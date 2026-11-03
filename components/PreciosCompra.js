'use client';

import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import FichaArticulo from './FichaArticulo';
import { usePanel } from './PanelContext';
import { supabase } from '@/lib/supabase';
import { esBusiness } from '@/lib/planes';
import { fechaUY } from '@/lib/presupuestos';
import { haceDias, pct, pesos, unidadTexto } from '@/lib/compras';

// ¿Esta persona ve la inteligencia de compras de la cuenta? (Business y compras, importes, stock o seguimiento)
export function useVeCompras() {
  const { plan, profesional, yo, empresa, permisos } = usePanel();
  if (!esBusiness(plan?.plan)) return false;
  return !empresa || yo?.id === profesional?.id || (permisos || []).some((p) => ['compras', 'importes', 'stock', 'seguimiento'].includes(p));
}

/** Ficha del proveedor: qué se le compró, a cuánto, cómo vienen sus precios y si otro lo tiene más barato */
export function ComprasProveedor({ proveedorId, cuenta }) {
  const ve = useVeCompras();
  const [datos, setDatos] = useState(null);
  const [abierto, setAbierto] = useState(null);
  const [todos, setTodos] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('proveedor_compras', { p_proveedor: proveedorId, p_cuenta: cuenta });
    setDatos(error ? null : data);
  }, [proveedorId, cuenta]);

  useEffect(() => {
    if (ve) cargar();
  }, [ve, cargar]);

  if (!ve || !datos || !datos.compras) return null;
  const arts = datos.articulos || [];
  const visibles = todos ? arts : arts.slice(0, 8);
  return (
    <section className="tarjeta p-4">
      <h2 className="font-bold">Compras y precios</h2>
      <p className="mt-0.5 text-xs text-tinta-400">
        {datos.compras} {datos.compras === 1 ? 'precio registrado' : 'precios registrados'} en {datos.documentos} {datos.documentos === 1 ? 'documento' : 'documentos'}
        {datos.ultima ? ` · última compra ${fechaUY(datos.ultima)}` : ''} · sin IVA, en pesos
      </p>
      <ul className="mt-2 divide-y divide-navy-800">
        {visibles.map((a) => {
          const v = a.anterior > 0 ? ((a.precio_base_uyu - a.anterior) / a.anterior) * 100 : null;
          return (
            <li key={a.articulo_id}>
              <button type="button" className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:bg-navy-850" onClick={() => setAbierto(a.articulo_id)}>
                <span className="min-w-0">
                  <b className="block truncate">{a.nombre}</b>
                  <span className="block text-xs text-tinta-400">
                    {fechaUY(a.fecha)}
                    {v !== null && Math.abs(v) >= 0.05 ? (
                      <span className={v > 0 ? 'text-red-300' : 'text-menta-300'}> · {pct(v)} vs. la compra anterior</span>
                    ) : null}
                    {a.mejor_otro ? <span className="text-[#8cc8ff]"> · {a.mejor_otro.proveedor}: {pesos(a.mejor_otro.precio)}</span> : null}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm font-bold tabular-nums">
                  {pesos(a.precio_base_uyu)}
                  <span className="block text-[11px] font-normal text-tinta-400">por {unidadTexto(a.unidad)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {arts.length > 8 && (
        <button type="button" className="chip mt-2 text-xs" onClick={() => setTodos(!todos)}>
          {todos ? 'Ver menos' : `Ver los ${arts.length}`}
        </button>
      )}
      <FichaArticulo articuloId={abierto} cuenta={cuenta} onCerrar={() => setAbierto(null)} onCambio={cargar} />
    </section>
  );
}

/** Ficha del material del stock: último costo, mejor proveedor y acceso al comparador */
export function PreciosMaterial({ materialId, cuenta }) {
  const ve = useVeCompras();
  const [datos, setDatos] = useState(null);
  const [abierto, setAbierto] = useState(null);

  const cargar = useCallback(async () => {
    const { data: art } = await supabase.rpc('articulo_de_material', { p_material: materialId });
    if (!art) return setDatos(false);
    const { data, error } = await supabase.rpc('articulo_precios', { p_articulo: art });
    setDatos(error ? false : data);
  }, [materialId]);

  useEffect(() => {
    if (ve && materialId) cargar();
  }, [ve, materialId, cargar]);

  if (!ve || !datos) return null;
  const mejor = (datos.comparador || []).find((f) => f.mejor);
  const n = (datos.comparador || []).length;
  return (
    <section className="tarjeta p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold">Precios de compra</h2>
          <p className="text-xs text-tinta-400">Sin IVA, en pesos, por {unidadTexto(datos.articulo.unidad)}</p>
        </div>
        <button type="button" className="chip chip-activo shrink-0 text-xs" onClick={() => setAbierto(datos.articulo.id)}>
          <Icon name="grafico" className="h-3.5 w-3.5" /> Comparar
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-navy-850 p-2.5">
          <p className="text-[11px] text-tinta-400">Último costo</p>
          <p className="font-bold">{datos.ultimo ? pesos(datos.ultimo.precio_base_uyu) : '—'}</p>
          {datos.ultimo && <p className="truncate text-[11px] text-tinta-400">{datos.ultimo.proveedor} · {haceDias(datos.ultimo.fecha)}</p>}
        </div>
        <div className="rounded-xl bg-navy-850 p-2.5">
          <p className="text-[11px] text-tinta-400">Mejor precio {n > 1 ? `(${n} opciones)` : ''}</p>
          <p className="font-bold text-menta-300">{mejor ? pesos(mejor.precio_base_uyu) : '—'}</p>
          {mejor && <p className="truncate text-[11px] text-tinta-400">{mejor.proveedor}</p>}
        </div>
      </div>
      {datos.recomendacion?.texto && <p className="mt-2 text-xs text-tinta-300">{datos.recomendacion.texto}</p>}
      <FichaArticulo articuloId={abierto} cuenta={cuenta} onCerrar={() => setAbierto(null)} onCambio={cargar} />
    </section>
  );
}
