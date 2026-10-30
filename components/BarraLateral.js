'use client';

import Link from 'next/link';
import Icon from './Icon';
import Logo from './Logo';
import { usePanel } from './PanelContext';
import { NOMBRE_PLAN } from '@/lib/planes';
import { useAvisosSinLeer } from '@/lib/avisos';
import { useEquipoAsignable } from '@/lib/equipo';
import { guardarVista } from '@/lib/vista';

function Item({ href, icono, texto, activo, insignia = 0 }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
        activo ? 'bg-menta-500/15 text-menta-300' : 'text-tinta-300 hover:bg-navy-850 hover:text-tinta-100'
      }`}
    >
      <Icon name={icono} className="h-5 w-5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{texto}</span>
      {insignia > 0 && (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-marca-naranja px-1.5 text-[11px] font-extrabold text-navy-950">
          {insignia > 99 ? '99+' : insignia}
        </span>
      )}
    </Link>
  );
}

/** Menú de la vista PC: secciones, equipo, avisos y cambio de vista */
export default function BarraLateral({ nav, activo, pathname }) {
  const panel = usePanel();
  const equipo = useEquipoAsignable();
  const sinLeer = useAvisosSinLeer();
  const conEquipo = !!panel.empresa || equipo.hayEquipo;
  const plan = panel.plan?.plan;

  return (
    <aside className="fixed inset-y-0 left-0 z-[1100] flex w-64 flex-col border-r border-navy-800 bg-navy-950">
      <div className="px-5 pb-4 pt-5">
        <Link href="/panel" aria-label="Inicio">
          <Logo />
        </Link>
      </div>

      <Link href="/panel/perfil" className="mx-3 mb-3 flex items-center gap-3 rounded-xl border border-navy-800 bg-navy-900 px-3 py-2.5 hover:border-navy-700">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-menta-500/15 text-menta-300">
          <Icon name={panel.empresa ? 'empresa' : 'perfil'} className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <b className="block truncate text-sm">{panel.empresa ? panel.empresa.nombre : panel.yo?.nombre_publico || 'Mi cuenta'}</b>
          <span className="block truncate text-[11px] text-tinta-400">
            {panel.empresa ? 'Trabajando en la empresa' : `Plan ${NOMBRE_PLAN[plan] || plan || ''}`}
          </span>
        </span>
      </Link>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {nav.map((n) => (
          <Item key={n.href} href={n.href} icono={n.icono} texto={n.texto} activo={activo === n.href} />
        ))}
        {(conEquipo || equipo.puedeMonitorear) && <p className="px-3 pb-1 pt-4 text-[10.5px] font-bold uppercase tracking-wider text-tinta-500">Equipo</p>}
        {equipo.puedeMonitorear && equipo.disponible && (
          <Item href="/panel/equipo" icono="ruta" texto="Equipo en ruta" activo={pathname.startsWith('/panel/equipo')} />
        )}
        {conEquipo && <Item href="/panel/avisos" icono="campana" texto="Avisos" activo={pathname.startsWith('/panel/avisos')} insignia={sinLeer} />}
        {panel.empresa && <Item href="/panel/mi-stock" icono="caja" texto="Mi stock" activo={pathname.startsWith('/panel/mi-stock')} />}
      </nav>

      <div className="space-y-2 border-t border-navy-800 p-3">
        <button
          type="button"
          onClick={() => guardarVista('celular')}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-tinta-400 hover:bg-navy-850 hover:text-tinta-100"
        >
          <Icon name="celular" className="h-5 w-5" /> Pasar a vista celular
        </button>
        <p className="truncate px-3 text-[11px] text-tinta-500">{panel.user?.email}</p>
      </div>
    </aside>
  );
}
