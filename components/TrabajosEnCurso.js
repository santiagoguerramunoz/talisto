'use client';

import { Reloj } from './ControlTiempo';
import Icon from './Icon';
import { identificadorTrabajo } from '@/lib/trabajos';

// Aviso fijo arriba de la agenda con los trabajos B2B que están corriendo
export default function TrabajosEnCurso({ trabajos = [], porId = {}, onAbrir }) {
  if (!trabajos.length) return null;
  return (
    <div className="mb-3 space-y-2">
      {trabajos.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onAbrir(t)}
          className="flex w-full items-center gap-3 rounded-2xl border border-[#0a84ff]/60 bg-[#0a84ff]/10 px-4 py-3 text-left"
        >
          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0a84ff] text-white">
            <Icon name="cronometro" />
            <span className="absolute -top-1 -right-1 h-3 w-3 animate-pulse rounded-full border-2 border-navy-950 bg-red-500" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[#8cc8ff]">Trabajo en curso</span>
            <span className="block truncate font-bold">
              {porId[t.empresa_id]?.nombre || 'B2B'} · {identificadorTrabajo(t)}
            </span>
            {t.direccion && <span className="block truncate text-xs text-tinta-400">{t.direccion}</span>}
          </span>
          <span className="shrink-0 text-right">
            <Reloj tiempos={t.tiempos} className="text-lg font-extrabold" />
            <span className="block text-xs font-semibold text-red-300">Finalizar ›</span>
          </span>
        </button>
      ))}
    </div>
  );
}
