'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { supabase } from '@/lib/supabase';
import { numero, r2 } from '@/lib/precios';
import { mensajeError } from '@/lib/util';
import { ESTADOS_COMPRA, estadoStock, importe, numeroOrden, revisarProductos, sinFuncion } from '@/lib/proveedores';

/**
 * En el presupuesto: revisar stock y precios de los materiales del catálogo y
 * armar una orden de compra por proveedor.
 * items: líneas del formulario · onItems(nuevas): para actualizar precios
 * guardarAntes(): guarda el presupuesto (devuelve la fila o null)
 */
export default function CompraMateriales({ presupuesto, items, onItems, cuenta, puedeComprar, revision, onRevision, guardarAntes }) {
  const [revisando, setRevisando] = useState(false);
  const [error, setError] = useState('');
  const [ordenes, setOrdenes] = useState(null);
  const [armando, setArmando] = useState(false);

  const delCatalogo = useMemo(() => (items || []).filter((m) => m.producto_id && String(m.item || '').trim()), [items]);

  const cargarOrdenes = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('ordenes_compra')
      .select('id, numero, proveedor_nombre, estado, subtotal, moneda')
      .eq('presupuesto_id', presupuesto.id)
      .order('numero');
    setOrdenes(e ? (sinFuncion(e) ? null : []) : data || []);
  }, [presupuesto.id]);

  useEffect(() => {
    cargarOrdenes();
  }, [cargarOrdenes]);

  async function revisar() {
    setError('');
    setRevisando(true);
    try {
      onRevision(await revisarProductos(cuenta, delCatalogo.map((m) => m.producto_id)));
    } catch (e) {
      setError(e.message);
    }
    setRevisando(false);
  }

  if (!delCatalogo.length && !ordenes?.length) return null;

  const estados = revision ? delCatalogo.map((m) => estadoStock(revision[m.producto_id], m.cantidad)).filter(Boolean) : [];
  const conProblema = estados.filter((e) => ['sin', 'poco', 'baja'].includes(e.tipo)).length;
  const cambiados = revision
    ? delCatalogo.filter((m) => {
        const info = revision[m.producto_id];
        return info && info.moneda !== 'USD' && numero(m.costo) !== null && Math.abs(Number(info.precio) - numero(m.costo)) >= 0.01;
      })
    : [];

  function actualizarPrecios() {
    onItems(
      items.map((m) => {
        const info = m.producto_id && revision?.[m.producto_id];
        if (!info || info.moneda === 'USD') return m;
        const costo = Number(info.precio);
        const margen = numero(m.margen) ?? 0;
        return { ...m, costo: String(costo), precio: String(r2(costo * (1 + margen / 100))) };
      })
    );
  }

  return (
    <section className="tarjeta space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Icon name="caja" className="h-5 w-5 text-menta-300" />
        <h2 className="flex-1 font-bold">Compra de materiales</h2>
      </div>

      {delCatalogo.length > 0 && (
        <>
          <p className="text-sm text-tinta-300">
            {delCatalogo.length} {delCatalogo.length === 1 ? 'material es' : 'materiales son'} del catálogo de tus proveedores.
            {revision
              ? conProblema
                ? ` ${conProblema} sin stock suficiente.`
                : ' Hay stock de todo lo que tiene dato.'
              : ' Revisá el stock y el precio de hoy antes de mandar el presupuesto.'}
          </p>
          {cambiados.length > 0 && (
            <button type="button" className="btn btn-sec w-full border-amber-400/50 text-amber-200" onClick={actualizarPrecios}>
              Actualizar {cambiados.length} {cambiados.length === 1 ? 'precio' : 'precios'} al de hoy
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-sec whitespace-nowrap px-2 text-sm" onClick={revisar} disabled={revisando}>
              <Icon name="repetir" className={`h-4 w-4 ${revisando ? 'animate-spin' : ''}`} /> {revisando ? 'Revisando…' : 'Revisar stock'}
            </button>
            <button type="button" className="btn btn-menta whitespace-nowrap px-2 text-sm" onClick={() => setArmando(true)} disabled={!puedeComprar || ordenes === null}>
              <Icon name="documento" className="h-4 w-4" /> Orden de compra
            </button>
          </div>
          {!puedeComprar && <p className="text-xs text-tinta-500">Las órdenes de compra las arma quien tiene el permiso de Compras.</p>}
          {ordenes === null && <p className="text-xs text-tinta-500">Para armar órdenes de compra falta correr el SQL 09.</p>}
        </>
      )}
      {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

      {ordenes?.length > 0 && (
        <ul className="divide-y divide-navy-800 rounded-xl border border-navy-700">
          {ordenes.map((o) => (
            <li key={o.id}>
              <Link href={`/panel/finanzas/compras/${o.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-navy-850">
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm">OC {numeroOrden(o.numero)} · {o.proveedor_nombre}</b>
                  <span className="text-xs text-tinta-400">{importe(o.subtotal, o.moneda)}</span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${ESTADOS_COMPRA[o.estado]?.clase}`}>{ESTADOS_COMPRA[o.estado]?.texto}</span>
                <Icon name="der" className="h-4 w-4 shrink-0 text-tinta-500" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <ArmarOrdenes
        abierto={armando}
        onCerrar={() => setArmando(false)}
        presupuesto={presupuesto}
        lineas={delCatalogo}
        cuenta={cuenta}
        revision={revision}
        onRevision={onRevision}
        guardarAntes={guardarAntes}
        onCreadas={() => {
          setArmando(false);
          cargarOrdenes();
        }}
      />
    </section>
  );
}

function ArmarOrdenes({ abierto, onCerrar, presupuesto, lineas, cuenta, revision, onRevision, guardarAntes, onCreadas }) {
  const [grupos, setGrupos] = useState([]);
  const [entrega, setEntrega] = useState('');
  const [estado, setEstado] = useState({ cargando: false, error: '' });

  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    (async () => {
      setEstado({ cargando: true, error: '' });
      setEntrega(presupuesto.cliente_direccion ? `En obra: ${presupuesto.cliente_direccion}` : '');
      let info = revision;
      if (!info) {
        try {
          info = await revisarProductos(cuenta, lineas.map((m) => m.producto_id));
          if (vivo) onRevision(info);
        } catch (e) {
          if (vivo) setEstado({ cargando: false, error: e.message });
          return;
        }
      }
      const ids = [...new Set(lineas.map((m) => info[m.producto_id]?.proveedor_id || m.proveedor_id).filter(Boolean))];
      const { data: provs } = await supabase
        .from('proveedores')
        .select('id, nombre, contacto, telefono, whatsapp, email, rut, moneda, iva_incluido, pedido_url, pedido_email')
        .in('id', ids);
      if (!vivo) return;
      const porId = Object.fromEntries((provs || []).map((p) => [p.id, p]));
      const armados = ids
        .filter((id) => porId[id])
        .map((id) => ({
          proveedor: porId[id],
          incluir: true,
          lineas: lineas
            .filter((m) => (info[m.producto_id]?.proveedor_id || m.proveedor_id) === id)
            .map((m) => ({
              producto_id: m.producto_id,
              codigo: m.codigo,
              item: m.item,
              unidad: m.unidad || 'u',
              cantidad: String(numero(m.cantidad) ?? 1),
              precio: info[m.producto_id]?.precio ?? numero(m.costo) ?? 0,
              info: info[m.producto_id],
            })),
        }));
      setGrupos(armados);
      setEstado({ cargando: false, error: '' });
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  function cambiarCantidad(g, k, valor) {
    setGrupos((gs) => gs.map((x, i) => (i !== g ? x : { ...x, lineas: x.lineas.map((l, j) => (j === k ? { ...l, cantidad: valor } : l)) })));
  }

  async function crear() {
    setEstado({ cargando: true, error: '' });
    const guardado = await guardarAntes();
    if (!guardado) {
      setEstado({ cargando: false, error: 'Primero guardá el presupuesto.' });
      return;
    }
    const filas = grupos
      .filter((g) => g.incluir)
      .map((g) => ({
        profesional_id: cuenta,
        proveedor_id: g.proveedor.id,
        proveedor_nombre: g.proveedor.nombre,
        proveedor_datos: {
          contacto: g.proveedor.contacto || null,
          telefono: g.proveedor.telefono || null,
          whatsapp: g.proveedor.whatsapp || null,
          email: g.proveedor.pedido_email || g.proveedor.email || null,
          rut: g.proveedor.rut || null,
        },
        presupuesto_id: presupuesto.id,
        moneda: g.proveedor.moneda || 'UYU',
        iva_incluido: !!g.proveedor.iva_incluido,
        entrega: entrega.trim() || null,
        notas: `Para el presupuesto Nº ${String(presupuesto.numero || 0).padStart(4, '0')}${presupuesto.cliente_nombre ? ` (${presupuesto.cliente_nombre})` : ''}`,
        items: g.lineas
          .filter((l) => (numero(l.cantidad) ?? 0) > 0)
          .map((l) => ({ producto_id: l.producto_id, codigo: l.codigo || null, item: l.item, cantidad: numero(l.cantidad), unidad: l.unidad, precio: Number(l.precio) || 0 })),
      }))
      .filter((f) => f.items.length);
    if (!filas.length) {
      setEstado({ cargando: false, error: 'Elegí al menos un proveedor con cantidades.' });
      return;
    }
    const { error } = await supabase.from('ordenes_compra').insert(filas);
    if (error) {
      setEstado({ cargando: false, error: sinFuncion(error) ? 'Falta correr el SQL 09.' : mensajeError(error) });
      return;
    }
    setEstado({ cargando: false, error: '' });
    onCreadas();
  }

  const elegidos = grupos.filter((g) => g.incluir).length;

  return (
    <Modal
      abierto={abierto}
      onCerrar={() => !estado.cargando && onCerrar()}
      titulo="Órdenes de compra"
      pie={
        <button type="button" className="btn btn-menta w-full" onClick={crear} disabled={estado.cargando || !elegidos}>
          {estado.cargando ? 'Un momento…' : `Crear ${elegidos} ${elegidos === 1 ? 'orden' : 'órdenes'} de compra`}
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-tinta-300">Una orden por proveedor, con el precio y el stock de hoy. Quedan en borrador para revisarlas y mandarlas.</p>
        {estado.cargando && !grupos.length && <p className="py-4 text-center text-sm text-tinta-400">Revisando stock y precios…</p>}
        {grupos.map((g, gi) => {
          const total = g.lineas.reduce((s, l) => s + (numero(l.cantidad) ?? 0) * (Number(l.precio) || 0), 0);
          return (
            <section key={g.proveedor.id} className={`rounded-2xl border p-3 ${g.incluir ? 'border-menta-500/40' : 'border-navy-700 opacity-60'}`}>
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[#2cc79b]"
                  checked={g.incluir}
                  onChange={(e) => setGrupos((gs) => gs.map((x, i) => (i === gi ? { ...x, incluir: e.target.checked } : x)))}
                />
                <b className="flex-1">{g.proveedor.nombre}</b>
                <span className="text-sm font-bold">{importe(total, g.proveedor.moneda)}</span>
              </label>
              <ul className="mt-2 space-y-2">
                {g.lineas.map((l, k) => {
                  const st = estadoStock(l.info, l.cantidad);
                  return (
                    <li key={l.producto_id} className="flex items-center gap-2 rounded-xl bg-navy-850 p-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-snug">{l.item}</span>
                        <span className="block text-[11px] text-tinta-400">
                          {importe(l.precio, g.proveedor.moneda)} / {l.unidad}
                          {st && <span className={`ml-1.5 font-semibold ${st.clase}`}>{st.texto}</span>}
                        </span>
                      </span>
                      <input
                        className="campo w-20 shrink-0 px-2 py-1.5 text-center text-sm"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        value={l.cantidad}
                        onChange={(e) => cambiarCantidad(gi, k, e.target.value)}
                        aria-label={`Cantidad de ${l.item}`}
                      />
                    </li>
                  );
                })}
              </ul>
              {!g.proveedor.email && !g.proveedor.whatsapp && !g.proveedor.pedido_url && (
                <p className="mt-2 text-[11px] text-amber-300">Este proveedor no tiene email ni WhatsApp cargados: completalos para mandarle la orden.</p>
              )}
            </section>
          );
        })}
        <div>
          <label className="etiqueta" htmlFor="oc-entrega">Entrega</label>
          <input id="oc-entrega" className="campo" value={entrega} onChange={(e) => setEntrega(e.target.value)} placeholder="Ej. Retiro en el local / En obra: dirección" />
        </div>
        {estado.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>}
      </div>
    </Modal>
  );
}
