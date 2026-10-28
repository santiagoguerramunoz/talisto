import { supabase } from './supabase';
import { fechaCorta, horaHHMM } from './fechas';

export const ESTADOS_RELEVAMIENTO = {
  pendiente: { texto: 'Pendiente', clase: 'bg-amber-400/15 text-amber-300' },
  relevado: { texto: 'Relevado', clase: 'bg-menta-500/15 text-menta-300' },
  presupuestado: { texto: 'Presupuestado', clase: 'bg-[#176ba8]/25 text-[#8cc4ee]' },
  descartado: { texto: 'Descartado', clase: 'bg-navy-700 text-tinta-400' },
};

export const COLOR_RELEVAMIENTO = '#ec8328';

const BASE =
  'id, turno_id, cliente_id, direccion_id, pedido, estado, notas, medidas, materiales, horas_estimadas, costo_estimado, fotos, relevado_en, creado_en, actualizado_en';
// Dirección propia (un lugar que no está entre las direcciones del cliente)
const UBICACION = 'direccion, referencia, lat, lng';
const RELACIONES = 'turnos(*), clientes(id, nombre, color, telefono), direcciones(id, etiqueta, direccion, referencia, lat, lng)';

export const CAMPOS_RELEVAMIENTO = `${BASE}, ${UBICACION}, ${RELACIONES}`;
const CAMPOS_SIN_UBICACION = `${BASE}, ${RELACIONES}`;

export const AVISO_SQL_UBICACION =
  'Para guardar la dirección propia del relevamiento falta correr en Supabase el archivo 03_ordenes_empresa.sql.';

// Errores de "todavía no se corrió el SQL"
export const faltaColumna = (e) => !!e && (e.code === '42703' || e.code === 'PGRST204');
export const faltaTabla = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205');

/**
 * Consulta tolerante: armar(campos) devuelve la consulta de Supabase.
 * Si todavía no existen las columnas de dirección propia, repite sin ellas.
 */
export async function consultarRelevamientos(armar) {
  const r = await armar(CAMPOS_RELEVAMIENTO);
  if (!faltaColumna(r.error)) return r;
  return { ...(await armar(CAMPOS_SIN_UBICACION)), sinUbicacion: true };
}

// Para el mapa y la agenda: los pendientes (siempre en el mapa) + los que tienen turno entre dos fechas
export async function cargarRelevamientosMapa(profesionalId, desdeIso, hastaIso) {
  const campos = (ubicacion, turnos) =>
    `id, turno_id, cliente_id, direccion_id, pedido, estado${ubicacion ? `, ${UBICACION}` : ''}, ` +
    `${turnos}(id, inicio, fin, flexible, estado, titulo), clientes(id, nombre, color, telefono), ` +
    'direcciones(id, etiqueta, direccion, referencia, lat, lng)';
  const pedir = (ubicacion) =>
    Promise.all([
      supabase
        .from('relevamientos')
        .select(campos(ubicacion, 'turnos'))
        .eq('profesional_id', profesionalId)
        .eq('estado', 'pendiente'),
      supabase
        .from('relevamientos')
        .select(campos(ubicacion, 'turnos!inner'))
        .eq('profesional_id', profesionalId)
        .gte('turnos.inicio', desdeIso)
        .lt('turnos.inicio', hastaIso),
    ]);

  let [pendientes, delRango] = await pedir(true);
  if (faltaColumna(pendientes.error) || faltaColumna(delRango.error)) [pendientes, delRango] = await pedir(false);
  const error = pendientes.error || delRango.error;
  if (error) return faltaTabla(error) ? { data: [], error: null } : { data: [], error };

  const porId = new Map();
  [...(pendientes.data || []), ...(delRango.data || [])].forEach((r) => porId.set(r.id, r));
  return { data: [...porId.values()], error: null };
}

/**
 * Guarda la ficha. Con id → update; sin id → upsert por turno_id.
 * Si falta el SQL de la dirección propia, guarda el resto y avisa (sinUbicacion).
 */
export async function guardarRelevamiento(fila, { id } = {}) {
  const ejecutar = (f) =>
    id
      ? supabase.from('relevamientos').update(f).eq('id', id).select('id').single()
      : supabase.from('relevamientos').upsert(f, { onConflict: 'turno_id' }).select('id').single();
  const r = await ejecutar(fila);
  if (!faltaColumna(r.error)) return r;
  // eslint-disable-next-line no-unused-vars
  const { direccion, referencia, lat, lng, ...resto } = fila;
  const tieneDatos = !!direccion || (lat !== null && lat !== undefined);
  const r2 = await ejecutar(resto);
  return { ...r2, sinUbicacion: tieneDatos };
}

const hayValor = (v) => v !== null && v !== undefined;

// Dónde es el relevamiento: su dirección propia o la del cliente elegida
export function ubicacionRelevamiento(rel) {
  if (!rel) return null;
  if (rel.direccion || hayValor(rel.lat)) {
    return {
      id: `r-${rel.id}`,
      etiqueta: 'Relevamiento',
      direccion: rel.direccion || '',
      referencia: rel.referencia || '',
      lat: hayValor(rel.lat) ? rel.lat : null,
      lng: hayValor(rel.lng) ? rel.lng : null,
      propia: true,
    };
  }
  return rel.direcciones ? { ...rel.direcciones, propia: false } : null;
}

export const enElMapa = (d) => !!d && hayValor(d.lat) && hayValor(d.lng);

export const nombreRelevamiento = (rel) => rel?.clientes?.nombre || rel?.turnos?.titulo || 'Relevamiento';

// "Mar 3/11 · entre 09:00 y 13:00"
export function textoCuando(turno) {
  if (!turno) return 'Sin fecha en la agenda';
  const dia = fechaCorta(turno.inicio);
  return turno.flexible
    ? `${dia} · entre ${horaHHMM(turno.inicio)} y ${horaHHMM(turno.fin)}`
    : `${dia} · ${horaHHMM(turno.inicio)}–${horaHHMM(turno.fin)}`;
}

export const CARPETA_FOTOS = 'relevamientos';
