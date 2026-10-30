'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import Icon from './Icon';
import { MESES } from '@/lib/fechas';
import { esBusiness, esPro } from '@/lib/planes';
import { usePanel } from './PanelContext';

const TABS = [
  { href: '/panel/finanzas', texto: 'Resumen', permisos: ['importes', 'tickets_asignar'] },
  { href: '/panel/finanzas/presupuestos', texto: 'Presupuestos', pro: true, permisos: ['presupuestos', 'importes'] },
  { href: '/panel/finanzas/gastos', texto: 'Gastos', pro: true, permisos: ['gastos', 'importes'] },
  { href: '/panel/finanzas/compras', texto: 'Compras', pro: true, permisos: ['compras'], tambien: ['/panel/finanzas/proveedores'] },
  { href: '/panel/finanzas/stock', texto: 'Stock', business: true, permisos: ['stock', 'compras'] },
  { href: '/panel/finanzas/comisiones', texto: 'Comisiones', business: true, permisos: ['comisiones', 'presupuestos'] },
];

// Encabezado de Finanzas: pestañas y, si corresponde, el mes
export default function FinanzasEncabezado({ periodo, onMover, accion }) {
  const pathname = usePathname();
  const panel = usePanel();
  const navRef = useRef(null);
  useEffect(() => {
    const activo = navRef.current?.querySelector('[data-activo="si"]');
    if (activo && navRef.current) navRef.current.scrollLeft = Math.max(0, activo.offsetLeft - (navRef.current.clientWidth - activo.offsetWidth) / 2);
  }, [pathname]);
  const pro = esPro(panel?.plan?.plan);
  const business = esBusiness(panel?.plan?.plan);
  // En una empresa, solo las pestañas de sus permisos
  const tabs = panel?.empresa ? TABS.filter((t) => t.permisos.some((p) => (panel.permisos || []).includes(p))) : TABS;
  return (
    <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Finanzas</h1>
        {accion}
      </div>
      <nav ref={navRef} className="mt-3 flex overflow-x-auto rounded-xl bg-navy-900 p-1 text-sm font-bold [scrollbar-width:none]">
        {tabs.map((t) => {
          const activo = t.href === '/panel/finanzas' ? pathname === t.href : [t.href, ...(t.tambien || [])].some((h) => pathname.startsWith(h));
          return (
            <Link key={t.href} href={t.href} data-activo={activo ? 'si' : 'no'} className={`flex shrink-0 grow items-center justify-center gap-0.5 whitespace-nowrap rounded-lg px-[7px] py-1.5 text-center text-[13px] sm:px-2 sm:text-sm ${activo ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}>
              {t.texto}
              {((t.pro && !pro) || (t.business && !business)) && <Icon name="candado" className="h-3.5 w-3.5 text-marca-naranja" />}
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
