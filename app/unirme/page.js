'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import Icon from '@/components/Icon';
import { supabase } from '@/lib/supabase';
import { guardarEspacio, guardarInvitacion } from '@/lib/empresa';
import { mensajeError } from '@/lib/util';

// Página a la que lleva el link o el QR de una invitación a una empresa
function Unirme() {
  const router = useRouter();
  const params = useSearchParams();
  const codigo = (params.get('c') || '').trim();
  const [invitacion, setInvitacion] = useState(undefined);
  const [sesion, setSesion] = useState(undefined);
  const [error, setError] = useState('');
  const [uniendo, setUniendo] = useState(false);

  useEffect(() => {
    if (!codigo) return;
    guardarInvitacion(codigo); // si tiene que entrar o crear la cuenta, vuelve acá
    supabase.rpc('ver_invitacion', { p_codigo: codigo }).then(({ data }) => {
      setInvitacion(data || null);
      if (!data || data.estado !== 'pendiente') guardarInvitacion(''); // ya no sirve: no volver a mostrarla
    });
    supabase.auth.getSession().then(({ data }) => setSesion(data.session || null));
  }, [codigo]);

  async function aceptar() {
    setError('');
    setUniendo(true);
    const { data, error: err } = await supabase.rpc('aceptar_invitacion', { p_codigo: codigo });
    setUniendo(false);
    if (err) return setError(mensajeError(err));
    guardarInvitacion('');
    guardarEspacio(data?.empresa_id || '');
    router.replace('/panel');
  }

  function descartar() {
    guardarInvitacion('');
    router.replace(sesion ? '/panel' : '/');
  }

  const valida = invitacion && invitacion.estado === 'pendiente';

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-10">
      <header className="py-2">
        <Logo />
      </header>
      <div className="flex flex-1 flex-col justify-center">
        {!codigo || invitacion === null ? (
          <section className="tarjeta p-6 text-center">
            <h1 className="text-xl font-extrabold">Invitación no encontrada</h1>
            <p className="mt-2 text-sm text-tinta-300">Revisá el link o pedile a la empresa que te mande uno nuevo.</p>
            <button type="button" className="btn btn-sec mt-6 w-full" onClick={descartar}>Volver</button>
          </section>
        ) : invitacion === undefined || sesion === undefined ? (
          <p className="text-center text-tinta-400">Cargando…</p>
        ) : (
          <section className="tarjeta overflow-hidden">
            <div className="p-6 text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-menta-500/15 text-menta-300">
                <Icon name="empresa" className="h-7 w-7" />
              </span>
              <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-tinta-400">Te invitaron a sumarte a</p>
              <h1 className="mt-1 text-2xl font-extrabold">{invitacion.empresa}</h1>
              {invitacion.roles?.length > 0 && <p className="mt-2 text-sm text-tinta-300">Como: <b className="text-tinta-100">{invitacion.roles.join(' · ')}</b></p>}
              {invitacion.para_email && <p className="mt-1 text-xs text-tinta-400">Invitación para {invitacion.para_email}</p>}
            </div>
            <div className="space-y-3 border-t border-navy-800 p-4">
              {!valida ? (
                <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">
                  {invitacion.estado === 'vencida' ? 'La invitación venció.' : invitacion.estado === 'aceptada' ? 'Esta invitación ya se usó.' : 'La invitación fue cancelada.'} Pedile una nueva a la empresa.
                </p>
              ) : sesion ? (
                <>
                  <p className="text-sm text-tinta-300">Vas a entrar con <b className="text-tinta-100">{sesion.user.email}</b>. Tu cuenta personal sigue siendo tuya: cambiás entre Personal y la empresa desde Perfil.</p>
                  {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
                  <button type="button" className="btn btn-menta w-full" onClick={aceptar} disabled={uniendo}>
                    {uniendo ? 'Sumándote…' : `Unirme a ${invitacion.empresa}`}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-tinta-300">Para sumarte necesitás una cuenta de TaListo!. Si ya tenés, entrá; si no, creala en un minuto{invitacion.para_email ? ` con ${invitacion.para_email}` : ''}.</p>
                  <Link href="/login" className="btn btn-menta w-full">Entrar</Link>
                  <Link href="/registro?rol=profesional" className="btn btn-sec w-full">Crear mi cuenta</Link>
                </>
              )}
              <button type="button" className="w-full py-2 text-sm text-tinta-400" onClick={descartar}>Ahora no</button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default function Pagina() {
  return (
    <Suspense fallback={<p className="p-6 text-center text-tinta-400">Cargando…</p>}>
      <Unirme />
    </Suspense>
  );
}
