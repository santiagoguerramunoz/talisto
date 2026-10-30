'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { Reloj } from './ControlTiempo';
import { usePanel } from './PanelContext';
import { supabase } from '@/lib/supabase';
import { esMismoDia, fechaISO, fechaLarga, inicioDia, sumarDias } from '@/lib/fechas';
import { ESTADOS_TRABAJO } from '@/lib/trabajos';
import { sesionAbierta } from '@/lib/tiempos';
import { linkGoogleMaps, linkRutaDelDia, linkWaze, mensajeError } from '@/lib/util';
import { hhmm, ubicacionActual } from '@/lib/equipo';

const TIPO = {
  ticket: { texto: 'Ticket B2B', icono: 'maletin' },
  trabajo: { texto: 'Trabajo', icono: 'herramienta' },
  visita: { texto: 'Visita técnica', icono: 'herramienta' },
  relevamiento: { texto: 'Relevamiento', icono: 'relevamiento' },
};

const claveCompartir = (cuenta) => `talisto_compartir_${cuenta}`;
function leerCompartir(cuenta) {
  try {
    return window.localStorage.getItem(claveCompartir(cuenta)) || '';
  } catch {
    return '';
  }
}
function guardarCompartir(cuenta, v) {
  try {
    window.localStorage.setItem(claveCompartir(cuenta), v);
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
}

const sinFuncion = (e) => !!e && (e.code === 'PGRST202' || e.code === '42883');
const minutosDelDia = (iso) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};
const hora = (t) => (t ? String(t).slice(0, 5) : '');

// Une tickets B2B y turnos en una sola lista, en el orden de la ruta
function armarLista(datos, fechaIso) {
  const tickets = (datos?.tickets || []).map((o) => {
    const corriendo = !!sesionAbierta(o.tiempos);
    return {
      key: `t-${o.id}`,
      rpc: 'ticket',
      id: o.id,
      tipo: 'ticket',
      titulo: [o.empresa, o.numero_ticket ? `Tk ${o.numero_ticket}` : o.numero_cliente ? `Cliente ${o.numero_cliente}` : null].filter(Boolean).join(' · '),
      color: o.color || '#94a3b8',
      cuando: o.hora_inicio ? `${hora(o.hora_inicio)}${o.hora_fin ? `–${hora(o.hora_fin)}` : ''}` : 'Sin horario',
      minuto: o.hora_inicio ? Number(hora(o.hora_inicio).slice(0, 2)) * 60 + Number(hora(o.hora_inicio).slice(3, 5)) : 24 * 60,
      deOtroDia: o.fecha !== fechaIso,
      clienteFinal: o.cliente_final,
      lugar: o.direccion || o.lat != null ? { direccion: o.direccion || '', referencia: o.referencia, lat: o.lat, lng: o.lng } : null,
      pedido: o.pedido,
      materiales: o.materiales || [],
      estado: corriendo ? 'en_curso' : o.estado === 'en_curso' ? 'pendiente' : o.estado,
      tiempos: o.tiempos || [],
      resolucion: o.realizado,
      nota: o.nota_estado,
      puestas: Number(o.acondicionamientos || 0),
      moes: Number(o.moes || 0),
      orden: o.orden_ruta,
      fechaSigue: o.fecha,
    };
  });
  const turnos = (datos?.turnos || []).map((t) => {
    const corriendo = !!sesionAbierta(t.tiempos);
    const fin = (t.tiempos || []).length && !corriendo;
    return {
      key: `u-${t.id}`,
      rpc: 'turno',
      id: t.id,
      tipo: t.tipo || 'trabajo',
      titulo: t.cliente || t.titulo || 'Trabajo',
      color: t.color || '#2dd4bf',
      cuando: `${hhmm(t.inicio)}–${hhmm(t.fin)}`,
      minuto: minutosDelDia(t.inicio),
      lugar: t.direccion || t.lat != null ? { direccion: t.direccion || '', referencia: t.referencia, lat: t.lat, lng: t.lng } : null,
      telefono: t.telefono,
      pedido: t.pedido || t.notas,
      notas: t.pedido ? t.notas : null,
      materiales: [],
      estado: t.estado === 'realizado' ? 'finalizado' : corriendo ? 'en_curso' : fin && t.resolucion ? 'suspendido' : 'pendiente',
      tiempos: t.tiempos || [],
      resolucion: t.estado === 'realizado' ? t.resolucion : null,
      nota: t.estado !== 'realizado' ? t.resolucion : null,
      orden: t.orden_ruta,
    };
  });
  return [...tickets, ...turnos].sort(
    (a, b) => (a.orden ?? 9999) - (b.orden ?? 9999) || a.minuto - b.minuto || a.titulo.localeCompare(b.titulo)
  );
}

function Contador({ etiqueta, valor, onChange }) {
  const v = Number(valor) || 0;
  const fijar = (n) => onChange(Math.max(0, Math.round(n * 2) / 2));
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-850 p-3">
      <p className="text-sm font-bold">{etiqueta}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button type="button" onClick={() => fijar(v - 0.5)} className="grid h-10 w-10 place-items-center rounded-xl bg-navy-700 text-xl font-bold" aria-label={`Restar media ${etiqueta}`}>−</button>
        <span className="min-w-10 text-center text-2xl font-extrabold tabular-nums">{v.toLocaleString('es-UY', { minimumFractionDigits: v % 1 ? 1 : 0 })}</span>
        <button type="button" onClick={() => fijar(v + 0.5)} className="grid h-10 w-10 place-items-center rounded-xl bg-menta-500 text-xl font-bold text-navy-950" aria-label={`Sumar media ${etiqueta}`}>+</button>
      </div>
    </div>
  );
}

// Envía la ubicación a la empresa mientras la pantalla está abierta (como mucho una vez por minuto)
function useCompartirUbicacion(cuenta, activo) {
  const ultimo = useRef(0);
  const [estado, setEstado] = useState('');
  useEffect(() => {
    if (!activo || !cuenta || typeof navigator === 'undefined' || !navigator.geolocation) return undefined;
    const id = navigator.geolocation.watchPosition(
      async (p) => {
        setEstado('ok');
        if (Date.now() - ultimo.current < 60000) return;
        ultimo.current = Date.now();
        const { error } = await supabase.rpc('reportar_posicion', {
          p_cuenta: cuenta,
          p_lat: p.coords.latitude,
          p_lng: p.coords.longitude,
          p_precision: Math.round(p.coords.accuracy || 0),
        });
        if (error) ultimo.current = 0;
      },
      (e) => setEstado(e.code === 1 ? 'denegado' : 'error'),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [cuenta, activo]);
  return estado;
}

export default function MisTickets({ onVerAgenda }) {
  const { profesional, empresa } = usePanel();
  const cuenta = profesional.id;
  const [fecha, setFecha] = useState(() => inicioDia(new Date()));
  const [datos, setDatos] = useState({ cargando: true, lista: [], error: '' });
  const [ocupado, setOcupado] = useState('');
  const [aviso, setAviso] = useState('');
  const [cerrando, setCerrando] = useState(null);
  const [compartir, setCompartir] = useState(() => leerCompartir(cuenta));
  const pedido = useRef(0);
  const fechaIso = fechaISO(fecha);

  const cargar = useCallback(async () => {
    const n = ++pedido.current;
    const { data, error } = await supabase.rpc('mis_trabajos', { p_cuenta: cuenta, p_desde: fechaIso, p_hasta: fechaIso });
    if (n !== pedido.current) return;
    if (error) {
      setDatos((d) => ({
        ...d,
        cargando: false,
        error: sinFuncion(error) ? 'Falta activar los tickets del equipo (SQL 08). Avisale a la cuenta principal.' : mensajeError(error),
      }));
      return;
    }
    setDatos({ cargando: false, lista: armarLista(data, fechaIso), error: '' });
  }, [cuenta, fechaIso]);

  useEffect(() => {
    setDatos((d) => ({ ...d, cargando: true }));
    cargar();
    const t = setInterval(cargar, 60000);
    const alVolver = () => document.visibilityState === 'visible' && cargar();
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [cargar]);

  const ubicacionEstado = useCompartirUbicacion(cuenta, compartir === 'si');

  function elegirCompartir(v) {
    guardarCompartir(cuenta, v);
    setCompartir(v);
    if (v === 'no') supabase.rpc('dejar_de_compartir', { p_cuenta: cuenta });
  }

  async function iniciar(item) {
    setAviso('');
    setOcupado(item.key);
    const pos = await ubicacionActual();
    const { error } = await supabase.rpc('iniciar_trabajo', { p_tipo: item.rpc, p_id: item.id, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null });
    setOcupado('');
    if (error) return setAviso(mensajeError(error));
    cargar();
  }

  const lista = datos.lista;
  const hechos = lista.filter((i) => i.estado === 'finalizado').length;
  const pendientes = lista.filter((i) => i.estado !== 'finalizado' && i.lugar);
  const ruta = linkRutaDelDia(pendientes.map((i) => i.lugar));
  const enCurso = lista.find((i) => i.estado === 'en_curso');
  const esHoy = esMismoDia(fecha, new Date());

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold">Mis tickets</h1>
            <p className="truncate text-xs font-semibold text-menta-300">{empresa?.nombre}</p>
          </div>
          {onVerAgenda && (
            <button type="button" className="btn btn-sec px-3 py-2 text-sm" onClick={onVerAgenda}>
              <Icon name="agenda" className="h-4 w-4" /> Agenda
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => setFecha((f) => sumarDias(f, -1))} className="btn btn-sec px-2.5 py-2" aria-label="Día anterior"><Icon name="izq" /></button>
          <button onClick={() => setFecha((f) => sumarDias(f, 1))} className="btn btn-sec px-2.5 py-2" aria-label="Día siguiente"><Icon name="der" /></button>
          <p className="flex-1 truncate px-1 font-bold">{fechaLarga(fecha)}</p>
          {!esHoy && <button onClick={() => setFecha(inicioDia(new Date()))} className="chip chip-activo">Hoy</button>}
        </div>
      </header>

      <div className="space-y-3 px-4 pt-4">
        {/* Ubicación compartida */}
        {!compartir ? (
          <section className="rounded-2xl border border-[#0a84ff]/40 bg-[#0a84ff]/10 p-4">
            <p className="flex items-center gap-2 font-bold text-tinta-100">
              <Icon name="ubicacion" className="h-5 w-5 text-[#8cc8ff]" /> ¿Compartís tu ubicación mientras trabajás?
            </p>
            <p className="mt-1 text-sm text-tinta-300">
              Así {empresa?.nombre || 'la empresa'} ve en el mapa por dónde va la ruta. Solo la ven quienes organizan el trabajo, y solo mientras tenés TaListo!
              abierto. Al iniciar y al finalizar cada trabajo se guarda el lugar.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-sec" onClick={() => elegirCompartir('no')}>Ahora no</button>
              <button type="button" className="btn btn-menta" onClick={() => elegirCompartir('si')}>Compartir</button>
            </div>
          </section>
        ) : (
          <label className="flex items-center gap-3 rounded-xl bg-navy-900 px-3 py-2.5 text-sm">
            <Icon name="ubicacion" className={`h-5 w-5 shrink-0 ${compartir === 'si' ? 'text-[#8cc8ff]' : 'text-tinta-500'}`} />
            <span className="min-w-0 flex-1">
              <b className="block text-tinta-100">Compartir mi ubicación</b>
              <span className="text-xs text-tinta-400">
                {compartir !== 'si'
                  ? 'Apagado: la empresa no ve por dónde vas.'
                  : ubicacionEstado === 'denegado'
                    ? 'El celular no da permiso: activalo en los ajustes de ubicación.'
                    : 'La empresa ve tu última ubicación mientras la app está abierta.'}
              </span>
            </span>
            <input type="checkbox" className="h-5 w-5 accent-[#2cc79b]" checked={compartir === 'si'} onChange={(e) => elegirCompartir(e.target.checked ? 'si' : 'no')} />
          </label>
        )}

        {datos.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{datos.error}</p>}
        {aviso && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{aviso}</p>}

        {lista.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-tinta-300">
            <span className="font-semibold text-tinta-100">{lista.length} {lista.length === 1 ? 'trabajo' : 'trabajos'}</span>
            <span>· {hechos} {hechos === 1 ? 'terminado' : 'terminados'}</span>
            {ruta && pendientes.length > 1 && (
              <a href={ruta} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 font-bold text-menta-300">
                <Icon name="ruta" className="h-4 w-4" /> Ruta del día
              </a>
            )}
          </div>
        )}

        {datos.cargando && lista.length === 0 ? (
          <p className="py-8 text-center text-tinta-400">Cargando…</p>
        ) : lista.length === 0 && !datos.error ? (
          <section className="tarjeta p-6 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-menta-500/15 text-menta-300">
              <Icon name="check" />
            </span>
            <h2 className="mt-3 text-lg font-extrabold">{esHoy ? 'No tenés trabajos para hoy' : 'Sin trabajos ese día'}</h2>
            <p className="mt-1 text-sm text-tinta-400">Cuando te asignen un ticket, un trabajo o un relevamiento, aparece acá con la dirección.</p>
          </section>
        ) : (
          <ol className="space-y-3">
            {lista.map((item, n) => (
              <Tarjeta
                key={item.key}
                item={item}
                numero={n + 1}
                ocupado={ocupado === item.key}
                bloqueado={!!enCurso && enCurso.key !== item.key}
                onIniciar={() => iniciar(item)}
                onFinalizar={() => setCerrando(item)}
              />
            ))}
          </ol>
        )}
        <p className="pb-4 pt-1 text-center text-xs text-tinta-500">Se actualiza solo. Los importes los ve la administración.</p>
      </div>

      <Cierre
        item={cerrando}
        onCerrar={() => setCerrando(null)}
        onListo={() => {
          setCerrando(null);
          cargar();
        }}
      />
    </>
  );
}

function Tarjeta({ item, numero, ocupado, bloqueado, onIniciar, onFinalizar }) {
  const info = ESTADOS_TRABAJO[item.estado] || ESTADOS_TRABAJO.pendiente;
  const tipo = TIPO[item.tipo] || TIPO.trabajo;
  const terminado = item.estado === 'finalizado';
  const corriendo = item.estado === 'en_curso';
  const sesiones = item.tiempos.filter((t) => t?.inicio);
  const primera = sesiones[0];
  const ultima = sesiones[sesiones.length - 1];
  return (
    <li className={`tarjeta overflow-hidden ${corriendo ? 'border-[#0a84ff]/60' : ''} ${terminado ? 'opacity-70' : ''}`}>
      <div className="flex gap-3 p-4">
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-extrabold ${item.tipo === 'relevamiento' ? 'rounded-lg bg-marca-naranja text-navy-950' : 'text-navy-950'}`}
          style={item.tipo === 'relevamiento' ? undefined : { background: item.color }}
        >
          {terminado ? <Icon name="check" className="h-4 w-4" /> : numero}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 font-bold leading-tight">{item.titulo}</p>
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${info.clase}`}>
              {corriendo && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0a84ff]" />}
              {info.texto}
            </span>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-tinta-400">
            <Icon name={tipo.icono} className="h-3.5 w-3.5" /> {tipo.texto} · {item.cuando}
            {item.deOtroDia && <span className="rounded bg-[#176ba8]/30 px-1.5 text-[#8cc4ee]">Viene de otro día</span>}
          </p>
          {item.clienteFinal && <p className="mt-1 text-sm text-tinta-200">{item.clienteFinal}</p>}
          {item.lugar && (
            <p className="mt-1 flex gap-1.5 text-sm text-tinta-200">
              <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-tinta-400" />
              <span>
                {item.lugar.direccion || 'Ubicación marcada en el mapa'}
                {item.lugar.referencia && <span className="block text-xs text-tinta-400">{item.lugar.referencia}</span>}
              </span>
            </p>
          )}
          {item.pedido && (
            <p className="mt-2 whitespace-pre-line rounded-xl bg-navy-850 p-2.5 text-sm text-tinta-200">
              <b className="block text-xs uppercase tracking-wide text-tinta-400">{item.tipo === 'relevamiento' ? 'Qué pide el cliente' : 'Qué hay que hacer'}</b>
              {item.pedido}
            </p>
          )}
          {item.notas && <p className="mt-1.5 text-xs text-tinta-400">Notas: {item.notas}</p>}
          {item.materiales?.length > 0 && (
            <p className="mt-1.5 text-xs text-tinta-300">
              <b className="text-tinta-200">Materiales:</b>{' '}
              {item.materiales.map((m) => [m.item, m.cantidad ? `${m.cantidad}${m.unidad ? ` ${m.unidad}` : ''}` : ''].filter(Boolean).join(' ')).join(' · ')}
            </p>
          )}
          {item.nota && item.estado !== 'finalizado' && <p className="mt-1.5 text-xs text-red-300">{item.estado === 'multidia' ? 'Avance' : 'Motivo'}: {item.nota}</p>}
          {item.estado === 'multidia' && item.fechaSigue && <p className="mt-1 text-xs text-[#8cc4ee]">Sigue el {item.fechaSigue.split('-').reverse().join('/')}</p>}
          {terminado && item.resolucion && (
            <p className="mt-2 rounded-xl bg-menta-500/10 p-2.5 text-sm text-menta-200">
              <b className="block text-xs uppercase tracking-wide text-menta-300">Cómo quedó</b>
              {item.resolucion}
            </p>
          )}
          {primera && (
            <p className="mt-1.5 text-xs text-tinta-400">
              Inicio {hhmm(primera.inicio)}
              {ultima?.fin ? ` · Fin ${hhmm(ultima.fin)}` : ''}
              {sesiones.length > 1 ? ` · ${sesiones.length} tramos` : ''} ·{' '}
              <Reloj tiempos={item.tiempos} className={corriendo ? 'font-bold text-[#8cc8ff]' : ''} />
            </p>
          )}
        </div>
      </div>

      {!terminado && (
        <div className="space-y-2 border-t border-navy-800 p-3">
          {corriendo ? (
            <button type="button" className="btn w-full bg-red-500 py-3 text-base font-extrabold text-white hover:bg-red-400" onClick={onFinalizar}>
              <Icon name="parar" /> Finalizar
            </button>
          ) : (
            <button type="button" className="btn btn-menta w-full py-3 text-base font-extrabold" onClick={onIniciar} disabled={ocupado || bloqueado}>
              <Icon name="play" /> {ocupado ? 'Iniciando…' : sesiones.length ? 'Retomar' : 'Iniciar'}
            </button>
          )}
          {bloqueado && !corriendo && <p className="text-center text-xs text-tinta-500">Primero finalizá el trabajo que tenés en curso.</p>}
          {(item.lugar || item.telefono) && (
            <div className="grid grid-flow-col gap-2">
              {item.lugar && (
                <a href={linkGoogleMaps(item.lugar)} target="_blank" rel="noreferrer" className="btn btn-sec py-2 text-sm">
                  <Icon name="ir" className="h-4 w-4" /> Ir
                </a>
              )}
              {item.lugar && (
                <a href={linkWaze(item.lugar)} target="_blank" rel="noreferrer" className="btn btn-sec py-2 text-sm">Waze</a>
              )}
              {item.telefono && (
                <a href={`tel:${String(item.telefono).replace(/[^\d+]/g, '')}`} className="btn btn-sec py-2 text-sm">
                  <Icon name="telefono" className="h-4 w-4" /> Llamar
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ¿Cómo queda el trabajo? Terminado (con la resolución) · Suspendido · Sigue otro día
function Cierre({ item, onCerrar, onListo }) {
  const [paso, setPaso] = useState('finalizado');
  const [texto, setTexto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [puestas, setPuestas] = useState(0);
  const [moes, setMoes] = useState(0);
  const [otroDia, setOtroDia] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!item) return;
    setPaso('finalizado');
    setTexto(item.resolucion || '');
    setMotivo('');
    setPuestas(item.puestas || (item.tipo === 'ticket' ? 1 : 0));
    setMoes(item.moes || 0);
    setOtroDia(fechaISO(sumarDias(new Date(), 1)));
    setError('');
  }, [item]);

  const opciones = useMemo(
    () => [
      ['finalizado', 'Terminado'],
      ['suspendido', item?.tipo === 'ticket' ? 'Suspendido' : 'No se pudo'],
      ...(item?.tipo === 'ticket' ? [['multidia', 'Sigue otro día']] : []),
    ],
    [item]
  );

  if (!item) return null;

  async function guardar() {
    setError('');
    if (paso === 'finalizado' && !texto.trim()) return setError('Contá qué hiciste y cómo quedó.');
    if (paso === 'suspendido' && !motivo.trim()) return setError('Poné el motivo.');
    setGuardando(true);
    const pos = await ubicacionActual();
    const { error: err } = await supabase.rpc('terminar_trabajo', {
      p_tipo: item.rpc,
      p_id: item.id,
      p_resultado: paso,
      p_resolucion: paso === 'suspendido' ? null : texto.trim() || null,
      p_puestas: item.tipo === 'ticket' && paso === 'finalizado' ? puestas : null,
      p_moes: item.tipo === 'ticket' && paso === 'finalizado' ? moes : null,
      p_nota: paso === 'suspendido' ? motivo.trim() : null,
      p_lat: pos?.lat ?? null,
      p_lng: pos?.lng ?? null,
      p_fecha: paso === 'multidia' ? otroDia : null,
    });
    setGuardando(false);
    if (err) return setError(mensajeError(err));
    onListo();
  }

  return (
    <Modal
      abierto={!!item}
      onCerrar={() => !guardando && onCerrar()}
      titulo="¿Cómo queda el trabajo?"
      pie={
        <button type="button" className="btn btn-menta w-full" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : paso === 'finalizado' ? 'Cerrar el trabajo' : paso === 'multidia' ? 'Pasar a ese día' : 'Guardar'}
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm font-semibold text-tinta-200">{item.titulo}</p>
        <div className={`grid gap-1.5 rounded-2xl bg-navy-850 p-1.5 ${opciones.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {opciones.map(([v, t]) => (
            <button
              key={v}
              type="button"
              onClick={() => setPaso(v)}
              className={`rounded-xl px-1 py-2.5 text-sm font-bold ${paso === v ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {paso !== 'suspendido' && (
          <div>
            <label className="etiqueta" htmlFor="mt-res">{paso === 'multidia' ? '¿Qué avanzaste? (opcional)' : '¿Qué hiciste y cómo quedó?'}</label>
            <textarea
              id="mt-res"
              rows={4}
              className="campo"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              maxLength={2000}
              placeholder={item.tipo === 'relevamiento' ? 'Medidas, qué hay que hacer, materiales que van a hacer falta…' : 'Ej. Se cambió el router y se probó la conexión: anda bien.'}
            />
          </div>
        )}

        {paso === 'finalizado' && item.tipo === 'ticket' && (
          <div className="grid grid-cols-2 gap-2">
            <Contador etiqueta="Puestas" valor={puestas} onChange={setPuestas} />
            <Contador etiqueta="MOE" valor={moes} onChange={setMoes} />
          </div>
        )}

        {paso === 'suspendido' && (
          <div>
            <label className="etiqueta" htmlFor="mt-mot">{item.tipo === 'ticket' ? '¿Por qué se suspende?' : '¿Por qué no se pudo hacer?'}</label>
            <input id="mt-mot" className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} placeholder="Ej. Falta material, no estaba el cliente…" />
          </div>
        )}

        {paso === 'multidia' && (
          <div>
            <label className="etiqueta" htmlFor="mt-dia">¿Qué día seguís?</label>
            <input id="mt-dia" type="date" className="campo" value={otroDia} min={fechaISO(sumarDias(new Date(), 1))} onChange={(e) => e.target.value && setOtroDia(e.target.value)} />
            <p className="mt-1 text-xs text-tinta-400">El tiempo se va sumando. El ticket te aparece ese día.</p>
          </div>
        )}

        <p className="text-xs text-tinta-500">Se guarda la hora y el lugar donde estás.</p>
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}
