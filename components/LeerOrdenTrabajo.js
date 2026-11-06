'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import SelectorUbicacion from './SelectorUbicacion';
import TextoEspera from './TextoEspera';
import { supabase } from '@/lib/supabase';
import { avisar } from '@/lib/avisos';
import { useEquipoAsignable } from '@/lib/equipo';
import { fechaCorta, fechaISO } from '@/lib/fechas';
import { comprimirImagen } from '@/lib/imagenes';
import { MAX_TEXTO, empresaDeLaOrden } from '@/lib/ordenesIA';
import { leerCierres, nombrePlanilla, planillaDeFecha, rangoPlanilla, textoRango } from '@/lib/periodos';
import { mensajeError } from '@/lib/util';

const TIPOS_OK = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_PDF = 2.8 * 1024 * 1024;
const idNuevo = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const aBase64 = (blob) =>
  new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = mal;
    r.readAsDataURL(blob);
  });

// Un punto en el mapa solo si encontró la puerta: el medio de una calle larga puede quedar a kilómetros,
// y el "Ir" llevaría ahí. Sin punto, Ir y Waze buscan la dirección escrita.
async function buscarPunto(direccion) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=uy&limit=1&accept-language=es&q=${encodeURIComponent(direccion)}`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    const datos = await r.json();
    const x = Array.isArray(datos) ? datos[0] : null;
    return x?.address?.house_number ? { lat: Number(x.lat), lng: Number(x.lon) } : null;
  } catch {
    return null;
  }
}

function armarFila(o, empresas, empresaId) {
  const empresa = empresaDeLaOrden(o.empresa, empresas) || empresas.find((e) => e.id === empresaId) || (empresas.length === 1 ? empresas[0] : null);
  return {
    k: idNuevo(),
    incluir: true,
    forzar: false,
    repetida: '',
    empresa_id: empresa?.id || '',
    numero_ticket: o.numero_orden,
    numero_cliente: o.numero_cliente,
    codigo_bykom: o.codigo_bykom,
    cliente_final: o.cliente,
    telefono: o.telefono,
    fecha: o.fecha,
    desde: o.hora_inicio,
    hasta: o.hora_fin,
    direccion: o.direccion,
    referencia: o.referencia,
    pedido: o.detalle,
    nota: o.nota,
    asignado_a: '',
    lat: null,
    lng: null,
    ubicando: !!o.direccion,
    verMapa: false,
    abierta: false,
  };
}

// Lo que falta para poder cargar el ticket
function faltaDe(f) {
  if (!f.empresa_id) return 'Elegí el cliente B2B.';
  if (!f.fecha) return 'La orden no dice qué día: elegí la fecha.';
  if (f.hasta && !f.desde) return 'Poné la hora de inicio.';
  if (f.desde && f.hasta && f.hasta <= f.desde) return 'La hora de fin tiene que ser después de la de inicio.';
  return '';
}

function Ficha({ f, empresas, asignables, onCambiar }) {
  const falta = f.incluir ? faltaDe(f) : '';
  const empresa = empresas.find((e) => e.id === f.empresa_id);
  const abierta = f.abierta || !!falta;
  const horario = f.desde ? `${f.desde}${f.hasta ? `–${f.hasta}` : ''}` : 'Sin hora';
  const tienePin = f.lat !== null;
  const id = (campo) => `o-${f.k}-${campo}`;

  return (
    <li className={`tarjeta p-3 ${f.incluir ? '' : 'opacity-60'}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0 accent-[#2cc79b]"
          checked={f.incluir}
          onChange={(e) => onCambiar({ incluir: e.target.checked, forzar: e.target.checked && !!f.repetida })}
          aria-label={`Cargar ${f.numero_ticket || 'esta orden'}`}
        />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onCambiar({ abierta: !f.abierta })} aria-expanded={abierta}>
          <span className="block truncate font-bold">{f.numero_ticket ? `Orden ${f.numero_ticket}` : 'Sin nº de orden'}</span>
          {(f.numero_cliente || f.codigo_bykom) && (
            <span className="block truncate text-sm font-semibold text-tinta-200">
              {[f.numero_cliente && `Cliente ${f.numero_cliente}`, f.codigo_bykom && `Bykom ${f.codigo_bykom}`].filter(Boolean).join(' · ')}
            </span>
          )}
          <span className="block truncate text-sm text-tinta-300">
            {f.fecha ? fechaCorta(`${f.fecha}T00:00`) : 'Sin fecha'} · {horario}
            {empresa && empresas.length > 1 ? ` · ${empresa.nombre}` : ''}
          </span>
          <span className="block truncate text-sm text-tinta-300">{[f.cliente_final, f.direccion].filter(Boolean).join(' · ') || 'Sin dirección'}</span>
          {!abierta && f.pedido && <span className="mt-0.5 line-clamp-2 block text-sm text-tinta-400">{f.pedido}</span>}
        </button>
        <span className="mt-0.5 shrink-0 text-tinta-400"><Icon name={abierta ? 'arriba' : 'abajo'} className="h-4 w-4" /></span>
      </div>

      {f.repetida && <p className="mt-2 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-xs text-amber-200">{f.repetida}{f.forzar ? ' Se carga igual.' : ' Tildala si es otro trabajo.'}</p>}
      {f.nota && <p className="mt-2 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-xs text-amber-200">La IA avisa: {f.nota}</p>}
      {falta && <p className="mt-2 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300">{falta}</p>}

      {abierta && (
        <div className="mt-3 space-y-3 border-t border-navy-800 pt-3">
          {empresas.length > 1 && (
            <div>
              <label className="etiqueta" htmlFor={id('empresa')}>Cliente B2B</label>
              <select id={id('empresa')} className="campo" value={f.empresa_id} onChange={(e) => onCambiar({ empresa_id: e.target.value })}>
                <option value="">Elegí el cliente</option>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>{e.nombre}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="etiqueta" htmlFor={id('tk')}>Nº de orden / ticket</label>
            <input id={id('tk')} className="campo" value={f.numero_ticket} onChange={(e) => onCambiar({ numero_ticket: e.target.value })} placeholder="No figura en la orden" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="etiqueta" htmlFor={id('cli')}>Código de cliente</label>
              <input id={id('cli')} className="campo" value={f.numero_cliente} onChange={(e) => onCambiar({ numero_cliente: e.target.value })} placeholder="No figura" />
            </div>
            <div>
              <label className="etiqueta" htmlFor={id('bykom')}>Código Bykom</label>
              <input id={id('bykom')} className="campo" maxLength={60} value={f.codigo_bykom} onChange={(e) => onCambiar({ codigo_bykom: e.target.value })} placeholder="No figura" />
            </div>
          </div>
          <p className="text-xs text-tinta-400">Si falta un código se carga igual y lo completás después en el ticket.</p>
          <div>
            <label className="etiqueta" htmlFor={id('fecha')}>Fecha</label>
            <input id={id('fecha')} type="date" className="campo" value={f.fecha} onChange={(e) => onCambiar({ fecha: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="etiqueta" htmlFor={id('desde')}>Desde</label>
              <input id={id('desde')} type="time" step="900" className="campo" value={f.desde} onChange={(e) => onCambiar({ desde: e.target.value })} />
            </div>
            <div>
              <label className="etiqueta" htmlFor={id('hasta')}>Hasta (opcional)</label>
              <input id={id('hasta')} type="time" step="900" className="campo" value={f.hasta} onChange={(e) => onCambiar({ hasta: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="etiqueta" htmlFor={id('final')}>Cliente</label>
            <input id={id('final')} className="campo" value={f.cliente_final} onChange={(e) => onCambiar({ cliente_final: e.target.value })} />
          </div>
          <div>
            <label className="etiqueta" htmlFor={id('tel')}>Teléfono</label>
            <input id={id('tel')} type="tel" inputMode="tel" maxLength={40} className="campo" value={f.telefono} onChange={(e) => onCambiar({ telefono: e.target.value })} />
          </div>
          <div>
            <label className="etiqueta" htmlFor={id('dir')}>Dirección</label>
            {f.verMapa ? (
              <SelectorUbicacion
                valor={{ direccion: f.direccion, lat: f.lat, lng: f.lng }}
                onChange={(u) => onCambiar({ direccion: u.direccion || '', lat: u.lat ?? null, lng: u.lng ?? null, ubicando: false })}
                alto={180}
              />
            ) : (
              <>
                <input id={id('dir')} className="campo" value={f.direccion} onChange={(e) => onCambiar({ direccion: e.target.value, lat: null, lng: null, ubicando: false })} />
                <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                  <span className={tienePin ? 'text-menta-300' : 'text-tinta-400'}>
                    {f.ubicando ? 'Buscando en el mapa…' : tienePin ? 'Ubicada en el mapa' : 'Sin punto en el mapa: Ir y Waze buscan la dirección escrita'}
                  </span>
                  <button type="button" className="shrink-0 font-semibold text-marca-naranja" onClick={() => onCambiar({ verMapa: true })}>
                    {tienePin ? 'Corregir' : 'Marcar'}
                  </button>
                </div>
              </>
            )}
            <input className="campo mt-2" value={f.referencia} onChange={(e) => onCambiar({ referencia: e.target.value })} placeholder="Referencia: apto, timbre, portería…" aria-label="Referencia" />
          </div>
          <div>
            <label className="etiqueta" htmlFor={id('pedido')}>Tarea a realizar</label>
            <textarea id={id('pedido')} rows={3} className="campo" value={f.pedido} onChange={(e) => onCambiar({ pedido: e.target.value })} />
          </div>
          {asignables.length > 0 && (
            <div>
              <label className="etiqueta" htmlFor={id('asig')}>Asignado a</label>
              <select id={id('asig')} className="campo" value={f.asignado_a} onChange={(e) => onCambiar({ asignado_a: e.target.value })}>
                <option value="">— Sin asignar —</option>
                {asignables.map((p) => (
                  <option key={p.usuario_id} value={p.usuario_id}>{p.nombre}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Orden de trabajo (foto, PDF o texto de un mail) → la IA la lee → se revisa → tickets B2B en la agenda.
 * Cada ticket queda pendiente y entra en la planilla de su empresa cuando se finaliza.
 * empresaId: el cliente B2B que se estaba viendo (si la IA no reconoce la empresa, va a ese).
 */
export default function LeerOrdenTrabajo({ abierto, onCerrar, onListo, cuenta, empresas = [], empresaId = '' }) {
  const equipo = useEquipoAsignable();
  const conEquipo = !!equipo?.hayEquipo && equipo.disponible;
  const asignables = conEquipo ? equipo.equipo.filter((p) => p.trabaja) : [];

  const [paso, setPaso] = useState('elegir');
  const [texto, setTexto] = useState('');
  const [archivos, setArchivos] = useState([]); // { id, file, url, tipo }
  const [filas, setFilas] = useState([]);
  const [uso, setUso] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [hecho, setHecho] = useState(null);
  const camara = useRef(null);
  const subir = useRef(null);
  const lectura = useRef(0); // para frenar la búsqueda en el mapa al cerrar

  useEffect(() => {
    if (!abierto) {
      lectura.current += 1;
      return;
    }
    setPaso('elegir');
    setTexto('');
    setArchivos([]);
    setFilas([]);
    setError('');
    setHecho(null);
    supabase.rpc('uso_lectura_ordenes', { p_cuenta: cuenta }).then(({ data }) => setUso(data || null));
  }, [abierto, cuenta]);

  if (!abierto) return null;

  const cambiarFila = (k, cambios) => setFilas((lista) => lista.map((f) => (f.k === k ? { ...f, ...cambios } : f)));
  const incluidas = filas.filter((f) => f.incluir);
  const restan = uso && uso.limite != null ? Math.max(0, uso.limite - (uso.usadas || 0)) : null;

  function agregar(lista) {
    setError('');
    const nuevos = [];
    for (const file of Array.from(lista || [])) {
      if (!TIPOS_OK.includes(file.type) && !file.type.startsWith('image/')) {
        setError('Ese formato no sirve: usá una foto (JPG o PNG) o un PDF. Si es un mail, pegá el texto.');
        continue;
      }
      if (file.type === 'application/pdf' && file.size > MAX_PDF) {
        setError('El PDF pesa más de 2,8 MB. Probá sacándole una foto.');
        continue;
      }
      nuevos.push({ id: idNuevo(), file, tipo: file.type, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : '' });
    }
    setArchivos((a) => [...a, ...nuevos].slice(0, 3));
  }

  // Marca lo que ya está cargado (o repetido en la misma orden) y lo deja sin tildar
  async function marcarRepetidas(lista) {
    const numeros = [...new Set(lista.filter((f) => f.incluir && !f.forzar && f.numero_ticket.trim()).map((f) => f.numero_ticket.trim()))];
    if (!numeros.length) return { lista, hay: false };
    const { data } = await supabase.from('ordenes').select('empresa_id, numero_ticket, fecha').eq('profesional_id', cuenta).in('numero_ticket', numeros);
    const cargadas = new Map((data || []).map((o) => [`${o.empresa_id}|${o.numero_ticket}`, o.fecha]));
    const vistas = new Set();
    let hay = false;
    const nueva = lista.map((f) => {
      if (!f.incluir || f.forzar || !f.numero_ticket.trim()) return f;
      const clave = `${f.empresa_id}|${f.numero_ticket.trim()}`;
      const fecha = cargadas.get(clave);
      const repetida = fecha ? `Ya está cargada para el ${fecha.split('-').reverse().join('/')}.` : vistas.has(clave) ? 'Aparece dos veces en esta orden.' : '';
      vistas.add(clave);
      if (!repetida) return f;
      hay = true;
      return { ...f, repetida, incluir: false };
    });
    return { lista: nueva, hay };
  }

  // Busca las direcciones de a una (el servicio de mapas pide no más de una por segundo)
  async function ubicar(lista) {
    const vuelta = ++lectura.current;
    for (const f of lista.filter((x) => x.direccion)) {
      if (vuelta !== lectura.current) return;
      const punto = await buscarPunto(f.direccion);
      if (vuelta !== lectura.current) return;
      setFilas((actual) =>
        actual.map((x) => (x.k !== f.k || !x.ubicando ? x : { ...x, ubicando: false, ...(punto || {}) }))
      );
      await espera(1100);
    }
  }

  async function leer() {
    setError('');
    setPaso('leyendo');
    const abierta = lectura.current; // si cierran el modal mientras lee, la respuesta se descarta
    try {
      const paraIA = [];
      for (const a of archivos) {
        const pdf = a.tipo === 'application/pdf';
        const blob = pdf ? a.file : await comprimirImagen(a.file, 1600, 0.85);
        const tipo = pdf ? 'application/pdf' : blob.type || 'image/jpeg';
        if (!TIPOS_OK.includes(tipo)) throw new Error('No pudimos procesar esa foto. Probá sacándola de nuevo.');
        paraIA.push({ tipo, datos: await aBase64(blob) });
      }
      const { data: s } = await supabase.auth.getSession();
      const r = await fetch('/api/ordenes/leer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token || ''}` },
        body: JSON.stringify({ cuenta, archivos: paraIA, texto: texto.trim(), empresas: empresas.map((e) => e.nombre) }),
      });
      const res = await r.json().catch(() => ({}));
      if (abierta !== lectura.current) return;
      if (!r.ok) throw new Error(res.pista ? `${res.error} ${res.pista}` : res.error || 'No se pudo leer la orden. Probá de nuevo.');
      setUso((u) => ({ ...(u || {}), usadas: res.usadas, limite: res.limite }));
      const armadas = (res.ordenes || []).map((o) => armarFila(o, empresas, empresaId));
      if (armadas.length === 1) armadas[0].abierta = true;
      const { lista } = await marcarRepetidas(armadas);
      setFilas(lista);
      setPaso('revisar');
      ubicar(lista);
    } catch (e) {
      setError(e.message || 'No se pudo leer la orden.');
      setPaso('elegir');
    }
  }

  // Cada ticket se carga igual que uno hecho a mano: con la misma tarifa y su historial
  function filaTicket(f, conTelefono, conBykom) {
    const e = empresas.find((x) => x.id === f.empresa_id);
    const fila = {
      profesional_id: cuenta,
      empresa_id: f.empresa_id,
      numero_cliente: f.numero_cliente.trim() || null,
      numero_ticket: f.numero_ticket.trim() || null,
      fecha: f.fecha,
      hora_inicio: f.desde || null,
      hora_fin: f.desde && f.hasta ? f.hasta : null,
      cliente_final: f.cliente_final.trim() || null,
      direccion: f.direccion.trim() || null,
      referencia: f.referencia.trim() || null,
      lat: f.lat,
      lng: f.lng,
      pedido: f.pedido.trim() || null,
      acondicionamientos: 1,
      moes: 0,
      precio_acondicionamiento: e?.precio_acondicionamiento ?? null,
      factor_moe: Number(e?.factor_moe) || 1.75,
      estado: 'pendiente',
    };
    if (conTelefono) fila.telefono_contacto = f.telefono.trim().slice(0, 40) || null;
    if (conBykom) fila.codigo_bykom = f.codigo_bykom.trim().slice(0, 60) || null;
    if (conEquipo) fila.asignado_a = f.asignado_a || null;
    return fila;
  }

  async function cargar() {
    setError('');
    const conFalta = incluidas.find((f) => faltaDe(f));
    if (conFalta) return setError(`Falta completar: ${faltaDe(conFalta)}`);
    setGuardando(true);
    const revisadas = await marcarRepetidas(filas);
    if (revisadas.hay) {
      setFilas(revisadas.lista);
      setGuardando(false);
      return setError('Algunas ya estaban cargadas y quedaron sin tildar. Tildalas si querés cargarlas igual.');
    }
    const conTelefono = incluidas.some((f) => f.telefono.trim());
    const conBykom = incluidas.some((f) => f.codigo_bykom.trim());
    const { error: err } = await supabase.from('ordenes').insert(incluidas.map((f) => filaTicket(f, conTelefono, conBykom)));
    setGuardando(false);
    if (err) return setError(mensajeError(err));
    lectura.current += 1;

    // A qué planilla va cada uno
    const grupos = new Map();
    incluidas.forEach((f) => {
      const e = empresas.find((x) => x.id === f.empresa_id);
      const cierres = leerCierres(e?.cierre_planilla);
      const periodo = planillaDeFecha(cierres, f.fecha);
      const clave = `${f.empresa_id}|${periodo.anio}-${periodo.mes}`;
      const g = grupos.get(clave) || { clave, empresa: e?.nombre || '', planilla: nombrePlanilla(periodo), rango: textoRango(rangoPlanilla(cierres, periodo)), cantidad: 0 };
      grupos.set(clave, { ...g, cantidad: g.cantidad + 1 });
    });
    setHecho({ cantidad: incluidas.length, sinPunto: incluidas.filter((f) => f.lat === null).length, grupos: [...grupos.values()] });
    setPaso('listo');
    avisar();
    onListo?.();
  }

  const hayAlgo = archivos.length > 0 || !!texto.trim();
  const pie =
    paso === 'elegir' ? (
      <div className="space-y-2">
        <button type="button" className="btn btn-menta w-full" disabled={!hayAlgo} onClick={leer}>
          <Icon name="check" /> Leer con IA
        </button>
        {restan !== null && (
          <p className="text-center text-[11px] text-tinta-500">
            Este mes: {uso.usadas || 0} de {uso.limite} lecturas{restan <= 5 ? ` · quedan ${restan}` : ''}
          </p>
        )}
      </div>
    ) : paso === 'revisar' ? (
      <div className="space-y-2">
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        <button type="button" className="btn btn-menta w-full" disabled={guardando || !incluidas.length} onClick={cargar}>
          <Icon name="check" />{' '}
          {guardando ? 'Cargando…' : incluidas.length === 1 ? 'Cargar el ticket' : `Cargar ${incluidas.length} tickets`}
        </button>
      </div>
    ) : paso === 'listo' ? (
      <button type="button" className="btn btn-menta w-full" onClick={onCerrar}>Listo</button>
    ) : null;

  return (
    <Modal abierto onCerrar={onCerrar} titulo={paso === 'revisar' ? 'Revisá lo que leyó la IA' : 'Orden de trabajo con IA'} pie={pie}>
      <div className="space-y-4">
        {error && paso !== 'revisar' && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

        {paso === 'elegir' && (
          <>
            <p className="text-sm text-tinta-300">
              Sacale una foto a la orden, subí el PDF o pegá el mail. La IA arma cada ticket y vos lo revisás: queda en la <b>agenda</b> y entra en la <b>planilla</b> cuando lo finalizás.
            </p>
            {archivos.length > 0 && (
              <ul className="grid grid-cols-3 gap-2">
                {archivos.map((a, i) => (
                  <li key={a.id} className="relative aspect-[3/4] overflow-hidden rounded-xl border border-navy-700 bg-navy-850">
                    {a.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.url} alt={`Página ${i + 1}`} className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full place-items-center text-center text-xs text-tinta-300">
                        <Icon name="documento" className="mx-auto h-7 w-7" />
                        PDF
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label="Quitar"
                      className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"
                      onClick={() => setArchivos((x) => x.filter((y) => y.id !== a.id))}
                    >
                      <Icon name="cerrar" className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {archivos.length < 3 && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-sec flex-col gap-1 py-4" onClick={() => camara.current?.click()}>
                  <Icon name="camara" className="h-6 w-6" />
                  {archivos.length ? 'Otra página' : 'Sacar foto'}
                </button>
                <button type="button" className="btn btn-sec flex-col gap-1 py-4" onClick={() => subir.current?.click()}>
                  <Icon name="documento" className="h-6 w-6" />
                  Foto o PDF
                </button>
              </div>
            )}
            <input
              ref={camara}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                agregar(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              ref={subir}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                agregar(e.target.files);
                e.target.value = '';
              }}
            />
            <div>
              <label className="etiqueta" htmlFor="orden-texto">O pegá el texto del mail</label>
              <textarea
                id="orden-texto"
                rows={6}
                className="campo"
                maxLength={MAX_TEXTO}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Si trae varias órdenes, la IA arma un ticket por cada una."
              />
            </div>
            <p className="text-xs text-tinta-500">La orden se envía a Google Gemini para leerla.</p>
          </>
        )}

        {paso === 'leyendo' && (
          <div className="py-10 text-center">
            <Icon name="documento" className="mx-auto h-9 w-9 animate-pulse text-menta-400" />
            <p className="mt-3 font-bold">Leyendo la orden…</p>
            <TextoEspera className="mt-1 text-sm text-tinta-400" />
          </div>
        )}

        {paso === 'revisar' && (
          <>
            <p className="text-sm text-tinta-300">
              {filas.length === 1 ? 'Encontró 1 trabajo.' : `Encontró ${filas.length} trabajos.`} Tocá uno para corregirlo; lo que no tildes no se carga.
            </p>
            <ul className="space-y-2">
              {filas.map((f) => (
                <Ficha key={f.k} f={f} empresas={empresas} asignables={asignables} onCambiar={(c) => cambiarFila(f.k, c)} />
              ))}
            </ul>
          </>
        )}

        {paso === 'listo' && hecho && (
          <div className="py-4 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-menta-500/15 text-menta-300">
              <Icon name="check" />
            </span>
            <p className="mt-3 text-lg font-extrabold">{hecho.cantidad === 1 ? 'Ticket cargado' : `${hecho.cantidad} tickets cargados`}</p>
            <p className="mt-1 text-sm text-tinta-300">Ya están en la agenda. Cuando los finalices entran en:</p>
            <ul className="mt-3 space-y-1.5 text-left text-sm">
              {hecho.grupos.map((g) => (
                <li key={g.clave} className="rounded-xl bg-navy-850 p-3">
                  <b>{g.empresa}</b> · Planilla de {g.planilla} ({g.rango}){g.cantidad > 1 ? ` · ${g.cantidad} tickets` : ''}
                </li>
              ))}
            </ul>
            {hecho.sinPunto > 0 && (
              <p className="mt-3 text-xs text-tinta-400">
                {hecho.sinPunto === 1 ? '1 quedó' : `${hecho.sinPunto} quedaron`} sin punto en el mapa: desde el ticket se marca la ubicación.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
