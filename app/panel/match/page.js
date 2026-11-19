'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import ArchivosMatch from '@/components/ArchivosMatch';
import ServiciosDisponibles from '@/components/ServiciosDisponibles';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { DEPARTAMENTOS, mensajeError } from '@/lib/util';
import { DetallePuntos, Estado, Estrellas, MENSAJE_FALTA_SQL, PREFERENCIAS, ResumenCalificacion, notaTexto, diaLargo, fecha, hora, mayus, pesos, sinMatch } from '@/lib/match';

const PESTANAS = [
  ['solicitudes', 'Solicitudes'],
  ['pedidos', 'Para tomar'],
  ['visitas', 'Visitas'],
  ['cobros', 'Cobros'],
  ['calificaciones', 'Calificaciones'],
  ['perfil', 'Mi Match'],
];

export default function MatchPagina() {
  return (
    <Suspense fallback={<p className="p-4 text-tinta-400">Cargando…</p>}>
      <Match />
    </Suspense>
  );
}

function Match() {
  const router = useRouter();
  const params = useSearchParams();
  const { profesional, yo } = usePanel();
  const cuenta = profesional?.id;
  const [ver, setVer] = useState(params.get('ver') || 'solicitudes');
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    if (!cuenta) return;
    const [{ data, error: err }, { data: urg }] = await Promise.all([
      supabase.rpc('match_bandeja', { p_cuenta: cuenta }),
      supabase.from('configuracion').select('*').eq('id', 1).maybeSingle(),
    ]);
    if (err) return setError(sinMatch(err) ? MENSAJE_FALTA_SQL : mensajeError(err));
    setError('');
    // tarifa de urgencia (SQL 21): se suma a la configuración de la bandeja
    const u = urg && urg.precio_urgencia !== undefined && urg.urgencia_activa
      ? { precio_urgencia: urg.precio_urgencia, ret_urgencia: urg.urgencia_ret_profesional, neto_urgencia: urg.urgencia_neto_profesional,
          urgencia_desde: String(urg.urgencia_desde || '').slice(0, 5), urgencia_hasta: String(urg.urgencia_hasta || '').slice(0, 5) }
      : {};
    setDatos({ ...data, config: { ...data.config, ...u } });
  }, [cuenta]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function cambiar(v) {
    setVer(v);
    router.replace(`/panel/match?ver=${v}`, { scroll: false });
  }

  const pendientes = (datos?.solicitudes || []).filter((s) => s.estado === 'pendiente').length;
  const proximas = (datos?.visitas || []).length;
  const perfil = datos?.perfil;

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-menta-500/15 text-menta-300"><Icon name="match" className="h-5 w-5" /></span>
          <h1 className="flex-1 text-2xl font-extrabold">Match</h1>
          {perfil && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${perfil.disponible ? 'bg-menta-500/15 text-menta-300' : 'bg-navy-800 text-tinta-400'}`}>
              {perfil.disponible ? <><span className="sm:hidden">Activo</span><span className="hidden sm:inline">Recibiendo solicitudes</span></> : 'Pausado'}
            </span>
          )}
          <Link href="/inicio" className="chip shrink-0 text-xs" title="Pedí un técnico para vos, como cliente">
            <Icon name="buscar" className="h-4 w-4" /> Contratar
          </Link>
        </div>
        <nav className="-mx-4 mt-2 flex gap-1 overflow-x-auto px-4 pb-1 text-sm font-bold">
          {PESTANAS.map(([v, t]) => (
            <button key={v} type="button" onClick={() => cambiar(v)} className={`shrink-0 rounded-full px-3 py-1.5 ${ver === v ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}>
              {t}
              {v === 'solicitudes' && pendientes > 0 && <span className="ml-1.5 rounded-full bg-menta-400 px-1.5 text-[11px] text-navy-950">{pendientes}</span>}
              {v === 'visitas' && proximas > 0 && <span className="ml-1.5 rounded-full bg-navy-600 px-1.5 text-[11px]">{proximas}</span>}
            </button>
          ))}
        </nav>
      </header>
      <div className="space-y-4 px-4 pt-4 pb-8">
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        {!datos && !error && <p className="py-10 text-center text-sm text-tinta-400">Cargando…</p>}
        {datos && (
          <>
            {!perfil.disponible && ver !== 'perfil' && (
              <button type="button" onClick={() => cambiar('perfil')} className="tarjeta flex w-full items-center gap-3 p-3.5 text-left">
                <Icon name="match" className="h-5 w-5 shrink-0 text-menta-300" />
                <span className="min-w-0 flex-1 text-sm">
                  <b className="block">Activá Match para recibir clientes nuevos</b>
                  <span className="text-tinta-300">Elegí tus rubros y zonas. Cada visita técnica te deja {pesos(datos.config.neto_visita)} y la cobra TaListo! por vos.</span>
                </span>
                <Icon name="der" className="h-4 w-4 text-tinta-400" />
              </button>
            )}
            {ver === 'solicitudes' && <Solicitudes datos={datos} onCambio={cargar} />}
            {ver === 'pedidos' && (
              <>
                <p className="text-sm text-tinta-300">
                  Clientes que pidieron &ldquo;el primero disponible&rdquo; en tus rubros, desde la app o por WhatsApp. Tomalo al precio base o, si la visita sale más cara, mandá tu cotización: el cliente paga cuando lo tomás o cuando la acepta.{' '}
                  <Link href="/panel/mapa?ver=servicios" className="font-bold text-menta-300">Ver en el mapa</Link>
                </p>
                <ServiciosDisponibles cuenta={cuenta} conMapa={false} />
              </>
            )}
            {ver === 'visitas' && <Visitas datos={datos} onCambio={cargar} />}
            {ver === 'cobros' && <Cobros datos={datos} esDueno={yo?.id === cuenta} onIrPerfil={() => cambiar('perfil')} />}
            {ver === 'calificaciones' && <Calificaciones datos={datos} onCambio={cargar} />}
            {ver === 'perfil' && <PerfilMatch cuenta={cuenta} perfil={perfil} config={datos.config} esDueno={yo?.id === cuenta} onGuardado={cargar} />}
          </>
        )}
      </div>
    </>
  );
}

function Aviso({ texto, error }) {
  if (!texto) return null;
  return <p className={`rounded-xl p-3 text-sm ${error ? 'bg-red-500/10 text-red-300' : 'bg-menta-500/10 text-menta-200'}`}>{texto}</p>;
}

// ---------------------------------------------------------------- solicitudes
function Solicitudes({ datos, onCambio }) {
  const lista = datos.solicitudes || [];
  if (!lista.length) {
    return (
      <section className="tarjeta p-5 text-center text-sm text-tinta-300">
        <Icon name="match" className="mx-auto mb-2 h-8 w-8 text-tinta-500" />
        No hay solicitudes nuevas. Cuando un cliente pida un servicio de tus rubros en tu zona, te llega un aviso.
      </section>
    );
  }
  return (
    <div className="space-y-3 pc:grid pc:grid-cols-2 pc:gap-3 pc:space-y-0">
      {lista.map((x) => (
        <TarjetaSolicitud key={x.invitacion} x={x} neto={datos.config.neto_visita} onCambio={onCambio} />
      ))}
    </div>
  );
}

function TarjetaSolicitud({ x, neto, onCambio }) {
  const s = x.solicitud;
  const [modo, setModo] = useState(null); // 'aceptar' | 'rechazar'
  const [texto, setTexto] = useState('');
  const [precio, setPrecio] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!x.vista_en) supabase.rpc('marcar_invitacion_vista', { p_id: x.invitacion }).then(() => {});
  }, [x.invitacion, x.vista_en]);

  async function responder(acepta) {
    setOcupado(true);
    const args = { p_id: x.invitacion, p_acepta: acepta, p_mensaje: texto };
    if (acepta && Number(precio) > 0) args.p_precio = Math.round(Number(precio));
    const { error: err } = await supabase.rpc('responder_invitacion', args);
    setOcupado(false);
    if (err) return setError(mensajeError(err));
    onCambio();
  }

  return (
    <article className={`tarjeta p-4 ${x.estado === 'pendiente' ? 'border-menta-500/40' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-menta-300">
            {s.rubro}
            {s.urgente ? <span className="ml-2 rounded-full bg-red-500/15 px-1.5 py-0.5 text-red-300">Urgente</span> : null}
            {s.dirigida ? <span className="ml-2 rounded-full bg-[#0a84ff]/20 px-1.5 py-0.5 text-[#8cc8ff]">Te eligió a vos</span> : null}
          </p>
          <h3 className="mt-0.5 font-bold">{s.titulo}</h3>
          <p className="text-xs text-tinta-400">
            {[s.localidad, s.departamento].filter(Boolean).join(', ')} · {PREFERENCIAS.find((p) => p[0] === s.preferencia)?.[1]} · Nº {s.numero}
          </p>
        </div>
        <span className="shrink-0 text-right">
          <b className="block text-menta-300">{pesos(neto)}</b>
          <span className="text-[11px] text-tinta-400">para vos</span>
        </span>
      </div>
      <p className="mt-2 text-sm whitespace-pre-line text-tinta-200">{s.descripcion}</p>
      {s.archivos?.length > 0 && (
        <div className="mt-2">
          <ArchivosMatch rutas={s.archivos} tam="h-16 w-16" />
        </div>
      )}
      <p className="mt-2 text-[11px] text-tinta-500">La dirección exacta y el teléfono del cliente aparecen cuando reserva y paga la visita.</p>
      {error && <p className="mt-2 rounded-xl bg-red-500/10 p-2.5 text-sm text-red-300">{error}</p>}
      {x.estado === 'aceptada' ? (
        <p className="mt-3 rounded-xl bg-menta-500/10 p-2.5 text-sm text-menta-200">
          Aceptaste{x.precio_profesional ? ` por ${pesos(x.precio_profesional)}` : ''}. Ahora el cliente elige el profesional y el horario{x.mensaje ? `. Tu mensaje: “${x.mensaje}”` : ''}.
        </p>
      ) : modo ? (
        <div className="mt-3 space-y-2">
          <textarea
            className="campo min-h-[4.5rem] text-sm"
            value={texto}
            maxLength={modo === 'aceptar' ? 400 : 200}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={modo === 'aceptar' ? 'Mensaje para el cliente (opcional): qué vas a revisar, si llevás algo…' : 'Motivo (opcional): no llego a esa zona, no hago ese trabajo…'}
          />
          {modo === 'aceptar' && (
            <label className="block">
              <span className="etiqueta">Tu precio por la visita (opcional)</span>
              <input type="number" inputMode="numeric" min="0" className="campo" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder={`Si lo dejás vacío: ${pesos(neto)}`} />
              <span className="mt-1 block text-[11px] text-tinta-500">Es lo que recibís vos. El cliente ve tu precio más la tarifa de TaListo!.</span>
            </label>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn btn-sec flex-1 py-2" onClick={() => setModo(null)}>Volver</button>
            <button type="button" className={`btn flex-1 py-2 ${modo === 'aceptar' ? 'btn-menta' : 'btn-sec text-red-300'}`} disabled={ocupado} onClick={() => responder(modo === 'aceptar')}>
              {modo === 'aceptar' ? 'Aceptar solicitud' : 'Rechazar'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn btn-sec flex-1 py-2" onClick={() => setModo('rechazar')}>No puedo</button>
          <button type="button" className="btn btn-menta flex-1 py-2" onClick={() => setModo('aceptar')}>Puedo hacer la visita</button>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------- visitas
function Visitas({ datos, onCambio }) {
  const lista = datos.visitas || [];
  if (!lista.length) {
    return <p className="tarjeta p-5 text-center text-sm text-tinta-300">No tenés visitas de Match agendadas. Las que te reservan aparecen acá y en tu agenda.</p>;
  }
  return (
    <div className="space-y-3 pc:grid pc:grid-cols-2 pc:gap-3 pc:space-y-0">
      {lista.map((o) => (
        <TarjetaVisita key={o.id} o={o} config={datos.config} onCambio={onCambio} />
      ))}
    </div>
  );
}

function TarjetaVisita({ o, config, onCambio }) {
  const s = o.solicitud;
  const [modo, setModo] = useState(null); // 'realizada' | 'cancelar' | 'reclamo'
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState({});
  const llego = o.turno?.inicio && new Date(o.turno.inicio).getTime() <= Date.now() + 3600e3;

  async function hacer(fn, args, ok) {
    setOcupado(true);
    const { error } = await supabase.rpc(fn, args);
    setOcupado(false);
    if (error) return setAviso({ error: mensajeError(error) });
    setAviso({ ok });
    setModo(null);
    setTexto('');
    onCambio();
  }

  const mapa = s.lat ? `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}` : s.direccion ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.direccion}, ${s.departamento}`)}` : null;

  return (
    <article className="tarjeta p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Estado valor={o.estado} />
          <h3 className="mt-1 font-bold">{s.titulo}</h3>
          <p className="text-xs text-tinta-400">{s.rubro} · Nº {o.numero}</p>
        </div>
        {o.turno && (
          <span className="shrink-0 rounded-xl bg-navy-850 px-2.5 py-1.5 text-center">
            <b className="block text-sm">{mayus(diaLargo(o.turno.inicio))}</b>
            <span className="text-xs text-tinta-300">{hora(o.turno.inicio)} a {hora(o.turno.fin)}</span>
          </span>
        )}
      </div>
      {o.cliente && (
        <div className="mt-3 space-y-1 rounded-xl bg-navy-850 p-3 text-sm">
          <p>
            <b>{o.cliente.nombre}</b>
            {o.cliente.telefono && (
              <a href={`tel:${o.cliente.telefono}`} className="ml-2 font-semibold text-menta-300">{o.cliente.telefono}</a>
            )}
          </p>
          {s.direccion && (
            <p className="text-tinta-300">
              {s.direccion}, {[s.localidad, s.departamento].filter(Boolean).join(', ')}
              {s.referencia ? ` · ${s.referencia}` : ''}
            </p>
          )}
          {mapa && <a href={mapa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-[#8cc8ff]"><Icon name="mapa" className="h-3.5 w-3.5" /> Cómo llegar</a>}
        </div>
      )}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-tinta-400">Lo que pidió el cliente</summary>
        <p className="mt-1 whitespace-pre-line text-tinta-200">{s.descripcion}</p>
        {s.archivos?.length > 0 && <div className="mt-2"><ArchivosMatch rutas={s.archivos} tam="h-16 w-16" /></div>}
      </details>
      <p className="mt-2 text-xs text-tinta-400">
        Te queda {pesos(o.neto_profesional)} (el cliente pagó {pesos(o.importe)}, con {pesos(Number(o.importe) - Number(o.neto_profesional))} de TaListo!
        {Number(config.mp_costo_profesional_pct) > 0 ? ` − tu parte del costo de Mercado Pago (${Number(config.mp_costo_profesional_pct).toLocaleString('es-UY')} %)` : ''}).
      </p>
      {o.estado === 'pendiente_confirmacion' && (
        <p className="mt-2 rounded-xl bg-amber-400/10 p-2.5 text-xs text-amber-100">
          Esperando que el cliente confirme. Si no responde, se confirma sola el {fecha(o.confirmar_hasta)} a las {hora(o.confirmar_hasta)}.
        </p>
      )}
      {o.diagnostico && <p className="mt-2 rounded-xl bg-navy-850 p-2.5 text-xs text-tinta-200"><b>Tu diagnóstico:</b> {o.diagnostico}</p>}
      {o.reclamo && (
        <div className="mt-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">
          <p className="font-bold text-red-300">Reclamo del cliente</p>
          <p className="mt-1 text-tinta-200">{o.reclamo.descripcion}</p>
          {o.reclamo.archivos?.length > 0 && <div className="mt-2"><ArchivosMatch rutas={o.reclamo.archivos} tam="h-14 w-14" /></div>}
          {o.reclamo.respuesta_profesional ? (
            <p className="mt-2 text-xs text-tinta-300">Tu respuesta: {o.reclamo.respuesta_profesional}</p>
          ) : (
            <button type="button" className="chip mt-2 text-xs" onClick={() => setModo('reclamo')}>Responder</button>
          )}
          <p className="mt-1 text-[11px] text-tinta-400">TaListo! revisa el reclamo y decide. Mientras tanto el pago queda retenido.</p>
        </div>
      )}
      <Aviso texto={aviso.error || aviso.ok} error={!!aviso.error} />
      {modo ? (
        <div className="mt-3 space-y-2">
          <textarea
            className="campo min-h-[5rem] text-sm"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={modo === 'realizada' ? 2000 : 1000}
            placeholder={modo === 'realizada' ? 'Diagnóstico: qué encontraste y qué recomendás (lo ve el cliente)' : modo === 'cancelar' ? 'Motivo de la cancelación' : 'Tu respuesta al reclamo'}
          />
          {modo === 'cancelar' && (
            <p className="text-xs text-amber-200">
              Al cliente se le devuelve todo{Number(config.penalizacion) > 0 ? ` y se te descuenta una penalización de ${pesos(config.penalizacion)} en la próxima liquidación` : ''}.
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn btn-sec flex-1 py-2" onClick={() => setModo(null)}>Volver</button>
            <button
              type="button"
              className={`btn flex-1 py-2 ${modo === 'cancelar' ? 'btn-sec text-red-300' : 'btn-menta'}`}
              disabled={ocupado || (modo !== 'realizada' && !texto.trim())}
              onClick={() =>
                modo === 'realizada'
                  ? hacer('visita_realizada', { p_op: o.id, p_diagnostico: texto }, 'Listo. Le pedimos al cliente que confirme la visita.')
                  : modo === 'cancelar'
                    ? hacer('cancelar_visita', { p_op: o.id, p_motivo: texto }, 'Visita cancelada. Avisamos al cliente.')
                    : hacer('responder_reclamo', { p_id: o.reclamo.id, p_texto: texto }, 'Respuesta enviada.')
              }
            >
              {modo === 'realizada' ? 'Marcar como hecha' : modo === 'cancelar' ? 'Cancelar la visita' : 'Enviar'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {o.estado === 'reserva_confirmada' && (
            <>
              <button type="button" className="btn btn-menta flex-1 py-2" disabled={!llego} onClick={() => setModo('realizada')} title={llego ? '' : 'Se habilita una hora antes de la visita'}>
                Visita realizada
              </button>
              <button type="button" className="btn btn-sec py-2 text-red-300" onClick={() => setModo('cancelar')}>Cancelar</button>
            </>
          )}
          {['pendiente_confirmacion', 'pendiente_liquidacion'].includes(o.estado) && s.estado === 'en_curso' && !o.externa && (
            <BotonExterna solicitud={s.id} onHecho={onCambio} />
          )}
        </div>
      )}
    </article>
  );
}

// "El cliente sigue por fuera de TaListo!": queda registrado, sin comisión ni garantía
function BotonExterna({ solicitud, onHecho }) {
  const [seguro, setSeguro] = useState(false);
  const [error, setError] = useState('');
  async function marcar() {
    const { error: err } = await supabase.rpc('marcar_externa', { p_solicitud: solicitud });
    if (err) return setError(mensajeError(err));
    onHecho();
  }
  if (!seguro) {
    return (
      <button type="button" className="chip text-xs" onClick={() => setSeguro(true)}>
        El cliente sigue por fuera de TaListo!
      </button>
    );
  }
  return (
    <div className="w-full rounded-xl bg-navy-850 p-3 text-xs text-tinta-300">
      <p>
        El trabajo se arregla directo con el cliente: TaListo! no cobra comisión, no administra el presupuesto ni el pago y <b>no hay garantía TaListo!</b>. Solo queda registrada la visita.
      </p>
      {error && <p className="mt-1 text-red-300">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn btn-sec flex-1 py-1.5 text-xs" onClick={() => setSeguro(false)}>Volver</button>
        <button type="button" className="btn btn-menta flex-1 py-1.5 text-xs" onClick={marcar}>Confirmar</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- cobros
function Cobros({ datos, esDueno, onIrPerfil }) {
  const c = datos.cobros;
  const cfg = datos.config;
  return (
    <>
      <section className="grid grid-cols-2 gap-2 pc:grid-cols-4">
        <Cifra titulo="Para liquidar" valor={pesos(c.pendiente)} pie={`se transfiere a los ${cfg.liquidacion_dias} días`} bueno />
        <Cifra titulo="Retenido" valor={pesos(c.retenido)} pie="visitas sin confirmar" />
        <Cifra titulo="Cobrado por Match" valor={pesos(c.cobrado)} pie="transferido a tu cuenta" />
        <Cifra titulo="Descontado por TaListo!" valor={pesos(Number(c.retenciones) + Number(c.costo_mp))} pie={`${pesos(c.retenciones)} retención · ${pesos(c.costo_mp)} Mercado Pago`} />
      </section>
      {Number(c.penalizaciones) > 0 && (
        <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">Penalizaciones a descontar en la próxima liquidación: {pesos(c.penalizaciones)}.</p>
      )}
      {!datos.perfil.tiene_cobro && (
        <button type="button" onClick={onIrPerfil} className="w-full rounded-xl bg-amber-400/10 p-3 text-left text-sm text-amber-100">
          {esDueno ? 'Cargá tu cuenta bancaria para que TaListo! te transfiera lo cobrado. Tocá acá.' : 'La cuenta principal todavía no cargó la cuenta bancaria para las transferencias.'}
        </button>
      )}
      <section className="tarjeta p-4 text-sm">
        <h2 className="titulo-seccion">Cómo se reparte cada visita</h2>
        <ul className="mt-2 space-y-1 text-tinta-300">
          <li className="flex justify-between"><span>El cliente paga</span><b className="text-tinta-100">{pesos(cfg.precio_visita)}</b></li>
          {Number(cfg.ret_profesional) > 0 ? (
            <li className="flex justify-between"><span>Retención TaListo! al profesional</span><b>− {pesos(cfg.ret_profesional)}</b></li>
          ) : (
            <li className="flex justify-between"><span>Tarifa de TaListo! (la paga el cliente)</span><b>{pesos(Number(cfg.precio_visita) - Number(cfg.neto_visita))}</b></li>
          )}
          <li className="flex justify-between"><span>Te queda</span><b className="text-menta-300">{pesos(cfg.neto_visita)}</b></li>
          {cfg.precio_urgencia !== undefined && (
            <li className="flex justify-between border-t border-navy-800 pt-1.5">
              <span>Urgencia o fuera de horario: el cliente paga {pesos(cfg.precio_urgencia)}{Number(cfg.ret_urgencia) > 0 ? `, retención − ${pesos(cfg.ret_urgencia)}` : ''}</span>
              <b className="shrink-0 pl-2 text-menta-300">{pesos(cfg.neto_urgencia)}</b>
            </li>
          )}
          {Number(cfg.mp_costo_profesional_pct) > 0 && (
            <li className="text-xs text-tinta-400">De lo que cobra Mercado Pago por el pago, el {Number(cfg.mp_costo_profesional_pct).toLocaleString('es-UY')} % se descuenta de tu parte y el resto lo pone TaListo!.</li>
          )}
        </ul>
      </section>
      <section>
        <h2 className="titulo-seccion mb-2">Operaciones</h2>
        {(datos.historial || []).length === 0 ? (
          <p className="tarjeta p-4 text-sm text-tinta-400">Todavía no hay operaciones cerradas.</p>
        ) : (
          <ul className="divide-y divide-navy-800 rounded-2xl border border-navy-800 bg-navy-900">
            {datos.historial.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm">
                <span className="min-w-0">
                  <b className="block truncate">{o.solicitud.titulo}</b>
                  <span className="text-xs text-tinta-400">
                    Nº {o.numero} · {fecha(o.creado_en)}
                    {o.externa ? ' · siguió por fuera' : ''}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <b className="block tabular-nums">{o.liquidacion_monto !== null && o.liquidacion_monto !== undefined ? pesos(o.liquidacion_monto) : '—'}</b>
                  <Estado valor={o.estado} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {c.liquidaciones?.length > 0 && (
        <section>
          <h2 className="titulo-seccion mb-2">Transferencias de TaListo!</h2>
          <ul className="divide-y divide-navy-800 rounded-2xl border border-navy-800 bg-navy-900">
            {c.liquidaciones.map((l) => (
              <li key={l.numero} className="flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm">
                <span>
                  <b>Liquidación Nº {l.numero}</b>
                  <span className="block text-xs text-tinta-400">{fecha(l.fecha)} · {l.operaciones} {l.operaciones === 1 ? 'operación' : 'operaciones'} · ref. {l.referencia}</span>
                </span>
                <b className="shrink-0 whitespace-nowrap text-menta-300 tabular-nums">{pesos(l.monto)}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Cifra({ titulo, valor, pie, bueno }) {
  return (
    <div className="tarjeta p-3">
      <p className="text-[11px] font-semibold text-tinta-400">{titulo}</p>
      <p className={`mt-0.5 text-xl font-extrabold tabular-nums ${bueno ? 'text-menta-300' : ''}`}>{valor}</p>
      {pie && <p className="text-[11px] text-tinta-500">{pie}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- calificaciones
function Calificaciones({ datos, onCambio }) {
  const cal = datos.perfil.calificacion;
  const lista = datos.calificaciones || [];
  return (
    <>
      <ResumenCalificacion
        cal={cal}
        nota={`${cal?.cantidad || 0} calificaciones verificadas (solo califica quien pagó por TaListo!). Al dar el visto bueno el cliente califica de 0 a 10 tu puntualidad, velocidad y desempeño; tu puntaje es el promedio de las últimas 10, así un mal día se supera rápido.`}
      />
      {lista.map((k) => (
        <Calificacion key={k.id} k={k} onCambio={onCambio} />
      ))}
    </>
  );
}

function Calificacion({ k, onCambio }) {
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  async function responder() {
    const { error } = await supabase.rpc('responder_calificacion', { p_id: k.id, p_texto: texto });
    if (!error) {
      setAbierto(false);
      onCambio();
    }
  }
  return (
    <article className="tarjeta p-3.5 text-sm">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Estrellas valor={k.estrellas ?? k.puntaje} tam="h-3.5 w-3.5" />
          {k.nota !== null && k.nota !== undefined && <b className="text-xs text-tinta-200">{notaTexto(k.nota)}/10</b>}
        </span>
        <span className="text-[11px] text-tinta-500">{k.tipo === 'trabajo' ? 'Trabajo' : 'Visita técnica'} · {fecha(k.fecha)}</span>
      </div>
      <div className="mt-1">
        <DetallePuntos k={k} chico />
      </div>
      {k.comentario && <p className="mt-1.5 text-tinta-200">{k.comentario}</p>}
      {k.respuesta ? (
        <p className="mt-2 rounded-lg bg-navy-850 p-2 text-xs text-tinta-300"><b>Tu respuesta:</b> {k.respuesta}</p>
      ) : abierto ? (
        <div className="mt-2 flex gap-2">
          <input className="campo min-w-0 flex-1 px-3 py-2 text-sm" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={500} placeholder="Respuesta pública" />
          <button type="button" className="btn btn-menta px-3 py-2 text-sm" disabled={!texto.trim()} onClick={responder}>Enviar</button>
        </div>
      ) : (
        <button type="button" className="chip mt-2 text-xs" onClick={() => setAbierto(true)}>Responder</button>
      )}
    </article>
  );
}

// ---------------------------------------------------------------- perfil
function PerfilMatch({ cuenta, perfil, config, esDueno, onGuardado }) {
  const [rubros, setRubros] = useState([]);
  const [f, setF] = useState(() => ({
    disponible: !!perfil.disponible,
    rubros: perfil.rubros || [],
    urgencias: !!perfil.urgencias,
    departamentos: perfil.departamentos || [],
    barrios: (perfil.barrios || []).join(', '),
    cobro: perfil.cobro
      ? { ...perfil.cobro, metodo: perfil.cobro.metodo || 'banco', banco: perfil.cobro.metodo === 'abitab' ? '' : perfil.cobro.banco || '', numero: perfil.cobro.numero || '' }
      : { metodo: 'banco', banco: '', tipo_cuenta: 'caja_ahorro', numero: '', sucursal: '', titular: '', documento: '' },
  }));
  const [aviso, setAviso] = useState({});
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    supabase.from('categorias').select('id, nombre').eq('activa', true).order('orden').then(({ data }) => setRubros(data || []));
  }, []);

  const alternar = (campo, v) => setF((x) => ({ ...x, [campo]: x[campo].includes(v) ? x[campo].filter((y) => y !== v) : [...x[campo], v] }));

  async function guardar() {
    setOcupado(true);
    const cobroCargado = esDueno && (f.cobro.banco || f.cobro.numero || f.cobro.titular || f.cobro.documento);
    const { error } = await supabase.rpc('guardar_match_perfil', {
      p_cuenta: cuenta,
      p: {
        disponible: f.disponible,
        rubros: f.rubros,
        urgencias: f.urgencias,
        departamentos: f.departamentos,
        barrios: f.barrios.split(',').map((b) => b.trim()).filter(Boolean),
        ...(cobroCargado ? { cobro: f.cobro } : {}),
      },
    });
    setOcupado(false);
    if (error) return setAviso({ error: mensajeError(error) });
    setAviso({ ok: f.disponible ? 'Guardado. Ya podés recibir solicitudes.' : 'Guardado. Match queda en pausa.' });
    onGuardado();
  }

  return (
    <div className="space-y-4 pc:grid pc:grid-cols-2 pc:items-start pc:gap-4 pc:space-y-0">
      <section className="tarjeta space-y-4 p-4">
        <label className="flex items-center justify-between gap-3">
          <span>
            <b className="block">Recibir solicitudes</b>
            <span className="text-xs text-tinta-400">Pausalo cuando no tengas lugar en la agenda.</span>
          </span>
          <input type="checkbox" className="h-6 w-6 accent-[#2fd6a3]" checked={f.disponible} onChange={(e) => setF({ ...f, disponible: e.target.checked })} />
        </label>
        <div>
          <p className="etiqueta">Rubros</p>
          <div className="flex flex-wrap gap-1.5">
            {rubros.map((r) => (
              <button key={r.id} type="button" onClick={() => alternar('rubros', r.id)} className={`chip text-xs ${f.rubros.includes(r.id) ? 'chip-activo' : ''}`}>{r.nombre}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="etiqueta">Departamentos donde trabajás</p>
          <div className="flex flex-wrap gap-1.5">
            {DEPARTAMENTOS.map((d) => (
              <button key={d} type="button" onClick={() => alternar('departamentos', d)} className={`chip text-xs ${f.departamentos.includes(d) ? 'chip-activo' : ''}`}>{d}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="etiqueta" htmlFor="m-barrios">Barrios o localidades (opcional, separados por coma)</label>
          <input id="m-barrios" className="campo" value={f.barrios} onChange={(e) => setF({ ...f, barrios: e.target.value })} placeholder="Vacío = todo el departamento" />
        </div>
        <label className="flex items-start gap-2 rounded-xl bg-navy-850 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#2fd6a3]" checked={f.urgencias} onChange={(e) => setF({ ...f, urgencias: e.target.checked })} />
          <span>
            <b>Atiendo urgencias y fuera de horario</b>
            {config.precio_urgencia !== undefined ? (
              <span className="block text-xs text-tinta-400">
                Te pueden reservar fuera del horario normal (entre las {config.urgencia_desde} y las {config.urgencia_hasta}), aunque no esté en tu horario de trabajo, y tomás los pedidos urgentes del mapa.
                Esas visitas se cobran {pesos(config.precio_urgencia)} y te quedan {pesos(config.neto_urgencia)}.
              </span>
            ) : (
              <span className="block text-xs text-tinta-400">Te damos prioridad en las solicitudes urgentes.</span>
            )}
          </span>
        </label>
        {!perfil.tiene_horario && (
          <p className="rounded-xl bg-amber-400/10 p-3 text-xs text-amber-100">
            Para que el cliente pueda elegir horario, cargá tu horario de trabajo en <Link href="/panel/perfil" className="font-bold underline">Perfil</Link>.
          </p>
        )}
        {config.solo_verificados && !perfil.verificado && (
          <p className="rounded-xl bg-amber-400/10 p-3 text-xs text-amber-100">Por ahora TaListo! solo envía solicitudes a cuentas verificadas. Te avisamos cuando te verifiquemos.</p>
        )}
      </section>

      <section className="tarjeta space-y-3 p-4">
        <h2 className="font-bold">Cómo cobrás</h2>
        {esDueno ? (
          <>
            <p className="text-xs text-tinta-400">TaListo! te paga lo cobrado por Match por transferencia o por giro de Abitab. Solo lo ven vos y el administrador.</p>
            <div className="flex gap-2">
              {[['banco', 'Cuenta bancaria'], ['abitab', 'Giro por Abitab']].map(([v, t]) => (
                <button key={v} type="button" onClick={() => setF({ ...f, cobro: { ...f.cobro, metodo: v } })} className={`chip flex-1 justify-center ${f.cobro.metodo === v ? 'chip-activo' : ''}`}>{t}</button>
              ))}
            </div>
            {f.cobro.metodo === 'abitab' ? (
              <div className="grid grid-cols-2 gap-2">
                <Campo etiqueta="Titular" valor={f.cobro.titular} onCambio={(v) => setF({ ...f, cobro: { ...f.cobro, titular: v } })} />
                <Campo etiqueta="Cédula del titular" valor={f.cobro.documento || ''} onCambio={(v) => setF({ ...f, cobro: { ...f.cobro, documento: v } })} />
                <p className="col-span-2 text-[11px] text-tinta-500">Retirás el giro en cualquier local de Abitab con tu cédula.</p>
              </div>
            ) : (
            <div className="grid grid-cols-2 gap-2">
              <Campo etiqueta="Banco" valor={f.cobro.banco} onCambio={(v) => setF({ ...f, cobro: { ...f.cobro, banco: v } })} />
              <label className="block">
                <span className="etiqueta">Tipo</span>
                <select className="campo" value={f.cobro.tipo_cuenta} onChange={(e) => setF({ ...f, cobro: { ...f.cobro, tipo_cuenta: e.target.value } })}>
                  <option value="caja_ahorro">Caja de ahorro</option>
                  <option value="cuenta_corriente">Cuenta corriente</option>
                  <option value="otra">Otra</option>
                </select>
              </label>
              <Campo etiqueta="Número de cuenta" valor={f.cobro.numero} onCambio={(v) => setF({ ...f, cobro: { ...f.cobro, numero: v } })} />
              <Campo etiqueta="Sucursal" valor={f.cobro.sucursal || ''} onCambio={(v) => setF({ ...f, cobro: { ...f.cobro, sucursal: v } })} />
              <Campo etiqueta="Titular" valor={f.cobro.titular} onCambio={(v) => setF({ ...f, cobro: { ...f.cobro, titular: v } })} />
              <Campo etiqueta="Cédula o RUT" valor={f.cobro.documento || ''} onCambio={(v) => setF({ ...f, cobro: { ...f.cobro, documento: v } })} />
            </div>
            )}
          </>
        ) : (
          <p className="text-sm text-tinta-300">{perfil.tiene_cobro ? 'Cargada por la cuenta principal.' : 'La carga la cuenta principal de la empresa.'}</p>
        )}
        <div className="rounded-xl bg-navy-850 p-3 text-xs text-tinta-300">
          <p>Visita técnica: el cliente paga {pesos(config.precio_visita)} y te quedan {pesos(config.neto_visita)}.</p>
          {config.precio_urgencia !== undefined && (
            <p className="mt-1">Urgencia o fuera de horario: el cliente paga {pesos(config.precio_urgencia)} y te quedan {pesos(config.neto_urgencia)}.</p>
          )}
          <p className="mt-1">Los precios y comisiones los fija TaListo!; no se pueden cambiar desde la cuenta.</p>
        </div>
      </section>

      <div className="space-y-2 pc:col-span-2">
        <Aviso texto={aviso.error || aviso.ok} error={!!aviso.error} />
        <button type="button" className="btn btn-menta w-full py-3" disabled={ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </div>
  );
}

function Campo({ etiqueta, valor, onCambio }) {
  return (
    <label className="block">
      <span className="etiqueta">{etiqueta}</span>
      <input className="campo" value={valor} onChange={(e) => onCambio(e.target.value)} />
    </label>
  );
}

