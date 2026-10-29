'use client';

import Link from 'next/link';
import Icon from './Icon';
import { NOMBRE_PLAN } from '@/lib/planes';

// Tarjeta para una función que el plan actual no incluye.
// Se ve qué hace la función y cómo habilitarla.
export default function BloqueoPlan({ titulo, texto, puntos = [], plan = 'pro', compacto = false, className = '' }) {
  if (compacto) {
    return (
      <Link href="/panel/planes" className={`tarjeta flex items-center gap-3 p-3 hover:bg-navy-850 ${className}`}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-marca-naranja/15 text-marca-naranja">
          <Icon name="candado" className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{titulo}</span>
          {texto && <span className="block text-xs text-tinta-400">{texto}</span>}
        </span>
        <span className="shrink-0 rounded-full bg-marca-naranja/15 px-2.5 py-1 text-xs font-bold text-marca-naranja">{NOMBRE_PLAN[plan]}</span>
      </Link>
    );
  }
  return (
    <section className={`tarjeta overflow-hidden ${className}`}>
      <div className="flex items-start gap-3 p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-marca-naranja/15 text-marca-naranja">
          <Icon name="candado" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-marca-naranja">Disponible en {NOMBRE_PLAN[plan]}</p>
          <h2 className="mt-0.5 text-lg font-extrabold">{titulo}</h2>
          {texto && <p className="mt-1 text-sm text-tinta-300">{texto}</p>}
        </div>
      </div>
      {puntos.length > 0 && (
        <ul className="space-y-1.5 border-t border-navy-800 px-4 py-3 text-sm text-tinta-300">
          {puntos.map((p) => (
            <li key={p} className="flex items-start gap-2">
              <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-menta-400" /> {p}
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-navy-800 p-3">
        <Link href="/panel/planes" className="btn btn-menta w-full">
          <Icon name="estrella" /> Ver planes
        </Link>
      </div>
    </section>
  );
}

// Aviso cuando la base rechaza algo por el plan (TL001 / TL002)
export function AvisoPlan({ error, className = '' }) {
  if (!error) return null;
  return (
    <div className={`rounded-xl border border-marca-naranja/40 bg-marca-naranja/10 p-3 text-sm text-orange-100 ${className}`}>
      <p className="flex items-start gap-2">
        <Icon name="candado" className="mt-0.5 h-4 w-4 shrink-0 text-marca-naranja" />
        <span>{[error.message, error.hint].filter(Boolean).join(' ')}</span>
      </p>
      <Link href="/panel/planes" className="mt-2 inline-flex items-center gap-1 font-bold text-marca-naranja">
        Ver planes <Icon name="der" className="h-4 w-4" />
      </Link>
    </div>
  );
}
