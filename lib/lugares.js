import { supabase } from '@/lib/supabase';

// Países, regiones (departamento, provincia, estado…) y localidades (SQL 29)
let cachePaises = null;
const cacheRegiones = {};

export async function cargarPaises() {
  if (cachePaises) return cachePaises;
  const { data, error } = await supabase
    .from('paises')
    .select('codigo, nombre, nombre_region, nombre_localidad, moneda, simbolo, prefijo_tel, bandera, activo, orden')
    .order('activo', { ascending: false })
    .order('orden')
    .order('nombre');
  if (error) return null; // falta el SQL 29
  cachePaises = data || [];
  return cachePaises;
}

export async function cargarRegiones(pais) {
  if (!pais) return [];
  if (cacheRegiones[pais]) return cacheRegiones[pais];
  const { data } = await supabase.from('regiones').select('id, nombre').eq('pais', pais).order('nombre');
  cacheRegiones[pais] = data || [];
  return cacheRegiones[pais];
}

export async function buscarLocalidades(region, texto = '') {
  if (!region) return [];
  const { data } = await supabase.rpc('localidades_buscar', { p_region: Number(region), p_texto: texto || '' });
  return data || [];
}

export function claveLugar(t) {
  return (t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// "Pocitos, Montevideo · Uruguay" (sin banderas: Windows no las dibuja)
export function textoUbicacion(u) {
  if (!u?.region) return '';
  return `${u.localidad ? `${u.localidad}, ` : ''}${u.region} · ${u.pais_nombre || ''}`.trim();
}

// Lo que va al crear la cuenta o al guardar la ubicación
export function lugarCompleto(v) {
  return Boolean(v?.pais && v?.region_id && (v.localidad_id || (v.localidad_nueva || '').trim().length >= 2));
}
