// Planillas de liquidación de un cliente B2B, con fecha de cierre editable.
//
// Cada planilla se llama como el mes en que cierra: { anio, mes }. Si la empresa cierra el 25,
// la planilla de noviembre va del 26/10 al 25/11 y la de diciembre abre el 26/11.
// Una planilla empieza siempre el día después del cierre de la anterior: ningún día queda afuera
// ni entra en dos planillas.
//
// clientes.cierre_planilla (jsonb, SQL 16):
//   reglas: [{ desde: 'AAAA-MM', dia: 25 }]  desde qué planilla rige cada día de cierre (dia null = fin de mes)
//   fechas: { 'AAAA-MM': 'AAAA-MM-DD' }      la fecha de una planilla puntual (el mes que cierra distinto)
// Sin nada: mes calendario. Las planillas anteriores a una regla no cambian, así lo ya liquidado queda como estaba.
import { MESES, sumarMeses } from './fechas';

const dos = (n) => String(n).padStart(2, '0');
const CLAVE = /^\d{4}-\d{2}$/;

export const clavePlanilla = ({ anio, mes }) => `${anio}-${dos(mes)}`;

const diasDelMes = (anio, mes) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

function diaSiguiente(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
}

function esFecha(t) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t || '')) return false;
  const [a, m, d] = t.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= diasDelMes(a, m);
}

const diaValido = (n) => (Number.isInteger(n) && n >= 1 && n <= 31 ? n : null);

export function leerCierres(valor) {
  const c = valor && typeof valor === 'object' ? valor : {};
  const reglas = (Array.isArray(c.reglas) ? c.reglas : [])
    .filter((r) => CLAVE.test(r?.desde || ''))
    .map((r) => ({ desde: r.desde, dia: diaValido(r.dia) }))
    .sort((a, b) => a.desde.localeCompare(b.desde));
  const fechas = {};
  Object.entries(c.fechas && typeof c.fechas === 'object' ? c.fechas : {}).forEach(([k, v]) => {
    if (CLAVE.test(k) && esFecha(v)) fechas[k] = v;
  });
  return { reglas, fechas };
}

// Día de cierre que rige en esa planilla (null = fin de mes)
export function diaDeCierre(cierres, periodo) {
  const clave = clavePlanilla(periodo);
  let dia = null;
  cierres.reglas.forEach((r) => {
    if (r.desde <= clave) dia = r.dia;
  });
  return dia;
}

// Último día que entra en la planilla
export function fechaCierre(cierres, periodo) {
  const clave = clavePlanilla(periodo);
  if (cierres.fechas[clave]) return cierres.fechas[clave];
  const ultimo = diasDelMes(periodo.anio, periodo.mes);
  return `${clave}-${dos(Math.min(diaDeCierre(cierres, periodo) ?? ultimo, ultimo))}`;
}

// { desde, hasta, cierre }: desde y cierre entran; hasta es el día siguiente al cierre (para consultar la base)
export function rangoPlanilla(cierres, periodo) {
  const cierre = fechaCierre(cierres, periodo);
  return { desde: diaSiguiente(fechaCierre(cierres, sumarMeses(periodo, -1))), hasta: diaSiguiente(cierre), cierre };
}

// La planilla en la que cae una fecha
export function planillaDeFecha(cierres, iso) {
  const [anio, mes] = iso.split('-').map(Number);
  let p = { anio, mes };
  for (let i = 0; i < 24; i++) {
    const r = rangoPlanilla(cierres, p);
    if (iso > r.cierre) p = sumarMeses(p, 1);
    else if (iso < r.desde) p = sumarMeses(p, -1);
    else break;
  }
  return p;
}

const ddmm = (iso) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};
const ddmmaa = (iso) => iso.split('-').reverse().join('/');

export const fechaCierreTexto = ddmm;
export const textoRango = ({ desde, cierre }) => `${ddmm(desde)} al ${ddmm(cierre)}`;
export const textoRangoLargo = ({ desde, cierre }) => `Del ${ddmmaa(desde)} al ${ddmmaa(cierre)}`;

export const nombrePlanilla = ({ anio, mes }) => `${MESES[mes - 1].charAt(0).toUpperCase()}${MESES[mes - 1].slice(1)} ${anio}`;

// La planilla coincide con el mes calendario
export function esMesCompleto({ desde, cierre }) {
  const [a, m, d] = cierre.split('-').map(Number);
  return d === diasDelMes(a, m) && desde === `${a}-${dos(m)}-01`;
}

export function diasEntre(desdeIso, hastaIso) {
  const utc = (t) => {
    const [a, m, d] = t.split('-').map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((utc(hastaIso) - utc(desdeIso)) / 86400000);
}

// Texto corto del estado de la planilla
export function estadoPlanilla(rango, hoy) {
  if (hoy > rango.cierre) return `Cerrada el ${ddmm(rango.cierre)}`;
  if (hoy < rango.desde) return `Abre el ${ddmm(rango.desde)}`;
  const dias = diasEntre(hoy, rango.cierre);
  if (dias === 0) return 'Cierra hoy';
  return dias === 1 ? 'Cierra mañana' : `Cierra en ${dias} días`;
}

// Por qué no se puede cerrar la planilla en esa fecha ('' si se puede)
export function problemaCierre(cierres, periodo, fecha) {
  if (!esFecha(fecha)) return 'Elegí la fecha de cierre.';
  const anterior = fechaCierre(cierres, sumarMeses(periodo, -1));
  if (fecha <= anterior) return `Tiene que ser después del ${ddmm(anterior)}, que es cuando cierra la planilla anterior.`;
  const siguiente = fechaCierre(cierres, sumarMeses(periodo, 1));
  if (fecha >= siguiente) return `Tiene que ser antes del ${ddmm(siguiente)}, que es cuando cierra la planilla siguiente.`;
  return '';
}

// Fecha de una planilla puntual (null: vuelve al día de siempre)
export function conFecha(cierres, periodo, fecha) {
  const fechas = { ...cierres.fechas };
  if (fecha) fechas[clavePlanilla(periodo)] = fecha;
  else delete fechas[clavePlanilla(periodo)];
  return { ...cierres, fechas };
}

// Día de cierre de todos los meses, desde esa planilla en adelante. Las anteriores quedan como están.
export function conDia(cierres, periodo, dia) {
  const clave = clavePlanilla(periodo);
  const reglas = cierres.reglas.filter((r) => r.desde < clave);
  const antes = reglas.length ? reglas[reglas.length - 1].dia : null;
  if (antes !== dia) reglas.push({ desde: clave, dia });
  const fechas = Object.fromEntries(Object.entries(cierres.fechas).filter(([k]) => k < clave));
  return { reglas, fechas };
}
