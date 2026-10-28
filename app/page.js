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

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) setDestino(await rutaSegunPerfil(data.session.user.id));
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
          <span className="h-1.5 w-1.5 rounded-full bg-menta-400" /> Para oficios y profesionales de Uruguay
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
