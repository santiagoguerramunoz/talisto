'use client';

import { supabase } from './supabase';
import { comprimirImagen } from './imagenes';

// TaListo! Match (SQL 19): solicitudes, visitas técnicas, pagos con Mercado Pago y liquidaciones.

export const sinMatch = (e) => !!e && (e.code === 'PGRST202' || e.code === '42883' || e.code === '42P01' || e.code === 'PGRST205');
export const MENSAJE_FALTA_SQL = 'TaListo! Match todavía no está activo: falta correr el SQL 19 en Supabase.';

const TZ = 'America/Montevideo';
export const pesos = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const entero = Math.abs(v - Math.round(v)) < 0.005;
  return `$ ${v.toLocaleString('es-UY', { minimumFractionDigits: entero ? 0 : 2, maximumFractionDigits: entero ? 0 : 2 })}`;
};
export const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-UY', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
export const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-UY', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }) : '');
export const diaLargo = (iso) =>
  iso ? new Date(iso).toLocaleDateString('es-UY', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }) : '';
export const mayus = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
export const fechaHora = (iso) => (iso ? `${fecha(iso)} ${hora(iso)}` : '');

export const ESTADO_SOLICITUD = {
  abierta: { texto: 'Buscando profesional', clase: 'bg-[#0a84ff]/20 text-[#8cc8ff]' },
  reservada: { texto: 'Visita reservada', clase: 'bg-menta-500/15 text-menta-300' },
  en_curso: { texto: 'Visita hecha', clase: 'bg-menta-500/15 text-menta-300' },
  finalizada: { texto: 'Finalizada', clase: 'bg-navy-700 text-tinta-200' },
  externa: { texto: 'Contratada por fuera', clase: 'bg-navy-700 text-tinta-300' },
  cancelada: { texto: 'Cancelada', clase: 'bg-navy-700 text-tinta-400' },
  vencida: { texto: 'Vencida', clase: 'bg-navy-700 text-tinta-400' },
};

export const ESTADO_OPERACION = {
  pendiente_pago: { texto: 'Pendiente de pago', clase: 'bg-amber-400/15 text-amber-200' },
  buscando_tecnico: { texto: 'Esperando técnico', clase: 'bg-[#0a84ff]/20 text-[#8cc8ff]' },
  reserva_confirmada: { texto: 'Reserva confirmada', clase: 'bg-menta-500/15 text-menta-300' },
  visita_realizada: { texto: 'Visita realizada', clase: 'bg-menta-500/15 text-menta-300' },
  trabajo_en_curso: { texto: 'Trabajo en curso', clase: 'bg-[#0a84ff]/20 text-[#8cc8ff]' },
  pendiente_confirmacion: { texto: 'Pendiente de confirmación', clase: 'bg-amber-400/15 text-amber-200' },
  pendiente_liquidacion: { texto: 'Pendiente de liquidación', clase: 'bg-[#0a84ff]/20 text-[#8cc8ff]' },
  liquidado: { texto: 'Liquidado', clase: 'bg-menta-500/15 text-menta-300' },
  reembolsado: { texto: 'Reembolsado', clase: 'bg-navy-700 text-tinta-300' },
  en_disputa: { texto: 'En disputa', clase: 'bg-red-500/15 text-red-300' },
  cancelado: { texto: 'Cancelado', clase: 'bg-navy-700 text-tinta-400' },
};

export const FRANJAS = [
  ['cualquiera', 'Cualquier horario (8 a 19 h)'],
  ['manana', 'De mañana (8 a 13 h)'],
  ['tarde', 'De tarde (13 a 19 h)'],
];

// "El primero disponible": para cuándo lo pidió el cliente
export function cuandoTexto(s) {
  if (!s) return '';
  if (s.cuando === 'hoy') return 'Hoy, lo antes posible';
  const d = s.fecha ? new Date(`${String(s.fecha).slice(0, 10)}T12:00:00`).toLocaleDateString('es-UY', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  const fr = { manana: ' de mañana', tarde: ' de tarde' }[s.franja] || '';
  return `${d.charAt(0).toUpperCase()}${d.slice(1)}${fr}`;
}

export const PREFERENCIAS = [
  ['cualquiera', 'Cualquier horario'],
  ['manana', 'De mañana'],
  ['tarde', 'De tarde'],
];

export function Estado({ valor, tabla = ESTADO_OPERACION }) {
  const e = tabla[valor] || { texto: valor, clase: 'bg-navy-700 text-tinta-300' };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${e.clase}`}>{e.texto}</span>;
}

const ESTRELLA = 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z';
const conComa = (n, d = 1) => Number(n).toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: d });

// Estrellas de 1 a 5 con fracción (3,5 = tres y media). Con onElegir se eligen enteras.
export function Estrellas({ valor = 0, tam = 'h-4 w-4', onElegir }) {
  const v = Number(valor) || 0;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${conComa(v)} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const parte = onElegir ? (n <= Math.round(v) ? 1 : 0) : Math.max(0, Math.min(1, v - (n - 1)));
        const estrella = (
          <span className={`relative inline-block shrink-0 ${tam}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" className={`absolute inset-0 ${tam} fill-transparent text-tinta-500`} stroke="currentColor" strokeWidth="2">
              <path d={ESTRELLA} />
            </svg>
            {parte > 0 && (
              <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${parte * 100}%` }}>
                <svg viewBox="0 0 24 24" className={`${tam} max-w-none fill-amber-300 text-amber-300`} stroke="currentColor" strokeWidth="2">
                  <path d={ESTRELLA} />
                </svg>
              </span>
            )}
          </span>
        );
        return onElegir ? (
          <button key={n} type="button" onClick={() => onElegir(n)} className="p-1" aria-label={`${n} estrellas`}>
            {estrella}
          </button>
        ) : (
          <span key={n}>{estrella}</span>
        );
      })}
    </span>
  );
}

// Calificación de 0 a 10 (SQL 26): puntualidad, velocidad y desempeño; la nota es el promedio de los 3
export const ASPECTOS_CALIFICACION = [
  ['puntualidad', 'Puntualidad', '¿Llegó a la hora acordada?'],
  ['velocidad', 'Velocidad', '¿Lo resolvió en un tiempo razonable?'],
  ['desempeno', 'Desempeño', '¿Cómo hizo el trabajo y cómo te atendió?'],
];
// Rubros con técnicos disponibles en Match (SQL 27); si todavía no se corrió, todos los activos
export async function rubrosConTecnicos(supabase) {
  const { data, error } = await supabase.rpc('rubros_match');
  if (!error && Array.isArray(data)) return data;
  const { data: todos } = await supabase.from('categorias').select('id, nombre').eq('activa', true).order('orden');
  return todos || [];
}

export const estrellasDe = (nota) => (nota === null || nota === undefined ? null : Math.max(1, Math.round((Number(nota) / 2) * 10) / 10));
export const notaTexto = (n) => (n === null || n === undefined ? '—' : conComa(n));
const colorPunto = (n) =>
  n <= 4 ? 'bg-red-500 text-white' : n <= 6 ? 'bg-amber-400 text-navy-950' : n <= 8 ? 'bg-menta-400 text-navy-950' : 'bg-menta-500 text-navy-950';

// Elegir de 0 (malo) a 10 (excelente)
export function PuntosCero10({ valor, onElegir, etiqueta }) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="grid grid-cols-11 gap-1">
      {Array.from({ length: 11 }, (_, n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={valor === n}
          onClick={() => onElegir(n)}
          className={`h-9 rounded-lg text-sm font-bold transition ${valor === n ? colorPunto(n) : 'bg-navy-800 text-tinta-300 hover:bg-navy-700'}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

// Los 3 puntos de una calificación (o los promedios de las últimas 10)
export function DetallePuntos({ k, chico = false }) {
  if (!ASPECTOS_CALIFICACION.some(([c]) => k?.[c] !== null && k?.[c] !== undefined)) return null;
  return (
    <span className={`flex flex-wrap gap-x-3 gap-y-0.5 ${chico ? 'text-[11px]' : 'text-xs'} text-tinta-400`}>
      {ASPECTOS_CALIFICACION.map(([c, t]) => (
        <span key={c}>
          {t} <b className="text-tinta-200">{notaTexto(k[c])}</b>
        </span>
      ))}
    </span>
  );
}

// Puntaje del profesional: promedio de sus últimas 10 contrataciones
export function ResumenCalificacion({ cal, nota = '' }) {
  return (
    <section className="tarjeta space-y-3 p-4">
      <div className="flex items-center gap-4">
        <p className="text-4xl font-extrabold">{cal?.promedio ? conComa(cal.promedio) : '—'}</p>
        <div className="min-w-0">
          <Estrellas valor={cal?.promedio || 0} />
          <p className="text-xs text-tinta-400">
            {cal?.nota !== null && cal?.nota !== undefined ? <><b className="text-tinta-200">{notaTexto(cal.nota)}/10</b> · promedio de las últimas {cal.ultimas || 0}{' '}{cal.ultimas === 1 ? 'contratación' : 'contrataciones'}</> : 'Todavía sin calificaciones'}
          </p>
        </div>
      </div>
      {cal?.ultimas > 0 && (
        <div className="space-y-1.5">
          {ASPECTOS_CALIFICACION.map(([c, t]) =>
            cal[c] === null || cal[c] === undefined ? null : (
              <div key={c} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 text-tinta-300">{t}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-navy-800">
                  <span className="block h-full rounded-full bg-menta-500" style={{ width: `${Number(cal[c]) * 10}%` }} />
                </span>
                <b className="w-8 shrink-0 text-right">{notaTexto(cal[c])}</b>
              </div>
            )
          )}
        </div>
      )}
      {nota && <p className="text-xs text-tinta-400">{nota}</p>}
    </section>
  );
}

// Sube fotos (achicadas) y videos (hasta 50 MB) a la carpeta privada del usuario
export async function subirArchivos(archivos, carpeta) {
  const { data } = await supabase.auth.getUser();
  const uid = data?.user?.id;
  if (!uid) throw new Error('Tenés que iniciar sesión');
  const rutas = [];
  for (const f of archivos) {
    const esVideo = f.type.startsWith('video/');
    if (esVideo && f.size > 50 * 1024 * 1024) throw new Error(`El video ${f.name} pesa más de 50 MB`);
    const cuerpo = esVideo ? f : await comprimirImagen(f);
    const ext = esVideo ? (f.type === 'video/quicktime' ? 'mov' : f.type === 'video/webm' ? 'webm' : 'mp4') : 'jpg';
    const ruta = `${uid}/${carpeta}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('match').upload(ruta, cuerpo, { contentType: esVideo ? f.type : 'image/jpeg', upsert: false });
    if (error) throw new Error(error.message);
    rutas.push(ruta);
  }
  return rutas;
}

export async function urlsArchivos(rutas) {
  if (!rutas?.length) return {};
  const { data } = await supabase.storage.from('match').createSignedUrls(rutas, 3600);
  return Object.fromEntries((data || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
}

async function token() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

// Lleva al cliente a pagar con Mercado Pago (el importe lo pone el servidor)
export async function irAPagar(operacion) {
  const r = await fetch('/api/match/pagar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ operacion }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.url) throw new Error(d.error || 'No se pudo abrir Mercado Pago');
  window.location.href = d.url;
}

// El admin aprueba una devolución: se hace en Mercado Pago
export async function devolver(devolucion, monto, nota) {
  const r = await fetch('/api/match/devolver', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ devolucion, monto, nota }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'No se pudo hacer la devolución');
  return d;
}

// Actividad (solo el tipo de acción, nunca contenido). No falla nunca.
export function registrarEvento(tipo) {
  supabase.rpc('registrar_evento', { p_tipo: tipo }).then(
    () => {},
    () => {}
  );
}

export const esVideo = (ruta) => /\.(mp4|mov|webm)$/i.test(ruta || '');
