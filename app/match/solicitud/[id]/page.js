'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import ArchivosMatch from '@/components/ArchivosMatch';
import ComoFunciona from '@/components/ComoFuncionaMatch';
import TarjetaProfesional from '@/components/TarjetaProfesional';
import MarcoCliente, { useSesionCliente } from '@/components/MarcoCliente';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/util';
import {
  ESTADO_SOLICITUD, Estado, Estrellas, MENSAJE_FALTA_SQL, diaLargo, fecha, fechaHora, hora, irAPagar, pesos, sinMatch,
  subirArchivos,
  mayus, cuandoTexto,
} from '@/lib/match';

export default function SolicitudPagina() {
  return (
    <Suspense fallback={<div className="grid min-h-dvh place-items-center text-tinta-400">Cargando…</div>}>
      <Solicitud />
    </Suspense>
  );
}

function Solicitud() {
  const { id } = useParams();
  const router = useRouter();
  const params = useSearchParams();
  const { cargando } = useSesionCliente();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [eligiendo, setEligiendo] = useState(null);
  const [modal, setModal] = useState(null); // { tipo: 'cancelar'|'reclamar'|'externa', op }
  const [ocupado, setOcupado] = useState(false);
  const [cotizPrimero, setCotizPrimero] = useState(null);
  const pago = params.get('pago');

  const cargar = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('solicitud_cliente', { p_id: id });
    if (err) return setError(sinMatch(err) ? MENSAJE_FALTA_SQL : mensajeError(err));
    setError('');
    setD(data);
    return data;
  }, [id]);

  useEffect(() => {
    if (!cargando) cargar();
  }, [cargando, cargar]);

  // "El primero disponible" todavía sin pagar: el precio depende de la hora (fuera de horario es urgencia)
  const sp = d?.solicitud;
  const sinPagarPrimero = sp?.modo === 'primero' && sp.estado === 'abierta' && !sp.publicada_en;
  useEffect(() => {
    if (!sinPagarPrimero) return;
    supabase
      .rpc('cotizar_primero', { p_cuando: sp.cuando, p_fecha: sp.fecha, p_franja: sp.franja, p_urgente: !!sp.urgente })
      .then(({ data }) => setCotizPrimero(data || null));
  }, [sinPagarPrimero, sp?.cuando, sp?.fecha, sp?.franja, sp?.urgente]);

  // "El primero disponible" sin pagar: mientras nadie lo toma se refresca para mostrar las cotizaciones que llegan
  const esperandoTecnico = sp?.pago === 'al_tomar' && sp.estado === 'abierta' && !sp.tomada;
  useEffect(() => {
    if (!esperandoTecnico) return undefined;
    const t = setInterval(cargar, 30000);
    return () => clearInterval(t);
  }, [esperandoTecnico, cargar]);

  // Volviendo de Mercado Pago: el pago se confirma con el aviso de Mercado Pago (puede tardar unos segundos)
  useEffect(() => {
    if (cargando || pago !== 'ok') return undefined;
    setAviso('Estamos confirmando tu pago con Mercado Pago…');
    let n = 0;
    const t = setInterval(async () => {
      n += 1;
      const x = await cargar();
      const pagada = (x?.operaciones || []).some((o) => o.estado_pago === 'pagado');
      if (pagada || n > 15) {
        clearInterval(t);
        setAviso(pagada ? '¡Listo! Pago confirmado y visita reservada.' : 'Mercado Pago todavía no nos confirmó el pago. Te avisamos apenas llegue.');
        router.replace(`/match/solicitud/${id}`, { scroll: false });
      }
    }, 3000);
    return () => clearInterval(t);
  }, [cargando, pago, cargar, id, router]);

  async function rpc(nombre, args, ok) {
    setOcupado(true);
    setError('');
    const { data, error: err } = await supabase.rpc(nombre, args);
    setOcupado(false);
    if (err) {
      setError(mensajeError(err));
      return null;
    }
    if (ok) setAviso(typeof ok === 'function' ? ok(data) : ok);
    setModal(null);
    await cargar();
    return data ?? true;
  }

  async function pagar(op) {
    setOcupado(true);
    setError('');
    try {
      await irAPagar(op);
    } catch (e) {
      setOcupado(false);
      setError(e.message);
    }
  }

  if (cargando || (!d && !error)) return <div className="grid min-h-dvh place-items-center text-tinta-400">Cargando…</div>;
  if (!d) return <MarcoCliente titulo="Solicitud" volver="/inicio"><p className="mt-6 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p></MarcoCliente>;

  const s = d.solicitud;
  const ops = d.operaciones || [];
  const visita = ops.find((o) => o.tipo === 'visita' && o.estado !== 'cancelado') || ops.find((o) => o.tipo === 'visita');
  const aPagar = ops.find((o) => o.estado === 'pendiente_pago' && new Date(o.vence_pago_en) > new Date());
  const primero = s.modo === 'primero';
  const alTomar = primero && s.pago === 'al_tomar'; // se paga cuando un técnico lo toma o al aceptar una cotización
  const buscando = primero && (visita?.estado === 'buscando_tecnico' || (alTomar && s.estado === 'abierta' && !s.tomada && !aPagar));
  const pagado = buscando && !alTomar;
  const cotizaciones = alTomar && buscando ? d.cotizaciones || [] : [];

  async function aceptarCotizacion(k) {
    setOcupado(true);
    setError('');
    const { data, error: err } = await supabase.rpc('aceptar_cotizacion', { p_cotizacion: k.id });
    if (err) {
      setOcupado(false);
      setError(mensajeError(err));
      return cargar();
    }
    await pagar(data.operacion);
  }
  const sinPagar = primero && s.estado === 'abierta' && !s.publicada_en && !aPagar;

  async function pagarPrimero() {
    setOcupado(true);
    setError('');
    const { data, error: err } = await supabase.rpc('pagar_primero', { p_solicitud: s.id });
    if (err) {
      setOcupado(false);
      return setError(mensajeError(err));
    }
    await pagar(data.operacion);
  }

  return (
    <MarcoCliente titulo={s.titulo} volver="/inicio">
      <div className="space-y-4 pt-4 md:grid md:grid-cols-[1fr_20rem] md:gap-5 md:space-y-0">
        <div className="space-y-4">
          {aviso && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-200">{aviso}</p>}
          {params.get('nueva') !== null && s.estado === 'abierta' && !primero && (
            <p className="rounded-xl bg-[#0a84ff]/10 p-3 text-sm text-[#cfe6ff]">
              {Number(params.get('nueva')) > 0
                ? `Listo: se la mandamos a ${params.get('nueva')} ${Number(params.get('nueva')) === 1 ? 'profesional' : 'profesionales'} de tu zona. Te avisamos cuando acepten.`
                : 'Por ahora no hay profesionales disponibles para ese rubro en tu zona. Quedó publicada y te avisamos si aparece alguno.'}
            </p>
          )}
          {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

          {aPagar && (
            <section className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
              <p className="font-bold">Falta pagar la visita</p>
              {primero && !alTomar ? (
                <p className="mt-1 text-sm text-tinta-200">
                  El primero disponible · {cuandoTexto(s)}. Cuando pagues, tu pedido aparece en el mapa de los técnicos del rubro.
                </p>
              ) : (
                <p className="mt-1 text-sm text-tinta-200">
                  {aPagar.profesional?.nombre} · {aPagar.turno ? `${diaLargo(aPagar.turno.inicio)}, ${hora(aPagar.turno.inicio)}` : ''}. Guardamos el horario
                  hasta las {hora(aPagar.vence_pago_en)}.
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button className="btn btn-menta flex-1" disabled={ocupado} onClick={() => pagar(aPagar.id)}>
                  Pagar {pesos(aPagar.importe)} con Mercado Pago
                </button>
                {!primero && (
                  <button className="btn btn-sec" disabled={ocupado} onClick={() => rpc('cancelar_visita', { p_op: aPagar.id, p_motivo: 'Elijo otro horario' }, 'Horario liberado.')}>
                    Cambiar
                  </button>
                )}
              </div>
            </section>
          )}

          {sinPagar && (
            <section className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
              <p className="font-bold">Falta pagar para publicar tu pedido</p>
              <p className="mt-1 text-sm text-tinta-200">El primero disponible · {cuandoTexto(s)}.</p>
              <button className="btn btn-menta mt-3 w-full" disabled={ocupado} onClick={pagarPrimero}>
                Pagar {cotizPrimero?.importe ? `${pesos(cotizPrimero.importe)} ` : ''}con Mercado Pago
              </button>
              {cotizPrimero?.urgencia && <p className="mt-2 text-xs text-[#ffc2a8]">Se cobra como urgencia (marcado urgente o fuera del horario normal).</p>}
            </section>
          )}

          {buscando && (
            <section className="tarjeta space-y-2 border-[#0a84ff]/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold">{alTomar ? 'Buscando técnico' : 'Esperando que un técnico lo tome'}</h2>
                <Estado valor="buscando_tecnico" />
              </div>
              <p className="text-sm text-tinta-200">
                Tu pedido está en el mapa de los técnicos de {s.rubro}. El primero que lo tome te visita <b>{cuandoTexto(s).toLowerCase()}</b> y te avisamos a qué hora llega.
              </p>
              {alTomar ? (
                <p className="text-xs text-tinta-400">
                  Todavía no pagaste nada. Si lo toman al precio base pagás {pesos(s.precio_base)}; si la visita sale más cara, el técnico te manda su
                  cotización y vos decidís. Si nadie lo toma antes de las {hora(s.limite_toma)} del {fecha(s.limite_toma)}, se cancela solo.
                </p>
              ) : (
                <p className="text-xs text-tinta-400">
                  Pagaste {pesos(visita.importe)}{visita.pagado_en ? ` el ${fechaHora(visita.pagado_en)}` : ''}. Si nadie lo toma antes de las{' '}
                  {hora(s.limite_toma)} del {fecha(s.limite_toma)}, te devolvemos todo.
                </p>
              )}
            </section>
          )}

          {cotizaciones.length > 0 && (
            <section>
              <h2 className="titulo-seccion mb-2">{cotizaciones.length === 1 ? 'Te mandaron una cotización' : `Te mandaron ${cotizaciones.length} cotizaciones`}</h2>
              <ul className="space-y-2">
                {cotizaciones.map((k) => (
                  <li key={k.id} className="tarjeta p-4">
                    <TarjetaProfesional p={k.profesional} />
                    {k.mensaje && <p className="mt-2 rounded-xl bg-navy-850 p-2.5 text-sm text-tinta-200">“{k.mensaje}”</p>}
                    <p className="mt-2 text-sm text-tinta-300">
                      Llega el <b className="text-tinta-100">{diaLargo(k.inicio)}, {hora(k.inicio)}</b>
                      {k.urgencia && <span className="ml-1.5 rounded-full bg-[#ff8a5c]/15 px-2 py-0.5 text-[11px] font-semibold text-[#ffc2a8]">Urgencia</span>}
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-sm text-tinta-300">
                        Visita <b className="text-tinta-100">{pesos(k.importe)}</b> <span className="text-xs text-tinta-400">(incluye TaListo!)</span>
                      </span>
                      <button className="btn btn-menta px-4 py-2 text-sm" disabled={ocupado} onClick={() => aceptarCotizacion(k)}>
                        Aceptar y pagar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-tinta-400">Si preferís esperar, otro técnico puede tomarlo al precio base ({pesos(s.precio_base)}).</p>
            </section>
          )}

          {visita && !['pendiente_pago', 'buscando_tecnico'].includes(visita.estado) && <TarjetaVisita op={visita} config={d.config} ocupado={ocupado} rpc={rpc} setModal={setModal} />}

          {s.estado === 'abierta' && !aPagar && !primero && (
            <section>
              <h2 className="titulo-seccion mb-2">
                {d.propuestas.length ? 'Profesionales que pueden ir' : 'Esperando respuestas'}
              </h2>
              {d.propuestas.length === 0 ? (
                <p className="tarjeta p-4 text-sm text-tinta-300">
                  {s.sin_profesionales
                    ? 'No encontramos profesionales disponibles para este rubro en tu zona. Te avisamos si aparece alguno.'
                    : `Le mandamos tu solicitud a ${d.invitados} ${d.invitados === 1 ? 'profesional' : 'profesionales'}. Te avisamos cuando respondan.`}
                </p>
              ) : (
                <ul className="space-y-2">
                  {d.propuestas.map((p) => (
                    <li key={p.invitacion} className="tarjeta p-4">
                      <TarjetaProfesional p={p.profesional} />
                      {p.mensaje && <p className="mt-2 rounded-xl bg-navy-850 p-2.5 text-sm text-tinta-200">“{p.mensaje}”</p>}
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="text-sm text-tinta-300">
                          Visita técnica <b className="text-tinta-100">{pesos(p.precio_visita)}</b>
                        </span>
                        <button className="btn btn-menta px-4 py-2 text-sm" onClick={() => setEligiendo(p)}>
                          Elegir horario
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {d.esperando > 0 && d.propuestas.length > 0 && (
                <p className="mt-2 text-xs text-tinta-400">
                  {d.esperando} {d.esperando === 1 ? 'profesional todavía no respondió' : 'profesionales todavía no respondieron'}.
                </p>
              )}
            </section>
          )}

          <section className="tarjeta space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Estado valor={s.estado} tabla={ESTADO_SOLICITUD} />
              <span className="text-xs text-tinta-400">
                Solicitud Nº {s.numero} · {s.rubro} · {fecha(s.creado_en)}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-tinta-200">{s.descripcion}</p>
            <ArchivosMatch rutas={s.archivos} />
            <p className="text-xs text-tinta-400">
              <Icon name="pin" className="mr-1 inline h-3.5 w-3.5" />
              {[s.direccion, s.localidad, s.departamento].filter(Boolean).join(', ')}
              {s.referencia ? ` · ${s.referencia}` : ''}
            </p>
            {primero && <p className="text-xs font-semibold text-menta-300">El primero disponible · {cuandoTexto(s)}</p>}
            {s.estado === 'abierta' && !aPagar && (
              <button
                className="text-xs font-semibold text-tinta-400 underline"
                disabled={ocupado}
                onClick={() =>
                  window.confirm(pagado ? '¿Cancelar el pedido? Te devolvemos todo lo que pagaste.' : buscando ? '¿Cancelar el pedido?' : '¿Cancelar la solicitud?') &&
                  rpc('cancelar_solicitud', { p_id: s.id }, pagado ? 'Pedido cancelado. Te devolvemos el pago por Mercado Pago.' : buscando ? 'Pedido cancelado.' : 'Solicitud cancelada.')
                }
              >
                {buscando ? 'Cancelar el pedido' : 'Cancelar solicitud'}
              </button>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <ComoFunciona config={d.config} compacto />
          <p className="rounded-xl bg-navy-850 p-3 text-xs text-tinta-300">
            {visita?.externa || s.modalidad === 'externa'
              ? 'Esta contratación es externa: TaListo! no administra el presupuesto ni el pago y no hay garantía TaListo!.'
              : 'La visita técnica está gestionada por TaListo!: el pago queda retenido hasta que confirmás que se hizo.'}
          </p>
        </aside>
      </div>

      {eligiendo && <ElegirHorario propuesta={eligiendo} config={d.config} onCerrar={() => setEligiendo(null)} onListo={cargar} />}
      {modal && <ModalAccion modal={modal} solicitudId={s.id} config={d.config} ocupado={ocupado} rpc={rpc} onCerrar={() => setModal(null)} setError={setError} />}
    </MarcoCliente>
  );
}

function TarjetaVisita({ op, config, ocupado, rpc, setModal }) {
  const [puntaje, setPuntaje] = useState(0);
  const [comentario, setComentario] = useState('');
  const t = op.turno;
  const empezo = t && new Date(t.inicio) <= new Date();
  return (
    <section className="tarjeta space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">Visita técnica</h2>
        <Estado valor={op.estado} />
      </div>
      <TarjetaProfesional p={op.profesional} />
      {t && (
        <p className="rounded-xl bg-navy-850 p-3 text-sm">
          <Icon name="agenda" className="mr-1.5 inline h-4 w-4 text-menta-300" />
          <b>{mayus(diaLargo(t.inicio))}</b> de {hora(t.inicio)} a {hora(t.fin)}
        </p>
      )}
      <p className="text-xs text-tinta-400">
        Pagaste {pesos(op.importe)} por Mercado Pago{op.pagado_en ? ` el ${fechaHora(op.pagado_en)}` : ''} · operación Nº {op.numero}
        {op.reintegrado > 0 ? ` · te devolvimos ${pesos(op.reintegrado)}` : ''}
      </p>
      {op.devoluciones?.some((x) => ['pendiente', 'aprobada'].includes(x.estado)) && (
        <p className="rounded-xl bg-amber-400/10 p-2.5 text-xs text-amber-100">Tenés una devolución en proceso. Te avisamos cuando se acredite.</p>
      )}
      {op.diagnostico && (
        <div className="rounded-xl bg-navy-850 p-3 text-sm">
          <b className="block text-xs text-tinta-400">Diagnóstico del profesional</b>
          <p className="whitespace-pre-wrap text-tinta-200">{op.diagnostico}</p>
        </div>
      )}
      {op.estado === 'pendiente_confirmacion' && op.confirmar_hasta && (
        <p className="text-xs text-amber-200">Si no la confirmás ni reclamás, se confirma sola el {fechaHora(op.confirmar_hasta)}.</p>
      )}
      {op.reclamo && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm">
          <b className="block">Reclamo {op.reclamo.estado === 'abierto' ? 'en revisión' : op.reclamo.estado}</b>
          <p className="text-tinta-300">{op.reclamo.descripcion}</p>
          {op.reclamo.respuesta_profesional && <p className="mt-1 text-xs text-tinta-400">Respuesta del profesional: {op.reclamo.respuesta_profesional}</p>}
          {op.reclamo.resolucion && <p className="mt-1 text-xs text-menta-200">Resolución de TaListo!: {op.reclamo.resolucion}</p>}
        </div>
      )}

      {op.estado === 'reserva_confirmada' && (
        <div className="flex flex-wrap gap-2">
          {empezo && (
            <button className="btn btn-menta flex-1" disabled={ocupado} onClick={() => rpc('confirmar_visita', { p_op: op.id }, 'Gracias: confirmaste la visita.')}>
              Ya vino: confirmar
            </button>
          )}
          {!empezo && (
            <button className="btn btn-sec flex-1" disabled={ocupado} onClick={() => setModal({ tipo: 'cancelar', op })}>
              Cancelar visita
            </button>
          )}
          {empezo && (
            <button className="btn btn-sec" disabled={ocupado} onClick={() => setModal({ tipo: 'reclamar', op })}>
              No vino / reclamar
            </button>
          )}
        </div>
      )}
      {op.estado === 'pendiente_confirmacion' && !op.calificacion && (
        <div className="space-y-2 rounded-xl bg-navy-850 p-3">
          <b className="block text-sm">¿Cómo fue la visita?</b>
          <Estrellas valor={puntaje} tam="h-7 w-7" onElegir={setPuntaje} />
          <textarea className="campo min-h-20 text-sm" value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={600} placeholder="Contá cómo te atendió (opcional)" />
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-menta flex-1" disabled={ocupado || !puntaje} onClick={() => rpc('calificar', { p_op: op.id, p_puntaje: puntaje, p_comentario: comentario }, '¡Gracias por calificar!')}>
              Confirmar y calificar
            </button>
            <button className="btn btn-sec" disabled={ocupado} onClick={() => rpc('confirmar_visita', { p_op: op.id }, 'Visita confirmada.')}>
              Solo confirmar
            </button>
            <button className="btn btn-sec" disabled={ocupado} onClick={() => setModal({ tipo: 'reclamar', op })}>
              Reclamar
            </button>
          </div>
        </div>
      )}
      {['pendiente_liquidacion', 'liquidado'].includes(op.estado) && !op.calificacion && op.reclamo?.estado !== 'abierto' && (
        <div className="space-y-2 rounded-xl bg-navy-850 p-3">
          <b className="block text-sm">Calificá la visita</b>
          <Estrellas valor={puntaje} tam="h-7 w-7" onElegir={setPuntaje} />
          <textarea className="campo min-h-20 text-sm" value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={600} placeholder="Opcional" />
          <button className="btn btn-menta w-full" disabled={ocupado || !puntaje} onClick={() => rpc('calificar', { p_op: op.id, p_puntaje: puntaje, p_comentario: comentario }, '¡Gracias por calificar!')}>
            Calificar
          </button>
        </div>
      )}
      {op.calificacion && (
        <p className="flex items-center gap-2 text-sm text-tinta-300">
          Tu calificación: <Estrellas valor={op.calificacion.puntaje} />
          {op.calificacion.respuesta ? <span className="text-xs text-tinta-400">· respondió: {op.calificacion.respuesta}</span> : null}
        </p>
      )}
      {['pendiente_confirmacion', 'pendiente_liquidacion', 'liquidado'].includes(op.estado) && !op.externa && (
        <div className="rounded-xl border border-navy-700 p-3 text-sm">
          <b className="block">¿Cómo seguís con el trabajo?</b>
          <p className="mt-1 text-xs text-tinta-400">
            Muy pronto vas a poder contratar el trabajo con garantía TaListo! ({config?.garantia_dias ?? 90} días) directamente desde acá.
          </p>
          <button className="mt-2 text-xs font-semibold text-tinta-300 underline" onClick={() => setModal({ tipo: 'externa', op })}>
            Lo arreglé directamente con el profesional
          </button>
        </div>
      )}
      {op.externa && (
        <p className="rounded-xl bg-navy-850 p-3 text-xs text-tinta-300">
          Seguiste por fuera de TaListo!: el trabajo no tiene comisión ni garantía TaListo!. Queda registrada la visita técnica.
        </p>
      )}
    </section>
  );
}

function ElegirHorario({ propuesta, config, onCerrar, onListo }) {
  const [horas, setHoras] = useState(null);
  const [desde, setDesde] = useState(null);
  const [elegida, setElegida] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const args = { p_invitacion: propuesta.invitacion, p_desde: desde, p_dias: 7 };
      // con precio por horario (SQL 21); si no está, la lista de antes al precio de la propuesta
      let { data, error: e } = await supabase.rpc('horarios_visita_precios', args);
      if (e && sinMatch(e)) {
        ({ data, error: e } = await supabase.rpc('horarios_visita', args));
        data = (data || []).map((h) => ({ desde: h, urgencia: false, importe: propuesta.precio_visita }));
      }
      if (e) setError(mensajeError(e));
      setHoras(data || []);
    })();
  }, [propuesta.invitacion, propuesta.precio_visita, desde]);

  const porDia = (horas || []).reduce((m, h) => {
    const k = fecha(h.desde);
    (m[k] = m[k] || []).push(h);
    return m;
  }, {});
  const hayUrgencias = (horas || []).some((h) => h.urgencia);
  const urgenciaPrecio = (horas || []).find((h) => h.urgencia)?.importe;
  const todasUrgencia = hayUrgencias && (horas || []).every((h) => h.urgencia);

  async function reservar() {
    setOcupado(true);
    setError('');
    const { data, error: e } = await supabase.rpc('elegir_profesional', { p_invitacion: propuesta.invitacion, p_inicio: elegida.desde });
    if (e) {
      setOcupado(false);
      setError(mensajeError(e));
      return;
    }
    try {
      await irAPagar(data.operacion);
    } catch (err) {
      setOcupado(false);
      setError(err.message);
      onListo();
    }
  }

  const siguiente = () => {
    const ultimo = horas?.length ? new Date(horas[horas.length - 1].desde) : new Date();
    setDesde(new Date(ultimo.getTime() + 864e5).toISOString().slice(0, 10));
    setHoras(null);
  };

  return (
    <Modal abierto onCerrar={onCerrar} titulo="Elegí el horario de la visita">
      <div className="space-y-3">
        <TarjetaProfesional p={propuesta.profesional} />
        {horas === null && <p className="py-6 text-center text-sm text-tinta-400">Buscando horarios libres…</p>}
        {horas?.length === 0 && <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-300">No tiene horarios libres esos días. Probá la semana siguiente.</p>}
        {Object.entries(porDia).map(([dia, lista]) => (
          <div key={dia}>
            <p className="mb-1 text-xs font-bold text-tinta-300">{mayus(diaLargo(lista[0].desde))}</p>
            <div className="flex flex-wrap gap-1.5">
              {lista.map((h) => (
                <button
                  key={h.desde}
                  type="button"
                  onClick={() => setElegida(h)}
                  className={`chip ${elegida?.desde === h.desde ? 'chip-activo' : ''} ${h.urgencia && !todasUrgencia ? 'border-[#ff8a5c]/50 text-[#ffc2a8]' : ''}`}
                  title={h.urgencia ? `Urgencia: ${pesos(h.importe)}` : undefined}
                >
                  {h.urgencia && !todasUrgencia && <Icon name="match" className="h-3.5 w-3.5" />}
                  {hora(h.desde)}
                </button>
              ))}
            </div>
          </div>
        ))}
        {horas !== null && (
          <button type="button" className="text-xs font-semibold text-tinta-300 underline" onClick={siguiente}>
            Ver días siguientes
          </button>
        )}
        {hayUrgencias && !todasUrgencia && (
          <p className="flex items-center gap-1.5 text-xs text-[#ffc2a8]">
            <Icon name="match" className="h-3.5 w-3.5 shrink-0" /> Fuera del horario normal: la visita cuesta {pesos(urgenciaPrecio)} (urgencia).
          </p>
        )}
        <p className="rounded-xl bg-navy-850 p-3 text-xs text-tinta-300">
          Pagás {pesos(elegida ? elegida.importe : todasUrgencia ? urgenciaPrecio : propuesta.precio_visita)}
          {elegida?.urgencia ? ' (urgencia)' : ''} por Mercado Pago. Te guardamos el horario mientras pagás. Si cancelás con más de {config?.cancelacion_horas ?? 24} horas,
          te devolvemos todo{Number(config?.cancelacion_tarde_pct) > 0 ? `; después, el ${config.cancelacion_tarde_pct} %` : '; después, no hay devolución'}.
        </p>
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        <button className="btn btn-menta w-full py-3" disabled={!elegida || ocupado} onClick={reservar}>
          {ocupado ? 'Abriendo Mercado Pago…' : elegida ? `Reservar ${diaLargo(elegida.desde)} ${hora(elegida.desde)} y pagar ${pesos(elegida.importe)}` : 'Elegí un horario'}
        </button>
      </div>
    </Modal>
  );
}

function ModalAccion({ modal, solicitudId, config, ocupado, rpc, onCerrar, setError }) {
  const [texto, setTexto] = useState('');
  const [archivos, setArchivos] = useState([]);
  const [subiendo, setSubiendo] = useState(false);
  const { tipo, op } = modal;
  const horasFalta = op.turno ? (new Date(op.turno.inicio) - new Date()) / 36e5 : 0;
  const pctDev = horasFalta >= Number(config?.cancelacion_horas ?? 24) ? 100 : Number(config?.cancelacion_tarde_pct ?? 0);

  async function reclamar() {
    try {
      setSubiendo(true);
      const rutas = archivos.length ? await subirArchivos(archivos, `reclamo-${op.id}`) : [];
      setSubiendo(false);
      await rpc('reclamar', { p_op: op.id, p_descripcion: texto, p_archivos: rutas }, 'Recibimos tu reclamo. TaListo! lo revisa con el profesional.');
    } catch (e) {
      setSubiendo(false);
      setError(e.message);
    }
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo={tipo === 'cancelar' ? 'Cancelar la visita' : tipo === 'reclamar' ? 'Hacer un reclamo' : 'Contratación por fuera'}>
      <div className="space-y-3">
        {tipo === 'cancelar' && (
          <>
            <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-200">
              {pctDev === 100
                ? `Faltan más de ${config?.cancelacion_horas ?? 24} horas: te devolvemos ${pesos(op.importe)} por Mercado Pago.`
                : pctDev > 0
                  ? `Faltan menos de ${config?.cancelacion_horas ?? 24} horas: te devolvemos el ${pctDev} % (${pesos((op.importe * pctDev) / 100)}).`
                  : `Faltan menos de ${config?.cancelacion_horas ?? 24} horas: según las condiciones no hay devolución y el profesional cobra la visita.`}
            </p>
            <input className="campo" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Motivo (opcional)" maxLength={300} />
            <button className="btn btn-menta w-full" disabled={ocupado} onClick={() => rpc('cancelar_visita', { p_op: op.id, p_motivo: texto || null }, (r) =>
              r?.devolucion > 0 ? `Visita cancelada. La devolución de ${pesos(r.devolucion)} queda en proceso.` : 'Visita cancelada.')}>
              Cancelar la visita
            </button>
          </>
        )}
        {tipo === 'reclamar' && (
          <>
            <p className="text-sm text-tinta-300">Contanos qué pasó. Mientras se revisa, el pago al profesional queda frenado.</p>
            <textarea className="campo min-h-28" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={2000} placeholder="Ej.: no vino, llegó y no revisó nada…" />
            <label className="btn btn-sec w-full cursor-pointer">
              <Icon name="camara" /> {archivos.length ? `${archivos.length} fotos o videos` : 'Agregar fotos o videos'}
              <input type="file" accept="image/*,video/*" multiple className="sr-only" onChange={(e) => setArchivos([...e.target.files].slice(0, 8))} />
            </label>
            <button className="btn btn-menta w-full" disabled={ocupado || subiendo || texto.trim().length < 10} onClick={reclamar}>
              {subiendo ? 'Subiendo…' : 'Enviar reclamo'}
            </button>
          </>
        )}
        {tipo === 'externa' && (
          <>
            <ul className="space-y-1.5 rounded-xl bg-navy-850 p-3 text-sm text-tinta-200">
              <li>• TaListo! no cobra comisión por ese trabajo.</li>
              <li>• TaListo! no administra el presupuesto ni el pago.</li>
              <li>• El trabajo no tiene garantía TaListo! ni reclamos por la plataforma.</li>
              <li>• Queda registrada la visita técnica, y podés calificar solo la visita.</li>
            </ul>
            <button className="btn btn-menta w-full" disabled={ocupado} onClick={() => rpc('marcar_externa', { p_solicitud: solicitudId }, 'Listo, quedó registrado.')}>
              Entendido, sigo por fuera
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
