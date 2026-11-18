'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Logo from '@/components/Logo';

// A esta página vuelve Mercado Pago cuando el cliente paga desde el link de WhatsApp
function Contenido() {
  const estado = useSearchParams().get('estado');
  const ok = estado === 'ok';
  const [numero, setNumero] = useState('');
  useEffect(() => {
    supabase.from('configuracion').select('whatsapp_numero').eq('id', 1).maybeSingle()
      .then(({ data }) => setNumero(String(data?.whatsapp_numero || '').replace(/\D/g, '')));
  }, []);
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <Logo />
      <div className={`grid h-16 w-16 place-items-center rounded-full text-3xl ${ok ? 'bg-menta-500/15' : 'bg-amber-400/15'}`}>{ok ? '✅' : estado === 'pendiente' ? '⏳' : '⚠️'}</div>
      <h1 className="text-2xl font-extrabold">{ok ? '¡Pago recibido!' : estado === 'pendiente' ? 'Pago en proceso' : 'No se completó el pago'}</h1>
      <p className="text-tinta-300">
        {ok
          ? 'Tu visita quedó confirmada. Te escribimos por WhatsApp con los datos del técnico.'
          : estado === 'pendiente'
            ? 'Mercado Pago está procesando el pago. Te avisamos por WhatsApp cuando se confirme.'
            : 'No se te cobró nada. Volvé a WhatsApp y escribinos para intentar de nuevo.'}
      </p>
      <a href={`https://wa.me/${numero}`} className="btn btn-menta px-6 py-3">Volver a WhatsApp</a>
    </main>
  );
}

export default function PagoWhatsapp() {
  return (
    <Suspense fallback={null}>
      <Contenido />
    </Suspense>
  );
}
