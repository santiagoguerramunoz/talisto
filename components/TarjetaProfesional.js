'use client';

import Link from 'next/link';
import Icon from './Icon';
import { Estrellas } from '@/lib/match';

const Envoltorio = ({ enlace, href, children }) =>
  enlace ? (
    <Link href={href} className="flex items-center gap-3">
      {children}
    </Link>
  ) : (
    <div className="flex items-center gap-3">{children}</div>
  );

/** Profesional como lo ve el cliente: nombre, verificado, calificación verificada y visitas hechas por TaListo! */
export default function TarjetaProfesional({ p, enlace = true }) {
  if (!p) return null;
  return (
    <Envoltorio enlace={enlace} href={`/match/profesional/${p.id}`}>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-menta-500/15 text-lg font-extrabold text-menta-300">
        {(p.nombre || '?').slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0">
        <b className="flex items-center gap-1.5">
          <span className="truncate">{p.nombre}</span>
          {p.verificado && <Icon name="escudo" className="h-4 w-4 shrink-0 text-menta-300" />}
        </b>
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-tinta-400">
          {p.calificacion?.cantidad > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Estrellas valor={p.calificacion.promedio} tam="h-3.5 w-3.5" /> {Number(p.calificacion.promedio).toLocaleString('es-UY')} ({p.calificacion.cantidad})
            </span>
          ) : (
            <span>Sin calificaciones todavía</span>
          )}
          {p.visitas > 0 && <span>{p.visitas} visitas por TaListo!</span>}
          {p.verificado && <span className="text-menta-300">Verificado</span>}
        </span>
      </span>
    </Envoltorio>
  );
}

