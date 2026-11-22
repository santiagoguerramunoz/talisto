'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import Logo from '@/components/Logo';
import Modal from '@/components/Modal';
import { supabase } from '@/lib/supabase';
import { buscarLocalidades } from '@/lib/lugares';
import { mensajeError } from '@/lib/util';

const PESTANAS = [
  ['paises', 'Países'],
  ['localidades', 'Localidades nuevas'],
  ['zonas', 'Cuentas por zona'],
];
const PRECIOS = [
  ['visita_cliente', 'Visita: paga el cliente'],
  ['visita_profesional', 'Visita: recibe el técnico'],
  ['urgencia_cliente', 'Urgencia: paga el cliente'],
  ['urgencia_profesional', 'Urgencia: recibe el técnico'],
  ['plan_pro', 'Plan Pro por mes'],
  ['plan_business', 'Plan Business por mes'],
];

export default function AdminPaises() {
  const router = useRouter();
  const [listo, setListo] = useState(false);
  const [ver, setVer] = useState('paises');
  const [paises, setPaises] = useState(null);
  const [pendientes, setPendientes] = useState(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('paises').select('*').order('activo', { ascending: false }).order('orden').order('nombre');
    setPaises(error ? [] : data || []);
    const r = await supabase.rpc('admin_localidades_pendientes');
    setPendientes(r.error ? [] : r.data || []);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return router.replace('/login?volver=/admin/paises');
      const { data: p } = await supabase.from('perfiles').select('es_admin, rol').eq('id', data.session.user.id).maybeSingle();
      if (!p?.es_admin) return router.replace(p?.rol === 'profesional' ? '/panel' : '/inicio');
      setListo(true);
      cargar();
    })();
  }, [router, cargar]);

  if (!listo) return <div className="grid min-h-dvh place-items-center text-tinta-400">Cargando…</div>;
  return (
    <main className="mx-auto min-h-dvh max-w-4xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-12">
      <header className="flex items-center gap-3 py-2">
        <Link href="/admin" className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver a Administración"><Icon name="izq" /></Link>
        <Logo />
      </header>
      <h1 className="mt-4 text-2xl font-extrabold">Países y localidades</h1>
      <p className="mt-1 text-sm text-tinta-300">
        TaListo! tiene cargados 20 países de Latinoamérica con sus regiones y localidades. Cada cuenta guarda su país, región y localidad: sirve
        para mostrar técnicos, proveedores y publicidad de cada zona.
      </p>
      <div className="mt-5 flex gap-2 overflow-x-auto">
        {PESTANAS.map(([k, t]) => (
          <button key={k} onClick={() => setVer(k)} className={`chip shrink-0 ${ver === k ? 'chip-activo' : ''}`}>
            {t}
            {k === 'localidades' && pendientes?.length ? <span className="ml-1 rounded-full bg-amber-400 px-1.5 text-xs font-bold text-navy-950">{pendientes.length}</span> : null}
          </button>
        ))}
      </div>
      {paises && !paises.length && (
        <p className="tarjeta mt-6 p-4 text-sm text-amber-300">Falta correr en Supabase el SQL 29 (países y localidades) y sus 3 partes de localidades.</p>
      )}
      {ver === 'paises' && paises?.length > 0 && <ListaPaises paises={paises} onGuardado={cargar} />}
      {ver === 'localidades' && <Pendientes lista={pendientes} onCambio={cargar} />}
      {ver === 'zonas' && paises?.length > 0 && <Zonas paises={paises} />}
      <p className="mt-10 text-xs text-tinta-500">Datos de lugares: countries-states-cities-database (dr5hn), licencia ODbL.</p>
    </main>
  );
}

function ListaPaises({ paises, onGuardado }) {
  const [editar, setEditar] = useState(null);
  return (
    <>
      <ul className="tarjeta mt-5 divide-y divide-navy-800 overflow-hidden">
        {paises.map((p) => (
          <li key={p.codigo}>
            <button onClick={() => setEditar(p)} className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-navy-850">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-navy-800 text-xs font-bold text-tinta-300">{p.codigo}</span>
              <span className="min-w-0 flex-1">
                <b className="block">{p.nombre}</b>
                <span className="text-xs text-tinta-400">
                  {p.moneda} · {p.nombre_region} · {p.nombre_localidad}
                </span>
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.activo ? 'bg-menta-500/15 text-menta-300' : 'bg-navy-800 text-tinta-400'}`}>
                {p.activo ? 'Activo' : 'Muy pronto'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {editar && <EditarPais pais={editar} onCerrar={() => setEditar(null)} onGuardado={() => { setEditar(null); onGuardado(); }} />}
    </>
  );
}

function EditarPais({ pais, onCerrar, onGuardado }) {
  const [f, setF] = useState({
    nombre_region: pais.nombre_region,
    nombre_localidad: pais.nombre_localidad,
    simbolo: pais.simbolo,
    activo: pais.activo,
    precios: Object.fromEntries(PRECIOS.map(([k]) => [k, pais.precios?.[k] ?? ''])),
  });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const esUY = pais.codigo === 'UY';

  async function guardar() {
    setError('');
    setGuardando(true);
    const { error: err } = await supabase.rpc('admin_pais_guardar', { p_codigo: pais.codigo, p: esUY ? { ...f, precios: undefined } : f });
    setGuardando(false);
    if (err) return setError(mensajeError(err));
    onGuardado();
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={pais.nombre}
      pie={
        <button className="btn btn-menta w-full" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      }
    >
      <div className="space-y-4">
        <label className="flex items-center justify-between gap-3 rounded-xl bg-navy-850 p-3">
          <span>
            <b className="block text-sm">País activo</b>
            <span className="text-xs text-tinta-400">Se pueden crear cuentas y pedir técnicos en este país.</span>
          </span>
          <input type="checkbox" className="h-5 w-5 accent-menta-500" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} />
        </label>
        {!esUY && !pais.activo && (
          <p className="text-xs text-tinta-400">
            Para abrir {pais.nombre} hace falta su cuenta de Mercado Pago local y que Match cobre en {pais.moneda}. Cargá los precios ahora y lo
            activamos cuando esté el cobro.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta">Cómo se llama la región</label>
            <input className="campo" value={f.nombre_region} onChange={(e) => setF({ ...f, nombre_region: e.target.value })} />
          </div>
          <div>
            <label className="etiqueta">Cómo se llama la localidad</label>
            <input className="campo" value={f.nombre_localidad} onChange={(e) => setF({ ...f, nombre_localidad: e.target.value })} />
          </div>
        </div>
        {esUY ? (
          <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-300">
            Uruguay cobra con los precios de <Link href="/admin/match" className="text-menta-400 underline">Administración → Match</Link> y de los planes.
          </p>
        ) : (
          <div>
            <p className="etiqueta">Precios en {pais.moneda} ({pais.simbolo})</p>
            <div className="grid grid-cols-2 gap-3">
              {PRECIOS.map(([k, t]) => (
                <div key={k}>
                  <label className="text-xs text-tinta-400">{t}</label>
                  <input
                    className="campo"
                    inputMode="decimal"
                    value={f.precios[k]}
                    onChange={(e) => setF({ ...f, precios: { ...f.precios, [k]: e.target.value.replace(',', '.').replace(/[^\d.]/g, '') } })}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}

function Pendientes({ lista, onCambio }) {
  if (!lista) return <p className="mt-6 text-sm text-tinta-400">Cargando…</p>;
  if (!lista.length) return <p className="tarjeta mt-5 p-4 text-sm text-tinta-300">No hay localidades nuevas para revisar.</p>;
  return (
    <ul className="mt-5 space-y-3">
      {lista.map((l) => (
        <Pendiente key={l.id} l={l} onCambio={onCambio} />
      ))}
    </ul>
  );
}

function Pendiente({ l, onCambio }) {
  const [nombre, setNombre] = useState(l.nombre);
  const [unir, setUnir] = useState(false);
  const [texto, setTexto] = useState('');
  const [opciones, setOpciones] = useState([]);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!unir) return;
    const t = setTimeout(() => buscarLocalidades(l.region_id, texto).then((r) => setOpciones(r.filter((o) => !o.pendiente && o.id !== l.id))), 250);
    return () => clearTimeout(t);
  }, [unir, texto, l.region_id, l.id]);

  async function resolver(accion, extra = {}) {
    setError('');
    setOcupado(true);
    const { error: err } = await supabase.rpc('admin_localidad_resolver', { p_id: l.id, p_accion: accion, p_nombre: extra.nombre || null, p_unir_con: extra.unir || null });
    setOcupado(false);
    if (err) return setError(mensajeError(err));
    onCambio();
  }

  return (
    <li className="tarjeta space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <b className="block">{l.nombre}</b>
          <span className="text-xs text-tinta-400">
            {l.region} · {l.pais_nombre} · la propuso {l.propuesta_por || 'una cuenta'} · {l.cuentas} {l.cuentas === 1 ? 'cuenta la usa' : 'cuentas la usan'}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="text-xs text-tinta-400">Nombre correcto</label>
          <input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <button className="btn btn-menta" disabled={ocupado} onClick={() => resolver('aprobar', { nombre })}>Aprobar</button>
        <button className="btn btn-sec" disabled={ocupado} onClick={() => setUnir(!unir)}>Unir con…</button>
        <button className="btn btn-peligro" disabled={ocupado} onClick={() => resolver('rechazar')}>Rechazar</button>
      </div>
      {unir && (
        <div className="rounded-xl bg-navy-850 p-3">
          <label className="text-xs text-tinta-400">Es la misma que (de {l.region})</label>
          <input className="campo" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar localidad" />
          <div className="mt-2 flex flex-wrap gap-2">
            {opciones.slice(0, 12).map((o) => (
              <button key={o.id} className="chip" disabled={ocupado} onClick={() => resolver('unir', { unir: o.id })}>{o.nombre}</button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    </li>
  );
}

function Zonas({ paises }) {
  const [pais, setPais] = useState(paises.find((p) => p.activo)?.codigo || 'UY');
  const [filas, setFilas] = useState(null);
  useEffect(() => {
    setFilas(null);
    supabase.rpc('admin_cuentas_por_zona', { p_pais: pais }).then(({ data }) => setFilas(data || []));
  }, [pais]);
  const p = paises.find((x) => x.codigo === pais);
  return (
    <div className="mt-5">
      <select className="campo max-w-xs" value={pais} onChange={(e) => setPais(e.target.value)}>
        {paises.map((x) => (
          <option key={x.codigo} value={x.codigo}>{x.nombre}</option>
        ))}
      </select>
      {!filas ? (
        <p className="mt-4 text-sm text-tinta-400">Cargando…</p>
      ) : !filas.length ? (
        <p className="tarjeta mt-4 p-4 text-sm text-tinta-300">Todavía no hay cuentas en {p?.nombre}.</p>
      ) : (
        <div className="tarjeta mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-tinta-400">
              <tr>
                <th className="p-3">{p?.nombre_region}</th>
                <th className="p-3 text-right">Clientes</th>
                <th className="p-3 text-right">Técnicos</th>
                <th className="p-3 text-right">{p?.nombre_localidad}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-800">
              {filas.map((f) => (
                <tr key={f.region_id || 'sin'}>
                  <td className="p-3">{f.region}</td>
                  <td className="p-3 text-right">{f.clientes}</td>
                  <td className="p-3 text-right">{f.profesionales}</td>
                  <td className="p-3 text-right">{f.localidades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
