'use client';

import Icon from './Icon';

/**
 * Materiales para quien no ve importes (encargado): solo qué, cuánto y la unidad.
 * Los precios que ya tenía cada renglón quedan en el objeto (y la base los conserva, SQL 31).
 */
export default function MaterialesSinPrecios({ materiales, onChange, titulo = 'Materiales', textoAgregar = 'Añadir materiales', vacio = '' }) {
  const lista = materiales || [];
  const cambiar = (i, campo, valor) => onChange(lista.map((m, j) => (j === i ? { ...m, [campo]: valor } : m)));
  const cargados = lista.filter((m) => String(m.item || '').trim()).length;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="titulo-seccion min-w-0">
          {titulo} {cargados > 0 && <span className="text-tinta-500">({cargados})</span>}
        </h3>
        <button type="button" className="chip chip-activo ml-auto shrink-0 whitespace-nowrap" onClick={() => onChange([...lista, { item: '', cantidad: '1', unidad: 'u' }])}>
          <Icon name="mas" className="h-3.5 w-3.5" /> {textoAgregar}
        </button>
      </div>
      {lista.length === 0 ? (
        <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">{vacio}</p>
      ) : (
        <ul className="space-y-2">
          {lista.map((m, i) => (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem_3.75rem_auto] items-center gap-2 rounded-xl border border-navy-700 bg-navy-850 p-2">
              <input className="campo px-2 py-2 text-sm" value={m.item} onChange={(e) => cambiar(i, 'item', e.target.value)} placeholder="Material" aria-label="Material" />
              <input className="campo px-2 py-2 text-sm" type="number" inputMode="decimal" min="0" value={m.cantidad} onChange={(e) => cambiar(i, 'cantidad', e.target.value)} placeholder="Cant." aria-label="Cantidad" />
              <input className="campo px-2 py-2 text-sm" value={m.unidad} onChange={(e) => cambiar(i, 'unidad', e.target.value)} placeholder="u" aria-label="Unidad" />
              <button type="button" className="rounded-lg p-2 text-tinta-400 hover:text-red-300" onClick={() => onChange(lista.filter((_, k) => k !== i))} aria-label="Quitar">
                <Icon name="borrar" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
