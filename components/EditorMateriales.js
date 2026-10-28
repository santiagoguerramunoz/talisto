'use client';

import Icon from './Icon';
import { margenDePrecio, numero, pesos, precioConMargen, totalesMateriales } from '@/lib/precios';

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
}) {
  const lista = materiales || [];
  const t = totalesMateriales(lista);

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
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="titulo-seccion min-w-0">
          {titulo} {t.items > 0 && <span className="text-tinta-500">({t.items})</span>}
        </h3>
        <button type="button" className="chip chip-activo shrink-0 whitespace-nowrap" onClick={() => onChange([...lista, { ...MATERIAL_VACIO, margen: String(margenDefecto) }])}>
          <Icon name="mas" className="h-3.5 w-3.5" /> {textoAgregar}
        </button>
      </div>

      {lista.length === 0 ? (
        <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">{vacio}</p>
      ) : (
        <ul className="space-y-2">
          {lista.map((m, i) => {
            const cant = numero(m.cantidad) ?? 0;
            const linea = cant * (numero(m.precio) ?? 0);
            const costoLinea = cant * (numero(m.costo) ?? 0);
            return (
              <li key={i} className="rounded-xl border border-navy-700 bg-navy-850 p-2.5">
                <div className="flex items-center gap-2">
                  <input className="campo min-w-0 flex-1 px-3 py-2 text-sm" value={m.item} onChange={(e) => cambiar(i, 'item', e.target.value)} placeholder="Material o ítem" aria-label="Material" />
                  <button type="button" className="shrink-0 rounded-lg p-2 text-tinta-400 hover:text-red-300" onClick={() => onChange(lista.filter((_, k) => k !== i))} aria-label="Quitar">
                    <Icon name="cerrar" className="h-4 w-4" />
                  </button>
                </div>
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
                    <input className="campo px-2 py-2 text-sm" type="number" inputMode="decimal" min="0" value={m.costo} onChange={(e) => cambiar(i, 'costo', e.target.value)} placeholder="$" />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-tinta-400">Margen %</span>
                    <input className="campo px-2 py-2 text-sm" type="number" inputMode="decimal" value={m.margen} onChange={(e) => cambiar(i, 'margen', e.target.value)} placeholder="%" />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] font-semibold text-menta-300">Precio final</span>
                    <input className="campo border-menta-500/40 px-2 py-2 text-sm font-semibold" type="number" inputMode="decimal" min="0" value={m.precio} onChange={(e) => cambiar(i, 'precio', e.target.value)} placeholder="$" />
                  </label>
                </div>
                {linea > 0 && (
                  <p className="mt-1.5 text-right text-xs text-tinta-400">
                    {costoLinea > 0 && <>Costo {pesos(costoLinea)} · </>}
                    <b className="text-tinta-100">Subtotal {pesos(linea)}</b>
                    {costoLinea > 0 && <> · Gana {pesos(linea - costoLinea)}</>}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {t.items > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-navy-850 p-2">
            <p className="text-[11px] text-tinta-400">Costo</p>
            <p className="text-sm font-bold">{pesos(t.costo)}</p>
          </div>
          <div className="rounded-xl bg-navy-850 p-2">
            <p className="text-[11px] text-tinta-400">Subtotal</p>
            <p className="text-sm font-bold text-menta-300">{pesos(t.venta)}</p>
          </div>
          <div className="rounded-xl bg-navy-850 p-2">
            <p className="text-[11px] text-tinta-400">Ganancia</p>
            <p className="text-sm font-bold">
              {pesos(t.ganancia)}
              {t.margen !== null && <span className="block text-[11px] font-semibold text-tinta-400">{t.margen.toLocaleString('es-UY')}%</span>}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
