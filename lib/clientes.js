import { supabase } from './supabase';

const DIRECCIONES = 'direcciones(id, etiqueta, direccion, referencia, lat, lng)';
const EMPRESA = 'es_empresa, precio_acondicionamiento, factor_moe';

const columnaFaltante = (error) => error && (error.code === '42703' || /does not exist|could not find/i.test(error.message || ''));

/**
 * Clientes del profesional con sus direcciones.
 * Si todavía no se corrió 03_ordenes_empresa.sql, carga sin los datos de empresa (no rompe la app).
 */
export async function cargarClientes(profesionalId, extra = '') {
  const base = `id, nombre, color, telefono${extra ? `, ${extra}` : ''}, ${DIRECCIONES}`;
  const conEmpresa = await supabase.from('clientes').select(`${base}, ${EMPRESA}`).eq('profesional_id', profesionalId).order('nombre');
  if (!columnaFaltante(conEmpresa.error)) return conEmpresa;
  return supabase.from('clientes').select(base).eq('profesional_id', profesionalId).order('nombre');
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
