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

export const PREFERENCIAS = [
  ['cualquiera', 'Cualquier horario'],
  ['manana', 'De mañana'],
  ['tarde', 'De tarde'],
];

export function Estado({ valor, tabla = ESTADO_OPERACION }) {
  const e = tabla[valor] || { texto: valor, clase: 'bg-navy-700 text-tinta-300' };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${e.clase}`}>{e.texto}</span>;
}

export function Estrellas({ valor = 0, tam = 'h-4 w-4', onElegir }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${valor} de 5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const llena = n <= Math.round(Number(valor) || 0);
        const estrella = (
          <svg viewBox="0 0 24 24" className={`${tam} ${llena ? 'fill-amber-300 text-amber-300' : 'fill-transparent text-tinta-500'}`} stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
          </svg>
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
