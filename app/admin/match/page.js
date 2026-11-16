'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import Logo from '@/components/Logo';
import ArchivosMatch from '@/components/ArchivosMatch';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/util';
import { Estado, MENSAJE_FALTA_SQL, devolver, fecha, fechaHora, pesos, sinMatch } from '@/lib/match';

const PESTANAS = [
  ['operaciones', 'Operaciones'],
  ['a_liquidar', 'A liquidar'],
  ['devoluciones', 'Devoluciones'],
  ['reclamos', 'Reclamos'],
  ['config', 'Configuración'],
  ['comisiones', 'Comisiones'],
  ['rubros', 'Rubros'],
  ['historial', 'Historial'],
];

export default function AdminMatchPagina() {
  return (
    <Suspense fallback={<div className="grid min-h-dvh place-items-center text-tinta-400">Cargando…</div>}>
      <AdminMatch />
    </Suspense>
  );
}

function AdminMatch() {
  const router = useRouter();
  const params = useSearchParams();
  const [listo, setListo] = useState(false);
  const [ver, setVer] = useState(params.get('ver') || 'operaciones');
  const [resumen, setResumen] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return router.replace('/login?volver=/admin/match');
      const { data: p } = await supabase.from('perfiles').select('es_admin, rol').eq('id', data.session.user.id).maybeSingle();
      if (!p?.es_admin) return router.replace(p?.rol === 'profesional' ? '/panel' : '/inicio');
      setListo(true);
    })();
  }, [router]);

  function cambiar(v) {
    setVer(v);
    router.replace(`/admin/match?ver=${v}`, { scroll: false });
  }

  if (!listo) return <div className="grid min-h-dvh place-items-center text-tinta-400">Cargando…</div>;
  const r = resumen || {};
  return (
    <main className="mx-auto min-h-dvh max-w-5xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-12">
      <header className="flex items-center gap-3 py-2">
        <Link href="/admin" className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver a Administración"><Icon name="izq" /></Link>
        <Logo />
      </header>
      <h1 className="mt-2 text-2xl font-extrabold">TaListo! Match · Configuración comercial</h1>
      <p className="text-sm text-tinta-300">Solo el administrador cambia precios y comisiones. Los cambios valen para operaciones nuevas.</p>
      {resumen && (
        <section className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Cifra titulo="Retenido" valor={pesos(r.retenido)} pie="visitas sin confirmar" />
          <Cifra titulo="A liquidar" valor={pesos(r.a_liquidar)} pie={`${r.a_liquidar_ops} operaciones`} alerta={r.a_liquidar_ops > 0} />
          <Cifra titulo="Devoluciones" valor={r.devoluciones} pie="por aprobar" alerta={r.devoluciones > 0} />
          <Cifra titulo="Reclamos" valor={r.reclamos} pie="abiertos" alerta={r.reclamos > 0} />
          <Cifra titulo="Sin profesionales" valor={r.sin_profesionales} pie="solicitudes abiertas" alerta={r.sin_profesionales > 0} />
        </section>
      )}
      <nav className="-mx-4 mt-4 flex gap-1 overflow-x-auto border-b border-navy-800 px-4 pb-2 text-sm font-bold">
        {PESTANAS.map(([v, t]) => (
          <button key={v} type="button" onClick={() => cambiar(v)} className={`shrink-0 rounded-full px-3 py-1.5 ${ver === v ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}>{t}</button>
        ))}
      </nav>
      <div className="mt-4 space-y-4">
        {['operaciones', 'a_liquidar', 'devoluciones', 'reclamos'].includes(ver) && <Operaciones ver={ver} onResumen={setResumen} />}
        {ver === 'config' && <Configuracion />}
        {ver === 'comisiones' && <Comisiones />}
        {ver === 'rubros' && <Rubros />}
        {ver === 'historial' && <Historial />}
      </div>
    </main>
  );
}

function Cifra({ titulo, valor, pie, alerta }) {
  return (
    <div className="tarjeta p-3">
      <p className="text-[11px] font-semibold text-tinta-400">{titulo}</p>
      <p className={`text-xl font-extrabold tabular-nums ${alerta ? 'text-amber-300' : ''}`}>{valor ?? 0}</p>
      {pie && <p className="text-[11px] text-tinta-500">{pie}</p>}
    </div>
  );
}

function Mensaje({ m }) {
  if (!m?.texto) return null;
  return <p className={`rounded-xl p-3 text-sm ${m.error ? 'bg-red-500/10 text-red-300' : 'bg-menta-500/10 text-menta-200'}`}>{m.texto}</p>;
}

// ---------------------------------------------------------------- operaciones, liquidar, devoluciones, reclamos
function Operaciones({ ver, onResumen }) {
  const [datos, setDatos] = useState(null);
  const [texto, setTexto] = useState('');
  const [m, setM] = useState({});

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_match', { p_ver: ver, p_texto: texto || null });
    if (error) return setM({ error: true, texto: sinMatch(error) ? MENSAJE_FALTA_SQL : mensajeError(error) });
    setDatos(data);
    onResumen(data.resumen);
  }, [ver, texto, onResumen]);

  useEffect(() => {
    const t = setTimeout(cargar, texto ? 300 : 0);
    return () => clearTimeout(t);
  }, [cargar, texto]);

  if (!datos) return <Mensaje m={m} />;
  return (
    <>
      <Mensaje m={m} />
      {ver === 'operaciones' && (
        <>
          <input className="campo" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por cliente, profesional o número" />
          <ListaOperaciones ops={datos.operaciones || []} />
        </>
      )}
      {ver === 'a_liquidar' && <ALiquidar ops={datos.operaciones || []} liquidaciones={datos.liquidaciones || []} onHecho={(t) => { setM({ texto: t }); cargar(); }} />}
      {ver === 'devoluciones' && <Devoluciones lista={datos.devoluciones || []} onHecho={(t, e) => { setM({ texto: t, error: e }); cargar(); }} />}
      {ver === 'reclamos' && <Reclamos lista={datos.reclamos || []} onHecho={(t, e) => { setM({ texto: t, error: e }); cargar(); }} />}
    </>
  );
}

function Reparto({ o }) {
  return (
    <span className="text-[11px] text-tinta-400">
      Cobrado {pesos(o.importe)} = ret. cliente {pesos(o.ret_cliente)} + ret. profesional {pesos(o.ret_profesional)}
      {Number(o.comision) > 0 ? ` + comisión ${pesos(o.comision)}` : ''} + profesional {pesos(o.neto_profesional)}
      {o.mp_costo !== null && o.mp_costo !== undefined ? ` · costo MP ${pesos(o.mp_costo)} (prof. ${pesos(o.mp_costo_profesional)} / TaListo! ${pesos(o.mp_costo_talisto)})` : ''}
      {Number(o.reintegrado) > 0 ? ` · devuelto ${pesos(o.reintegrado)}` : ''}
    </span>
  );
}

function ListaOperaciones({ ops }) {
  if (!ops.length) return <p className="tarjeta p-4 text-sm text-tinta-400">No hay operaciones.</p>;
  return (
    <ul className="divide-y divide-navy-800 rounded-2xl border border-navy-800 bg-navy-900">
      {ops.map((o) => (
        <li key={o.id} className="px-3.5 py-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="min-w-0">
              <b>Nº {o.numero} · {o.tipo === 'visita' ? 'Visita técnica' : 'Trabajo'}</b> <span className="text-tinta-400">· {o.rubro}</span>
              <span className="block text-xs text-tinta-300">{o.cliente} → {o.profesional}{o.externa ? ' · siguió por fuera' : ''}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <b className="tabular-nums">{pesos(o.importe)}</b>
              <Estado valor={o.estado} />
            </span>
          </div>
          <div className="mt-1 flex flex-wrap justify-between gap-x-3">
            <Reparto o={o} />
            <span className="text-[11px] text-tinta-500">
              {fechaHora(o.creado_en)}
              {o.mp_pago_id ? ` · MP ${o.mp_pago_id}` : ''}
              {o.ingreso_talisto !== null && o.ingreso_talisto !== undefined ? ` · ingreso TaListo! ${pesos(o.ingreso_talisto)}` : ''}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ALiquidar({ ops, liquidaciones, onHecho }) {
  const grupos = useMemo(() => {
    const g = {};
    ops.forEach((o) => {
      g[o.profesional_id] ||= { id: o.profesional_id, nombre: o.profesional, cobro: o.cobro, ops: [] };
      g[o.profesional_id].ops.push(o);
    });
    return Object.values(g);
  }, [ops]);
  return (
    <>
      {grupos.length === 0 ? (
        <p className="tarjeta p-4 text-sm text-tinta-400">No hay nada pendiente de liquidar.</p>
      ) : (
        grupos.map((g) => <GrupoLiquidar key={g.id} g={g} onHecho={onHecho} />)
      )}
      {liquidaciones.length > 0 && (
        <section>
          <h2 className="titulo-seccion mb-2">Últimas liquidaciones</h2>
          <ul className="divide-y divide-navy-800 rounded-2xl border border-navy-800 bg-navy-900">
            {liquidaciones.map((l) => (
              <li key={l.numero} className="flex justify-between gap-2 px-3.5 py-2.5 text-sm">
                <span>Nº {l.numero} · {l.profesional}<span className="block text-xs text-tinta-400">{fecha(l.fecha)} · {l.operaciones} op. · ref. {l.referencia}</span></span>
                <b className="tabular-nums">{pesos(l.monto)}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function GrupoLiquidar({ g, onHecho }) {
  const [elegidas, setElegidas] = useState(() => g.ops.map((o) => o.id));
  const [ref, setRef] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const total = g.ops.filter((o) => elegidas.includes(o.id)).reduce((s, o) => s + Number(o.liquidacion_monto || 0), 0);
  async function liquidar() {
    setOcupado(true);
    const { data, error: err } = await supabase.rpc('admin_liquidar', { p_profesional: g.id, p_operaciones: elegidas, p_referencia: ref });
    setOcupado(false);
    if (err) return setError(mensajeError(err));
    onHecho(`Liquidación Nº ${data.numero} registrada: ${pesos(data.monto)} a ${g.nombre}${Number(data.penalizaciones) > 0 ? ` (descontadas penalizaciones por ${pesos(data.penalizaciones)})` : ''}.`);
  }
  return (
    <section className="tarjeta p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold">{g.nombre}</h3>
          {g.cobro ? (
            <p className="text-xs text-tinta-300">
              {g.cobro.banco} · {g.cobro.tipo_cuenta === 'cuenta_corriente' ? 'Cta. cte.' : g.cobro.tipo_cuenta === 'caja_ahorro' ? 'Caja de ahorro' : 'Cuenta'} {g.cobro.numero}
              {g.cobro.sucursal ? ` · suc. ${g.cobro.sucursal}` : ''} · {g.cobro.titular}{g.cobro.documento ? ` (${g.cobro.documento})` : ''}
            </p>
          ) : (
            <p className="text-xs font-semibold text-amber-300">No cargó la cuenta bancaria.</p>
          )}
        </div>
        <b className="text-lg text-menta-300 tabular-nums">{pesos(total)}</b>
      </div>
      <ul className="mt-2 space-y-1">
        {g.ops.map((o) => (
          <li key={o.id}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={elegidas.includes(o.id)} onChange={(e) => setElegidas(e.target.checked ? [...elegidas, o.id] : elegidas.filter((x) => x !== o.id))} />
              <span className="flex-1">Nº {o.numero} · {o.cliente} · confirmada {fecha(o.confirmado_en)}</span>
              <b className="tabular-nums">{pesos(o.liquidacion_monto)}</b>
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-tinta-400">Primero hacé la transferencia desde el banco y después registrala acá con su referencia.</p>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      <div className="mt-2 flex gap-2">
        <input className="campo min-w-0 flex-1" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Referencia de la transferencia" />
        <button type="button" className="btn btn-menta shrink-0 px-4" disabled={ocupado || !ref.trim() || !elegidas.length || !g.cobro} onClick={liquidar}>Registrar</button>
      </div>
    </section>
  );
}

function Devoluciones({ lista, onHecho }) {
  if (!lista.length) return <p className="tarjeta p-4 text-sm text-tinta-400">No hay devoluciones.</p>;
  return lista.map((d) => <Devolucion key={d.id} d={d} onHecho={onHecho} />);
}

function Devolucion({ d, onHecho }) {
  const [monto, setMonto] = useState(String(d.monto));
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const abierta = ['pendiente', 'error'].includes(d.estado);
  async function aprobar() {
    setOcupado(true);
    try {
      await devolver(d.id, Number(String(monto).replace(',', '.')), nota);
      onHecho(`Devolución hecha en Mercado Pago: ${pesos(monto)} al cliente.`);
    } catch (e) {
      onHecho(e.message, true);
    }
    setOcupado(false);
  }
  async function rechazar() {
    const { error } = await supabase.rpc('admin_rechazar_devolucion', { p_id: d.id, p_nota: nota });
    if (error) return onHecho(mensajeError(error), true);
    onHecho('Devolución rechazada.');
  }
  return (
    <section className="tarjeta p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span>
          <b>Operación Nº {d.operacion}</b> · {d.cliente} → {d.profesional}
          <span className="block text-xs text-tinta-400">{fechaHora(d.creado_en)} · origen: {d.origen} · cobrado {pesos(d.importe)}{d.mp_pago_id ? ` · MP ${d.mp_pago_id}` : ''}</span>
        </span>
        <span className="text-right">
          <b className="block tabular-nums">{pesos(d.monto)}</b>
          <span className="text-xs font-bold text-tinta-300">{d.estado}</span>
        </span>
      </div>
      {d.motivo && <p className="mt-1 text-tinta-200">{d.motivo}</p>}
      {d.error && <p className="mt-1 text-xs text-red-300">Error de Mercado Pago: {d.error}</p>}
      {abierta && (
        <div className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr_auto_auto]">
          <input className="campo" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} aria-label="Monto a devolver" />
          <input className="campo" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (obligatoria para rechazar)" />
          <button type="button" className="btn btn-menta px-4" disabled={ocupado} onClick={aprobar}>Devolver por MP</button>
          <button type="button" className="btn btn-sec px-4" disabled={ocupado || !nota.trim()} onClick={rechazar}>Rechazar</button>
        </div>
      )}
    </section>
  );
}

function Reclamos({ lista, onHecho }) {
  if (!lista.length) return <p className="tarjeta p-4 text-sm text-tinta-400">No hay reclamos.</p>;
  return lista.map((r) => <Reclamo key={r.id} r={r} onHecho={onHecho} />);
}

function Reclamo({ r, onHecho }) {
  const [accion, setAccion] = useState('liberar');
  const [monto, setMonto] = useState('');
  const [texto, setTexto] = useState('');
  async function resolver() {
    const { error } = await supabase.rpc('admin_resolver_reclamo', {
      p_id: r.id, p_accion: accion, p_monto: accion === 'devolver_parcial' ? Number(String(monto).replace(',', '.')) : null, p_resolucion: texto,
    });
    if (error) return onHecho(mensajeError(error), true);
    onHecho(accion.startsWith('devolver') ? 'Reclamo resuelto. La devolución quedó en Devoluciones para hacerla por Mercado Pago.' : 'Reclamo resuelto.');
  }
  return (
    <section className={`tarjeta p-4 text-sm ${r.estado === 'abierto' ? 'border-red-500/40' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span>
          <b>Reclamo Nº {r.numero}</b> · operación Nº {r.operacion} · {r.cliente} → {r.profesional}
          <span className="block text-xs text-tinta-400">{fechaHora(r.creado_en)} · cobrado {pesos(r.importe)}</span>
        </span>
        <span className="text-xs font-bold text-tinta-300">{r.estado}{r.accion ? ` · ${r.accion}` : ''}</span>
      </div>
      <p className="mt-1 text-tinta-200">{r.descripcion}</p>
      {r.archivos?.length > 0 && <div className="mt-2"><ArchivosMatch rutas={r.archivos} tam="h-16 w-16" /></div>}
      {r.respuesta_profesional && <p className="mt-2 rounded-lg bg-navy-850 p-2 text-xs"><b>Profesional:</b> {r.respuesta_profesional}</p>}
      {r.resolucion && <p className="mt-2 rounded-lg bg-navy-850 p-2 text-xs"><b>Resolución:</b> {r.resolucion}</p>}
      {r.estado === 'abierto' && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {[['liberar', 'Liberar el pago al profesional'], ['devolver_total', 'Devolver todo'], ['devolver_parcial', 'Devolver una parte'], ['sin_accion', 'Rechazar el reclamo']].map(([v, t]) => (
              <button key={v} type="button" onClick={() => setAccion(v)} className={`chip text-xs ${accion === v ? 'chip-activo' : ''}`}>{t}</button>
            ))}
          </div>
          {accion === 'devolver_parcial' && <input className="campo" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Monto a devolver" />}
          <div className="flex gap-2">
            <input className="campo min-w-0 flex-1" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Resolución (la ven el cliente y el profesional)" />
            <button type="button" className="btn btn-menta shrink-0 px-4" disabled={!texto.trim()} onClick={resolver}>Resolver</button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- configuración
const GRUPOS = [
  ['Visita técnica', [
    ['precio_visita', 'Precio total de la visita ($)'],
    ['visita_ret_cliente', 'Retención TaListo! al cliente ($)'],
    ['visita_ret_profesional', 'Retención TaListo! al profesional ($)'],
    ['visita_neto_profesional', 'Recibe el profesional ($)'],
    ['duracion_visita_min', 'Duración en la agenda (minutos)'],
  ]],
  ['Trabajos con garantía', [
    ['trabajo_comision_pct', 'Comisión general por trabajo (%)'],
    ['trabajo_comision_activa', 'Cobrar comisión por trabajos', 'si'],
    ['comision_por_rubro', 'Usar comisiones diferenciadas por rubro', 'si'],
    ['acreditar_visita', 'Descontar la visita del trabajo contratado', 'si'],
  ]],
  ['Mercado Pago', [['mp_costo_profesional_pct', 'Parte del costo de MP que paga el profesional (%)']]],
  ['El primero disponible', [
    ['primero_activo', 'Los clientes pueden pedir "el primero disponible"', 'si'],
    ['primero_horas', 'Horas para que alguien lo tome (pedidos para hoy)'],
  ]],
  ['Plazos', [
    ['pago_minutos', 'Minutos para pagar una reserva'],
    ['solicitud_dias', 'Días que una solicitud queda abierta'],
    ['max_invitados', 'Profesionales invitados por solicitud'],
    ['confirmacion_auto_horas', 'Horas para la confirmación automática'],
    ['liquidacion_dias', 'Días para liquidar después de confirmar'],
    ['solo_verificados', 'Solo enviar solicitudes a cuentas verificadas', 'si'],
  ]],
  ['Cancelaciones y devoluciones', [
    ['cancelacion_horas', 'Cancelación sin cargo hasta (horas antes)'],
    ['cancelacion_tarde_pct', 'Cargo por cancelación tardía del cliente (%)'],
    ['penalizacion_profesional', 'Penalización si cancela el profesional ($)'],
    ['devolucion_dias', 'Días para pedir una devolución'],
  ]],
  ['Garantía y reclamos', [
    ['garantia_dias', 'Duración de la garantía (días)'],
    ['garantia_cobertura', 'Cobertura', 'texto'],
    ['garantia_exclusiones', 'Exclusiones', 'texto'],
    ['reclamo_procedimiento', 'Procedimiento de reclamos', 'texto'],
  ]],
];

function Configuracion() {
  const [cfg, setCfg] = useState(null);
  const [f, setF] = useState(null);
  const [m, setM] = useState({});
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    supabase.from('configuracion').select('*').eq('id', 1).maybeSingle().then(({ data }) => {
      setCfg(data);
      setF(data);
    });
  }, []);

  if (!f) return <p className="text-sm text-tinta-400">Cargando…</p>;
  if (f.visita_neto_profesional === undefined) return <Mensaje m={{ error: true, texto: MENSAJE_FALTA_SQL }} />;
  const n = (k) => Number(String(f[k] ?? '').replace(',', '.'));
  const suma = n('visita_ret_cliente') + n('visita_ret_profesional') + n('visita_neto_profesional');
  const cuadra = Math.abs(suma - n('precio_visita')) < 0.005;

  async function guardar() {
    setOcupado(true);
    const p = {};
    GRUPOS.forEach(([, campos]) => campos.forEach(([k, , tipo]) => {
      p[k] = tipo === 'si' ? !!f[k] : tipo === 'texto' ? String(f[k] || '') : n(k);
    }));
    const { data, error } = await supabase.rpc('guardar_config_match', { p });
    setOcupado(false);
    if (error) return setM({ error: true, texto: mensajeError(error) });
    setCfg(data);
    setF(data);
    setM({ texto: 'Guardado. Vale para las operaciones nuevas; las ya creadas mantienen sus importes.' });
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {GRUPOS.map(([titulo, campos]) => (
          <section key={titulo} className={`tarjeta space-y-3 p-4 ${titulo === 'Garantía y reclamos' ? 'md:col-span-2' : ''}`}>
            <h2 className="font-bold">{titulo}</h2>
            {campos.map(([k, etiqueta, tipo]) =>
              tipo === 'si' ? (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-5 w-5" checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
                  {etiqueta}
                </label>
              ) : tipo === 'texto' ? (
                <label key={k} className="block">
                  <span className="etiqueta">{etiqueta}</span>
                  <textarea className="campo min-h-[4.5rem] text-sm" value={f[k] || ''} maxLength={1500} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
                </label>
              ) : (
                <label key={k} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-tinta-300">{etiqueta}</span>
                  <input className="campo w-28 text-right tabular-nums" inputMode="decimal" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
                </label>
              )
            )}
            {titulo === 'Visita técnica' && (
              <p className={`rounded-xl p-3 text-sm ${cuadra ? 'bg-menta-500/10 text-menta-200' : 'bg-red-500/10 text-red-300'}`}>
                {pesos(n('visita_ret_cliente'))} + {pesos(n('visita_ret_profesional'))} + {pesos(n('visita_neto_profesional'))} = {pesos(suma)}
                {cuadra ? ` · cuadra con el precio. Ingreso bruto TaListo!: ${pesos(n('visita_ret_cliente') + n('visita_ret_profesional'))}.` : ` · no cuadra con el precio de ${pesos(n('precio_visita'))}.`}
              </p>
            )}
            {titulo === 'Trabajos con garantía' && (
              <p className="text-xs text-tinta-400">
                Ejemplo: trabajo de {pesos(20000)} → comisión {pesos(20000 * n('trabajo_comision_pct') / 100)}, el profesional recibe {pesos(20000 - 20000 * n('trabajo_comision_pct') / 100)}.
                {f.acreditar_visita ? ' La visita ya pagada se descuenta del trabajo y se ajusta en la liquidación.' : ''} Las excepciones por rubro o cuenta van en Comisiones.
                {' '}La contratación del trabajo con garantía dentro de TaListo! llega en la próxima etapa: estos valores se aplican desde ese momento.
              </p>
            )}
          </section>
        ))}
      </div>
      <Mensaje m={m} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-menta px-6" disabled={ocupado || !cuadra} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar configuración'}</button>
        <button type="button" className="btn btn-sec px-4" onClick={() => setF(cfg)}>Deshacer cambios</button>
        {cfg?.actualizado_en && <span className="text-xs text-tinta-500">Último cambio: {fechaHora(cfg.actualizado_en)}</span>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- comisiones especiales
function Comisiones() {
  const [lista, setLista] = useState(null);
  const [rubros, setRubros] = useState([]);
  const [pros, setPros] = useState([]);
  const [nueva, setNueva] = useState({ tipo: 'rubro', categoria: '', profesional: '', pct: '', notas: '' });
  const [m, setM] = useState({});

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_comisiones');
    if (error) return setM({ error: true, texto: sinMatch(error) ? MENSAJE_FALTA_SQL : mensajeError(error) });
    setLista(data || []);
  }, []);

  useEffect(() => {
    cargar();
    supabase.from('categorias').select('id, nombre').order('orden').then(({ data }) => setRubros(data || []));
    supabase.from('profesionales').select('id, nombre').order('nombre').limit(1000).then(({ data }) => setPros(data || []));
  }, [cargar]);

  async function guardar(c, cambios) {
    const x = { ...c, ...cambios };
    const { error } = await supabase.rpc('guardar_comision_especial', {
      p_id: x.id || null, p_tipo: x.tipo, p_categoria: x.tipo === 'rubro' ? Number(x.categoria_id ?? x.categoria) : null,
      p_profesional: x.tipo === 'cuenta' ? x.profesional_id ?? x.profesional : null, p_pct: Number(String(x.pct).replace(',', '.')), p_activa: x.activa ?? true, p_notas: x.notas || null,
    });
    if (error) return setM({ error: true, texto: mensajeError(error) });
    setM({ texto: 'Comisión guardada.' });
    setNueva({ tipo: 'rubro', categoria: '', profesional: '', pct: '', notas: '' });
    cargar();
  }

  return (
    <>
      <p className="text-sm text-tinta-300">Orden: excepción de la cuenta (profesional o empresa) → rubro (si está habilitado en Configuración) → comisión general.</p>
      <Mensaje m={m} />
      <ul className="space-y-2">
        {(lista || []).map((c) => (
          <li key={c.id} className="tarjeta flex flex-wrap items-center gap-2 p-3 text-sm">
            <span className="min-w-0 flex-1">
              <b>{c.tipo === 'rubro' ? c.rubro : c.profesional}</b> <span className="text-xs text-tinta-400">· {c.tipo === 'rubro' ? 'rubro' : 'cuenta'}{c.notas ? ` · ${c.notas}` : ''}</span>
            </span>
            <PctEditable valor={c.pct} onGuardar={(pct) => guardar(c, { pct })} />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={c.activa} onChange={(e) => guardar(c, { activa: e.target.checked })} /> activa
            </label>
          </li>
        ))}
      </ul>
      <section className="tarjeta space-y-2 p-4">
        <h2 className="font-bold">Nueva excepción</h2>
        <div className="flex gap-1.5">
          {[['rubro', 'Por rubro'], ['cuenta', 'Por profesional o empresa']].map(([v, t]) => (
            <button key={v} type="button" className={`chip text-xs ${nueva.tipo === v ? 'chip-activo' : ''}`} onClick={() => setNueva({ ...nueva, tipo: v })}>{t}</button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_7rem_1fr_auto]">
          {nueva.tipo === 'rubro' ? (
            <select className="campo" value={nueva.categoria} onChange={(e) => setNueva({ ...nueva, categoria: e.target.value })}>
              <option value="">Elegí el rubro</option>
              {rubros.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            </select>
          ) : (
            <select className="campo" value={nueva.profesional} onChange={(e) => setNueva({ ...nueva, profesional: e.target.value })}>
              <option value="">Elegí la cuenta</option>
              {pros.map((p) => <option key={p.id} value={p.id}>{p.nombre || p.id.slice(0, 8)}</option>)}
            </select>
          )}
          <input className="campo text-right" inputMode="decimal" value={nueva.pct} onChange={(e) => setNueva({ ...nueva, pct: e.target.value })} placeholder="%" />
          <input className="campo" value={nueva.notas} onChange={(e) => setNueva({ ...nueva, notas: e.target.value })} placeholder="Notas (opcional)" />
          <button type="button" className="btn btn-menta px-4" disabled={!nueva.pct || (nueva.tipo === 'rubro' ? !nueva.categoria : !nueva.profesional)} onClick={() => guardar(nueva, {})}>Agregar</button>
        </div>
      </section>
    </>
  );
}

function PctEditable({ valor, onGuardar }) {
  const [v, setV] = useState(String(valor));
  return (
    <span className="flex items-center gap-1">
      <input className="campo w-20 px-2 py-1.5 text-right text-sm" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} />
      <span className="text-tinta-400">%</span>
      {Number(String(v).replace(',', '.')) !== Number(valor) && <button type="button" className="chip chip-activo text-xs" onClick={() => onGuardar(v)}>Guardar</button>}
    </span>
  );
}

// ---------------------------------------------------------------- rubros
function Rubros() {
  const [lista, setLista] = useState(null);
  const [m, setM] = useState({});
  const [nuevo, setNuevo] = useState('');

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('categorias').select('id, nombre, sinonimos, activa, orden').order('orden');
    setLista(data || []);
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardar(r, cambios) {
    const x = { ...r, ...cambios };
    const { error } = await supabase.rpc('guardar_rubro', { p_id: x.id ?? null, p_nombre: x.nombre, p_sinonimos: x.sinonimos || [], p_activa: x.activa ?? true });
    if (error) return setM({ error: true, texto: mensajeError(error) });
    setM({ texto: 'Rubro guardado.' });
    setNuevo('');
    cargar();
  }

  async function mover(i, d) {
    const ids = lista.map((r) => r.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setLista(ids.map((id) => lista.find((r) => r.id === id)));
    const { error } = await supabase.rpc('ordenar_rubros', { p_ids: ids });
    if (error) setM({ error: true, texto: mensajeError(error) });
  }

  if (!lista) return <p className="text-sm text-tinta-400">Cargando…</p>;
  return (
    <>
      <Mensaje m={m} />
      <ul className="space-y-2">
        {lista.map((r, i) => (
          <FilaRubro key={r.id} r={r} primero={i === 0} ultimo={i === lista.length - 1} onMover={(d) => mover(i, d)} onGuardar={(c) => guardar(r, c)} />
        ))}
      </ul>
      <div className="flex gap-2">
        <input className="campo min-w-0 flex-1" value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Nuevo rubro" />
        <button type="button" className="btn btn-menta shrink-0 px-4" disabled={nuevo.trim().length < 3} onClick={() => guardar({ id: null, nombre: nuevo, sinonimos: [], activa: true }, {})}>Agregar</button>
      </div>
    </>
  );
}

function FilaRubro({ r, primero, ultimo, onMover, onGuardar }) {
  const [nombre, setNombre] = useState(r.nombre);
  const [sin, setSin] = useState((r.sinonimos || []).join(', '));
  const cambio = nombre !== r.nombre || sin !== (r.sinonimos || []).join(', ');
  return (
    <li className={`tarjeta p-3 ${r.activa ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-2">
        <span className="flex flex-col">
          <button type="button" disabled={primero} onClick={() => onMover(-1)} className="text-tinta-400 disabled:opacity-30" aria-label="Subir"><Icon name="arriba" className="h-4 w-4" /></button>
          <button type="button" disabled={ultimo} onClick={() => onMover(1)} className="text-tinta-400 disabled:opacity-30" aria-label="Bajar"><Icon name="abajo" className="h-4 w-4" /></button>
        </span>
        <input className="campo min-w-0 flex-1 py-2 font-bold" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <label className="flex shrink-0 items-center gap-1 text-xs">
          <input type="checkbox" checked={r.activa} onChange={(e) => onGuardar({ activa: e.target.checked })} /> activo
        </label>
      </div>
      <div className="mt-2 flex gap-2">
        <input className="campo min-w-0 flex-1 py-2 text-xs" value={sin} onChange={(e) => setSin(e.target.value)} placeholder="Palabras para el buscador, separadas por coma" />
        {cambio && <button type="button" className="chip chip-activo shrink-0 text-xs" onClick={() => onGuardar({ nombre, sinonimos: sin.split(',').map((x) => x.trim()).filter(Boolean) })}>Guardar</button>}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- historial de cambios
function Historial() {
  const [lista, setLista] = useState(null);
  useEffect(() => {
    supabase.rpc('admin_config_historial', { p_limite: 200 }).then(({ data }) => setLista(data || []));
  }, []);
  if (!lista) return <p className="text-sm text-tinta-400">Cargando…</p>;
  if (!lista.length) return <p className="tarjeta p-4 text-sm text-tinta-400">Todavía no hay cambios registrados.</p>;
  return (
    <ul className="divide-y divide-navy-800 rounded-2xl border border-navy-800 bg-navy-900">
      {lista.map((h) => (
        <li key={h.id} className="px-3.5 py-2.5 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <b>{h.referencia ? `${h.referencia} · ` : ''}{h.campo}</b>
            <span className="text-xs text-tinta-400">{fechaHora(h.creado_en)} · {h.admin_nombre || 'sistema'}</span>
          </div>
          <p className="text-xs text-tinta-300">
            <span className="text-tinta-500 line-through">{h.valor_anterior ?? '—'}</span> → <b className="text-tinta-100">{h.valor_nuevo ?? '—'}</b>
          </p>
        </li>
      ))}
    </ul>
  );
}
