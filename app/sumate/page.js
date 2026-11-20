'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import Icon from '@/components/Icon';
import { supabase } from '@/lib/supabase';
import { pesos } from '@/lib/match';

// Página para invitar técnicos a TaListo! Match (se comparte por WhatsApp o redes)
const VENTAJAS = [
  { icono: 'mapa', titulo: 'Pedidos de clientes de tu zona', texto: 'Te llegan pedidos de tus rubros y zonas. Los tomás cuando te sirven.' },
  { icono: 'check', titulo: 'Cobro asegurado', texto: 'El cliente paga antes de la visita por Mercado Pago. Te liberamos la plata con su visto bueno.' },
  { icono: 'agenda', titulo: 'Tu agenda y tus clientes', texto: 'Las visitas entran solas a tu agenda, con la dirección en el mapa.' },
  { icono: 'maletin', titulo: 'Vos ponés el precio cuando hace falta', texto: 'Si la visita sale más cara, mandás tu cotización. Lo que cotizás es 100 % tuyo.' },
];

export default function Sumate() {
  const [c, setC] = useState(null);
  useEffect(() => {
    supabase.from('configuracion').select('*').eq('id', 1).maybeSingle().then(({ data }) => setC(data || {}));
  }, []);
  const neto = c?.visita_neto_profesional;
  const netoUrg = c?.urgencia_activa ? c?.urgencia_neto_profesional : null;
  const pasos = [
    ['Creá tu cuenta de profesional', 'Con tu correo y tu celular. Es gratis.'],
    ['Completá tu perfil de Match', 'Tus rubros, las zonas donde trabajás y cómo cobrás: cuenta bancaria o Abitab.'],
    ['Verificamos tu identidad', 'Para que los clientes confíen. Te pedimos tu documento y lo revisamos a mano.'],
    ['Activá Match y recibí pedidos', 'Te avisamos al celular cuando entra un pedido de tu rubro. El primero que lo toma, lo atiende.'],
  ];
  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/" className="mb-10 inline-block">
        <Logo />
      </Link>
      <section className="max-w-xl">
        <p className="text-xs font-bold uppercase tracking-wider text-menta-400">TaListo! Match</p>
        <h1 className="mt-2 text-3xl font-extrabold text-balance">Sumate como técnico y recibí clientes de tu zona</h1>
        <p className="mt-3 text-tinta-300">
          Electricistas, sanitarios, técnicos de aire acondicionado, cerrajeros, jardineros y más. Vos hacés el trabajo; TaListo! te trae el cliente y te asegura el cobro.
        </p>
        <Link href="/registro?rol=profesional" className="btn btn-menta mt-6 px-6 py-3.5">
          Quiero sumarme
        </Link>
      </section>

      <section className="mt-12 grid gap-3 sm:grid-cols-2">
        {VENTAJAS.map((v) => (
          <div key={v.titulo} className="tarjeta flex gap-4 p-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-navy-800 text-menta-400">
              <Icon name={v.icono} />
            </span>
            <div className="min-w-0">
              <h2 className="font-bold">{v.titulo}</h2>
              <p className="mt-1 text-sm text-tinta-300">{v.texto}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-extrabold">Cuánto cobrás</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="tarjeta p-4">
            <p className="text-xs text-tinta-400">Visita técnica</p>
            <p className="mt-1 text-2xl font-extrabold">{neto !== undefined && neto !== null ? pesos(neto) : '…'}</p>
            <p className="mt-1 text-xs text-tinta-400">Lo que te queda a vos, limpio.</p>
          </div>
          {netoUrg !== null && netoUrg !== undefined && (
            <div className="tarjeta p-4">
              <p className="text-xs text-tinta-400">Urgencia fuera de horario</p>
              <p className="mt-1 text-2xl font-extrabold">{pesos(netoUrg)}</p>
              <p className="mt-1 text-xs text-tinta-400">Si atendés urgencias.</p>
            </div>
          )}
          <div className="tarjeta p-4">
            <p className="text-xs text-tinta-400">Tu cotización</p>
            <p className="mt-1 text-2xl font-extrabold">100 %</p>
            <p className="mt-1 text-xs text-tinta-400">Si la visita sale más cara, cobrás lo que cotizás.</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-tinta-400">
          El trabajo que acuerdes con el cliente después de la visita es tuyo y lo arreglan entre ustedes. Cobrás por transferencia o por Abitab cuando el cliente da el visto bueno.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-extrabold">Cómo empezar</h2>
        <ol className="mt-4 space-y-3">
          {pasos.map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-menta-500 text-sm font-extrabold text-navy-950">{i + 1}</span>
              <span className="min-w-0">
                <b className="block">{t}</b>
                <span className="text-sm text-tinta-300">{d}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12 tarjeta p-5">
        <h2 className="font-bold">Tu puntaje te pone primero</h2>
        <p className="mt-1 text-sm text-tinta-300">
          Con cada visita el cliente califica de 0 a 10 tu puntualidad, tu velocidad y tu desempeño. Cuenta el promedio de tus últimas 10 visitas, así que un mal día se supera rápido. Los que mantienen buen puntaje en el tiempo aparecen primero.
        </p>
        <Link href="/registro?rol=profesional" className="btn btn-menta mt-4 px-6 py-3">
          Crear mi cuenta
        </Link>
      </section>

      <p className="mt-10 text-xs text-tinta-400">
        <Link href="/terminos" className="underline">Términos y condiciones</Link> · <Link href="/privacidad" className="underline">Política de privacidad</Link>
      </p>
    </main>
  );
}
