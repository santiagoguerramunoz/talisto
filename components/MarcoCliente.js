'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Icon from './Icon';
import Logo from './Logo';
import Campanita from './Campanita';
import { supabase } from '@/lib/supabase';
import { registrarEvento } from '@/lib/match';

/** Sesión del cliente (si no hay, va al login y vuelve) */
export function useSesionCliente() {
  const router = useRouter();
  const ruta = usePathname();
  const [sesion, setSesion] = useState({ cargando: true, usuario: null, perfil: null });
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const u = data.session?.user;
      if (!u) {
        router.replace(`/login?volver=${encodeURIComponent(ruta)}`);
        return;
      }
      const { data: p } = await supabase.from('perfiles').select('*').eq('id', u.id).maybeSingle();
      if (vivo) setSesion({ cargando: false, usuario: u, perfil: p });
      registrarEvento('sesion');
    })();
    return () => {
      vivo = false;
    };
  }, [router, ruta]);
  return sesion;
}

/** Marco de las pantallas del cliente: cabecera con logo, avisos y volver */
export default function MarcoCliente({ titulo, volver, children, ancho = 'max-w-md md:max-w-3xl', acciones }) {
  const router = useRouter();
  return (
    <main className={`mx-auto min-h-dvh ${ancho} px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-16`}>
      <header className="sticky top-0 z-20 -mx-4 flex items-center gap-2 border-b border-navy-800 bg-navy-950/90 px-4 py-2.5 backdrop-blur">
        {volver ? (
          <button type="button" onClick={() => (typeof volver === 'string' ? router.push(volver) : router.back())} className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver">
            <Icon name="izq" />
          </button>
        ) : null}
        {titulo ? <h1 className="min-w-0 flex-1 truncate text-lg font-extrabold">{titulo}</h1> : (
          <Link href="/inicio" className="flex-1" aria-label="Inicio"><Logo /></Link>
        )}
        {acciones}
        <Campanita href="/match/avisos" />
      </header>
      {children}
    </main>
  );
}
