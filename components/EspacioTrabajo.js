'use client';

import Link from 'next/link';
import { useState } from 'react';
import Icon from './Icon';
import { usePanel } from './PanelContext';
import { esBusiness } from '@/lib/planes';
import { usable } from '@/lib/empresa';

// Perfil > Espacio de trabajo: pasar de lo personal a una empresa del equipo, y gestionar la empresa propia
export default function EspacioTrabajo() {
  const { yo, empresa, espacios, planPersonal, permisos, cambiarEspacio } = usePanel();
  const [cambiando, setCambiando] = useState('');
  if (!espacios?.disponible) return null;

  const miEmpresa = espacios.miEmpresa;
  const lista = espacios.empresas || [];
  const gestiona = empresa && (permisos || []).includes('equipo');
  if (!lista.length && !miEmpresa && !esBusiness(planPersonal?.plan)) return null;

  async function elegir(id) {
    setCambiando(id || 'personal');
    await cambiarEspacio(id);
  }

  function estadoDe(e) {
    if (e.estado !== 'activo') return 'Tu cuenta está bloqueada en esta empresa';
    if (!e.activa) return 'La empresa no tiene Business activo';
    if (!(e.permisos || []).length) return 'Todavía no tenés roles asignados';
    return (e.roles || []).join(' · ') || 'Sin roles';
  }

  return (
    <section>
      <h2 className="titulo-seccion mb-2">Espacio de trabajo</h2>
      <div className="tarjeta divide-y divide-navy-800 overflow-hidden">
        {(lista.length > 0 || empresa) && (
          <>
            <button type="button" onClick={() => elegir('')} disabled={!empresa || !!cambiando} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-navy-850">
              <Icon name="perfil" className="h-5 w-5 shrink-0 text-tinta-300" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Personal</span>
                <span className="block truncate text-xs text-tinta-400">{yo?.nombre_publico || 'Tu agenda y tus clientes'}</span>
              </span>
              {!empresa ? <Icon name="check" className="h-5 w-5 text-menta-400" /> : cambiando === 'personal' ? <span className="text-xs text-tinta-400">…</span> : null}
            </button>
            {lista.map((e) => {
              const ok = usable(e);
              const actual = empresa?.id === e.id;
              return (
                <button key={e.id} type="button" onClick={() => ok && !actual && elegir(e.id)} disabled={!ok || actual || !!cambiando} className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-navy-850 ${ok ? '' : 'opacity-60'}`}>
                  <Icon name="empresa" className="h-5 w-5 shrink-0 text-menta-300" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{e.nombre}</span>
                    <span className="block truncate text-xs text-tinta-400">{estadoDe(e)}</span>
                  </span>
                  {actual ? <Icon name="check" className="h-5 w-5 text-menta-400" /> : cambiando === e.id ? <span className="text-xs text-tinta-400">…</span> : ok ? <Icon name="der" className="h-4 w-4 text-tinta-500" /> : null}
                </button>
              );
            })}
          </>
        )}
        {(miEmpresa || gestiona) && (
          <Link href="/panel/empresa" className="flex items-center gap-3 px-4 py-3 hover:bg-navy-850">
            <Icon name="clientes" className="h-5 w-5 shrink-0 text-marca-naranja" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{gestiona ? `Equipo de ${empresa.nombre}` : `Mi empresa: ${miEmpresa.nombre}`}</span>
              <span className="block text-xs text-tinta-400">
                {miEmpresa && !gestiona ? `${miEmpresa.usadas} de ${miEmpresa.cupo} cuentas · ` : ''}Cuentas, roles e invitaciones
              </span>
            </span>
            <Icon name="der" className="h-4 w-4 text-tinta-500" />
          </Link>
        )}
        {!miEmpresa && !empresa && esBusiness(planPersonal?.plan) && (
          <Link href="/panel/empresa" className="flex items-center gap-3 px-4 py-3 hover:bg-navy-850">
            <Icon name="empresa" className="h-5 w-5 shrink-0 text-marca-naranja" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Crear mi empresa</span>
              <span className="block text-xs text-tinta-400">Invitá a tu equipo y dales roles con permisos</span>
            </span>
            <Icon name="der" className="h-4 w-4 text-tinta-500" />
          </Link>
        )}
      </div>
      {empresa && <p className="mt-2 text-xs text-tinta-500">En {empresa.nombre} ves y cargás los datos de la empresa según tus roles. Tu perfil público y tus horarios siguen siendo los tuyos.</p>}
    </section>
  );
}
