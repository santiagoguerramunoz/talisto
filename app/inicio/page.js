'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import Icon from '@/components/Icon';
import BotonInstalar from '@/components/BotonInstalar';
import { supabase } from '@/lib/supabase';
import { monto, mensajeError } from '@/lib/util';

// Pantalla del cliente. El buscador y las reservas llegan en las fases 2 y 3.
export default function InicioCliente() {
  const router = useRouter();
  const [perfil, setPerfil] = useState(null);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace('/login');
        return;
      }
      const [{ data: p }, { data: c }] = await Promise.all([
        supabase.from('perfiles').select('*').eq('id', data.session.user.id).maybeSingle(),
        supabase.from('configuracion').select('*').eq('id', 1).maybeSingle(),
      ]);
      if (p?.rol === 'profesional') {
        router.replace('/panel');
        return;
      }
      setPerfil(p);
      setConfig(c);
    })();
  }, [router]);

  async function hacermeProfesional() {
    setCargando(true);
    setError('');
    const { error: err } = await supabase.rpc('convertirme_en_profesional');
    setCargando(false);
    if (err) setError(mensajeError(err));
    else router.replace('/panel/perfil');
  }

  async function salir() {
    await supabase.auth.signOut();
    router.replace('/');
  }

  if (!perfil) return <div className="grid min-h-dvh place-items-center text-tinta-400">Cargando…</div>;

  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-10">
      <header className="flex items-center justify-between py-2">
        <Logo />
        <button onClick={salir} className="rounded-full p-2 text-tinta-400 hover:text-tinta-100" aria-label="Cerrar sesión">
          <Icon name="salir" />
        </button>
      </header>
      <h1 className="mt-10 text-3xl font-extrabold">Hola{perfil.nombre ? `, ${perfil.nombre}` : ''} 👋</h1>
      <div className="tarjeta mt-6 p-5">
        <p className="font-bold">Muy pronto vas a poder buscar profesionales en TaListo!</p>
        <p className="mt-2 text-sm text-tinta-300">
          Electricistas, sanitarios, jardineros y más, por zona y por servicio. Vas a ver sus horarios libres y reservar
          una visita técnica{config ? ` por ${monto(config.precio_visita, config.moneda)}` : ''}.
        </p>
      </div>
      <div className="mt-4">
        <BotonInstalar variante="tarjeta" />
      </div>
      {perfil.es_admin && (
        <button onClick={() => router.push('/admin')} className="btn btn-sec mt-4 w-full">
          <Icon name="escudo" /> Panel de administración
        </button>
      )}
      <div className="tarjeta mt-4 p-5">
        <p className="font-bold">¿Tenés un oficio o sos profesional?</p>
        <p className="mt-1 text-sm text-tinta-300">Activá tu agenda, cargá tus clientes y tus servicios.</p>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        <button onClick={hacermeProfesional} disabled={cargando} className="btn btn-menta mt-4 w-full">
          {cargando ? 'Activando…' : 'Quiero ofrecer mis servicios'}
        </button>
      </div>
    </main>
  );
}
