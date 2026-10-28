'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import { PanelContext } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';

const NAV = [
  { href: '/panel', icono: 'agenda', texto: 'Agenda' },
  { href: '/panel/clientes', icono: 'clientes', texto: 'Clientes' },
  { href: '/panel/mapa', icono: 'mapa', texto: 'Mapa' },
  { href: '/panel/perfil', icono: 'perfil', texto: 'Perfil' },
];

export default function PanelLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [estado, setEstado] = useState({ cargando: true, user: null, perfil: null, profesional: null });

  const cargar = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) {
      router.replace('/login');
      return;
    }
    const uid = session.user.id;
    const [{ data: perfil }, { data: profesional }] = await Promise.all([
      supabase.from('perfiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('profesionales').select('*').eq('id', uid).maybeSingle(),
    ]);
    if (!perfil || perfil.rol !== 'profesional' || !profesional) {
      router.replace(perfil?.es_admin ? '/admin' : '/inicio');
      return;
    }
    setEstado({ cargando: false, user: session.user, perfil, profesional });
  }, [router]);

  useEffect(() => {
    cargar();
    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT') router.replace('/login');
    });
    return () => sub.subscription.unsubscribe();
  }, [cargar, router]);

  const valor = useMemo(() => ({ ...estado, recargar: cargar }), [estado, cargar]);

  if (estado.cargando) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-navy-700 border-t-menta-400" />
      </div>
    );
  }

  return (
    <PanelContext.Provider value={valor}>
      <div className="mx-auto min-h-dvh max-w-2xl pb-[calc(5.5rem_+_env(safe-area-inset-bottom))]">{children}</div>

      <nav className="fixed inset-x-0 bottom-0 z-[1100] border-t border-navy-800 bg-navy-950/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-2xl grid-cols-4">
          {NAV.map((item) => {
            const activo = item.href === '/panel' ? pathname === '/panel' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-1 pt-2.5 pb-1.5 text-[11px] font-semibold ${activo ? 'text-menta-400' : 'text-tinta-400'}`}
              >
                <span className={`grid h-8 w-14 place-items-center rounded-full ${activo ? 'bg-menta-500/15' : ''}`}>
                  <Icon name={item.icono} className="h-[22px] w-[22px]" />
                </span>
                {item.texto}
                <span className={`h-1 w-1 rounded-full ${activo ? 'bg-marca-naranja' : 'bg-transparent'}`} />
              </Link>
            );
          })}
        </div>
      </nav>
    </PanelContext.Provider>
  );
}
