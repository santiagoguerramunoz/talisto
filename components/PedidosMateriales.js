'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { nuevoRenglon } from './StockRenglones';
import { supabase } from '@/lib/supabase';
import { avisar } from '@/lib/avisos';
import { normalizarMaterial } from '@/lib/stock';
import { mensajeError } from '@/lib/util';

const sinSql = (e) => !!e && (e.code === 'PGRST202' || e.code === '42883');
const norm = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const cant = (n) => (Number(n) || 0).toLocaleString('es-UY', { maximumFractionDigits: 3 });

// Busca en el stock el material de cada renglón pedido (por id, por nombre exacto o parecido)
export function emparejar(items, materiales) {
  const lista = (materiales || []).map(normalizarMaterial);
  return items.map((it) => {
    let m = it.material_id ? lista.find((x) => x.id === it.material_id) : null;
    const q = norm(it.descripcion);
    if (!m && q) m = lista.find((x) => norm(x.nombre) === q);
    if (!m && q) m = lista.find((x) => norm(x.nombre).includes(q) || q.includes(norm(x.nombre)));
    if (!m && q) {
      const palabras = q.split(' ').filter((p) => p.length > 2);
      m = lista.find((x) => palabras.length && palabras.every((p) => norm(`${x.nombre} ${x.codigo || ''}`).includes(p)));
    }
    return { it, material: m || null };
  });
}

/**
 * Stock: pedidos de materiales de los tickets para aprobar.
 * Aprobar = entregar con un comprobante (al operario del ticket, o directo al trabajo). Rechazar = con el motivo.
 * onEntregar(pedido, { accion, preset }) abre el formulario de movimiento ya cargado.
 */
export default function PedidosMateriales({ cuenta, ctx, gestiona, onEntregar, recarga = 0 }) {
  const [lista, setLista] = useState(null);
  const [rechazando, setRechazando] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const ref = useRef(null);

  const cargar = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('pedidos_materiales_de', { p_cuenta: cuenta, p_estado: 'pendiente' });
    if (err) {
      if (!sinSql(err)) setError(mensajeError(err));
      setLista([]);
      return;
    }
    setLista(data || []);
  }, [cuenta]);

  useEffect(() => {
    cargar();
  }, [cargar, recarga]);
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('pedidos') && lista?.length) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      /* nada */
    }
  }, [lista]);

  if (!lista?.length && !error) return null;

  function entregar(p) {
    const pares = emparejar(p.items || [], ctx?.materiales);
    const renglones = pares.filter((x) => x.material).map((x) => nuevoRenglon(x.material, Number(x.it.cantidad) || 1));
    const faltan = pares.filter((x) => !x.material).map((x) => `${cant(x.it.cantidad)} ${x.it.unidad || 'u'} ${x.it.descripcion}`);
    const operario = p.asignado_a ? (ctx?.equipo || []).find((e) => e.usuario_id === p.asignado_a) : null;
    const nota = `Pedido de materiales Nº ${p.numero}${p.ticket_numero ? ` · Ticket Nº ${String(p.ticket_numero).padStart(4, '0')}` : ''}${faltan.length ? ` · Sin material en el stock: ${faltan.join(', ')}` : ''}`;
    if (operario) onEntregar(p, { accion: 'entrega', preset: { destino: operario.id, renglones, nota } });
    else onEntregar(p, { accion: 'a_trabajo', preset: { trabajo: { tipo: p.turno_id ? 'turno' : 'ticket', id: p.turno_id || p.orden_id, nombre: p.titulo }, renglones, nota } });
  }

  async function rechazar(p) {
    if (!motivo.trim()) return setError('Poné el motivo del rechazo: le llega a quien lo pidió y al operario.');
    setError('');
    const { error: err } = await supabase.rpc('resolver_pedido_materiales', { p_id: p.id, p_estado: 'rechazado', p_movimiento: null, p_respuesta: motivo.trim() });
    if (err) return setError(mensajeError(err));
    avisar();
    setRechazando('');
    setMotivo('');
    cargar();
  }

  return (
    <section ref={ref} className="tarjeta scroll-mt-24 overflow-hidden border-amber-400/50">
      <h2 className="flex items-center gap-2 border-b border-navy-800 px-4 py-3 font-bold text-amber-300">
        <Icon name="caja" className="h-5 w-5" /> Pedidos de materiales para aprobar · {lista?.length || 0}
      </h2>
      {error && <p className="m-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      <ul className="divide-y divide-navy-800">
        {(lista || []).map((p) => {
          const pares = emparejar(p.items || [], ctx?.materiales);
          return (
            <li key={p.id} className="space-y-2 px-4 py-3">
              <div>
                <p className="text-xs text-tinta-400">
                  Pedido Nº {p.numero}
                  {p.ticket_numero ? ` · Ticket Nº ${String(p.ticket_numero).padStart(4, '0')}` : ''}
                  {p.presupuesto_numero ? ` · Presupuesto Nº ${String(p.presupuesto_numero).padStart(4, '0')}` : ''} · {p.creado_por_nombre || 'Equipo'}
                </p>
                <b className="block">{p.titulo}</b>
                <p className="text-xs text-tinta-300">
                  {p.por_agendar ? 'Ticket todavía sin día' : p.inicio ? new Date(p.inicio).toLocaleString('es-UY', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                  {p.asignado ? ` · lo hace ${p.asignado}` : ' · sin operario asignado'}
                </p>
              </div>
              <ul className="rounded-xl bg-navy-850 p-2.5 text-sm">
                {pares.map(({ it, material }, k) => (
                  <li key={k} className="flex items-center justify-between gap-2 py-0.5">
                    <span className="min-w-0">
                      {it.descripcion}
                      {material ? (
                        material.nombre !== it.descripcion && <span className="block text-[11px] text-menta-300">En stock: {material.nombre}</span>
                      ) : (
                        <span className="block text-[11px] text-amber-300">No está en el stock: agregalo a mano o compralo</span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-tinta-300">
                      {cant(it.cantidad)} {it.unidad || 'u'}
                    </span>
                  </li>
                ))}
              </ul>
              {gestiona &&
                (rechazando === p.id ? (
                  <div className="space-y-2">
                    <input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} placeholder="Motivo. Ej. No hay stock: se compra para el jueves" />
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className="btn btn-sec py-2 text-sm" onClick={() => setRechazando('')}>Volver</button>
                      <button type="button" className="btn btn-peligro py-2 text-sm" onClick={() => rechazar(p)}>Rechazar</button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <button type="button" className="btn btn-menta py-2.5 text-sm" onClick={() => entregar(p)}>
                      <Icon name="check" className="h-4 w-4" /> {p.asignado ? `Aprobar y entregar a ${p.asignado.split(' ')[0]}` : 'Aprobar y mandar al trabajo'}
                    </button>
                    <button type="button" className="btn btn-sec py-2.5 text-sm" onClick={() => (setRechazando(p.id), setMotivo(''))}>
                      Rechazar
                    </button>
                  </div>
                ))}
            </li>
          );
        })}
      </ul>
      <p className="px-4 pb-3 text-[11px] text-tinta-500">Al aprobar se abre la entrega ya cargada: revisala, elegí de qué depósito sale y confirmá. Sale con remito.</p>
    </section>
  );
}
