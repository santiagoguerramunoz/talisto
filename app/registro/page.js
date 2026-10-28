'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import Logo from '@/components/Logo';
import CampoPassword from '@/components/CampoPassword';
import AvisoConfiguracion from '@/components/AvisoConfiguracion';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/util';

function FormRegistro() {
  const router = useRouter();
  const params = useSearchParams();
  const [rol, setRol] = useState(params.get('rol') === 'cliente' ? 'cliente' : 'profesional');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [error, setError] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [cargando, setCargando] = useState(false);

  const noCoinciden = confirmar.length > 0 && confirmar !== password;

  async function registrar(e) {
    e.preventDefault();
    setError('');
    if (password !== confirmar) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setCargando(true);
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { nombre: nombre.trim(), rol, telefono: telefono.trim() },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    setCargando(false);
    if (err) {
      setError(mensajeError(err));
      return;
    }
    if (data.session) router.replace(rol === 'profesional' ? '/panel' : '/inicio');
    else setEnviado(true);
  }

  if (enviado) {
    return (
      <div className="tarjeta p-6 text-center">
        <h1 className="text-xl font-extrabold">¡Cuenta creada!</h1>
        <p className="mt-2 text-tinta-300">
          Te enviamos un email a <b className="text-tinta-100">{email}</b>. Confirmalo y después entrá con tu contraseña.
        </p>
        <Link href="/login" className="btn btn-menta mt-6 w-full">Ir a entrar</Link>
      </div>
    );
  }

  return (
    <>
      <AvisoConfiguracion />
      <h1 className="text-2xl font-extrabold">Crear cuenta</h1>
      <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-navy-900 p-1.5">
        {[
          ['profesional', 'Soy profesional'],
          ['cliente', 'Busco un servicio'],
        ].map(([valor, texto]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setRol(valor)}
            className={`rounded-xl py-2.5 text-sm font-bold transition ${rol === valor ? 'bg-menta-500 text-navy-950' : 'text-tinta-300'}`}
          >
            {texto}
          </button>
        ))}
      </div>

      <form onSubmit={registrar} className="mt-6 space-y-4">
        <div>
          <label className="etiqueta" htmlFor="nombre">{rol === 'profesional' ? 'Nombre o nombre comercial' : 'Nombre'}</label>
          <input id="nombre" className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={rol === 'profesional' ? 'Ej. Juan Pérez Electricista' : 'Tu nombre'} required />
        </div>
        <div>
          <label className="etiqueta" htmlFor="telefono">Celular / WhatsApp</label>
          <input id="telefono" type="tel" inputMode="tel" className="campo" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="099 123 456" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="email">Email</label>
          <input id="email" type="email" className="campo" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        <div>
          <label className="etiqueta" htmlFor="password">Contraseña</label>
          <CampoPassword id="password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="Mínimo 6 caracteres" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="confirmar">Confirmar contraseña</label>
          <CampoPassword id="confirmar" value={confirmar} onChange={setConfirmar} autoComplete="new-password" placeholder="Repetí la contraseña" />
          {noCoinciden && <p className="mt-1.5 text-xs text-red-300">Las contraseñas no coinciden.</p>}
        </div>
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        <button className="btn btn-menta w-full py-3.5" disabled={cargando || noCoinciden}>
          {cargando ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>
      </form>
      <p className="mt-8 text-center text-sm text-tinta-300">
        ¿Ya tenés cuenta? <Link href="/login" className="font-semibold text-menta-400">Entrar</Link>
      </p>
    </>
  );
}

export default function Registro() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <Link href="/" className="mb-8 self-start"><Logo grande /></Link>
      <Suspense fallback={null}>
        <FormRegistro />
      </Suspense>
    </main>
  );
}
