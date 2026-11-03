'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import GraficoPrecios, { BarrasProveedores } from './GraficoPrecios';
import { usePanel } from './PanelContext';
import { supabase } from '@/lib/supabase';
import { fechaUY } from '@/lib/presupuestos';
import { mensajeError } from '@/lib/util';
import { dinero } from '@/lib/precios';
import { MENSAJE_FALTA_SQL, haceDias, pct, pesos, sinInteligencia, unidadTexto } from '@/lib/compras';

const ORIGEN = { comprobante: 'Comprobante', orden_compra: 'Orden de compra', manual: 'Manual', compra: 'Compra', lista: 'Lista de precios' };

export async function verComprobante(id) {
  if (!id) return;
  const { data } = await supabase.from('comprobantes').select('archivos').eq('id', id).maybeSingle();
  const ruta = data?.archivos?.[0];
  if (!ruta) return;
  const { data: url } = await supabase.storage.from('comprobantes').createSignedUrl(ruta, 300);
  if (url?.signedUrl) window.open(url.signedUrl, '_blank', 'noopener');
}

// De dónde sale un precio: el comprobante (se puede abrir), la orden de compra o la lista del proveedor
export function Respaldo({ fila }) {
  if (fila.comprobante_id) {
    return (
      <button type="button" className="inline-flex items-center gap-1 font-semibold text-[#8cc8ff] underline-offset-2 hover:underline" onClick={() => verComprobante(fila.comprobante_id)}>
        <Icon name="documento" className="h-3 w-3" /> {fila.documento || 'Comprobante'}
      </button>
    );
  }
  if (fila.orden_compra_id) {
    return (
      <Link href={`/panel/finanzas/compras/${fila.orden_compra_id}`} className="inline-flex items-center gap-1 font-semibold text-[#8cc8ff] hover:underline">
        <Icon name="documento" className="h-3 w-3" /> {fila.documento || 'Orden de compra'}
      </Link>
    );
  }
  return <span>{fila.documento || ORIGEN[fila.origen] || ''}</span>;
}

/**
 * Ficha de un artículo: comparador de proveedores, recomendación, evolución, historial con su respaldo
 * y "es el mismo producto" para unir equivalentes.
 */
export default function FichaArticulo({ articuloId, cuenta, onCerrar, onCambio }) {
  const { profesional, yo, empresa, permisos } = usePanel();
  const puedeEditar = !empresa || yo?.id === profesional?.id || (permisos || []).some((p) => p === 'compras' || p === 'stock');
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [anulando, setAnulando] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [uniendo, setUniendo] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [encontrados, setEncontrados] = useState([]);
  const [destino, setDestino] = useState(null);
  const [factor, setFactor] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState('');
  const [id, setId] = useState(articuloId);

  useEffect(() => setId(articuloId), [articuloId]);

  const cargar = useCallback(async () => {
    if (!id) return;
    const { data, error: err } = await supabase.rpc('articulo_precios', { p_articulo: id });
    if (err) {
      setError(sinInteligencia(err) ? MENSAJE_FALTA_SQL : mensajeError(err));
      setDatos(null);
      return;
    }
    setError('');
    setDatos(data);
  }, [id]);

  useEffect(() => {
    setDatos(null);
    setAviso('');
    setUniendo(false);
    setAnulando(null);
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!uniendo || !cuenta) return undefined;
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('buscar_articulos', { p_cuenta: cuenta, p_texto: busqueda, p_limite: 12 });
      setEncontrados((data || []).filter((a) => a.id !== datos?.articulo?.id));
    }, 300);
    return () => clearTimeout(t);
  }, [uniendo, busqueda, cuenta, datos?.articulo?.id]);

  async function anular() {
    if (!motivo.trim()) return;
    setOcupado(true);
    const { error: err } = await supabase.rpc('anular_precio', { p_id: anulando, p_motivo: motivo.trim() });
    setOcupado(false);
    if (err) return setAviso(mensajeError(err));
    setAnulando(null);
    setMotivo('');
    setAviso('Precio anulado. Queda en el historial con el motivo y ya no se usa para comparar.');
    cargar();
    onCambio?.();
  }

  async function unir(otro, f) {
    setOcupado(true);
    const { error: err } = await supabase.rpc('unir_articulos', { p_origen: otro.id, p_destino: datos.articulo.id, p_factor: f ? Number(String(f).replace(',', '.')) : null });
    setOcupado(false);
    if (err) return setAviso(mensajeError(err));
    setUniendo(false);
    setDestino(null);
    setFactor('');
    setAviso(`Listo: "${otro.nombre}" ahora se compara junto con este artículo.`);
    cargar();
    onCambio?.();
  }

  const a = datos?.articulo;
  const rec = datos?.recomendacion;
  const comp = datos?.comparador || [];
  const hist = datos?.historial || [];
  const unidad = a?.unidad || 'u';

  return (
    <Modal abierto={!!articuloId} onCerrar={onCerrar} titulo={a?.nombre || 'Artículo'}>
      {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {!datos && !error && <p className="py-8 text-center text-sm text-tinta-400">Cargando precios…</p>}
      {datos && (
        <div className="space-y-4">
          <p className="text-xs text-tinta-400">
            Precios sin IVA, en pesos, por {unidadTexto(unidad)}
            {a.material ? <> · material del stock: <b className="text-tinta-200">{a.material}</b></> : ''}
            {datos.ultimo ? ` · última compra ${haceDias(datos.ultimo.fecha)}` : ''}
          </p>
          {aviso && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-200">{aviso}</p>}

          {rec && (
            <section className={`rounded-2xl border p-3.5 ${rec.suficiente ? 'border-menta-500/40 bg-menta-500/10' : 'border-navy-700 bg-navy-850'}`}>
              <p className="flex items-start gap-2 text-sm font-semibold">
                <Icon name={rec.suficiente ? 'estrella' : 'documento'} className={`mt-0.5 h-4 w-4 shrink-0 ${rec.suficiente ? 'text-menta-300' : 'text-tinta-400'}`} />
                <span>{rec.texto}</span>
              </p>
              {rec.notas?.length > 0 && (
                <ul className="mt-2 space-y-0.5 pl-6 text-xs text-tinta-300">
                  {rec.notas.map((n) => (
                    <li key={n} className="list-disc">{n}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section>
            <h3 className="titulo-seccion mb-2">Comparador de proveedores</h3>
            {comp.length === 0 ? (
              <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">Todavía no hay precios de este artículo.</p>
            ) : (
              <ul className="space-y-2">
                {comp.map((f, i) => (
                  <li key={`${f.proveedor_id}-${f.origen}-${i}`} className={`rounded-xl border p-2.5 ${f.mejor ? 'border-menta-500/50 bg-menta-500/5' : 'border-navy-700 bg-navy-850'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-bold">
                          {f.proveedor_id ? (
                            <Link href={`/panel/finanzas/proveedores/${f.proveedor_id}`} className="hover:underline">{f.proveedor}</Link>
                          ) : (
                            f.proveedor
                          )}
                        </p>
                        <p className="text-[11px] text-tinta-400">
                          {f.origen === 'lista' ? 'Lista de precios' : `Última compra ${fechaUY(f.fecha)}`}
                          {f.compras > 1 ? ` · ${f.compras} compras` : ''}
                          {f.stock !== null && f.stock !== undefined ? ` · stock informado: ${Number(f.stock).toLocaleString('es-UY')}` : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-lg font-extrabold tabular-nums ${f.mejor ? 'text-menta-300' : ''}`}>{pesos(f.precio_base_uyu)}</p>
                        {f.mejor ? (
                          <p className="text-[11px] font-bold text-menta-300">Más económico</p>
                        ) : (
                          f.diferencia_pct !== null && <p className="text-[11px] font-semibold text-red-300">+{pesos(f.diferencia)} ({pct(f.diferencia_pct, { signo: false })})</p>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-tinta-400">
                      {(f.moneda === 'USD' || Number(f.factor) !== 1) && (
                        <span>
                          {dinero(f.precio, f.moneda)} {Number(f.factor) !== 1 ? `(trae ${Number(f.factor).toLocaleString('es-UY')} ${unidad})` : ''}
                        </span>
                      )}
                      <Respaldo fila={f} />
                      {f.desactualizado && <span className="font-semibold text-amber-300">Precio de {haceDias(f.fecha)}: puede estar desactualizado</span>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(hist.filter((h) => !h.anulado).length > 1 || comp.length > 1) && (
            <section className="tarjeta space-y-4 p-3.5">
              <h3 className="titulo-seccion">Evolución del precio</h3>
              <GraficoPrecios historial={hist} unidad={unidad} />
              <BarrasProveedores filas={comp} />
            </section>
          )}

          <section>
            <h3 className="titulo-seccion mb-2">Historial de compras ({hist.length})</h3>
            <ul className="divide-y divide-navy-800 rounded-xl border border-navy-700 bg-navy-850">
              {[...hist].reverse().map((h) => (
                <li key={h.id} className={`px-3 py-2 text-sm ${h.anulado ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <b className={h.anulado ? 'line-through' : ''}>{pesos(h.precio_base_uyu)}</b>{' '}
                      <span className="text-tinta-300">· {h.proveedor || 'Sin proveedor'}</span>
                      <span className="block text-[11px] text-tinta-400">
                        {fechaUY(h.fecha)}
                        {h.cantidad ? ` · ${Number(h.cantidad).toLocaleString('es-UY')} ${h.unidad || ''}` : ''}
                        {h.moneda === 'USD' || Number(h.factor) !== 1 ? ` · ${dinero(h.precio, h.moneda)} c/u` : ''}
                        {h.descripcion && h.descripcion !== a.nombre ? ` · "${h.descripcion}"` : ''}
                      </span>
                      <span className="block text-[11px] text-tinta-400">
                        <Respaldo fila={h} />
                        {h.creado_por_nombre ? ` · cargó ${h.creado_por_nombre}` : ''}
                      </span>
                      {h.anulado && <span className="block text-[11px] font-semibold text-amber-300">Anulado: {h.anulado_motivo}</span>}
                    </span>
                    {puedeEditar && !h.anulado && (
                      <button type="button" className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-tinta-400 hover:bg-navy-800" onClick={() => setAnulando(anulando === h.id ? null : h.id)}>
                        Anular
                      </button>
                    )}
                  </div>
                  {anulando === h.id && (
                    <div className="mt-2 flex gap-2">
                      <input className="campo min-w-0 flex-1 px-3 py-2 text-sm" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué se anula (ej.: la IA leyó mal el precio)" autoFocus />
                      <button type="button" className="btn btn-menta shrink-0 px-3 py-2 text-sm" disabled={ocupado || !motivo.trim()} onClick={anular}>Anular</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-tinta-500">Ningún precio se borra: si estaba mal se anula y queda registrado quién lo hizo y por qué.</p>
          </section>

          {puedeEditar && (
            <section className="rounded-2xl bg-navy-850 p-3.5">
              <h3 className="titulo-seccion">¿Es el mismo producto?</h3>
              <p className="mt-1 text-xs text-tinta-400">
                TaListo! compara solo lo que es igual (misma descripción, medida y unidad). Si otro artículo es el mismo producto con otro nombre o en otra presentación, unilos.
              </p>
              {datos.equivalentes?.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {datos.equivalentes.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 rounded-xl bg-navy-900 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">Parecido: <b>{e.nombre}</b></span>
                      <span className="flex shrink-0 gap-1">
                        <button type="button" className="chip text-xs" onClick={() => setId(e.id)}>Ver</button>
                        <button type="button" className="chip chip-activo text-xs" disabled={ocupado} onClick={() => unir(e, null)}>Es el mismo</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {!uniendo ? (
                <button type="button" className="chip mt-2 text-xs" onClick={() => setUniendo(true)}>
                  <Icon name="buscar" className="h-3.5 w-3.5" /> Unir con otro artículo
                </button>
              ) : (
                <div className="mt-2 space-y-2">
                  <input className="campo px-3 py-2 text-sm" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar el otro artículo…" autoFocus />
                  <ul className="max-h-48 space-y-1 overflow-y-auto">
                    {encontrados.map((e) => (
                      <li key={e.id}>
                        <button type="button" className={`w-full rounded-lg px-3 py-1.5 text-left text-sm ${destino?.id === e.id ? 'bg-navy-700' : 'hover:bg-navy-800'}`} onClick={() => setDestino(e)}>
                          {e.nombre} <span className="text-xs text-tinta-400">· por {unidadTexto(e.unidad)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {destino && (
                    <div className="space-y-2 rounded-xl bg-navy-900 p-2.5 text-sm">
                      {destino.unidad !== unidad ? (
                        <label className="block">
                          <span className="mb-1 block text-xs text-tinta-300">
                            ¿Cuántos {unidadTexto(unidad)} trae cada {unidadTexto(destino.unidad)} de “{destino.nombre}”?
                          </span>
                          <input className="campo px-3 py-2 text-sm" inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value)} placeholder="Ej.: 305" />
                        </label>
                      ) : (
                        <p className="text-xs text-tinta-300">Misma unidad: sus precios pasan a compararse con los de este artículo.</p>
                      )}
                      <div className="flex gap-2">
                        <button type="button" className="btn btn-sec flex-1 py-2" onClick={() => { setUniendo(false); setDestino(null); }}>Cancelar</button>
                        <button type="button" className="btn btn-menta flex-1 py-2" disabled={ocupado || (destino.unidad !== unidad && !(Number(String(factor).replace(',', '.')) > 0))} onClick={() => unir(destino, destino.unidad !== unidad ? factor : null)}>
                          Unir
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
