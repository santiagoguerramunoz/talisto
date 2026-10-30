'use client';

import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { supabase } from '@/lib/supabase';
import { numero } from '@/lib/precios';
import { UNIDADES, cant, numeroMov, rpcStock, textoError } from '@/lib/stock';

const norm = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
const capital = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** Lo recibido por renglón de la orden (sin contar recepciones anuladas) */
export async function recibidoDeOrden(ordenId) {
  const { data, error } = await supabase
    .from('movimientos_stock')
    .select('id, numero, creado_en, referencia, anulado_por, creado_por_nombre, movimientos_stock_items(orden_item, cantidad_presentacion, cantidad)')
    .eq('orden_compra_id', ordenId)
    .eq('tipo', 'ingreso')
    .order('numero');
  if (error) return { porRenglon: {}, recepciones: [], error };
  const porRenglon = {};
  (data || [])
    .filter((m) => !m.anulado_por)
    .forEach((m) =>
      (m.movimientos_stock_items || []).forEach((i) => {
        if (i.orden_item === null || i.orden_item === undefined) return;
        porRenglon[i.orden_item] = (porRenglon[i.orden_item] || 0) + Number(i.cantidad_presentacion ?? i.cantidad);
      })
    );
  return { porRenglon, recepciones: data || [], error: null };
}

/**
 * Recibir una orden de compra en el stock (toda o lo que llegó).
 * Cada producto se vincula a un material (existente o nuevo) y se dice cuántas unidades mínimas trae.
 */
export default function RecibirOrden({ abierto, onCerrar, onListo, orden, cuenta, recibido = {}, onSinStock }) {
  const [lugares, setLugares] = useState(null);
  const [materiales, setMateriales] = useState([]);
  const [lineas, setLineas] = useState([]);
  const [destino, setDestino] = useState('');
  const [referencia, setReferencia] = useState('');
  const [nota, setNota] = useState('');
  const [estado, setEstado] = useState({ cargando: true, guardando: false, error: '' });

  const items = useMemo(() => (orden?.items || []).map((it, indice) => ({ ...it, indice })).filter((it) => String(it.item || '').trim()), [orden]);

  useEffect(() => {
    if (!abierto || !orden) return;
    let vivo = true;
    setEstado({ cargando: true, guardando: false, error: '' });
    setReferencia('');
    setNota('');
    (async () => {
      try {
        const ids = items.map((i) => i.producto_id).filter(Boolean);
        const [l, mats, vins] = await Promise.all([
          rpcStock('stock_lugares', { p_cuenta: cuenta }),
          supabase.from('materiales').select('id, nombre, codigo, unidad, decimales, presentaciones, activo').eq('profesional_id', cuenta).eq('activo', true).order('nombre'),
          ids.length ? supabase.from('materiales_vinculos').select('producto_id, material_id, factor').eq('profesional_id', cuenta).in('producto_id', ids) : Promise.resolve({ data: [] }),
        ]);
        if (!vivo) return;
        if (mats.error) throw mats.error;
        const lista = mats.data || [];
        const vinculo = Object.fromEntries((vins.data || []).map((v) => [v.producto_id, v]));
        setLugares(l);
        setDestino(l.depositos?.[0]?.id || '');
        setMateriales(lista);
        setLineas(
          items.map((it) => {
            const pedido = numero(it.cantidad) ?? 0;
            const falta = Math.max(0, pedido - (recibido[it.indice] || 0));
            const v = it.producto_id ? vinculo[it.producto_id] : null;
            const porCodigo = !v && it.codigo ? lista.find((m) => m.codigo && norm(m.codigo) === norm(it.codigo)) : null;
            const porNombre = !v && !porCodigo ? lista.find((m) => norm(m.nombre) === norm(it.item)) : null;
            const mat = v ? lista.find((m) => m.id === v.material_id) : porCodigo || porNombre;
            return {
              indice: it.indice,
              item: it.item,
              codigo: it.codigo,
              unidadOrden: it.unidad || 'u',
              pedido,
              ya: recibido[it.indice] || 0,
              cantidad: falta ? String(falta) : '',
              material_id: mat?.id || '',
              factor: String(v ? Number(v.factor) : 1),
              nuevoUnidad: it.unidad && UNIDADES.some((u) => u.id === it.unidad) ? it.unidad : 'u',
              recordado: !!v,
            };
          })
        );
        setEstado({ cargando: false, guardando: false, error: '' });
      } catch (e) {
        if (vivo) setEstado({ cargando: false, guardando: false, error: textoError(e) });
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, orden, cuenta]);

  const cambiar = (k, campo, valor) => setLineas((ls) => ls.map((l, j) => (j === k ? { ...l, [campo]: valor } : l)));

  async function guardar() {
    setEstado((e) => ({ ...e, guardando: true, error: '' }));
    if (!destino) return setEstado((e) => ({ ...e, guardando: false, error: 'Elegí a qué depósito entra.' }));
    const payload = [];
    for (const l of lineas) {
      const c = numero(l.cantidad);
      if (c === null || c === 0) continue;
      const fac = numero(l.factor);
      if (c < 0) return setEstado((e) => ({ ...e, guardando: false, error: `${l.item}: la cantidad no puede ser negativa.` }));
      if (fac === null || fac <= 0) return setEstado((e) => ({ ...e, guardando: false, error: `${l.item}: poné cuánto trae cada ${l.unidadOrden}.` }));
      const mat = materiales.find((m) => m.id === l.material_id);
      const unidadMat = mat ? mat.unidad : l.nuevoUnidad;
      payload.push({
        indice: l.indice,
        cantidad: c,
        factor: fac,
        material_id: l.material_id || null,
        nuevo: l.material_id ? null : { nombre: l.item, codigo: l.codigo || null, unidad: l.nuevoUnidad, decimales: UNIDADES.find((u) => u.id === l.nuevoUnidad)?.decimales ?? 0 },
        presentacion: fac !== 1 ? `${capital(l.unidadOrden === 'u' ? 'caja' : l.unidadOrden)} x ${cant(fac)} ${unidadMat}`.slice(0, 30) : null,
      });
    }
    if (!payload.length) return setEstado((e) => ({ ...e, guardando: false, error: 'Poné cuánto llegó de al menos un producto.' }));
    try {
      const r = await rpcStock('recibir_orden_compra', { p_orden: orden.id, p_destino: destino, p_lineas: payload, p_referencia: referencia.trim() || null, p_nota: nota.trim() || null });
      setEstado((e) => ({ ...e, guardando: false }));
      onListo?.(r, `${numeroMov(r.numero)}: entró al stock. La orden quedó ${r.estado_orden === 'recibida' ? 'recibida' : 'con una parte recibida'}.`);
      onCerrar();
    } catch (e) {
      setEstado((x) => ({ ...x, guardando: false, error: textoError(e) }));
    }
  }

  const lugaresDestino = [...(lugares?.depositos || []).filter((d) => d.activo !== false), ...(lugares?.equipo || []).filter((p) => p.activo !== false)];

  return (
    <Modal
      abierto={abierto}
      onCerrar={() => !estado.guardando && onCerrar()}
      titulo="Recibir en el stock"
      pie={
        <button type="button" className="btn btn-menta w-full" onClick={guardar} disabled={estado.guardando || estado.cargando}>
          {estado.guardando ? 'Guardando…' : 'Ingresar al stock'}
        </button>
      }
    >
      {estado.cargando ? (
        <p className="text-sm text-tinta-400">{estado.error || 'Cargando…'}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-tinta-300">Poné lo que llegó de verdad. Si falta algo, la orden queda con una parte recibida y lo recibís cuando llegue.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="etiqueta" htmlFor="ro-dest">Entra a</label>
              <select id="ro-dest" className="campo" value={destino} onChange={(e) => setDestino(e.target.value)}>
                {lugaresDestino.map((l) => (
                  <option key={l.id} value={l.id}>{l.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="etiqueta" htmlFor="ro-ref">Remito o factura</label>
              <input id="ro-ref" className="campo" value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={80} placeholder="Ej. Remito 0045" />
            </div>
          </div>

          <ul className="space-y-2">
            {lineas.map((l, k) => {
              const mat = materiales.find((m) => m.id === l.material_id);
              const unidadMat = mat ? mat.unidad : l.nuevoUnidad;
              const c = numero(l.cantidad) ?? 0;
              const fac = numero(l.factor) ?? 0;
              const completo = l.ya >= l.pedido && l.pedido > 0;
              return (
                <li key={l.indice} className={`rounded-xl border border-navy-700 bg-navy-850 p-2.5 ${completo ? 'opacity-60' : ''}`}>
                  <b className="block text-sm leading-snug">{l.item}</b>
                  <span className="text-[11px] text-tinta-400">
                    {l.codigo ? `cód. ${l.codigo} · ` : ''}pedido {cant(l.pedido)} {l.unidadOrden}
                    {l.ya > 0 ? ` · ya llegó ${cant(l.ya)}` : ''}
                  </span>
                  <div className="mt-2 grid grid-cols-[6rem_1fr] items-end gap-2">
                    <label className="block">
                      <span className="mb-0.5 block text-[11px] text-tinta-400">Llegó ({l.unidadOrden})</span>
                      <input className="campo px-2 py-1.5 text-sm" type="number" inputMode="decimal" min="0" step="any" value={l.cantidad} onChange={(e) => cambiar(k, 'cantidad', e.target.value)} aria-label={`Cuánto llegó de ${l.item}`} />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-0.5 block text-[11px] text-tinta-400">Material del stock</span>
                      <select className="campo px-2 py-1.5 text-sm" value={l.material_id} onChange={(e) => cambiar(k, 'material_id', e.target.value)} aria-label={`Material para ${l.item}`}>
                        <option value="">+ Crear “{l.item.slice(0, 30)}”</option>
                        {materiales.map((m) => (
                          <option key={m.id} value={m.id}>{m.nombre} ({m.unidad})</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-tinta-300">
                    <span>Cada {l.unidadOrden} trae</span>
                    <input className="campo w-20 px-2 py-1 text-sm" type="number" inputMode="decimal" min="0" step="any" value={l.factor} onChange={(e) => cambiar(k, 'factor', e.target.value)} aria-label={`Cuánto trae cada ${l.unidadOrden}`} />
                    {mat ? (
                      <span>{unidadMat}</span>
                    ) : (
                      <select className="campo w-auto px-2 py-1 text-sm" value={l.nuevoUnidad} onChange={(e) => cambiar(k, 'nuevoUnidad', e.target.value)} aria-label="Unidad del material nuevo">
                        {UNIDADES.map((u) => (
                          <option key={u.id} value={u.id}>{u.id}</option>
                        ))}
                      </select>
                    )}
                    {c > 0 && fac > 0 && fac !== 1 && (
                      <b className="text-menta-300">= {cant(c * fac)} {unidadMat}</b>
                    )}
                    {l.recordado && <span className="text-tinta-500">(recordado)</span>}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-tinta-400">
            <Icon name="check" className="mr-1 inline h-3.5 w-3.5 text-menta-400" />
            La próxima vez que compres estos productos se reconocen solos, con su material y cuánto trae cada uno. El costo por unidad se actualiza con el precio de la orden.
          </p>

          <div>
            <label className="etiqueta" htmlFor="ro-nota">Nota (opcional)</label>
            <input id="ro-nota" className="campo" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} />
          </div>
          {estado.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>}
          {onSinStock && (
            <button type="button" className="w-full text-center text-xs font-semibold text-tinta-400 underline" onClick={onSinStock} disabled={estado.guardando}>
              Marcar recibida sin pasar por el stock
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
