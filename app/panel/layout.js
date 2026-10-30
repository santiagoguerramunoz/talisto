'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import { PanelContext } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { cargarPlan } from '@/lib/planes';
import { SECCIONES, cargarEspacios, espacioGuardado, guardarEspacio, invitacionPendiente, tiene, usable } from '@/lib/empresa';
import BarraLateral from '@/components/BarraLateral';
import { useVistaPc, vistaPcHabilitada } from '@/lib/vista';

// En la vista PC estas pantallas quedan angostas (formularios); el resto va a lo ancho
const ANGOSTAS = ['/panel/perfil', '/panel/planes', '/panel/empresa', '/panel/avisos'];

const NAV = [
  { href: '/panel', icono: 'agenda', texto: 'Agenda' },
  { href: '/panel/relevamientos', icono: 'relevamiento', texto: 'Relevar' },
  { href: '/panel/clientes', icono: 'clientes', texto: 'Clientes' },
  { href: '/panel/mapa', icono: 'mapa', texto: 'Mapa' },
  { href: '/panel/finanzas', icono: 'grafico', texto: 'Finanzas' },
  { href: '/panel/perfil', icono: 'perfil', texto: 'Perfil' },
];

// Sección del menú a la que pertenece una ruta
function seccionDe(pathname) {
  if (pathname.startsWith('/panel/ordenes')) return '/panel/finanzas';
  if (pathname.startsWith('/panel/planes') || pathname.startsWith('/panel/empresa')) return '/panel/perfil';
  if (pathname.startsWith('/panel/equipo')) return '/panel/equipo';
  const item = NAV.filter((n) => n.href !== '/panel').find((n) => pathname.startsWith(n.href));
  return item ? item.href : '/panel';
}

export default function PanelLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [estado, setEstado] = useState({ cargando: true, user: null, perfil: null, profesional: null, plan: null });

  const cargar = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) {
      router.replace('/login');
      return;
    }
    const uid = session.user.id;
    const [{ data: perfil }, { data: profesional }, plan, espacios] = await Promise.all([
      supabase.from('perfiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('profesionales').select('*').eq('id', uid).maybeSingle(),
      cargarPlan(),
      cargarEspacios(),
    ]);
    if (!perfil || perfil.rol !== 'profesional' || !profesional) {
      router.replace(perfil?.es_admin ? '/admin' : '/inicio');
      return;
    }

    // Espacio de trabajo: Personal o una empresa en la que estoy
    let empresa = null;
    let cuenta = profesional;
    let planActivo = plan;
    const guardado = espacioGuardado();
    const elegida = espacios.empresas.find((e) => e.id === guardado);
    if (elegida && usable(elegida)) {
      const { data: dueno } = await supabase.from('profesionales').select('*').eq('id', elegida.dueno_id).maybeSingle();
      if (dueno) {
        empresa = elegida;
        cuenta = dueno;
        planActivo = { ...plan, plan: 'business', origen: 'empresa', limite_exportaciones: null, limite_empresas_b2b: null };
      }
    }
    if (guardado && !empresa) guardarEspacio('');

    setEstado({
      cargando: false,
      user: session.user,
      perfil,
      yo: profesional,          // mi cuenta personal
      profesional: cuenta,      // dueña de los datos con los que se trabaja (yo o la empresa)
      plan: planActivo,
      planPersonal: plan,
      empresa,                  // null = Personal
      permisos: empresa ? empresa.permisos : null,
      espacios,
    });
  }, [router]);

  useEffect(() => {
    cargar();
    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT') router.replace('/login');
    });
    return () => sub.subscription.unsubscribe();
  }, [cargar, router]);

  const recargarPlan = useCallback(async () => {
    const plan = await cargarPlan();
    setEstado((e) => (e.empresa ? { ...e, planPersonal: plan } : { ...e, plan, planPersonal: plan }));
    return plan;
  }, []);

  const cambiarEspacio = useCallback(
    async (empresaId) => {
      guardarEspacio(empresaId || '');
      setEstado((e) => ({ ...e, cargando: true }));
      await cargar();
      router.push('/panel');
    },
    [cargar, router]
  );

  const vista = useVistaPc(!estado.cargando && vistaPcHabilitada(estado));
  const valor = useMemo(
    () => ({ ...estado, recargar: cargar, recargarPlan, cambiarEspacio, vistaPc: vista.pc, vistaPreferida: vista.preferencia, elegirVista: vista.elegir }),
    [estado, cargar, recargarPlan, cambiarEspacio, vista.pc, vista.preferencia, vista.elegir]
  );

  // En una empresa, cada uno ve solo las secciones de sus permisos
  const nav = estado.empresa
    ? NAV.filter((n) => tiene(estado.permisos, SECCIONES[n.href])).map((n) =>
        // Producción sin agenda: su inicio son sus tickets
        n.href === '/panel' && !(estado.permisos || []).includes('agenda') ? { ...n, icono: 'maletin', texto: 'Tickets' } : n
      )
    : NAV;
  const seccion = seccionDe(pathname);
  const permitida = !estado.empresa || tiene(estado.permisos, SECCIONES[seccion]);
  useEffect(() => {
    if (!estado.cargando && !permitida) router.replace(nav[0]?.href || '/panel/perfil');
  }, [estado.cargando, permitida, nav, router]);

  if (estado.cargando) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-navy-700 border-t-menta-400" />
      </div>
    );
  }

  const invitacion = estado.espacios?.invitaciones?.[0]?.codigo || invitacionPendiente();
  const mostrarInvitacion = invitacion && (pathname === '/panel' || pathname === '/panel/perfil');
  const activo = seccion === '/panel/equipo' ? '/panel' : seccion;
  const angosta = ANGOSTAS.some((r) => pathname.startsWith(r));

  return (
    <PanelContext.Provider value={valor}>
      {vista.pc && (
        <BarraLateral
          nav={nav}
          activo={['/panel/equipo', '/panel/avisos', '/panel/mi-stock'].some((r) => pathname.startsWith(r)) ? '' : seccion}
          pathname={pathname}
        />
      )}
      <div className={vista.pc ? 'min-h-dvh pl-64' : ''}>
      <div
        key={estado.empresa?.id || 'personal'}
        className={
          vista.pc
            ? `mx-auto min-h-dvh px-4 pb-12 ${angosta ? 'max-w-3xl' : 'max-w-6xl'}`
            : `mx-auto min-h-dvh max-w-2xl ${estado.empresa ? 'pb-[calc(7rem_+_env(safe-area-inset-bottom))]' : 'pb-[calc(5.5rem_+_env(safe-area-inset-bottom))]'}`
        }
      >
        {mostrarInvitacion && (
          <Link
            href={`/unirme?c=${encodeURIComponent(invitacion)}`}
            className="mx-4 mt-[max(0.75rem,env(safe-area-inset-top))] flex items-center gap-3 rounded-2xl border border-menta-500/40 bg-menta-500/10 p-3 text-sm"
          >
            <Icon name="empresa" className="h-5 w-5 shrink-0 text-menta-300" />
            <span className="min-w-0 flex-1">
              <b className="block text-tinta-100">
                Te invitaron a {estado.espacios?.invitaciones?.[0]?.empresa || 'una empresa'}
              </b>
              <span className="text-xs text-tinta-300">Tocá para ver la invitación y sumarte al equipo</span>
            </span>
            <Icon name="der" className="h-4 w-4 shrink-0 text-tinta-400" />
          </Link>
        )}
        {permitida ? children : null}
      </div>
      </div>

      {!vista.pc && (
      <nav className="fixed inset-x-0 bottom-0 z-[1100] border-t border-navy-800 bg-navy-950/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        {estado.empresa && (
          <button
            type="button"
            onClick={() => router.push('/panel/perfil')}
            className="mx-auto flex max-w-2xl items-center justify-center gap-1.5 border-b border-navy-800 bg-menta-500/10 px-3 py-1 text-[11px] font-bold text-menta-300 w-full"
          >
            <Icon name="empresa" className="h-3.5 w-3.5" /> Trabajando en {estado.empresa.nombre}
          </button>
        )}
        <div className="mx-auto grid max-w-2xl" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
          {nav.map((item) => {
            const esActivo = item.href === activo;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-w-0 flex-col items-center gap-1 pt-2.5 pb-1.5 text-[10.5px] font-semibold ${esActivo ? 'text-menta-400' : 'text-tinta-400'}`}
              >
                <span className={`grid h-8 w-11 place-items-center rounded-full ${esActivo ? 'bg-menta-500/15' : ''}`}>
                  <Icon name={item.icono} className="h-[22px] w-[22px]" />
                </span>
                {item.texto}
                <span className={`h-1 w-1 rounded-full ${esActivo ? 'bg-marca-naranja' : 'bg-transparent'}`} />
              </Link>
            );
          })}
        </div>
      </nav>
      )}
    </PanelContext.Provider>
  );
}
