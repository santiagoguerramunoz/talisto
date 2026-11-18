'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import Icon from '@/components/Icon';
import AvisoConfiguracion from '@/components/AvisoConfiguracion';
import BotonInstalar from '@/components/BotonInstalar';
import { supabase } from '@/lib/supabase';
import { rutaSegunPerfil } from '@/lib/sesion';

const PUNTOS = [
  { icono: 'agenda', titulo: 'Tu agenda en orden', texto: 'Días, horarios y clientes fijos. Lo que se repite se carga una sola vez.' },
  { icono: 'mapa', titulo: 'El día en el mapa', texto: 'Todas las direcciones del día, en orden, con un toque para ir en Waze o Google Maps.' },
  { icono: 'clientes', titulo: 'Clientes con varias direcciones', texto: 'Casa, oficina, obra: cada cliente con sus lugares y horarios acordados.' },
  { icono: 'maletin', titulo: 'Servicios y tarifas', texto: 'Tu zona de trabajo y tus precios, listos para que te encuentren.' },
];

export default function Inicio() {
  const [destino, setDestino] = useState(null);
  const [whatsapp, setWhatsapp] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) setDestino(await rutaSegunPerfil(data.session.user.id));
    });
    // Pedir un técnico por WhatsApp, sin bajar la app (si está activo)
    supabase.from('configuracion').select('*').eq('id', 1).maybeSingle().then(({ data }) => {
      const n = String(data?.whatsapp_numero || '').replace(/\D/g, '');
      if (data?.whatsapp_activo && n.length >= 8) setWhatsapp(n);
    });
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-10">
      <header className="flex items-center justify-between py-2">
        <Logo />
        {destino ? (
          <Link href={destino} className="btn btn-sec py-2 text-sm">Ir a mi cuenta</Link>
        ) : (
          <Link href="/login" className="btn btn-sec py-2 text-sm">Entrar</Link>
        )}
      </header>

      <section className="mt-12 md:mt-20">
        <AvisoConfiguracion />
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-menta-500/40 bg-menta-500/10 px-3 py-1 text-xs font-semibold text-menta-300">
          <span className="h-1.5 w-1.5 rounded-full bg-marca-naranja" /> Para oficios y profesionales de Uruguay
        </p>
        <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.08] tracking-tight md:text-6xl">
          Tu trabajo, tus clientes y tu agenda.
          <span className="block text-menta-400">Todo en un lugar.</span>
        </h1>
        <p className="mt-5 max-w-xl text-lg text-tinta-300">
          Organizá tus días, guardá las direcciones de cada cliente y dejá que te encuentren por tu zona y tus servicios.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/registro?rol=profesional" className="btn btn-menta px-6 py-3.5 text-base">
            Soy profesional · Crear mi agenda
          </Link>
          <Link href="/registro?rol=cliente" className="btn btn-sec px-6 py-3.5 text-base">
            Busco un servicio
          </Link>
        </div>
        {whatsapp && (
          <a href={`https://wa.me/${whatsapp}?text=${encodeURIComponent('Hola, necesito un técnico')}`} target="_blank" rel="noopener noreferrer"
            className="mt-4 flex max-w-md items-center gap-3 rounded-2xl border border-[#25d366]/40 bg-[#25d366]/10 p-3.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#25d366] text-white"><Icon name="whatsapp" /></span>
            <span className="min-w-0 text-sm">
              <b className="block">Pedí un técnico por WhatsApp</b>
              <span className="text-tinta-300">Sin bajar nada: te hacemos unas preguntas y te conseguimos el primero disponible.</span>
            </span>
          </a>
        )}
        <div className="mt-6 max-w-md">
          <BotonInstalar variante="tarjeta" />
        </div>
      </section>

      <section className="mt-16 grid gap-3 sm:grid-cols-2">
        {PUNTOS.map((p) => (
          <div key={p.titulo} className="tarjeta flex gap-4 p-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-navy-800 text-menta-400">
              <Icon name={p.icono} />
            </span>
            <div>
              <h3 className="font-bold">{p.titulo}</h3>
              <p className="mt-1 text-sm text-tinta-300">{p.texto}</p>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
