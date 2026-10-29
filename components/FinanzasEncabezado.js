'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from './Icon';
import { MESES } from '@/lib/fechas';
import { esPro } from '@/lib/planes';
import { usePanel } from './PanelContext';

const TABS = [
  { href: '/panel/finanzas', texto: 'Resumen' },
  { href: '/panel/finanzas/presupuestos', texto: 'Presupuestos', pro: true },
  { href: '/panel/finanzas/gastos', texto: 'Mis gastos', pro: true },
];

// Encabezado de Finanzas: pestañas y, si corresponde, el mes
export default function FinanzasEncabezado({ periodo, onMover, accion }) {
  const pathname = usePathname();
  const panel = usePanel();
  const pro = esPro(panel?.plan?.plan);
  return (
    <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Finanzas</h1>
        {accion}
      </div>
      <nav className="mt-3 grid grid-cols-3 rounded-xl bg-navy-900 p-1 text-sm font-bold">
        {TABS.map((t) => {
          const activo = t.href === '/panel/finanzas' ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} className={`flex min-w-0 items-center justify-center gap-0.5 whitespace-nowrap rounded-lg px-1 py-1.5 text-center text-[13px] sm:text-sm ${activo ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}>
              {t.texto}
              {t.pro && !pro && <Icon name="candado" className="h-3.5 w-3.5 text-marca-naranja" />}
            </Link>
          );
        })}
      </nav>
      {periodo && onMover && (
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => onMover(-1)} className="btn btn-sec px-2.5 py-2" aria-label="Mes anterior"><Icon name="izq" /></button>
          <button onClick={() => onMover(1)} className="btn btn-sec px-2.5 py-2" aria-label="Mes siguiente"><Icon name="der" /></button>
          <p className="flex-1 px-1 font-bold capitalize">{MESES[periodo.mes - 1]} {periodo.anio}</p>
        </div>
      )}
    </header>
  );
}
