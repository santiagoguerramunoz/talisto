'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import CampoPassword from '@/components/CampoPassword';
import { supabase } from '@/lib/supabase';
import { rutaSegunPerfil } from '@/lib/sesion';
import { mensajeError } from '@/lib/util';

export default function NuevaClave() {
  const router = useRouter();
  const [listo, setListo] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    // El link del email trae la sesión de recuperación; Supabase la detecta sola
    const { data: sub } = supabase.auth.onAuthStateChange((evento, sesion) => {
      if (evento === 'PASSWORD_RECOVERY' || sesion) setListo(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setListo(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function guardar(e) {
    e.preventDefault();
    setError('');
    if (password !== confirmar) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setCargando(true);
    const { data, error: err } = await supabase.auth.updateUser({ password });
    setCargando(false);
    if (err) {
      setError(mensajeError(err));
      return;
    }
    router.replace(await rutaSegunPerfil(data.user.id));
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <Link href="/" className="mb-10 self-start"><Logo grande /></Link>
      <h1 className="text-2xl font-extrabold">Nueva contraseña</h1>
      {!listo ? (
        <p className="mt-3 text-tinta-300">
          Abrí esta página desde el link que te llegó por email. Si ya venció, pedí uno nuevo desde{' '}
          <Link href="/login" className="text-menta-400">Entrar</Link>.
        </p>
      ) : (
        <form onSubmit={guardar} className="mt-6 space-y-4">
          <div>
            <label className="etiqueta" htmlFor="p1">Contraseña nueva</label>
            <CampoPassword id="p1" value={password} onChange={setPassword} autoComplete="new-password" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="p2">Confirmar contraseña</label>
            <CampoPassword id="p2" value={confirmar} onChange={setConfirmar} autoComplete="new-password" />
          </div>
          {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
          <button className="btn btn-menta w-full py-3.5" disabled={cargando}>{cargando ? 'Guardando…' : 'Guardar contraseña'}</button>
        </form>
      )}
    </main>
  );
}
