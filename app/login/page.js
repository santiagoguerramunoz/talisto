'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import CampoPassword from '@/components/CampoPassword';
import AvisoConfiguracion from '@/components/AvisoConfiguracion';
import { supabase } from '@/lib/supabase';
import { rutaSegunPerfil } from '@/lib/sesion';
import { mensajeError } from '@/lib/util';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [cargando, setCargando] = useState(false);

  // Si ya hay sesión (o viene del link de confirmación del email), entra directo
  useEffect(() => {
    let activo = true;
    const ir = async (sesion) => {
      if (activo && sesion) router.replace(await rutaSegunPerfil(sesion.user.id));
    };
    supabase.auth.getSession().then(({ data }) => ir(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((evento, sesion) => {
      // setTimeout: Supabase recomienda no consultar la base dentro de este callback
      if (evento === 'SIGNED_IN') setTimeout(() => ir(sesion), 0);
    });
    return () => {
      activo = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  async function entrar(e) {
    e.preventDefault();
    setError('');
    setAviso('');
    setCargando(true);
    const { data, error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) {
      setError(mensajeError(err));
      setCargando(false);
      return;
    }
    router.replace(await rutaSegunPerfil(data.user.id));
  }

  async function recuperar() {
    setError('');
    if (!email.trim()) {
      setError('Escribí tu email y tocá de nuevo "Olvidé mi contraseña".');
      return;
    }
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/nueva-clave`,
    });
    if (err) setError(mensajeError(err));
    else setAviso('Te enviamos un email con un link para crear una contraseña nueva.');
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <Link href="/" className="mb-10 self-start"><Logo grande /></Link>
      <AvisoConfiguracion />
      <h1 className="text-2xl font-extrabold">Entrar</h1>
      <p className="mt-1 text-tinta-300">Accedé a tu agenda.</p>

      <form onSubmit={entrar} className="mt-6 space-y-4">
        <div>
          <label className="etiqueta" htmlFor="email">Email</label>
          <input id="email" type="email" className="campo" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        <div>
          <label className="etiqueta" htmlFor="password">Contraseña</label>
          <CampoPassword id="password" value={password} onChange={setPassword} />
        </div>
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        {aviso && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{aviso}</p>}
        <button className="btn btn-menta w-full py-3.5" disabled={cargando}>{cargando ? 'Entrando…' : 'Entrar'}</button>
      </form>

      <button type="button" onClick={recuperar} className="mt-4 self-center text-sm text-tinta-400 underline-offset-4 hover:underline">
        Olvidé mi contraseña
      </button>
      <p className="mt-8 text-center text-sm text-tinta-300">
        ¿No tenés cuenta? <Link href="/registro?rol=profesional" className="font-semibold text-menta-400">Registrate</Link>
      </p>
    </main>
  );
}
