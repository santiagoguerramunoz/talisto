'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { supabase } from '@/lib/supabase';
import { avisar, haceRato } from '@/lib/avisos';
import { presupuestoNuevo } from '@/lib/presupuestos';
import { mensajeError } from '@/lib/util';

const sinTabla = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || e.code === '42883');
const cant = (n) => (Number(n) || 0).toLocaleString('es-UY', { maximumFractionDigits: 3 });

/**
 * Lo que el equipo pidió cotizar desde el lugar (SQL 11).
 * Ventas lo pasa a un presupuesto (con los renglones ya cargados) o lo descarta con el motivo.
 */
export default function PedidosCotizacion({ cuenta, ajustes, onCambio }) {
  const router = useRouter();
  const [lista, setLista] = useState([]);
  const [abierto, setAbierto] = useState('');
  const [descartando, setDescartando] = useState('');
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [error, setError] = useState('');
  const ref = useRef(null);

  const cargar = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('cotizaciones_pedidas')
      .select('id, numero, orden_id, turno_id, cliente_id, titulo, direccion, items, nota, creado_por_nombre, creado_en, clientes(nombre, es_empresa)')
      .eq('profesional_id', cuenta)
      .eq('estado', 'pendiente')
      .order('creado_en', { ascending: true })
      .limit(50);
    if (err) {
      if (!sinTabla(err)) setError(mensajeError(err));
      return;
    }
    setLista(data || []);
  }, [cuenta]);

  useEffect(() => {
    cargar();
    try {
      if (new URLSearchParams(window.location.search).get('pedidas')) setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
    } catch {
      /* nada */
    }
  }, [cargar]);

  async function armar(c) {
    setError('');
    setOcupado(c.id);
    const items = (c.items || []).map((i) => ({ item: i.tipo === 'tarea' ? `Mano de obra: ${i.descripcion}` : i.descripcion, cantidad: i.cantidad, unidad: i.tipo === 'tarea' ? 'tarea' : i.unidad }));
    const { data, error: err } = await supabase
      .from('presupuestos')
      .insert(
        presupuestoNuevo({
          profesionalId: cuenta,
          ajustes,
          cliente: c.cliente_id ? { id: c.cliente_id, nombre: c.clientes?.nombre || null } : null,
          lugar: c.direccion ? { direccion: c.direccion } : null,
          items,
          titulo: c.titulo || '',
        })
      )
      .select('id')
      .single();
    if (err) {
      setOcupado('');
      return setError(mensajeError(err));
    }
    const { error: e2 } = await supabase.rpc('resolver_cotizacion', { p_id: c.id, p_estado: 'presupuestada', p_presupuesto: data.id, p_respuesta: null });
    setOcupado('');
    if (e2) return setError(mensajeError(e2));
    avisar();
    onCambio?.();
    router.push(`/panel/finanzas/presupuestos/${data.id}`);
  }

  async function descartar(c) {
    if (!motivo.trim()) return setError('Poné el motivo: le llega a quien lo pidió.');
    setError('');
    setOcupado(c.id);
    const { error: err } = await supabase.rpc('resolver_cotizacion', { p_id: c.id, p_estado: 'descartada', p_presupuesto: null, p_respuesta: motivo.trim() });
    setOcupado('');
    if (err) return setError(mensajeError(err));
    avisar();
    setDescartando('');
    setMotivo('');
    cargar();
  }

  if (!lista.length && !error) return null;
  return (
    <section ref={ref} className="tarjeta mb-4 scroll-mt-24 overflow-hidden border-marca-naranja/50">
      <h2 className="flex items-center gap-2 border-b border-navy-800 px-4 py-3 font-bold text-marca-naranja">
        <Icon name="calculadora" className="h-5 w-5" /> Pedidos de cotización del equipo · {lista.length}
      </h2>
      {error && <p className="m-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      <ul>
        {lista.map((c) => {
          const ver = abierto === c.id;
          const b2b = c.orden_id ? true : !!c.clientes?.es_empresa;
          return (
            <li key={c.id} className="border-b border-navy-800 last:border-0">
              <button type="button" onClick={() => setAbierto(ver ? '' : c.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-navy-850">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-tinta-400">
                    <b className={b2b ? 'text-[#8cc8ff]' : 'text-violet-200'}>{b2b ? 'B2B' : 'B2C'}</b> · Pedido Nº {c.numero} · {c.creado_por_nombre || 'Equipo'} · {haceRato(c.creado_en)}
                  </span>
                  <b className="block truncate">{c.titulo || 'Trabajo'}</b>
                  <span className="block truncate text-sm text-tinta-300">{(c.items || []).map((i) => i.descripcion).join(' · ')}</span>
                </span>
                <Icon name={ver ? 'arriba' : 'abajo'} className="mt-1 h-4 w-4 shrink-0 text-tinta-400" />
              </button>
              {ver && (
                <div className="space-y-3 bg-navy-850/60 px-4 pb-4 pt-1">
                  {c.direccion && (
                    <p className="text-sm text-tinta-300">
                      <Icon name="pin" className="mr-1 inline h-3.5 w-3.5" />
                      {c.direccion}
                    </p>
                  )}
                  <table className="w-full text-sm">
                    <tbody>
                      {(c.items || []).map((i, k) => (
                        <tr key={k} className="border-b border-navy-800 last:border-0">
                          <td className="py-1.5 pr-2 text-[11px] font-bold uppercase text-tinta-400">{i.tipo === 'tarea' ? 'Tarea' : 'Material'}</td>
                          <td className="py-1.5">{i.descripcion}</td>
                          <td className="whitespace-nowrap py-1.5 pl-2 text-right tabular-nums text-tinta-300">
                            {i.tipo === 'tarea' && Number(i.cantidad) === 1 ? '' : `${cant(i.cantidad)} ${i.unidad || ''}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {c.nota && <p className="rounded-xl bg-navy-900 p-2.5 text-sm text-tinta-200">“{c.nota}”</p>}
                  {descartando === c.id ? (
                    <div className="space-y-2">
                      <input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} placeholder="¿Por qué no se cotiza? Ej. Ya está incluido en el contrato" />
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" className="btn btn-sec py-2 text-sm" onClick={() => setDescartando('')}>Volver</button>
                        <button type="button" className="btn btn-peligro py-2 text-sm" onClick={() => descartar(c)} disabled={ocupado === c.id}>
                          Descartar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <button type="button" className="btn btn-menta py-2.5" onClick={() => armar(c)} disabled={ocupado === c.id}>
                        <Icon name="documento" className="h-4 w-4" /> {ocupado === c.id ? 'Armando…' : 'Armar presupuesto'}
                      </button>
                      <button type="button" className="btn btn-sec py-2.5 text-sm" onClick={() => (setDescartando(c.id), setMotivo(''))}>
                        Descartar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
