// Errores típicos de "todavía no se corrió el SQL" en Supabase
export const faltaColumna = (e) => !!e && (e.code === '42703' || e.code === 'PGRST204');
export const faltaTabla = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205');
// Un estado nuevo que la base todavía no acepta (falta el SQL 04)
export const estadoNoValido = (e) => !!e && e.code === '23514' && /estado/.test(e.message || '');

export const AVISO_SQL_04 = 'Falta correr en Supabase el archivo 04_trabajos_finanzas.sql.';

export function faltaSql04(e) {
  return faltaColumna(e) || faltaTabla(e) || estadoNoValido(e);
}
