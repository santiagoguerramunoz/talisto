'use client';

import Link from 'next/link';
import Icon from '@/components/Icon';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import MarcoCliente, { useSesionCliente } from '@/components/MarcoCliente';
import TarjetaProfesional from '@/components/TarjetaProfesional';
import { supabase } from '@/lib/supabase';
import { DEPARTAMENTOS, mensajeError } from '@/lib/util';
import { rubrosConTecnicos, MENSAJE_FALTA_SQL, registrarEvento, sinMatch } from '@/lib/match';

export default function ProfesionalesPagina() {
  return (
    <Suspense fallback={<div className="grid min-h-dvh place-items-center text-tinta-400">Cargando…</div>}>
      <Profesionales />
    </Suspense>
  );
}

// Buscar profesionales por rubro y ubicación (solo los que están recibiendo solicitudes)
function Profesionales() {
  const router = useRouter();
  const params = useSearchParams();
  const { cargando } = useSesionCliente();
  const [rubros, setRubros] = useState([]);
  const [rubro, setRubro] = useState(params.get('rubro') || '');
  const [dep, setDep] = useState(params.get('dep') || 'Montevideo');
  const [lista, setLista] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    rubrosConTecnicos(supabase).then(setRubros); // solo los rubros que tienen técnicos disponibles
  }, []);

  useEffect(() => {
    if (cargando) return;
    setLista(null);
    router.replace(`/match/profesionales?rubro=${rubro}&dep=${encodeURIComponent(dep)}`, { scroll: false });
    supabase.rpc('profesionales_match', { p_categoria: rubro ? Number(rubro) : null, p_departamento: dep || null }).then(({ data, error: e }) => {
      if (e) setError(sinMatch(e) ? MENSAJE_FALTA_SQL : mensajeError(e));
      setLista(data || []);
    });
    registrarEvento('vio_profesional');
  }, [cargando, rubro, dep, router]);

  return (
    <MarcoCliente titulo="Profesionales" volver="/inicio">
      <div className="grid grid-cols-2 gap-2 pt-4">
        <select className="campo" value={rubro} onChange={(e) => setRubro(e.target.value)} aria-label="Rubro">
          <option value="">Todos los rubros</option>
          {rubros.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nombre}
            </option>
          ))}
        </select>
        <select className="campo" value={dep} onChange={(e) => setDep(e.target.value)} aria-label="Departamento">
          {DEPARTAMENTOS.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </div>
      {error && <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {lista === null && <p className="py-10 text-center text-sm text-tinta-400">Buscando…</p>}
      {lista?.length === 0 && (
        <div className="tarjeta mt-4 p-5 text-center text-sm text-tinta-300">
          <p>Todavía no hay profesionales recibiendo solicitudes para eso en {dep}.</p>
          <Link href={`/match/nueva${rubro ? `?rubro=${rubro}` : ''}`} className="btn btn-menta mt-3">
            Publicar mi solicitud igual
          </Link>
        </div>
      )}
      <Link href={`/match/nueva?modo=primero${rubro ? `&rubro=${rubro}` : ''}`} className="tarjeta mt-4 flex items-center gap-3 border-menta-500/40 p-4 hover:border-menta-400">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-menta-500/15 text-menta-300"><Icon name="match" /></span>
        <span className="min-w-0 flex-1">
          <b className="block">El primero disponible</b>
          <span className="text-xs text-tinta-300">No elijas a nadie: pagás la visita y te atiende el primer técnico del rubro que la toma, hoy o el día que digas.</span>
        </span>
        <Icon name="der" className="h-5 w-5 shrink-0 text-tinta-400" />
      </Link>
      <ul className="mt-3 grid gap-2 md:grid-cols-2">
        {(lista || []).map((p) => (
          <li key={p.id} className="tarjeta p-4">
            <TarjetaProfesional p={p} />
            <p className="mt-2 line-clamp-2 text-xs text-tinta-400">{(p.rubros || []).join(' · ')}</p>
            <div className="mt-3 flex gap-2">
              <Link href={`/match/profesional/${p.id}`} className="btn btn-sec flex-1 py-2 text-sm">
                Ver perfil
              </Link>
              <Link href={`/match/nueva?profesional=${p.id}${rubro ? `&rubro=${rubro}` : ''}`} className="btn btn-menta flex-1 py-2 text-sm">
                Pedir visita
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </MarcoCliente>
  );
}
