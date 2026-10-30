'use client';

import Icon from './Icon';
import { ESTADOS_MOV, TIPOS_MOV, fechaHora, numeroMov, resumenItems, rutaMov, tituloMov } from '@/lib/stock';

/** Un comprobante de stock en una lista */
export default function FilaMovimiento({ m, onAbrir }) {
  const est = ESTADOS_MOV[m.estado] || ESTADOS_MOV.hecho;
  const tipo = TIPOS_MOV[m.tipo] || TIPOS_MOV.ingreso;
  return (
    <li>
      <button type="button" onClick={onAbrir} className={`tarjeta flex w-full gap-3 p-3 text-left hover:bg-navy-850 ${m.anulado_por ? 'opacity-60' : ''}`}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-navy-800 text-tinta-300">
          <Icon name={tipo.icono} className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <b className="min-w-0 truncate text-sm">{tituloMov(m)}</b>
            <span className="shrink-0 text-[11px] text-tinta-400">{numeroMov(m.numero)}</span>
          </span>
          <span className="block truncate text-xs text-tinta-300">{rutaMov(m)}</span>
          <span className="block truncate text-[11px] text-tinta-400">{resumenItems(m.items, 2)}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-tinta-400">
            {m.estado !== 'hecho' && <span className={`rounded-full px-1.5 py-0.5 font-bold ${est.clase}`}>{est.texto}</span>}
            {m.anulado_por && <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 font-bold text-red-300">Anulado</span>}
            {fechaHora(m.creado_en)}
            {m.por ? ` · ${m.por}` : ''}
          </span>
        </span>
      </button>
    </li>
  );
}

