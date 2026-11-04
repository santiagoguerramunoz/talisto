import { supabase } from './supabase';

const DIRECCIONES = 'direcciones(id, etiqueta, direccion, referencia, lat, lng)';
const EMPRESA = 'es_empresa, precio_acondicionamiento, factor_moe';
const CIERRE = 'cierre_planilla'; // SQL 16

const columnaFaltante = (error) => error && (error.code === '42703' || /does not exist|could not find/i.test(error.message || ''));

/**
 * Clientes del profesional con sus direcciones.
 * Si todavía no se corrieron 03_ordenes_empresa.sql o 16_ordenes_ia_cierres.sql, carga sin esas columnas (no rompe la app).
 */
export async function cargarClientes(profesionalId, extra = '') {
  const base = `id, nombre, color, telefono${extra ? `, ${extra}` : ''}, ${DIRECCIONES}`;
  for (const columnas of [`${base}, ${EMPRESA}, ${CIERRE}`, `${base}, ${EMPRESA}`]) {
    const r = await supabase.from('clientes').select(columnas).eq('profesional_id', profesionalId).order('nombre');
    if (!columnaFaltante(r.error)) return r;
  }
  return supabase.from('clientes').select(base).eq('profesional_id', profesionalId).order('nombre');
}

// Trabajos B2B con el cronómetro corriendo (de cualquier fecha)
export async function cargarTrabajosEnCurso(profesionalId) {
  const r = await supabase.from('ordenes').select('*').eq('profesional_id', profesionalId).eq('estado', 'en_curso');
  return r.error ? { data: [], error: null } : r;
}

export async function cargarOrdenes(profesionalId, desdeIso, hastaIso) {
  const r = await supabase
    .from('ordenes')
    .select('*')
    .eq('profesional_id', profesionalId)
    .gte('fecha', desdeIso)
    .lt('fecha', hastaIso)
    .neq('estado', 'cancelado')
    .order('fecha')
    .order('hora_inicio', { nullsFirst: false });
  // Si la tabla todavía no existe, la agenda sigue funcionando sin órdenes
  if (r.error && (r.error.code === '42P01' || r.error.code === 'PGRST205' || /does not exist|could not find the table/i.test(r.error.message || ''))) {
    return { data: [], error: null, faltaTabla: true };
  }
  return r;
}
