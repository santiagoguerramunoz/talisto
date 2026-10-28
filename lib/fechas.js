export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Orden de la semana en Uruguay: lunes primero. Valores según getDay() (0 = domingo)
export const SEMANA_ORDEN = [1, 2, 3, 4, 5, 6, 0];
export const DIA_LETRA = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 0: 'D' };

const dos = (n) => String(n).padStart(2, '0');

export function inicioDia(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function sumarDias(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function inicioSemana(d) {
  const x = inicioDia(d);
  const dow = x.getDay();
  return sumarDias(x, dow === 0 ? -6 : 1 - dow);
}

// 'YYYY-MM-DD' en hora local
export function fechaISO(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${dos(x.getMonth() + 1)}-${dos(x.getDate())}`;
}

// 'YYYY-MM-DD' -> Date local a las 00:00
export function desdeISO(s) {
  const [a, m, d] = s.split('-').map(Number);
  return new Date(a, m - 1, d);
}

export function horaHHMM(d) {
  const x = new Date(d);
  return `${dos(x.getHours())}:${dos(x.getMinutes())}`;
}

// fecha 'YYYY-MM-DD' + hora 'HH:MM' -> Date local
export function combinar(fecha, hora) {
  const [a, m, d] = fecha.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  return new Date(a, m - 1, d, h, mi || 0, 0, 0);
}

// '09:30:00' -> 570
export function minutos(hora) {
  const [h, m] = String(hora).split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minutosDeFecha(d) {
  const x = new Date(d);
  return x.getHours() * 60 + x.getMinutes();
}

export function textoHora(min) {
  return `${dos(Math.floor(min / 60))}:${dos(min % 60)}`;
}

export function esMismoDia(a, b) {
  return fechaISO(a) === fechaISO(b);
}

export function fechaLarga(d) {
  const x = new Date(d);
  return `${DIAS[x.getDay()]} ${x.getDate()} de ${MESES[x.getMonth()]}`;
}

export function fechaCorta(d) {
  const x = new Date(d);
  return `${DIAS_CORTOS[x.getDay()]} ${x.getDate()}/${x.getMonth() + 1}`;
}

export function textoDias(dias = []) {
  const set = new Set(dias.map(Number));
  const lista = SEMANA_ORDEN.filter((d) => set.has(d));
  if (lista.length === 7) return 'Todos los días';
  if (lista.length === 5 && !set.has(0) && !set.has(6)) return 'Lunes a viernes';
  return lista.map((d) => DIAS_CORTOS[d]).join(', ');
}

// Mes como rango de fechas 'YYYY-MM-DD' (hasta = primer día del mes siguiente)
export function rangoMes(anio, mes) {
  const desde = `${anio}-${dos(mes)}-01`;
  const hasta = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${dos(mes + 1)}-01`;
  return { desde, hasta };
}

export function sumarMeses({ anio, mes }, n) {
  const d = new Date(anio, mes - 1 + n, 1);
  return { anio: d.getFullYear(), mes: d.getMonth() + 1 };
}

export const nombreMes = (mes) => MESES[mes - 1].charAt(0).toUpperCase() + MESES[mes - 1].slice(1);
