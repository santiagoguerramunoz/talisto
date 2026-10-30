'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import ActivarAvisos from '@/components/ActivarAvisos';
import { supabase } from '@/lib/supabase';
import { avisosCambiaron, haceRato } from '@/lib/avisos';
import { mensajeError } from '@/lib/util';

const ICONO = (tipo = '') =>
  tipo.startsWith('stock') ? 'caja' : tipo.startsWith('cotizacion') ? 'calculadora' : tipo === 'operario_libre' ? 'perfil' : tipo.includes('finalizado') ? 'check' : 'maletin';

export default function Avisos() {
  const router = useRouter();
  const [estado, setEstado] = useState({ cargando: true, lista: [], error: '', fin: false });

  const cargar = useCallback(async (antes = null) => {
    const { data, error } = await supabase.rpc('mis_avisos', { p_limite: 40, p_antes: antes });
    if (error) {
      setEstado((e) => ({ ...e, cargando: false, error: error.code === 'PGRST202' ? 'Falta activar los avisos: corré el SQL 11 en Supabase.' : mensajeError(error) }));
      return;
    }
    setEstado((e) => ({ cargando: false, lista: antes ? [...e.lista, ...data] : data, error: '', fin: data.length < 40 }));
  }, []);

  useEffect(() => {
    cargar().then(() =>
      // al abrir la pantalla quedan leídos (se siguen viendo resaltados hasta salir)
      supabase.rpc('marcar_avisos_leidos', { p_ids: null }).then(() => avisosCambiaron())
    );
  }, [cargar]);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => router.back()} className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver">
            <Icon name="izq" />
          </button>
          <h1 className="flex-1 text-2xl font-extrabold">Avisos</h1>
        </div>
      </header>
      <div className="space-y-4 px-4 pt-4">
        <ActivarAvisos />
        {estado.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>}
        {estado.cargando ? (
          <p className="py-6 text-center text-tinta-400">Cargando…</p>
        ) : estado.lista.length === 0 && !estado.error ? (
          <div className="tarjeta p-6 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-menta-500/15 text-menta-300">
              <Icon name="campana" />
            </span>
            <p className="mt-3 font-bold">Sin avisos</p>
            <p className="mt-1 text-sm text-tinta-400">Acá aparecen los trabajos que te asignan, los cierres del equipo, el stock para confirmar y las cotizaciones.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {estado.lista.map((a) => (
              <li key={a.id}>
                <Link href={a.url || '/panel'} className={`tarjeta flex gap-3 p-3 hover:bg-navy-850 ${!a.leida_en ? 'border-menta-500/50' : ''}`}>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${!a.leida_en ? 'bg-menta-500/15 text-menta-300' : 'bg-navy-800 text-tinta-400'}`}>
                    <Icon name={ICONO(a.tipo)} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-sm leading-snug">{a.titulo}</b>
                    {a.cuerpo && <span className="mt-0.5 block whitespace-pre-line text-xs text-tinta-300">{a.cuerpo}</span>}
                    <span className="mt-1 block text-[11px] text-tinta-500">
                      {haceRato(a.creado_en)}
                      {a.empresa ? ` · ${a.empresa}` : ''}
                    </span>
                  </span>
                  {!a.leida_en && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-marca-naranja" aria-label="Nuevo" />}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {!estado.cargando && !estado.fin && estado.lista.length > 0 && (
          <button type="button" className="btn btn-sec w-full" onClick={() => cargar(estado.lista[estado.lista.length - 1].creado_en)}>
            Ver más
          </button>
        )}
        <div className="h-2" />
      </div>
    </>
  );
}
