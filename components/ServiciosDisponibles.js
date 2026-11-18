'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import Mapa from './Mapa';
import Modal from './Modal';
import ArchivosMatch from './ArchivosMatch';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/util';
import { metrosEntre } from '@/lib/orden';
import { textoDistancia } from '@/lib/ruta';
import { cuandoTexto, fecha, hora, pesos, sinMatch } from '@/lib/match';

const FALTA_SQL = 'Falta activar "el primero disponible": corré el SQL 20 en Supabase.';

// Horas posibles de llegada: desde lo antes posible (redondeado a 15 min) hasta que entre la visita en la franja
function horasPosibles(desde, hasta, duracionMin, paso) {
  const r = [];
  const ini = new Date(Math.max(new Date(desde).getTime(), Date.now() + 15 * 60e3));
  ini.setSeconds(0, 0);
  ini.setMinutes(Math.ceil(ini.getMinutes() / paso) * paso);
  const fin = new Date(hasta).getTime() - duracionMin * 60e3;
  for (let t = ini.getTime(); t <= fin && r.length < 48; t += paso * 60e3) r.push(new Date(t));
  return r;
}

/**
 * Pedidos "el primero disponible" que esta cuenta puede tomar (Pro y Business del rubro).
 * El técnico ve la zona aproximada; la dirección y el teléfono aparecen cuando lo toma.
 */
export default function ServiciosDisponibles({ cuenta, ubicacion = null, conMapa = true, propsMapa = {}, alto = 360 }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [elegido, setElegido] = useState(null);
  const [cotizando, setCotizando] = useState(null);
  const [tomado, setTomado] = useState(null);
  const [aviso, setAviso] = useState('');
  const refs = useRef({});

  const cargar = useCallback(async () => {
    if (!cuenta) return;
    const { data, error: err } = await supabase.rpc('servicios_disponibles', { p_cuenta: cuenta });
    if (err) return setError(sinMatch(err) ? FALTA_SQL : mensajeError(err));
    setError('');
    setDatos(data);
  }, [cuenta]);

  useEffect(() => {
    cargar();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') cargar();
    }, 60e3);
    return () => clearInterval(t);
  }, [cargar]);

  if (error) return <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>;
  if (!datos) return <p className="py-8 text-center text-sm text-tinta-400">Buscando pedidos…</p>;

  if (!datos.plan_ok) {
    return (
      <section className="tarjeta flex items-start gap-3 p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-menta-500/15 text-menta-300"><Icon name="match" /></span>
        <div className="min-w-0 text-sm">
          <b className="block">Pedidos de clientes en el mapa</b>
          <p className="mt-0.5 text-tinta-300">
            Con Pro o Business ves en el mapa los clientes que piden &ldquo;el primero disponible&rdquo; en tu rubro y, si quedaste libre, los tomás y los atendés. La visita ya viene paga.
          </p>
          <Link href="/panel/planes" className="btn btn-menta mt-3 inline-flex px-4 py-2 text-sm">Ver planes</Link>
        </div>
      </section>
    );
  }

  const faltan = [
    !datos.disponible && 'activar Match',
    !datos.rubros && 'elegir tus rubros',
    !datos.cobro_ok && 'cargar la cuenta bancaria',
  ].filter(Boolean);

  const lista = (datos.servicios || []).map((x) => ({
    ...x,
    metros: ubicacion?.lat && x.lat !== null ? metrosEntre(ubicacion, { lat: Number(x.lat), lng: Number(x.lng) }) : null,
  }));
  if (ubicacion?.lat) lista.sort((a, b) => (a.cuando === 'hoy') !== (b.cuando === 'hoy') ? (a.cuando === 'hoy' ? -1 : 1) : (a.metros ?? 1e9) - (b.metros ?? 1e9));

  const puntos = lista
    .filter((x) => x.lat !== null)
    .map((x) => ({ id: x.id, lat: Number(x.lat), lng: Number(x.lng), forma: 'match', urgente: x.cuando === 'hoy', popup: `${x.rubro} · ${x.titulo}\n${cuandoTexto(x)}` }));

  function irA(id) {
    refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setElegido(lista.find((x) => x.id === id) || null);
  }

  return (
    <div className="space-y-3">
      {faltan.length > 0 && (
        <Link href="/panel/match?ver=perfil" className="block rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">
          Para ver y tomar pedidos te falta {faltan.join(', ')}. Tocá acá.
        </Link>
      )}
      {aviso && <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">{aviso}</p>}
      {tomado && (
        <div className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-200">
          {tomado.pagoPendiente ? (
            <>Lo tomaste: <b>{tomado.titulo}</b>, el {fecha(tomado.inicio)} a las {hora(tomado.inicio)}. Le mandamos al cliente el link para pagar; te avisamos cuando pague.</>
          ) : (
            <>¡Es tuyo! <b>{tomado.titulo}</b>, el {fecha(tomado.inicio)} a las {hora(tomado.inicio)}. Ya está en tu agenda con la dirección y el teléfono del cliente.</>
          )}{' '}
          <Link href="/panel/match?ver=visitas" className="font-bold underline">Ver la visita</Link>
        </div>
      )}
      {conMapa && (
        <div>
          <Mapa key="servicios" alto={alto} puntos={puntos} onPunto={irA} encuadrarSiempre={false} {...propsMapa} />
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-tinta-400">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full bg-[#ff8a5c] ring-2 ring-white/80" /> Para hoy</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full bg-menta-400 ring-2 ring-white/80" /> Otro día</span>
            <span>Zona aproximada (~1 km): la dirección exacta la ves al tomarlo.</span>
          </p>
        </div>
      )}
      {datos.urgencias === false && (
        <p className="text-xs text-tinta-400">
          Los pedidos fuera de horario los ven solo los que atienden urgencias (y te quedan más).{' '}
          <Link href="/panel/match?ver=perfil" className="font-semibold text-menta-300 underline">Activalo en tu perfil Match</Link>.
        </p>
      )}
      {lista.length === 0 ? (
        <p className="tarjeta p-4 text-center text-sm text-tinta-300">
          Ahora no hay pedidos para tomar en tus rubros. Cuando un cliente pida &ldquo;el primero disponible&rdquo;, aparece acá{datos.disponible ? ' y te avisamos si es en tu zona' : ''}.
        </p>
      ) : (
        <ul className="space-y-2 pc:grid pc:grid-cols-2 pc:gap-2 pc:space-y-0">
          {lista.map((x) => (
            <li key={x.id} ref={(el) => { refs.current[x.id] = el; }} className={`tarjeta p-3.5 ${elegido?.id === x.id ? 'border-menta-400' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-menta-300">
                    {x.rubro}
                    <span className={`ml-2 rounded-full px-1.5 py-0.5 ${x.cuando === 'hoy' ? 'bg-[#ff8a5c]/20 text-[#ffb38f]' : 'bg-navy-700 text-tinta-200'}`}>{cuandoTexto(x)}</span>
                    {x.urgencia && <span className="ml-1.5 rounded-full bg-[#ff5c5c]/20 px-1.5 py-0.5 text-[#ffb3b3]">Urgencia</span>}
                  </p>
                  <h3 className="mt-0.5 font-bold">{x.titulo}</h3>
                  <p className="text-xs text-tinta-400">
                    {[x.localidad, x.departamento].filter(Boolean).join(', ')}
                    {x.metros !== null ? ` · a ${textoDistancia(x.metros)} de vos (aprox.)` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-right">
                  <b className="block text-menta-300">{pesos(x.neto)}</b>
                  <span className="text-[11px] text-tinta-400">{x.pago === 'al_tomar' ? 'para vos' : 'para vos, ya pago'}</span>
                </span>
              </div>
              <p className="mt-1.5 line-clamp-3 text-sm text-tinta-200">{x.descripcion}</p>
              {x.archivos?.length > 0 && <div className="mt-2"><ArchivosMatch rutas={x.archivos} tam="h-14 w-14" /></div>}
              {x.canal === 'whatsapp' && <p className="mt-1.5 text-[11px] text-tinta-400">Pedido por WhatsApp: el cliente paga cuando lo tomás o cuando acepta tu cotización.</p>}
              {x.mi_cotizacion && (
                <p className={`mt-2 rounded-lg p-2 text-xs ${x.mi_cotizacion.estado === 'pendiente' ? 'bg-[#0a84ff]/10 text-[#8cc8ff]' : 'bg-navy-850 text-tinta-400'}`}>
                  {x.mi_cotizacion.estado === 'pendiente'
                    ? `Cotizaste ${pesos(x.mi_cotizacion.precio)} para las ${hora(x.mi_cotizacion.inicio)}: el cliente la está viendo.`
                    : 'Tu cotización ya no está vigente.'}
                </p>
              )}
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <span className="text-[11px] text-tinta-500">Disponible hasta las {hora(x.limite_toma)}</span>
                <span className="flex gap-1.5">
                  {x.cotizable && (
                    <button type="button" className="btn btn-sec px-3 py-2 text-sm" onClick={() => setCotizando(x)}>{x.mi_cotizacion?.estado === 'pendiente' ? 'Cambiar' : 'Cotizar'}</button>
                  )}
                  <button type="button" className="btn btn-menta px-4 py-2 text-sm" onClick={() => setElegido(x)}>Tomar</button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {cotizando && (
        <Cotizar
          x={cotizando}
          cuenta={cuenta}
          datos={datos}
          onCerrar={() => setCotizando(null)}
          onListo={() => {
            setCotizando(null);
            setAviso('Listo: le mandamos tu cotización al cliente. Si la acepta y paga, te avisamos y queda en tu agenda.');
            cargar();
          }}
          onYaNo={(m) => {
            setAviso(m);
            setCotizando(null);
            cargar();
          }}
        />
      )}
      {elegido && (
        <Tomar
          x={elegido}
          cuenta={cuenta}
          duracion={datos.duracion_visita_min || 60}
          onCerrar={() => setElegido(null)}
          onListo={(r) => {
            setAviso('');
            setTomado({ ...r, titulo: elegido.titulo });
            setElegido(null);
            cargar();
          }}
          onYaNo={(m) => {
            setAviso(m);
            setElegido(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}

function Tomar({ x, cuenta, duracion, onCerrar, onListo, onYaNo }) {
  const opciones = horasPosibles(x.desde, x.hasta, duracion, x.cuando === 'hoy' ? 15 : 30);
  const [hora_, setHora] = useState(opciones[0]?.toISOString() || '');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  async function tomar() {
    setOcupado(true);
    setError('');
    const { data, error: err } = await supabase.rpc('tomar_servicio', { p_solicitud: x.id, p_cuenta: cuenta, p_inicio: hora_ });
    setOcupado(false);
    if (err) {
      const m = mensajeError(err);
      if (/ya tomó|ya no está disponible/.test(m)) return onYaNo(m);
      return setError(m);
    }
    onListo({ ...data, pagoPendiente: !!data?.pago_pendiente });
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo="Tomar el servicio">
      <div className="space-y-3 text-sm">
        <p>
          <b>{x.titulo}</b> · {x.rubro}
          <span className="block text-xs text-tinta-400">{[x.localidad, x.departamento].filter(Boolean).join(', ')} · {cuandoTexto(x)}</span>
        </p>
        {opciones.length === 0 ? (
          <p className="rounded-xl bg-amber-400/10 p-3 text-amber-100">Ya no quedan horarios para llegar dentro de lo que pidió el cliente.</p>
        ) : (
          <>
            <p className="etiqueta">¿A qué hora llegás?</p>
            <div className="grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto">
              {opciones.map((d) => (
                <button key={d.toISOString()} type="button" onClick={() => setHora(d.toISOString())} className={`chip justify-center text-xs ${hora_ === d.toISOString() ? 'chip-activo' : ''}`}>
                  {hora(d.toISOString())}
                </button>
              ))}
            </div>
          </>
        )}
        <ul className="space-y-1 rounded-xl bg-navy-850 p-3 text-xs text-tinta-300">
          {x.pago === 'al_tomar' ? (
            <>
              <li>• Al tomarlo, al cliente le llega el link para pagar {pesos(x.importe)}. Tiene 30 minutos; si no paga, el pedido vuelve al mapa y se libera tu agenda.</li>
              <li>• Cuando paga, te quedan {pesos(x.neto)} y ves la dirección y el teléfono del cliente.</li>
            </>
          ) : (
            <>
              <li>• La visita ya está paga: te quedan {pesos(x.neto)} y TaListo! te los transfiere cuando el cliente la confirma.</li>
              <li>• Al tomarlo ves la dirección y el teléfono del cliente, y entra a tu agenda.</li>
            </>
          )}
          <li>• Si después no podés ir, cancelala desde Match: al cliente se le devuelve todo.</li>
        </ul>
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-red-300">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn btn-sec flex-1 py-2.5" onClick={onCerrar}>Volver</button>
          <button type="button" className="btn btn-menta flex-1 py-2.5" disabled={ocupado || !hora_ || !opciones.length} onClick={tomar}>
            {ocupado ? 'Tomando…' : 'Tomar el servicio'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Cotizar un pedido de WhatsApp: tu precio (lo que recibís) y a qué hora llegás
function Cotizar({ x, cuenta, datos, onCerrar, onListo, onYaNo }) {
  const opciones = horasPosibles(x.desde, x.hasta, datos.duracion_visita_min || 60, x.cuando === 'hoy' ? 15 : 30);
  const [hora_, setHora] = useState(x.mi_cotizacion?.inicio || opciones[0]?.toISOString() || '');
  const [precio, setPrecio] = useState(String(x.mi_cotizacion?.precio || x.neto || ''));
  const [mensaje, setMensaje] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const tarifa = Number(x.urgencia ? datos.tarifa_talisto_urgencia : datos.tarifa_talisto) || 0;
  const n = Math.round(Number(precio) || 0);

  async function enviar() {
    setOcupado(true);
    setError('');
    const { error: err } = await supabase.rpc('cotizar_servicio', { p_solicitud: x.id, p_cuenta: cuenta, p_precio: n, p_inicio: hora_, p_mensaje: mensaje });
    setOcupado(false);
    if (err) {
      const m = mensajeError(err);
      if (/ya no está disponible|ya tiene técnico/.test(m)) return onYaNo(m);
      return setError(m);
    }
    onListo();
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo="Mandar cotización">
      <div className="space-y-3 text-sm">
        <p>
          <b>{x.titulo}</b> · {x.rubro}
          <span className="block text-xs text-tinta-400">{[x.localidad, x.departamento].filter(Boolean).join(', ')} · {cuandoTexto(x)}</span>
        </p>
        <label className="block">
          <span className="etiqueta">Tu precio por la visita (lo que recibís)</span>
          <input type="number" inputMode="numeric" min={datos.cotizacion_min || 0} max={datos.cotizacion_max || undefined} className="campo" value={precio} onChange={(e) => setPrecio(e.target.value)} />
          <span className="mt-1 block text-[11px] text-tinta-400">
            El cliente ve {pesos(n + tarifa)} ({pesos(n)} tuyos + {pesos(tarifa)} de TaListo!). Precio base: {pesos(x.neto)}.
          </span>
        </label>
        {opciones.length === 0 ? (
          <p className="rounded-xl bg-amber-400/10 p-3 text-amber-100">Ya no quedan horarios dentro de lo que pidió el cliente.</p>
        ) : (
          <>
            <p className="etiqueta">¿A qué hora llegás?</p>
            <div className="grid max-h-44 grid-cols-4 gap-1.5 overflow-y-auto">
              {opciones.map((d) => (
                <button key={d.toISOString()} type="button" onClick={() => setHora(d.toISOString())} className={`chip justify-center text-xs ${new Date(hora_).getTime() === d.getTime() ? 'chip-activo' : ''}`}>
                  {hora(d.toISOString())}
                </button>
              ))}
            </div>
          </>
        )}
        <textarea className="campo min-h-[3.5rem] text-sm" maxLength={300} value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder="Mensaje para el cliente (opcional): qué incluye, si llevás repuestos…" />
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-red-300">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn btn-sec flex-1 py-2.5" onClick={onCerrar}>Volver</button>
          <button type="button" className="btn btn-menta flex-1 py-2.5" disabled={ocupado || !hora_ || !opciones.length || n <= 0} onClick={enviar}>
            {ocupado ? 'Enviando…' : `Cotizar ${pesos(n + tarifa)}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
