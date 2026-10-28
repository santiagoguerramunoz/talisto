// Tiempo trabajado: tiempos = [{ inicio: ISO, fin: ISO|null }]

const ms = (iso) => new Date(iso).getTime();

export const sesionAbierta = (tiempos = []) => (tiempos || []).find((t) => t && t.inicio && !t.fin) || null;

export function msTrabajados(tiempos = [], ahora = Date.now()) {
  return (tiempos || []).reduce((total, t) => {
    if (!t?.inicio) return total;
    const fin = t.fin ? ms(t.fin) : ahora;
    return total + Math.max(0, fin - ms(t.inicio));
  }, 0);
}

// Minutos del trabajo: el tiempo corregido a mano manda sobre el cronómetro
export function minutosTrabajo(trabajo, ahora = Date.now()) {
  if (trabajo?.minutos_manual !== null && trabajo?.minutos_manual !== undefined) return Number(trabajo.minutos_manual);
  return Math.round(msTrabajados(trabajo?.tiempos, ahora) / 60000);
}

export function iniciarTiempos(tiempos = [], ahoraIso = new Date().toISOString()) {
  const lista = (tiempos || []).filter((t) => t?.inicio);
  if (sesionAbierta(lista)) return lista;
  return [...lista, { inicio: ahoraIso, fin: null }];
}

export function cerrarTiempos(tiempos = [], ahoraIso = new Date().toISOString()) {
  return (tiempos || []).filter((t) => t?.inicio).map((t) => (t.fin ? t : { ...t, fin: ahoraIso }));
}

// Días distintos trabajados (fecha local)
export function diasTrabajados(tiempos = []) {
  const dias = new Set();
  (tiempos || []).forEach((t) => {
    if (!t?.inicio) return;
    const d = new Date(t.inicio);
    dias.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  });
  return [...dias].sort();
}

const dos = (n) => String(n).padStart(2, '0');

// 01:23:45
export function textoReloj(milis) {
  const s = Math.max(0, Math.floor(milis / 1000));
  return `${dos(Math.floor(s / 3600))}:${dos(Math.floor((s % 3600) / 60))}:${dos(s % 60)}`;
}

// "2 h 05 min" / "45 min"
export function textoMinutos(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${dos(m % 60)} min`;
}

// "2:05" ↔ minutos (para corregir el tiempo a mano)
export function horasMinutos(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return `${Math.floor(m / 60)}:${dos(m % 60)}`;
}
export function leerHorasMinutos(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  const hm = t.match(/^(\d{1,3})(?::(\d{1,2}))?$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] || 0);
  const dec = Number(t.replace(',', '.'));
  return Number.isFinite(dec) && dec >= 0 ? Math.round(dec * 60) : null;
}
