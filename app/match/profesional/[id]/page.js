'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import MarcoCliente, { useSesionCliente } from '@/components/MarcoCliente';
import TarjetaProfesional from '@/components/TarjetaProfesional';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/util';
import { Estrellas, MENSAJE_FALTA_SQL, diaLargo, fecha, hora, mayus, registrarEvento, sinMatch } from '@/lib/match';

// Perfil público del profesional con sus valoraciones verificadas (solo de visitas y trabajos hechos por TaListo!)
export default function PerfilProfesional() {
  const { id } = useParams();
  const { cargando, usuario } = useSesionCliente();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (cargando) return;
    supabase.rpc('perfil_match', { p_id: id }).then(({ data, error: e }) => {
      if (e) setError(sinMatch(e) ? MENSAJE_FALTA_SQL : mensajeError(e));
      else if (!data) setError('No encontramos este profesional.');
      setD(data);
    });
    registrarEvento('vio_profesional');
  }, [cargando, id]);

  const p = d?.profesional;
  return (
    <MarcoCliente titulo={p?.nombre || 'Profesional'} volver>
      {error && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {!d && !error && <p className="py-10 text-center text-sm text-tinta-400">Cargando…</p>}
      {p && (
        <div className="space-y-4 pt-4">
          <section className="tarjeta space-y-3 p-4">
            <TarjetaProfesional p={p} enlace={false} />
            {p.bio && <p className="whitespace-pre-wrap text-sm text-tinta-200">{p.bio}</p>}
            <p className="text-xs text-tinta-400">
              <Icon name="pin" className="mr-1 inline h-3.5 w-3.5" />
              {(p.departamentos || []).join(', ') || 'Sin zona cargada'}
              {d.urgencias && d.disponible && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#ff8a5c]/15 px-2 py-0.5 font-semibold text-[#ffc2a8]">
                  <Icon name="match" className="h-3 w-3" /> Atiende urgencias y fuera de horario
                </span>
              )}
            </p>
            {p.rubros?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {p.rubros.map((r) => (
                  <span key={r} className="rounded-full bg-navy-850 px-2.5 py-1 text-xs text-tinta-200">
                    {r}
                  </span>
                ))}
              </div>
            )}
            <p className="rounded-xl bg-navy-850 p-3 text-sm">
              {!d.disponible
                ? 'Ahora no está recibiendo solicitudes.'
                : d.proximo
                  ? <>Próximo horario libre: <b>{mayus(diaLargo(d.proximo))}</b> a las {hora(d.proximo)}</>
                  : 'No tiene horarios libres esta semana.'}
            </p>
            {p.id === usuario?.id ? (
              <p className="rounded-xl bg-navy-850 p-3 text-center text-sm text-tinta-300">Este es tu perfil público: así te ven los clientes.</p>
            ) : d.disponible && (
              <Link href={`/match/nueva?profesional=${p.id}`} className="btn btn-menta w-full py-3">
                Pedirle una visita técnica
              </Link>
            )}
          </section>
          <section>
            <h2 className="titulo-seccion mb-2">Valoraciones verificadas ({p.calificacion?.cantidad || 0})</h2>
            <p className="mb-2 text-xs text-tinta-400">Solo califican clientes que contrataron y pagaron por TaListo!.</p>
            {(d.calificaciones || []).length === 0 && <p className="tarjeta p-4 text-sm text-tinta-300">Todavía no tiene calificaciones.</p>}
            <ul className="space-y-2">
              {(d.calificaciones || []).map((k, i) => (
                <li key={i} className="tarjeta p-3.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Estrellas valor={k.puntaje} />
                    <span className="text-xs text-tinta-500">
                      {k.cliente} · {k.tipo === 'trabajo' ? 'trabajo' : 'visita'} · {fecha(k.fecha)}
                    </span>
                  </div>
                  {k.comentario && <p className="mt-1.5 text-tinta-200">{k.comentario}</p>}
                  {k.respuesta && <p className="mt-1.5 border-l-2 border-navy-700 pl-2 text-xs text-tinta-400">Respuesta: {k.respuesta}</p>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </MarcoCliente>
  );
}
