'use client';

import { useState } from 'react';
import Icon from './Icon';
import BuscadorProductos from './BuscadorProductos';
import FichaArticulo from './FichaArticulo';
import { useVeCompras } from './PreciosCompra';
import { dinero, margenDePrecio, monedaLinea, numero, precioConMargen, r2, totalesMateriales } from '@/lib/precios';
import { estadoStock, importe, lineaDesdeProducto } from '@/lib/proveedores';
import { costoEnMoneda, haceDias, usePreciosCompra } from '@/lib/compras';

export const MATERIAL_VACIO = { item: '', cantidad: '1', unidad: 'u', proveedor: '', costo: '', margen: '', precio: '' };

/**
 * Lista de materiales / ítems con costo (precio proveedor), margen y precio final.
 * - Cambiás el costo o el margen → se calcula el precio final.
 * - Cambiás el precio final → se calcula el margen.
 * materiales: filas como texto (ver materialesParaEditar)
 */
export default function EditorMateriales({
  materiales,
  onChange,
  margenDefecto = 30,
  conProveedor = true,
  titulo = 'Materiales',
  textoAgregar = 'Agregar material',
  vacio = 'Sin materiales.',
  cuenta = null, // con la cuenta: buscar en las listas de los proveedores
  revision = null, // { producto_id: { stock, precio, … } } después de revisar stock y precios
  moneda = 'UYU', // presupuestos: 'UYU' | 'USD' | 'mixto' (cada renglón en su moneda)
  inteligencia = false, // Business: último costo y mejor precio registrado de cada renglón (SQL 15)
  bloqueado = false, // presupuesto aceptado: se muestra, pero no se ofrece cambiar costos
  cotizacion = null, // para pasar a dólares los precios registrados en pesos
}) {
  const lista = materiales || [];
  const mixto = moneda === 'mixto';
  const monedaDe = (m) => monedaLinea(m, moneda);
  const t = totalesMateriales(lista);
  const porMoneda = ['UYU', 'USD']
    .map((k) => ({ k, ...totalesMateriales(lista.filter((m) => monedaDe(m) === k)) }))
    .filter((x) => x.items > 0 || (!mixto && x.k === monedaDe({})));
  const [buscando, setBuscando] = useState(false);
  const [articulo, setArticulo] = useState(null);
  const precios = usePreciosCompra(cuenta, lista, inteligencia && !!cuenta);
  const veFicha = useVeCompras();
  // Lo que costarían los materiales con los mejores precios registrados (por moneda)
  const estimados = !precios
    ? []
    : ['UYU', 'USD']
        .map((k) => {
          let actual = 0;
          let mejor = 0;
          let venta = 0;
          let con = 0;
          let viejos = 0;
          let items = 0;
          lista.forEach((m, i) => {
            if (monedaDe(m) !== k || !String(m.item || '').trim()) return;
            items += 1;
            const cant = numero(m.cantidad) ?? 0;
            const propio = numero(m.costo);
            const info = precios[i];
            const best = info?.mejor ? costoEnMoneda(info.mejor.precio_uyu, k, cotizacion) : null;
            if (info?.desactualizado) viejos += 1;
            if (best !== null) con += 1;
            venta += cant * (numero(m.precio) ?? 0);
            actual += cant * (propio ?? best ?? 0);
            mejor += cant * (best !== null ? Math.min(best, propio ?? best) : propio ?? 0);
          });
          return { k, actual: r2(actual), mejor: r2(mejor), venta: r2(venta), con, viejos, items };
        })
        .filter((x) => x.con > 0);

  // "Usar" el mejor precio registrado: cambia el costo y el proveedor del renglón (nunca solo)
  function usarPrecio(i, info) {
    const costo = costoEnMoneda(info.mejor.precio_uyu, monedaDe(lista[i]), cotizacion);
    if (costo === null) return;
    onChange(
      lista.map((m, k) => {
        if (k !== i) return m;
        const margen = numero(m.margen) === null ? String(margenDefecto) : m.margen;
        return { ...m, costo: String(costo), margen, precio: String(precioConMargen(costo, margen) ?? ''), proveedor: info.mejor.proveedor || m.proveedor, proveedor_id: info.mejor.proveedor_id || m.proveedor_id };
      })
    );
  }

  // Del catálogo: si ya está en la lista, suma uno
  function agregarProducto(p, { cotizacion }) {
    const actual = lista.findIndex((m) => m.producto_id === p.id);
    if (actual >= 0) {
      onChange(lista.map((m, k) => (k === actual ? { ...m, cantidad: String((numero(m.cantidad) ?? 0) + 1) } : m)));
      return;
    }
    const vacias = lista.filter((m) => String(m.item || '').trim() || numero(m.costo) !== null);
    let linea;
    if (mixto) {
      // en los mixtos queda en la moneda del proveedor
      linea = { ...lineaDesdeProducto(p, { margen: margenDefecto }), moneda: p.moneda === 'USD' ? 'USD' : 'UYU' };
    } else if (moneda === 'USD' && p.moneda !== 'USD') {
      const cot = numero(cotizacion);
      const base = lineaDesdeProducto(p, { margen: margenDefecto });
      const costo = cot ? r2(Number(p.precio) / cot) : Number(p.precio);
      linea = { ...base, costo: String(costo), precio: String(precioConMargen(costo, margenDefecto) ?? '') };
    } else {
      linea = lineaDesdeProducto(p, { margen: margenDefecto, cotizacion: moneda === 'USD' ? null : cotizacion });
    }
    onChange([...vacias, linea]);
  }

  function cambiar(i, campo, valor) {
    onChange(
      lista.map((m, k) => {
        if (k !== i) return m;
        const nuevo = { ...m, [campo]: valor };
        if (campo === 'costo') {
          if (numero(valor) === null) return nuevo;
          if (numero(m.margen) === null && numero(m.precio) !== null) {
            nuevo.margen = String(margenDePrecio(valor, m.precio) ?? '');
          } else {
            if (numero(m.margen) === null) nuevo.margen = String(margenDefecto);
            nuevo.precio = String(precioConMargen(valor, nuevo.margen) ?? '');
          }
        } else if (campo === 'margen') {
          if (numero(m.costo) !== null && numero(valor) !== null) nuevo.precio = String(precioConMargen(m.costo, valor) ?? '');
        } else if (campo === 'precio') {
          if (numero(m.costo) !== null) nuevo.margen = String(margenDePrecio(m.costo, valor) ?? '');
        }
        return nuevo;
      })
    );
  }

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="titulo-seccion min-w-0">
          {titulo} {t.items > 0 && <span className="text-tinta-500">({t.items})</span>}
        </h3>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {cuenta && (
            <button type="button" className="chip shrink-0 whitespace-nowrap border-menta-500/50 text-menta-300" onClick={() => setBuscando(true)}>
              <Icon name="buscar" className="h-3.5 w-3.5" /> Proveedores
            </button>
          )}
          <button type="button" className="chip chip-activo shrink-0 whitespace-nowrap" onClick={() => onChange([...lista, { ...MATERIAL_VACIO, margen: String(margenDefecto), moneda: mixto && lista.length ? monedaDe(lista[lista.length - 1]) : 'UYU' }])}>
            <Icon name="mas" className="h-3.5 w-3.5" /> {textoAgregar}
          </button>
        </div>
      </div>

      {lista.length === 0 ? (
        <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">{vacio}</p>
      ) : (
        <ul className="space-y-2">
          {lista.map((m, i) => {
            const cant = numero(m.cantidad) ?? 0;
            const linea = cant * (numero(m.precio) ?? 0);
            const costoLinea = cant * (numero(m.costo) ?? 0);
            const info = m.producto_id && revision ? revision[m.producto_id] : null;
            const stock = info ? estadoStock(info, m.cantidad) : null;
            const cambioPrecio = info && info.moneda !== 'USD' && numero(m.costo) !== null && Math.abs(Number(info.precio) - numero(m.costo)) >= 0.01;
            const pc = precios?.[i];
            const mejorAca = pc?.mejor ? costoEnMoneda(pc.mejor.precio_uyu, monedaDe(m), cotizacion) : null;
            const ultimoAca = pc?.ultimo ? costoEnMoneda(pc.ultimo.precio_uyu, monedaDe(m), cotizacion) : null;
            const conviene = mejorAca !== null && (numero(m.costo) === null || mejorAca < numero(m.costo) - 0.009);
            return (
              <li key={i} className="rounded-xl border border-navy-700 bg-navy-850 p-2.5">
                <div className="flex items-center gap-2">
                  {mixto && (
                    <button
                      type="button"
                      onClick={() => cambiar(i, 'moneda', monedaDe(m) === 'USD' ? 'UYU' : 'USD')}
                      className={`shrink-0 rounded-lg px-2 py-2 text-xs font-extrabold ${monedaDe(m) === 'USD' ? 'bg-[#2f9e5b]/25 text-[#7be0a5]' : 'bg-[#176ba8]/25 text-[#8cc4ee]'}`}
                      aria-label={`Moneda del renglón: ${monedaDe(m) === 'USD' ? 'dólares' : 'pesos'} (tocá para cambiar)`}
                      title="Tocá para cambiar la moneda de este renglón"
                    >
                      {monedaDe(m) === 'USD' ? 'US$' : '$'}
                    </button>
                  )}
                  <input className="campo min-w-0 flex-1 px-3 py-2 text-sm" value={m.item} onChange={(e) => cambiar(i, 'item', e.target.value)} placeholder="Material o ítem" aria-label="Material" />
                  <button type="button" className="shrink-0 rounded-lg p-2 text-tinta-400 hover:text-red-300" onClick={() => onChange(lista.filter((_, k) => k !== i))} aria-label="Quitar">
                    <Icon name="cerrar" className="h-4 w-4" />
                  </button>
                </div>
                {m.producto_id && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[11px] text-tinta-400">
                    <span className="inline-flex items-center gap-1 font-semibold text-menta-400">
                      <Icon name="check" className="h-3 w-3" /> Catálogo
                    </span>
                    {m.codigo && <span>cód. {m.codigo}</span>}
                    {stock && <span className={`font-semibold ${stock.clase}`}>{stock.texto}</span>}
                    {cambioPrecio && (
                      <button
                        type="button"
                        className="font-semibold text-amber-300 underline"
                        onClick={() => cambiar(i, 'costo', String(info.precio))}
                      >
                        Precio hoy {importe(info.precio, info.moneda)}: actualizar
                      </button>
                    )}
                  </p>
                )}
                {pc && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[11px] text-tinta-400">
                    <span className="inline-flex items-center gap-1 font-semibold text-[#8cc8ff]">
                      <Icon name="grafico" className="h-3 w-3" /> Compras
                    </span>
                    {pc.ultimo && ultimoAca !== null && (
                      <span>Último costo {dinero(ultimoAca, monedaDe(m))} ({pc.ultimo.proveedor}, {haceDias(pc.ultimo.fecha)})</span>
                    )}
                    {pc.mejor && mejorAca !== null && (pc.mejor.proveedor !== pc.ultimo?.proveedor || mejorAca !== ultimoAca) && (
                      <span className="text-menta-300">Mejor: {dinero(mejorAca, monedaDe(m))} en {pc.mejor.proveedor}</span>
                    )}
                    {conviene && !bloqueado && (
                      <button type="button" className="font-semibold text-menta-300 underline" onClick={() => usarPrecio(i, pc)}>
                        Usar
                      </button>
                    )}
                    {monedaDe(m) === 'USD' && !(numero(cotizacion) > 0) && <span>Poné la cotización para verlo en dólares</span>}
                    {pc.desactualizado && <span className="font-semibold text-amber-300">Precio de hace {pc.dias} días: puede estar desactualizado</span>}
                    {veFicha && pc.opciones > 0 && (
                      <button type="button" className="font-semibold text-tinta-300 underline" onClick={() => setArticulo(pc.articulo_id)}>
                        {pc.opciones > 1 ? `Ver ${pc.opciones} proveedores` : 'Ver historial'}
                      </button>
                    )}
                  </p>
                )}
                <div className="mt-2 grid grid-cols-[4.5rem_3.75rem_1fr] gap-2">
                  <input className="campo px-2 py-2 text-sm" type="number" inputMode="decimal" min="0" value={m.cantidad} onChange={(e) => cambiar(i, 'cantidad', e.target.value)} placeholder="Cant." aria-label="Cantidad" />
                  <input className="campo px-2 py-2 text-sm" value={m.unidad} onChange={(e) => cambiar(i, 'unidad', e.target.value)} placeholder="u" aria-label="Unidad" />
                  {conProveedor ? (
                    <input className="campo px-2 py-2 text-sm" value={m.proveedor} onChange={(e) => cambiar(i, 'proveedor', e.target.value)} placeholder="Proveedor (opcional)" aria-label="Proveedor" />
                  ) : (
                    <span />
                  )}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-tinta-400">Costo unit.</span>
                    <input className="campo px-2 py-2 text-sm" type="number" inputMode="decimal" min="0" value={m.costo} onChange={(e) => cambiar(i, 'costo', e.target.value)} placeholder={monedaDe(m) === 'USD' ? 'US$' : '$'} />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-tinta-400">Margen %</span>
                    <input className="campo px-2 py-2 text-sm" type="number" inputMode="decimal" value={m.margen} onChange={(e) => cambiar(i, 'margen', e.target.value)} placeholder="%" />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] font-semibold text-menta-300">Precio final</span>
                    <input className="campo border-menta-500/40 px-2 py-2 text-sm font-semibold" type="number" inputMode="decimal" min="0" value={m.precio} onChange={(e) => cambiar(i, 'precio', e.target.value)} placeholder={monedaDe(m) === 'USD' ? 'US$' : '$'} />
                  </label>
                </div>
                {linea > 0 && (
                  <p className="mt-1.5 text-right text-xs text-tinta-400">
                    {costoLinea > 0 && <>Costo {dinero(costoLinea, monedaDe(m))} · </>}
                    <b className="text-tinta-100">Subtotal {dinero(linea, monedaDe(m))}</b>
                    {costoLinea > 0 && <> · Gana {dinero(linea - costoLinea, monedaDe(m))}</>}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {t.items > 0 &&
        porMoneda.map((x) => (
          <div key={x.k} className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-navy-850 p-2">
              <p className="text-[11px] text-tinta-400">Costo{porMoneda.length > 1 ? ` en ${x.k === 'USD' ? 'US$' : '$'}` : ''}</p>
              <p className="text-sm font-bold">{dinero(x.costo, x.k)}</p>
            </div>
            <div className="rounded-xl bg-navy-850 p-2">
              <p className="text-[11px] text-tinta-400">Subtotal{porMoneda.length > 1 ? ` en ${x.k === 'USD' ? 'US$' : '$'}` : ''}</p>
              <p className="text-sm font-bold text-menta-300">{dinero(x.venta, x.k)}</p>
            </div>
            <div className="rounded-xl bg-navy-850 p-2">
              <p className="text-[11px] text-tinta-400">Ganancia</p>
              <p className="text-sm font-bold">
                {dinero(x.ganancia, x.k)}
                {x.margen !== null && <span className="block text-[11px] font-semibold text-tinta-400">{x.margen.toLocaleString('es-UY')}%</span>}
              </p>
            </div>
          </div>
        ))}
      {estimados.length > 0 && (
        <div className="mt-2 space-y-1.5 rounded-xl border border-[#0a84ff]/30 bg-[#0a84ff]/10 p-2.5 text-xs text-tinta-200">
          <p className="flex items-center gap-1.5 font-semibold text-[#8cc8ff]">
            <Icon name="grafico" className="h-3.5 w-3.5" /> Costo de materiales según tus compras
          </p>
          {estimados.map((e) => (
            <div key={e.k}>
              <p>
                {estimados.length > 1 || mixto ? <b>{e.k === 'USD' ? 'En US$: ' : 'En $: '}</b> : null}
                Con estos costos <b>{dinero(e.actual, e.k)}</b>
                {e.mejor < e.actual - 0.009 ? (
                  <>
                    {' '}· con los mejores precios registrados <b className="text-menta-300">{dinero(e.mejor, e.k)}</b> (ahorrás {dinero(e.actual - e.mejor, e.k)}
                    {e.venta > 0 ? `; la ganancia de materiales pasa de ${dinero(e.venta - e.actual, e.k)} a ${dinero(e.venta - e.mejor, e.k)}` : ''})
                  </>
                ) : (
                  ' · ya usás el mejor precio registrado.'
                )}
              </p>
              <p className="text-tinta-400">
                {e.con} de {e.items} {e.items === 1 ? 'renglón tiene' : 'renglones tienen'} precios de compra registrados (sin IVA).
                {e.viejos > 0 ? ` ${e.viejos} con precio viejo: confirmalo con el proveedor.` : ''}
              </p>
            </div>
          ))}
          {bloqueado && <p className="text-tinta-400">El presupuesto ya está aceptado: sus costos no se cambian.</p>}
        </div>
      )}
      {articulo && <FichaArticulo articuloId={articulo} cuenta={cuenta} onCerrar={() => setArticulo(null)} />}
      {cuenta && (
        <BuscadorProductos abierto={buscando} onCerrar={() => setBuscando(false)} onElegir={agregarProducto} cuenta={cuenta} />
      )}
    </section>
  );
}
