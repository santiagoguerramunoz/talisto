'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import BuscadorProductos from '@/components/BuscadorProductos';
import RecibirOrden, { recibidoDeOrden } from '@/components/RecibirOrden';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { useAjustes } from '@/lib/ajustes';
import { esBusiness } from '@/lib/planes';
import { fechaHora, numeroMov } from '@/lib/stock';
import { numero, r2 } from '@/lib/precios';
import { fechaUY, numeroPresupuesto } from '@/lib/presupuestos';
import { linkWhatsapp, mensajeError } from '@/lib/util';
import { crearPdfOrdenCompra, nombreArchivoOrden } from '@/lib/ordenCompraPdf';
import {
  AVISO_SQL_09, ESTADOS_COMPRA, apiProveedores, estadoStock, importe, numeroOrden, revisarProductos, sinFuncion, textoOrden,
} from '@/lib/proveedores';

async function bajarLogo(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

const itemsParaEditar = (items) =>
  (items || []).map((i) => ({ ...i, cantidad: String(i.cantidad ?? ''), precio: String(i.precio ?? '') }));
const itemsParaGuardar = (items) =>
  items
    .filter((i) => String(i.item || '').trim())
    .map((i) => ({
      producto_id: i.producto_id || null,
      codigo: i.codigo || null,
      item: String(i.item).trim(),
      cantidad: numero(i.cantidad) ?? 0,
      unidad: i.unidad || 'u',
      precio: numero(i.precio) ?? 0,
    }));

export default function OrdenDeCompra() {
  const { id } = useParams();
  const router = useRouter();
  const { profesional, user, yo, empresa, permisos, plan } = usePanel();
  const { ajustes } = useAjustes(profesional.id);
  const puede = !empresa || yo?.id === profesional.id || (permisos || []).includes('compras');
  // Recibir en el stock (Business): la cuenta principal, Compras o Stock
  const puedeStock = esBusiness(plan?.plan) && (yo?.id === profesional.id || (permisos || []).includes('compras') || (permisos || []).includes('stock'));
  const [rec, setRec] = useState({ porRenglon: {}, recepciones: [] });
  const [recibiendo, setRecibiendo] = useState(false);
  const [o, setO] = useState(null);
  const [form, setForm] = useState(null);
  const [prov, setProv] = useState(null);
  const [presu, setPresu] = useState(null);
  const [estado, setEstado] = useState({ cargando: true, ocupado: false, error: '', ok: '' });
  const [cambios, setCambios] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [revision, setRevision] = useState(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('ordenes_compra').select('*').eq('id', id).maybeSingle();
    if (error || !data) {
      setEstado({ cargando: false, ocupado: false, error: error ? (sinFuncion(error) ? AVISO_SQL_09 : mensajeError(error)) : 'No encontramos esta orden.', ok: '' });
      return;
    }
    setO(data);
    setForm({ items: itemsParaEditar(data.items), entrega: data.entrega || '', notas: data.notas || '' });
    setCambios(false);
    setEstado((e) => ({ ...e, cargando: false }));
    const [pv, pr] = await Promise.all([
      data.proveedor_id
        ? supabase.from('proveedores').select('id, nombre, pedido_url, email, pedido_email, whatsapp, telefono, contacto').eq('id', data.proveedor_id).maybeSingle()
        : Promise.resolve({ data: null }),
      data.presupuesto_id ? supabase.from('presupuestos').select('id, numero, cliente_nombre').eq('id', data.presupuesto_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setProv(pv.data || null);
    setPresu(pr.data || null);
    const r = await recibidoDeOrden(data.id);
    setRec(r.error ? { porRenglon: {}, recepciones: [] } : r);
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (estado.cargando) return <p className="p-4 text-tinta-400">Cargando…</p>;
  if (!o || !form) {
    return (
      <div className="p-4">
        <p className="text-tinta-300">{estado.error || 'No encontramos esta orden.'}</p>
        <Link href="/panel/finanzas/compras" className="btn btn-sec mt-4">Volver a compras</Link>
      </div>
    );
  }

  const recepcionesVigentes = rec.recepciones.filter((r) => !r.anulado_por);
  const conRecepciones = rec.recepciones.length > 0;
  const editable = puede && ['borrador', 'enviada', 'confirmada'].includes(o.estado) && !recepcionesVigentes.length;
  const recibible = puedeStock && ['borrador', 'enviada', 'confirmada', 'parcial'].includes(o.estado);
  const subtotal = r2(form.items.reduce((s, i) => s + (numero(i.cantidad) ?? 0) * (numero(i.precio) ?? 0), 0));
  const negocio = {
    nombre: profesional.nombre_publico,
    razon_social: ajustes.razon_social,
    rut: ajustes.rut,
    telefono: ajustes.telefono || profesional.whatsapp,
    email: ajustes.email || (yo?.id === profesional.id ? user.email : ''),
    direccion: ajustes.direccion,
  };
  const datosProv = o.proveedor_datos || {};
  const telWhatsapp = prov?.whatsapp || datosProv.whatsapp || prov?.telefono || datosProv.telefono;
  const email = prov?.pedido_email || prov?.email || datosProv.email;

  const cambiarItem = (k, campo, valor) => {
    setForm((f) => ({ ...f, items: f.items.map((i, j) => (j === k ? { ...i, [campo]: valor } : i)) }));
    setCambios(true);
  };

  async function guardar(extra = {}, mensaje = 'Guardado.') {
    setEstado((e) => ({ ...e, ocupado: true, error: '', ok: '' }));
    const fila = editable ? { items: itemsParaGuardar(form.items), entrega: form.entrega.trim() || null, notas: form.notas.trim() || null, ...extra } : extra;
    const { data, error } = await supabase.from('ordenes_compra').update(fila).eq('id', o.id).select('*').single();
    if (error) {
      setEstado((e) => ({ ...e, ocupado: false, error: mensajeError(error) }));
      return null;
    }
    setO(data);
    setForm({ items: itemsParaEditar(data.items), entrega: data.entrega || '', notas: data.notas || '' });
    setCambios(false);
    setEstado((e) => ({ ...e, ocupado: false, ok: mensaje }));
    return data;
  }

  async function revisar() {
    setEstado((e) => ({ ...e, ocupado: true, error: '' }));
    try {
      setRevision(await revisarProductos(profesional.id, form.items.map((i) => i.producto_id)));
      setEstado((e) => ({ ...e, ocupado: false }));
    } catch (err) {
      setEstado((e) => ({ ...e, ocupado: false, error: err.message }));
    }
  }

  async function armarPdf() {
    const guardada = cambios ? await guardar({}, '') : o;
    if (!guardada) return null;
    const logo = await bajarLogo(ajustes.logo_url);
    const bytes = await crearPdfOrdenCompra({ orden: guardada, negocio, logo });
    return new File([bytes], nombreArchivoOrden(guardada), { type: 'application/pdf' });
  }

  function bajar(archivo) {
    const url = URL.createObjectURL(archivo);
    const a = document.createElement('a');
    a.href = url;
    a.download = archivo.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function compartirPdf() {
    try {
      const archivo = await armarPdf();
      if (!archivo) return;
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [archivo] })) {
        await navigator.share({ files: [archivo], title: archivo.name });
      } else bajar(archivo);
      if (o.estado === 'borrador') await guardar({ estado: 'enviada' }, 'Orden enviada.');
    } catch (e) {
      if (e?.name !== 'AbortError' && e?.name !== 'NotAllowedError') setEstado((x) => ({ ...x, error: `No se pudo armar el PDF: ${mensajeError(e)}` }));
    }
  }

  async function marcarEnviada() {
    if (cambios) await guardar({}, '');
    if (o.estado === 'borrador') await guardar({ estado: 'enviada' }, 'Orden marcada como enviada.');
  }

  async function enviarPorSistema() {
    if (cambios && !(await guardar({}, ''))) return;
    setEstado((e) => ({ ...e, ocupado: true, error: '', ok: '' }));
    try {
      await apiProveedores('pedido', { orden_id: o.id, comprador: negocio, reenviar: !!o.envio?.ok });
      await cargar();
      setEstado((e) => ({ ...e, ocupado: false, ok: 'El proveedor recibió la orden en su sistema.' }));
    } catch (err) {
      await cargar();
      setEstado((e) => ({ ...e, ocupado: false, error: err.message }));
    }
  }

  async function eliminar() {
    if (!window.confirm(`¿Eliminar la orden de compra Nº ${numeroOrden(o.numero)}?`)) return;
    const { error } = await supabase.from('ordenes_compra').delete().eq('id', o.id);
    if (error) return setEstado((e) => ({ ...e, error: mensajeError(error) }));
    router.replace('/panel/finanzas/compras');
  }

  const vistaOrden = { ...o, items: itemsParaGuardar(form.items), subtotal, entrega: form.entrega, notas: form.notas };
  const texto = textoOrden(vistaOrden, negocio);
  const est = ESTADOS_COMPRA[o.estado] || ESTADOS_COMPRA.borrador;

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/panel/finanzas/compras" className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver">
            <Icon name="izq" />
          </Link>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-menta-500/10 text-menta-300">
            <Icon name="caja" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-tinta-400">Orden de compra · {fechaUY(o.fecha)}</p>
            <h1 className="truncate text-xl font-extrabold">{o.proveedor_nombre}</h1>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${est.clase}`}>{est.texto}</span>
        </div>
      </header>

      <div className="space-y-5 px-4 pt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <b>Nº {numeroOrden(o.numero)}</b>
          {presu && (
            <Link href={`/panel/finanzas/presupuestos/${presu.id}`} className="inline-flex items-center gap-1 font-semibold text-menta-400">
              <Icon name="documento" className="h-4 w-4" /> Presupuesto {numeroPresupuesto(presu.numero)}
              {presu.cliente_nombre ? ` · ${presu.cliente_nombre}` : ''}
            </Link>
          )}
          {prov && (
            <Link href={`/panel/finanzas/proveedores/${prov.id}`} className="inline-flex items-center gap-1 font-semibold text-tinta-300">
              <Icon name="empresa" className="h-4 w-4" /> Ver proveedor
            </Link>
          )}
        </div>

        {estado.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>}
        {estado.ok && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{estado.ok}</p>}

        {/* Ítems */}
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="titulo-seccion">Productos ({form.items.length})</h2>
            <div className="flex gap-1.5">
              {form.items.some((i) => i.producto_id) && (
                <button type="button" className="chip" onClick={revisar} disabled={estado.ocupado}>
                  <Icon name="repetir" className="h-3.5 w-3.5" /> Stock
                </button>
              )}
              {editable && o.proveedor_id && (
                <button type="button" className="chip chip-activo" onClick={() => setBuscando(true)}>
                  <Icon name="mas" className="h-3.5 w-3.5" /> Agregar
                </button>
              )}
            </div>
          </div>
          {form.items.length === 0 ? (
            <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">Sin productos. Tocá Agregar para buscarlos en la lista del proveedor.</p>
          ) : (
            <ul className="space-y-2">
              {form.items.map((i, k) => {
                const st = i.producto_id && revision ? estadoStock(revision[i.producto_id], i.cantidad) : null;
                const linea = (numero(i.cantidad) ?? 0) * (numero(i.precio) ?? 0);
                return (
                  <li key={`${i.producto_id || 'm'}-${k}`} className="rounded-xl border border-navy-700 bg-navy-850 p-2.5">
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1">
                        <b className="block text-sm leading-snug">{i.item}</b>
                        <span className="text-[11px] text-tinta-400">
                          {i.codigo ? `cód. ${i.codigo}` : 'Sin código'}
                          {st && <span className={`ml-1.5 font-semibold ${st.clase}`}>{st.texto}</span>}
                          {rec.porRenglon[k] > 0 && (
                            <span className={`ml-1.5 font-semibold ${rec.porRenglon[k] >= (numero(i.cantidad) ?? 0) ? 'text-menta-300' : 'text-amber-300'}`}>
                              Llegó {Number(rec.porRenglon[k]).toLocaleString('es-UY')} de {Number(numero(i.cantidad) ?? 0).toLocaleString('es-UY')}
                            </span>
                          )}
                        </span>
                      </span>
                      {editable && (
                        <button
                          type="button"
                          className="shrink-0 rounded-lg p-1.5 text-tinta-400 hover:text-red-300"
                          onClick={() => {
                            setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== k) }));
                            setCambios(true);
                          }}
                          aria-label="Quitar"
                        >
                          <Icon name="cerrar" className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-[5rem_1fr_auto] items-end gap-2">
                      <label className="block">
                        <span className="mb-0.5 block text-[11px] text-tinta-400">Cantidad ({i.unidad || 'u'})</span>
                        <input className="campo px-2 py-1.5 text-sm" type="number" inputMode="decimal" min="0" value={i.cantidad} disabled={!editable} onChange={(e) => cambiarItem(k, 'cantidad', e.target.value)} />
                      </label>
                      <label className="block">
                        <span className="mb-0.5 block text-[11px] text-tinta-400">Precio unit. ({o.moneda})</span>
                        <input className="campo px-2 py-1.5 text-sm" type="number" inputMode="decimal" min="0" value={i.precio} disabled={!editable} onChange={(e) => cambiarItem(k, 'precio', e.target.value)} />
                      </label>
                      <span className="pb-2 text-right text-sm font-bold">{importe(linea, o.moneda)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-2 flex items-center justify-between rounded-xl bg-navy-850 px-3 py-2.5">
            <span className="text-sm text-tinta-300">Total {o.iva_incluido ? '(IVA incluido)' : '(sin IVA)'}</span>
            <b className="text-lg text-menta-300">{importe(subtotal, o.moneda)}</b>
          </div>
        </section>

        <section className="tarjeta space-y-3 p-4">
          <div>
            <label className="etiqueta" htmlFor="oc-ent">Entrega</label>
            <input id="oc-ent" className="campo" value={form.entrega} disabled={!editable} onChange={(e) => (setForm((f) => ({ ...f, entrega: e.target.value })), setCambios(true))} placeholder="Retiro en el local / En obra: dirección" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="oc-not">Notas para el proveedor</label>
            <textarea id="oc-not" rows={2} className="campo" value={form.notas} disabled={!editable} onChange={(e) => (setForm((f) => ({ ...f, notas: e.target.value })), setCambios(true))} />
          </div>
          {editable && cambios && (
            <button type="button" className="btn btn-menta w-full" onClick={() => guardar()} disabled={estado.ocupado}>
              {estado.ocupado ? 'Guardando…' : 'Guardar cambios'}
            </button>
          )}
        </section>

        {/* Recepción en el stock */}
        {(recibible || conRecepciones) && (
          <section className="space-y-2">
            <h2 className="titulo-seccion">Recepción</h2>
            {recibible && (
              <button type="button" className="btn btn-menta w-full" onClick={() => (cambios ? guardar({}, '') : Promise.resolve(o)).then((x) => x && setRecibiendo(true))} disabled={estado.ocupado || !form.items.length}>
                <Icon name="descargar" /> {o.estado === 'parcial' ? 'Recibir lo que faltaba' : 'Recibir en el stock'}
              </button>
            )}
            {rec.recepciones.map((r) => (
              <Link key={r.id} href={`/panel/finanzas/stock?mov=${r.id}`} className={`flex items-center justify-between gap-2 rounded-xl bg-navy-850 p-2.5 text-sm ${r.anulado_por ? 'opacity-60' : ''}`}>
                <span className="min-w-0">
                  <b className="block">{numeroMov(r.numero)}{r.referencia ? ` · ${r.referencia}` : ''}</b>
                  <span className="text-[11px] text-tinta-400">{fechaHora(r.creado_en)}{r.creado_por_nombre ? ` · ${r.creado_por_nombre}` : ''}{r.anulado_por ? ' · anulada' : ''}</span>
                </span>
                <Icon name="der" className="h-4 w-4 shrink-0 text-tinta-400" />
              </Link>
            ))}
          </section>
        )}

        {/* Enviar */}
        {o.estado !== 'cancelada' && !['parcial', 'recibida'].includes(o.estado) && (
          <section className="space-y-2">
            <h2 className="titulo-seccion">Mandar al proveedor</h2>
            {prov?.pedido_url && puede && (
              <button type="button" className="btn btn-menta w-full" onClick={enviarPorSistema} disabled={estado.ocupado || !form.items.length}>
                <Icon name="compartir" /> {o.envio?.ok ? 'Volver a mandar por sistema' : 'Mandar a su sistema'}
              </button>
            )}
            {o.envio && (
              <p className={`text-xs ${o.envio.ok ? 'text-menta-300' : 'text-red-300'}`}>
                {o.envio.ok ? 'Recibida por el sistema del proveedor' : 'No la recibió el sistema del proveedor'} ·{' '}
                {new Date(o.envio.en).toLocaleString('es-UY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-sec" onClick={compartirPdf} disabled={estado.ocupado || !form.items.length}>
                <Icon name="documento" /> PDF
              </button>
              {telWhatsapp ? (
                <a href={linkWhatsapp(telWhatsapp, texto)} target="_blank" rel="noreferrer" className="btn btn-sec" onClick={marcarEnviada}>
                  <Icon name="whatsapp" /> WhatsApp
                </a>
              ) : (
                <span className="btn btn-sec pointer-events-none opacity-40"><Icon name="whatsapp" /> WhatsApp</span>
              )}
            </div>
            {email && (
              <a
                href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Orden de compra Nº ${numeroOrden(o.numero)}${negocio.nombre ? ` · ${negocio.nombre}` : ''}`)}&body=${encodeURIComponent(texto)}`}
                className="btn btn-sec w-full"
                onClick={marcarEnviada}
              >
                <Icon name="compartir" /> Email a {email}
              </a>
            )}
            {!telWhatsapp && !email && !prov?.pedido_url && (
              <p className="text-xs text-amber-300">Cargá el WhatsApp o el email del proveedor para mandársela desde acá.</p>
            )}
          </section>
        )}

        {/* Estado */}
        {puede && (
          <section>
            <h2 className="titulo-seccion mb-2">Estado</h2>
            {recepcionesVigentes.length ? (
              <div className="space-y-2">
                <p className="text-sm text-tinta-300">
                  <span className={`mr-1.5 rounded-full px-2 py-0.5 text-xs font-bold ${est.clase}`}>{est.texto}</span>
                  El estado lo marca lo que se recibe en el stock.
                </p>
                {o.estado === 'parcial' && (
                  <button type="button" className="chip" onClick={() => window.confirm('¿Cancelar lo que falta recibir? Lo que ya llegó queda en el stock.') && guardar({ estado: 'cancelada' }, 'Se canceló lo que faltaba.')} disabled={estado.ocupado}>
                    No llega lo que falta: cancelar el resto
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                {Object.entries(ESTADOS_COMPRA)
                  .filter(([v]) => v !== 'parcial')
                  .map(([v, e]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        if (o.estado === v) return;
                        if (v === 'recibida' && recibible) setRecibiendo(true);
                        else guardar({ estado: v }, v === 'recibida' ? '¡Recibida!' : 'Estado guardado.');
                      }}
                      className={`chip justify-center ${o.estado === v ? 'chip-activo' : ''}`}
                      disabled={estado.ocupado}
                    >
                      {e.texto}
                    </button>
                  ))}
              </div>
            )}
          </section>
        )}

        {puede && !conRecepciones && (
          <button type="button" className="btn btn-peligro w-full" onClick={eliminar}>
            <Icon name="borrar" /> Eliminar orden
          </button>
        )}
        <div className="h-2" />
      </div>

      {puedeStock && (
        <RecibirOrden
          abierto={recibiendo}
          onCerrar={() => setRecibiendo(false)}
          orden={o}
          cuenta={profesional.id}
          recibido={rec.porRenglon}
          onListo={async (_, mensaje) => {
            await cargar();
            setEstado((e) => ({ ...e, ok: mensaje, error: '' }));
          }}
          onSinStock={
            o.estado !== 'parcial'
              ? async () => {
                  setRecibiendo(false);
                  await guardar({ estado: 'recibida' }, '¡Recibida! (sin pasar por el stock)');
                }
              : null
          }
        />
      )}

      {o.proveedor_id && (
        <BuscadorProductos
          abierto={buscando}
          onCerrar={() => setBuscando(false)}
          cuenta={profesional.id}
          proveedorId={o.proveedor_id}
          monedaDestino={o.moneda}
          titulo={`Productos de ${o.proveedor_nombre}`}
          onElegir={(p) => {
            setForm((f) => {
              const i = f.items.findIndex((x) => x.producto_id === p.id);
              if (i >= 0) return { ...f, items: f.items.map((x, j) => (j === i ? { ...x, cantidad: String((numero(x.cantidad) ?? 0) + 1) } : x)) };
              return { ...f, items: [...f.items, { producto_id: p.id, codigo: p.codigo, item: p.nombre, cantidad: '1', unidad: p.unidad || 'u', precio: String(p.precio) }] };
            });
            setCambios(true);
          }}
        />
      )}
    </>
  );
}
