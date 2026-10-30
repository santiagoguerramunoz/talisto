'use client';

import Link from 'next/link';
import Icon from './Icon';
import { useAvisosSinLeer } from '@/lib/avisos';

/** Botón de avisos con la cantidad sin leer */
export default function Campanita({ className = '' }) {
  const n = useAvisosSinLeer();
  return (
    <Link href="/panel/avisos" className={`btn btn-sec relative px-2.5 py-2 ${className}`} aria-label={n ? `Avisos: ${n} sin leer` : 'Avisos'}>
      <Icon name="campana" className="h-[18px] w-[18px]" />
      {n > 0 && (
        <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-marca-naranja px-1 text-[11px] font-extrabold text-navy-950">
          {n > 99 ? '99+' : n}
        </span>
      )}
    </Link>
  );
}
