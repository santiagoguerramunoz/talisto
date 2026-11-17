'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import BotonInstalar from '@/components/BotonInstalar';
import ActivarAvisos from '@/components/ActivarAvisos';
import MarcoCliente, { useSesionCliente } from '@/components/MarcoCliente';
import ComoFunciona from '@/components/ComoFuncionaMatch';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/util';
import { ESTADO_OPERACION, ESTADO_SOLICITUD, Estado, MENSAJE_FALTA_SQL, pesos, registrarEvento, sinMatch } from '@/lib/match';

// Inicio del cliente: buscar un servicio, pedir una visita técnica y seguir sus solicitudes (TaListo! Match)
export default function InicioCliente() {
  const router = useRouter();
  const { cargando, perfil } = useSesionCliente();
  const [rubros, setRubros] = useState([]);
  const [config, setConfig] = useState(null);
  const [solicitudes, setSolicitudes] = useState(null);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [activando, setActivando] = useState(false);

  useEffect(() => {
    if (cargando) return;
    (async () => {
      const [{ data: r }, { data: c }, { data: s, error: e }] = await Promise.all([
        supabase.from('categorias').select('id, nombre, sinonimos, orden').eq('activa', true).order('orden'),
        supabase.from('configuracion').select('*').eq('id', 1).maybeSingle(),
        supabase.rpc('mis_solicitudes'),
      ]);
      setRubros(r || []);
      setConfig(c);
      if (e) setError(sinMatch(e) ? MENSAJE_FALTA_SQL : mensajeError(e));
      setSolicitudes(s || []);
    })();
  }, [cargando]);

  const encontrados = useMemo(() => {
    const q = texto
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    if (!q) return rubros;
    return rubros.filter((r) =>
      [r.nombre, ...(r.sinonimos || [])].some((t) =>
        String(t)
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .includes(q)
      )
    );
  }, [texto, rubros]);

  useEffect(() => {
    if (texto.trim().length < 3) return undefined;
    const t = setTimeout(() => registrarEvento('busco_servicio'), 1200);
    return () => clearTimeout(t);
  }, [texto]);

  async function hacermeProfesional() {
    setActivando(true);
    const { error: err } = await supabase.rpc('convertirme_en_profesional');
    setActivando(false);
    if (err) setError(mensajeError(err));
    else router.replace('/panel/perfil');
  }

  async function salir() {
    await supabase.auth.signOut();
    router.replace('/');
  }

  if (cargando || !perfil) return <div className="grid min-h-dvh place-items-center text-tinta-400">Cargando…</div>;
  const activas = (solicitudes || []).filter((s) => ['abierta', 'reservada', 'en_curso'].includes(s.estado));
  const anteriores = (solicitudes || []).filter((s) => !['abierta', 'reservada', 'en_curso'].includes(s.estado));
  const esPro = perfil.rol === 'profesional';

  return (
    <MarcoCliente
      acciones={
        esPro ? (
          <Link href="/panel" className="chip shrink-0 text-xs">
            <Icon name="agenda" className="h-4 w-4" /> Mi panel
          </Link>
        ) : (
          <button onClick={salir} className="rounded-full p-2 text-tinta-400 hover:text-tinta-100" aria-label="Cerrar sesión">
            <Icon name="salir" />
          </button>
        )
      }
    >
      <section className="pt-6">
        <h1 className="text-2xl font-extrabold md:text-3xl">Hola{perfil.nombre ? `, ${perfil.nombre.split(' ')[0]}` : ''} 👋</h1>
        <p className="mt-1 text-tinta-300">¿Qué necesitás arreglar o instalar?</p>
        {esPro && (
          <p className="mt-2 rounded-xl bg-navy-850 p-3 text-xs text-tinta-300">
            Acá contratás como cliente: pedís una visita, la pagás y seguís tus pedidos. Tu panel de profesional sigue igual.
          </p>
        )}
        <div className="relative mt-4">
          <Icon name="buscar" className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-tinta-500" />
          <input
            className="campo py-3.5 pr-3 pl-11 text-base"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Electricista, aire acondicionado, cerrajero…"
            aria-label="Buscar un servicio"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {encontrados.slice(0, texto ? 30 : 12).map((r) => (
            <Link key={r.id} href={`/match/nueva?rubro=${r.id}`} className="chip">
              {r.nombre}
            </Link>
          ))}
          {!texto && rubros.length > 12 && (
            <button type="button" className="chip text-tinta-400" onClick={() => setTexto(' ')}>
              Ver todos
            </button>
          )}
          {texto && encontrados.length === 0 && <p className="text-sm text-tinta-400">No encontramos ese servicio. Probá con otra palabra.</p>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link href="/match/nueva" className="btn btn-menta py-3">
            <Icon name="match" /> Pedir una visita
          </Link>
          <Link href="/match/profesionales" className="btn btn-sec py-3">
            <Icon name="clientes" /> Ver profesionales
          </Link>
        </div>
      </section>

      {error && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

      {activas.length > 0 && (
        <section className="mt-7">
          <h2 className="titulo-seccion mb-2">Tus solicitudes</h2>
          <ul className="space-y-2">
            {activas.map((s) => (
              <FilaSolicitud key={s.id} s={s} />
            ))}
          </ul>
        </section>
      )}

      <div className="mt-7">
        <ComoFunciona config={config} />
      </div>

      {anteriores.length > 0 && (
        <section className="mt-7">
          <h2 className="titulo-seccion mb-2">Anteriores</h2>
          <ul className="space-y-2">
            {anteriores.slice(0, 10).map((s) => (
              <FilaSolicitud key={s.id} s={s} />
            ))}
          </ul>
        </section>
      )}

      <div className="mt-7 space-y-3">
        <ActivarAvisos compacto texto="Te avisamos cuando un profesional acepta tu solicitud y antes de la visita." />
        <BotonInstalar variante="tarjeta" />
        {perfil.es_admin && (
          <button onClick={() => router.push('/admin')} className="btn btn-sec w-full">
            <Icon name="escudo" /> Panel de administración
          </button>
        )}
        {!esPro && (
        <div className="tarjeta p-5">
          <p className="font-bold">¿Tenés un oficio o sos profesional?</p>
          <p className="mt-1 text-sm text-tinta-300">Recibí clientes nuevos con TaListo! Match y organizá tu agenda, presupuestos y cobros.</p>
          <button onClick={hacermeProfesional} disabled={activando} className="btn btn-menta mt-4 w-full">
            {activando ? 'Activando…' : 'Quiero ofrecer mis servicios'}
          </button>
        </div>
        )}
      </div>
      {config && (
        <p className="mt-6 text-center text-xs text-tinta-500">
          Visita técnica {pesos(config.precio_visita)}
          {config.precio_urgencia !== undefined && config.urgencia_activa ? ` · urgencias y fuera de horario ${pesos(config.precio_urgencia)}` : ''} · pagás por Mercado Pago
        </p>
      )}
    </MarcoCliente>
  );
}

function FilaSolicitud({ s }) {
  return (
    <li>
      <Link href={`/match/solicitud/${s.id}`} className="tarjeta flex items-center gap-3 p-3.5 hover:border-navy-600">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <Estado valor={s.estado} tabla={ESTADO_SOLICITUD} />
            {s.operacion && s.operacion !== 'cancelado' && <Estado valor={s.operacion} tabla={ESTADO_OPERACION} />}
          </span>
          <b className="mt-1 block truncate">{s.titulo}</b>
          <span className="block truncate text-xs text-tinta-400">
            {s.rubro} · {s.localidad ? `${s.localidad}, ` : ''}
            {s.departamento}
            {s.estado === 'abierta'
              ? s.sin_profesionales
                ? ' · sin profesionales en la zona'
                : ` · ${s.aceptaron} ${s.aceptaron === 1 ? 'aceptó' : 'aceptaron'}`
              : s.profesional
                ? ` · ${s.profesional}`
                : ''}
          </span>
        </span>
        <Icon name="der" className="h-5 w-5 shrink-0 text-tinta-500" />
      </Link>
    </li>
  );
}
