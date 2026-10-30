'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import Campanita from './Campanita';
import ActivarAvisos from './ActivarAvisos';
import CierreTrabajo, { BotonesCierre } from './CierreTrabajo';
import DetalleTrabajo, { EtiquetaCliente } from './DetalleTrabajo';
import PedirCotizacion from './PedirCotizacion';
import MaterialesTrabajo from './MaterialesTrabajo';
import { Reloj } from './ControlTiempo';
import { usePanel } from './PanelContext';
import { supabase } from '@/lib/supabase';
import { avisar } from '@/lib/avisos';
import { desdeISO, esMismoDia, fechaISO, fechaLarga, inicioDia, sumarDias } from '@/lib/fechas';
import { ESTADOS_TRABAJO } from '@/lib/trabajos';
import { sesionAbierta } from '@/lib/tiempos';
import { linkGoogleMaps, linkRutaDelDia, mensajeError } from '@/lib/util';
import { hhmm, ubicacionActual } from '@/lib/equipo';

const TIPO = {
  ticket: { texto: 'Ticket', icono: 'maletin' },
  trabajo: { texto: 'Trabajo', icono: 'herramienta' },
  visita: { texto: 'Visita técnica', icono: 'herramienta' },
  relevamiento: { texto: 'Relevamiento', icono: 'relevamiento' },
};
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

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
const hora = (t) => (t ? String(t).slice(0, 5) : '');
const aMin = (t) => Number(hora(t).slice(0, 2)) * 60 + Number(hora(t).slice(3, 5));
const textoDia = (iso) => {
  const f = desdeISO(iso);
  return `${DIAS[f.getDay()]} ${f.getDate()}/${f.getMonth() + 1}`;
};

// Une tickets B2B y trabajos de la agenda en una sola lista, en el orden de la ruta
function armarLista(datos, fechaIso) {
  const tickets = (datos?.tickets || []).map((o) => {
    const corriendo = !!sesionAbierta(o.tiempos);
    const desde = o.hora_inicio ? aMin(o.hora_inicio) : null;
    return {
      key: `t-${o.id}`,
      rpc: 'ticket',
      id: o.id,
      tipo: 'ticket',
      b2b: true,
      titulo: [o.empresa, o.numero_ticket ? `Tk ${o.numero_ticket}` : o.numero_cliente ? `Cliente ${o.numero_cliente}` : null].filter(Boolean).join(' · '),
      contacto: o.cliente_final,
      telefono: o.telefono,
      color: o.color || '#94a3b8',
      cuando: o.hora_inicio ? `${hora(o.hora_inicio)}${o.hora_fin ? `–${hora(o.hora_fin)}` : ''}` : 'Sin horario',
      horaTexto: hora(o.hora_inicio),
      minuto: desde ?? 24 * 60,
      duracion: desde !== null && o.hora_fin ? aMin(o.hora_fin) - desde : 60,
      fechaIso: o.fecha,
      fechaTexto: textoDia(o.fecha),
      deOtroDia: o.fecha !== fechaIso,
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
    };
  });
  const turnos = (datos?.turnos || []).map((t) => {
    const corriendo = !!sesionAbierta(t.tiempos);
    const ini = new Date(t.inicio);
    const k = fechaISO(ini);
    return {
      key: `u-${t.id}`,
      rpc: 'turno',
      id: t.id,
      tipo: t.tipo || 'trabajo',
      b2b: !!t.cliente_empresa,
      titulo: t.cliente || t.titulo || 'Trabajo',
      contacto: t.cliente,
      telefono: t.telefono,
      color: t.color || '#2dd4bf',
      cuando: `${hhmm(t.inicio)}–${hhmm(t.fin)}`,
      horaTexto: hhmm(t.inicio),
      minuto: ini.getHours() * 60 + ini.getMinutes(),
      duracion: Math.round((new Date(t.fin) - ini) / 60000),
      fechaIso: k,
      fechaTexto: textoDia(k),
      lugar: t.direccion || t.lat != null ? { direccion: t.direccion || '', referencia: t.referencia, lat: t.lat, lng: t.lng } : null,
      pedido: t.pedido || t.notas,
      notas: t.pedido ? t.notas : null,
      materiales: [],
      estado: t.estado === 'realizado' ? 'finalizado' : corriendo ? 'en_curso' : t.inicio_original ? 'multidia' : 'pendiente',
      tiempos: t.tiempos || [],
      resolucion: t.estado === 'realizado' ? t.resolucion : null,
      nota: t.estado !== 'realizado' ? t.nota_estado : null,
      orden: t.orden_ruta,
    };
  });
  return [...tickets, ...turnos].sort(
    (a, b) => (a.orden ?? 9999) - (b.orden ?? 9999) || a.minuto - b.minuto || a.titulo.localeCompare(b.titulo)
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

const FILTROS = [
  ['todos', 'Todos'],
  ['b2b', 'Empresas B2B'],
  ['b2c', 'Particulares B2C'],
];

export default function MisTickets({ onVerAgenda }) {
  const { profesional, empresa } = usePanel();
  const cuenta = profesional.id;
  const [fecha, setFecha] = useState(() => inicioDia(new Date()));
  const [datos, setDatos] = useState({ cargando: true, lista: [], error: '' });
  const [filtro, setFiltro] = useState('todos');
  const [ocupado, setOcupado] = useState('');
  const [aviso, setAviso] = useState('');
  const [listo, setListo] = useState('');
  const [compartir, setCompartir] = useState(() => leerCompartir(cuenta));
  const [avisos, setAvisos] = useState(null);
  // pantallas encima: detalle · cierre · materiales · cotizar (una a la vez)
  const [abierto, setAbierto] = useState(null);
  const [recargaCot, setRecargaCot] = useState(0);
  const [buscado, setBuscado] = useState('');
  const pedido = useRef(0);
  const fechaIso = fechaISO(fecha);

  // Stock (SQL 10): si la empresa lo usa y si tengo entregas para confirmar
  const cargarAvisos = useCallback(async () => {
    const { data, error } = await supabase.rpc('stock_avisos', { p_cuenta: cuenta });
    if (!error) setAvisos(data);
  }, [cuenta]);
  const usaStock = !!avisos?.usa_stock;

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
    cargarAvisos();
    const t = setInterval(() => (cargar(), cargarAvisos()), 60000);
    const alVolver = () => document.visibilityState === 'visible' && (cargar(), cargarAvisos());
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [cargar, cargarAvisos]);

  // Vengo de una notificación: /panel?trabajo=ticket:<id> → voy al día de ese trabajo y lo abro
  useEffect(() => {
    let q = '';
    try {
      q = new URLSearchParams(window.location.search).get('trabajo') || '';
    } catch {
      q = '';
    }
    if (!/^(ticket|turno):[0-9a-f-]{36}$/i.test(q)) return;
    setBuscado(q);
    window.history.replaceState(null, '', window.location.pathname);
    (async () => {
      const hoy = inicioDia(new Date());
      const { data } = await supabase.rpc('mis_trabajos', { p_cuenta: cuenta, p_desde: fechaISO(sumarDias(hoy, -14)), p_hasta: fechaISO(sumarDias(hoy, 45)) });
      const [tipo, id] = q.split(':');
      const t = tipo === 'ticket' ? data?.tickets?.find((o) => o.id === id) : data?.turnos?.find((x) => x.id === id);
      if (!t) {
        setBuscado('');
        setAviso('Ese trabajo ya no está a tu nombre (lo pueden haber reasignado o cerrado).');
        return;
      }
      const dia = tipo === 'ticket' ? (t.estado === 'multidia' || t.estado === 'en_curso' ? hoy : desdeISO(t.fecha)) : inicioDia(new Date(t.inicio));
      setFecha(dia < hoy && tipo === 'ticket' ? hoy : dia);
    })();
  }, [cuenta]);
  useEffect(() => {
    if (!buscado || datos.cargando) return;
    const [tipo, id] = buscado.split(':');
    const item = datos.lista.find((i) => i.rpc === tipo && i.id === id);
    if (item) {
      setAbierto({ que: 'detalle', item });
      setBuscado('');
    }
  }, [buscado, datos]);

  // Si el trabajo abierto cambió (se inició, se recargó), muestro lo último
  useEffect(() => {
    setAbierto((a) => {
      if (!a?.item) return a;
      const nuevo = datos.lista.find((i) => i.key === a.item.key);
      return nuevo && nuevo !== a.item ? { ...a, item: nuevo } : a;
    });
  }, [datos.lista]);

  const ubicacionEstado = useCompartirUbicacion(cuenta, compartir === 'si');

  function elegirCompartir(v) {
    guardarCompartir(cuenta, v);
    setCompartir(v);
    if (v === 'no') supabase.rpc('dejar_de_compartir', { p_cuenta: cuenta });
  }

  async function iniciar(item) {
    setAviso('');
    setListo('');
    setOcupado(item.key);
    const pos = await ubicacionActual();
    const { error } = await supabase.rpc('iniciar_trabajo', { p_tipo: item.rpc, p_id: item.id, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null });
    setOcupado('');
    if (error) return setAviso(mensajeError(error));
    avisar();
    cargar();
  }

  const lista = datos.lista;
  const cantB2b = lista.filter((i) => i.b2b).length;
  const cantB2c = lista.length - cantB2b;
  const filtroReal = cantB2b > 0 && cantB2c > 0 ? filtro : 'todos';
  const visibles = filtroReal === 'todos' ? lista : lista.filter((i) => (filtroReal === 'b2b' ? i.b2b : !i.b2b));
  const hechos = lista.filter((i) => i.estado === 'finalizado').length;
  const pendientes = visibles.filter((i) => i.estado !== 'finalizado' && i.lugar);
  const ruta = linkRutaDelDia(pendientes.map((i) => i.lugar));
  const enCurso = lista.find((i) => i.estado === 'en_curso');
  const esHoy = esMismoDia(fecha, new Date());
  const conMateriales = (item) => (usaStock && item?.tipo !== 'relevamiento' ? () => setAbierto({ que: 'materiales', item }) : null);
  const conCotizar = (item) => (item && item.estado !== 'finalizado' ? () => setAbierto({ que: 'cotizar', item }) : null);
  const it = abierto?.item;

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold">Mis tickets</h1>
            <p className="truncate text-xs font-semibold text-menta-300">{empresa?.nombre}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Campanita />
            {usaStock && (
              <Link href="/panel/mi-stock" className="btn btn-sec relative px-2.5 py-2 text-sm" aria-label="Mi stock">
                <Icon name="caja" className="h-4 w-4" /> <span className="hidden min-[400px]:inline">Mi stock</span>
                {avisos.recibir > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-marca-naranja px-1 text-[11px] font-extrabold text-navy-950">
                    {avisos.recibir}
                  </span>
                )}
              </Link>
            )}
            {onVerAgenda && (
              <button type="button" className="btn btn-sec px-2.5 py-2 text-sm" onClick={onVerAgenda} aria-label="Agenda de la empresa">
                <Icon name="agenda" className="h-4 w-4" /> <span className="hidden min-[400px]:inline">Agenda</span>
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => setFecha((f) => sumarDias(f, -1))} className="btn btn-sec px-2.5 py-2" aria-label="Día anterior"><Icon name="izq" /></button>
          <button onClick={() => setFecha((f) => sumarDias(f, 1))} className="btn btn-sec px-2.5 py-2" aria-label="Día siguiente"><Icon name="der" /></button>
          <p className="flex-1 truncate px-1 font-bold">{fechaLarga(fecha)}</p>
          {!esHoy && <button onClick={() => setFecha(inicioDia(new Date()))} className="chip chip-activo">Hoy</button>}
        </div>
        {lista.length > 0 && cantB2b > 0 && cantB2c > 0 && (
          <div className="mt-2.5 flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Tipo de cliente">
            {FILTROS.map(([v, t]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={filtro === v}
                onClick={() => setFiltro(v)}
                className={`chip shrink-0 text-xs ${filtro === v ? 'chip-activo' : ''}`}
              >
                {t} <span className="opacity-70">{v === 'todos' ? lista.length : v === 'b2b' ? cantB2b : cantB2c}</span>
              </button>
            ))}
          </div>
        )}
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

        {compartir && <ActivarAvisos compacto />}

        {avisos?.recibir > 0 && (
          <Link href="/panel/mi-stock" className="flex items-center gap-3 rounded-2xl border border-amber-400/50 bg-amber-400/10 p-3 text-sm">
            <Icon name="caja" className="h-5 w-5 shrink-0 text-amber-300" />
            <span className="min-w-0 flex-1">
              <b className="block text-tinta-100">
                Tenés {avisos.recibir} {avisos.recibir === 1 ? 'entrega' : 'entregas'} de materiales para confirmar
              </b>
              <span className="text-xs text-tinta-300">Confirmá lo que te llegó para que quede a tu cargo.</span>
            </span>
            <Icon name="der" className="h-4 w-4 shrink-0 text-tinta-400" />
          </Link>
        )}

        {datos.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{datos.error}</p>}
        {aviso && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{aviso}</p>}
        {listo && (
          <p className="flex items-center gap-2 rounded-xl bg-menta-500/10 p-3 text-sm text-menta-200">
            <Icon name="check" className="h-4 w-4 shrink-0" /> {listo}
          </p>
        )}

        {lista.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-tinta-300">
            <span className="font-semibold text-tinta-100">{visibles.length} {visibles.length === 1 ? 'trabajo' : 'trabajos'}</span>
            {filtroReal === 'todos' && <span>· {hechos} {hechos === 1 ? 'terminado' : 'terminados'}</span>}
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
            <p className="mt-1 text-sm text-tinta-400">Cuando te asignen un ticket, un trabajo o un relevamiento, te llega un aviso y aparece acá con la dirección.</p>
          </section>
        ) : (
          <ol className="lista-pc space-y-2.5">
            {visibles.map((item) => (
              <Tarjeta
                key={item.key}
                item={item}
                numero={lista.indexOf(item) + 1}
                ocupado={ocupado === item.key}
                bloqueado={!!enCurso && enCurso.key !== item.key}
                onVer={() => setAbierto({ que: 'detalle', item })}
                onIniciar={() => iniciar(item)}
                onCerrarCon={(opcion) => setAbierto({ que: 'cierre', item, opcion })}
              />
            ))}
          </ol>
        )}
        <p className="pb-4 pt-1 text-center text-xs text-tinta-500">Se actualiza solo. Tocá un trabajo para ver todo el detalle.</p>
      </div>

      {abierto?.que === 'detalle' && (
        <DetalleTrabajo
          item={it}
          cuenta={cuenta}
          recarga={recargaCot}
          ocupado={ocupado === it.key}
          bloqueado={!!enCurso && enCurso.key !== it.key}
          onCerrar={() => setAbierto(null)}
          onIniciar={() => iniciar(it)}
          onCerrarCon={(opcion) => setAbierto({ que: 'cierre', item: it, opcion })}
          onMateriales={conMateriales(it)}
          onCotizar={conCotizar(it)}
        />
      )}

      {abierto?.que === 'cierre' && (
        <CierreTrabajo
          item={it}
          cuenta={cuenta}
          opcionInicial={abierto.opcion}
          onCerrar={() => setAbierto(null)}
          onListo={(resultado) => {
            setAbierto(null);
            setListo(
              resultado === 'finalizado'
                ? 'Trabajo cerrado. Coordinación ya tiene el aviso.'
                : resultado === 'cancelado'
                  ? 'Quedó como cancelado, con el detalle para coordinación.'
                  : resultado === 'suspendido'
                    ? 'Suspendido: volvió a coordinación para reagendar.'
                    : 'Pasado al otro día. Te aparece ese día en tu lista.'
            );
            cargar();
          }}
          onMateriales={conMateriales(it) ? () => setAbierto({ que: 'materiales', item: it, volver: abierto.opcion || 'finalizar' }) : null}
        />
      )}

      <PedirCotizacion
        abierto={abierto?.que === 'cotizar'}
        cuenta={cuenta}
        item={it}
        onCerrar={() => setAbierto({ que: 'detalle', item: it })}
        onListo={(r) => {
          setRecargaCot((n) => n + 1);
          setAbierto({ que: 'detalle', item: it });
          setListo(`Pedido de cotización Nº ${r?.numero ?? ''} enviado a Ventas. Te avisamos cuando esté.`);
        }}
      />

      <Modal
        abierto={abierto?.que === 'materiales'}
        onCerrar={() => setAbierto(abierto?.volver ? { que: 'cierre', item: it, opcion: abierto.volver } : { que: 'detalle', item: it })}
        titulo="Materiales del trabajo"
      >
        {abierto?.que === 'materiales' && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-tinta-200">{it.titulo}</p>
            <MaterialesTrabajo
              cuenta={cuenta}
              tipo={it.rpc}
              id={it.id}
              modo="operario"
              onCambio={() => {
                cargarAvisos();
                avisar();
              }}
            />
          </div>
        )}
      </Modal>
    </>
  );
}

function Tarjeta({ item, numero, ocupado, bloqueado, onVer, onIniciar, onCerrarCon }) {
  const info = ESTADOS_TRABAJO[item.estado] || ESTADOS_TRABAJO.pendiente;
  const tipo = TIPO[item.tipo] || TIPO.trabajo;
  const terminado = item.estado === 'finalizado';
  const corriendo = item.estado === 'en_curso';
  const empezado = item.tiempos.some((t) => t?.inicio);
  return (
    <li
      className={`tarjeta overflow-hidden border-l-4 ${item.b2b ? 'border-l-[#0a84ff]' : 'border-l-violet-400'} ${corriendo ? 'ring-1 ring-[#0a84ff]/60' : ''} ${terminado ? 'opacity-65' : ''}`}
    >
      <button type="button" onClick={onVer} className="flex w-full gap-3 p-3.5 text-left hover:bg-navy-850/60">
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center text-sm font-extrabold text-navy-950 ${item.tipo === 'relevamiento' ? 'rounded-lg bg-marca-naranja' : 'rounded-full'}`}
          style={item.tipo === 'relevamiento' ? undefined : { background: item.color }}
        >
          {terminado ? <Icon name="check" className="h-4 w-4" /> : numero}
        </span>
        <span className="block min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <EtiquetaCliente b2b={item.b2b} />
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${info.clase}`}>
              {corriendo && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0a84ff]" />}
              {info.texto}
            </span>
          </span>
          <span className="mt-1 block truncate font-bold leading-tight">{item.titulo}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-tinta-400">
            <Icon name={tipo.icono} className="h-3.5 w-3.5" /> {tipo.texto} · <b className="text-tinta-200">{item.cuando}</b>
            {item.deOtroDia && <span className="rounded bg-[#176ba8]/30 px-1.5 text-[#8cc4ee]">Viene de otro día</span>}
            {corriendo && (
              <>
                · <Reloj tiempos={item.tiempos} className="font-bold text-[#8cc8ff]" />
              </>
            )}
          </span>
          {item.lugar && (
            <span className="mt-1 flex items-center gap-1.5 text-sm text-tinta-200">
              <Icon name="pin" className="h-3.5 w-3.5 shrink-0 text-tinta-400" />
              <span className="truncate">{item.lugar.direccion || 'Ubicación marcada en el mapa'}</span>
            </span>
          )}
          {item.pedido && <span className="mt-1 line-clamp-2 text-[13px] leading-snug text-tinta-300">{item.pedido}</span>}
          {item.nota && !terminado && (
            <span className="mt-1 block truncate text-xs text-red-300">
              {item.estado === 'multidia' ? 'Avance' : 'Motivo'}: {item.nota}
            </span>
          )}
        </span>
      </button>

      {corriendo && <BotonesCierre onCerrarCon={onCerrarCon} className="border-t border-navy-800 p-2.5" />}
      {!terminado && !corriendo && (
        <div className="flex gap-2 border-t border-navy-800 p-2.5">
          <button type="button" className="btn btn-menta flex-1 py-2.5 font-extrabold" onClick={onIniciar} disabled={ocupado || bloqueado} title={bloqueado ? 'Primero cerrá el trabajo en curso' : undefined}>
            <Icon name="play" className="h-5 w-5" /> {ocupado ? 'Iniciando…' : empezado ? 'Retomar' : 'Iniciar'}
          </button>
          {item.lugar && (
            <a href={linkGoogleMaps(item.lugar)} target="_blank" rel="noreferrer" className="btn btn-sec px-3.5 py-2.5 text-sm" aria-label="Cómo llegar">
              <Icon name="ir" className="h-4 w-4" /> Ir
            </a>
          )}
          <button type="button" className="btn btn-sec px-3.5 py-2.5 text-sm" onClick={onVer}>
            <Icon name="ojo" className="h-4 w-4" /> Ver
          </button>
        </div>
      )}
    </li>
  );
}
