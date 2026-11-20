'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import { supabase } from '@/lib/supabase';

// Página de texto legal (términos, privacidad). El responsable y el correo de contacto se cargan en /admin.
export function useDatosLegales() {
  const [d, setD] = useState({ responsable: 'TaListo!', email: '' });
  useEffect(() => {
    supabase
      .from('configuracion')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => setD({ responsable: data?.legal_responsable || 'TaListo!', email: data?.contacto_email || '' }));
  }, []);
  return d;
}

export function Contacto({ email }) {
  return email ? (
    <>
      escribiendo a <b className="select-all text-tinta-100">{email}</b>
    </>
  ) : (
    <>escribiendo al correo de contacto de TaListo!</>
  );
}

export default function PaginaLegal({ titulo, actualizado, secciones, otro }) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/" className="mb-8 inline-block">
        <Logo />
      </Link>
      <h1 className="text-2xl font-extrabold text-balance">{titulo}</h1>
      <p className="mt-1 text-xs text-tinta-400">Última actualización: {actualizado}</p>
      <div className="mt-6 space-y-6 text-sm leading-relaxed text-tinta-200">
        {secciones.map(([t, contenido], i) => (
          <section key={t} className="space-y-2">
            <h2 className="text-base font-bold text-tinta-100">
              {i + 1}. {t}
            </h2>
            {contenido}
          </section>
        ))}
      </div>
      <p className="mt-10 border-t border-navy-800 pt-4 text-xs text-tinta-400">
        {otro} · <Link href="/" className="underline">Volver a TaListo!</Link>
      </p>
    </main>
  );
}
