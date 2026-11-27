import { crearXlsx, ESTILO } from './xlsx';
import { equivalenteOrden, importeOrden } from './liquidacion';
import { fechaISO } from './fechas';

/*
 * Producción del equipo: tiempos de cada servicio y comparativa entre las personas.
 * - Cuentan los trabajos finalizados en el período, con todo su tiempo (aunque hayan empezado antes).
 * - El trabajo es de quien lo tenía asignado al cerrarlo. Cada sesión del cronómetro guarda quién la hizo
 *   (SQL 08: "por"), así que si fueron dos, cada uno suma su tiempo.
 * - Si el tiempo se corrigió a mano, manda la corrección (se reparte en la misma proporción).
 */

const msSesion = (s, ahora) =>
  s?.inicio ? Math.max(0, (s.fin ? new Date(s.fin).getTime() : ahora) - new Date(s.inicio).getTime()) : 0;
const suma = (o) => Object.values(o).reduce((a, b) => a + b, 0);

export function minutosPorPersona(trabajo, responsable, ahora = Date.now()) {
  const ms = {};
  (trabajo.tiempos || []).forEach((s) => {
    const m = msSesion(s, ahora);
    if (!m) return;
    const quien = s.por || responsable;
    ms[quien] = (ms[quien] || 0) + m;
  });
  const total = suma(ms);
  const manual = trabajo.minutos_manual;
  if (manual !== null && manual !== undefined && manual !== '') {
    if (!total) return Number(manual) > 0 ? { [responsable]: Number(manual) } : {};
    return Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, (Number(manual) * v) / total]));
  }
  return Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, v / 60000]));
}

export function desdeOrden(o, cuenta, nombreCliente, suspendido = false) {
  const responsable = o.asignado_a || o.cerrado_por || cuenta;
  const minutos = minutosPorPersona(o, responsable);
  return {
    key: `o-${o.id}`,
    tipo: 'ticket',
    suspendido,
    fecha: o.fecha,
    responsable,
    servicio: `Tickets ${nombreCliente || 'B2B'}`,
    titulo: [o.numero_ticket ? `Ticket ${o.numero_ticket}` : null, o.cliente_final].filter(Boolean).join(' · ') || 'Ticket',
    detalle: o.realizado || o.pedido || '',
    direccion: o.direccion || '',
    minutos,
    total: suma(minutos),
    equivalente: equivalenteOrden(o),
    importe: importeOrden(o) || 0,
  };
}

const SERVICIO_TURNO = { relevamiento: 'Relevamientos', visita: 'Visitas' };

export function desdeTurno(t, cuenta, suspendido = false) {
  const responsable = t.asignado_a || t.cerrado_por || cuenta;
  const minutos = minutosPorPersona(t, responsable);
  const cliente = t.clientes?.nombre || '';
  return {
    key: `t-${t.id}`,
    tipo: 'turno',
    suspendido,
    fecha: fechaISO(new Date(t.inicio)),
    responsable,
    servicio: SERVICIO_TURNO[t.tipo] || (t.clientes?.es_empresa ? `Trabajos ${cliente}` : 'Trabajos particulares'),
    titulo: `${t.numero ? `Nº ${String(t.numero).padStart(4, '0')} · ` : ''}${cliente || t.titulo || 'Trabajo'}`,
    detalle: t.resolucion || (cliente ? t.titulo : '') || '',
    direccion: t.direcciones?.direccion || '',
    minutos,
    total: suma(minutos),
    equivalente: 0,
    importe: Number(t.monto_acordado) || 0,
  };
}

const persona = (id) => ({
  id,
  trabajos: 0, // finalizados como responsable
  medidos: 0, // de esos, con tiempo
  minutosTrabajos: 0, // tiempo total de sus trabajos medidos
  minutos: 0, // tiempo propio en el cronómetro (incluye ayudas y suspendidos)
  equivalente: 0,
  eqMedido: 0, // puestas de los tickets con tiempo
  minEq: 0, // tiempo de esos tickets
  importe: 0,
  suspendidos: 0,
  ayudas: 0,
  lista: [],
  servicios: {},
});

export function resumenProduccion(trabajos) {
  const personas = {};
  const p = (id) => (personas[id] ||= persona(id));
  const servicios = {};
  trabajos.forEach((t) => {
    Object.entries(t.minutos).forEach(([quien, m]) => {
      const x = p(quien);
      x.minutos += m;
      if (quien !== t.responsable && !t.suspendido) x.ayudas += 1;
    });
    const r = p(t.responsable);
    if (t.suspendido) {
      r.suspendidos += 1;
      return;
    }
    r.trabajos += 1;
    r.equivalente += t.equivalente;
    r.importe += t.importe;
    r.lista.push(t);
    const sv = (r.servicios[t.servicio] ||= { trabajos: 0, medidos: 0, minutos: 0 });
    sv.trabajos += 1;
    servicios[t.servicio] = (servicios[t.servicio] || 0) + 1;
    if (t.total > 0) {
      r.medidos += 1;
      r.minutosTrabajos += t.total;
      sv.medidos += 1;
      sv.minutos += t.total;
      if (t.equivalente > 0) {
        r.eqMedido += t.equivalente;
        r.minEq += t.total;
      }
    }
  });
  const lista = Object.values(personas).map((x) => ({
    ...x,
    promedio: x.medidos ? x.minutosTrabajos / x.medidos : null,
    puestasHora: x.minEq ? x.eqMedido / (x.minEq / 60) : null,
    lista: x.lista.sort((a, b) => (a.fecha < b.fecha ? 1 : -1)),
  }));
  const finalizados = trabajos.filter((t) => !t.suspendido);
  return {
    personas: lista,
    servicios: Object.entries(servicios).sort((a, b) => b[1] - a[1]).map(([s]) => s),
    total: finalizados.length,
    sinMedir: finalizados.filter((t) => !(t.total > 0)).length,
    hayPuestas: finalizados.some((t) => t.equivalente > 0),
    minutos: lista.reduce((a, x) => a + x.minutos, 0),
    equivalente: lista.reduce((a, x) => a + x.equivalente, 0),
    importe: lista.reduce((a, x) => a + x.importe, 0),
  };
}

// Qué se puede comparar. mejor: 'mas' | 'menos' | null (sin mejor)
export const METRICAS = [
  { id: 'trabajos', texto: 'Trabajos finalizados', corto: 'Trabajos', mejor: 'mas', valor: (x) => x.trabajos },
  { id: 'minutos', texto: 'Horas trabajadas', corto: 'Horas', mejor: null, valor: (x) => x.minutos, tiempo: true },
  { id: 'promedio', texto: 'Tiempo promedio por trabajo', corto: 'Promedio', mejor: 'menos', valor: (x) => x.promedio, tiempo: true },
  { id: 'equivalente', texto: 'Puestas equivalentes', corto: 'Puestas', mejor: 'mas', valor: (x) => x.equivalente, puestas: true },
  { id: 'puestasHora', texto: 'Puestas por hora', corto: 'Puestas/h', mejor: 'mas', valor: (x) => x.puestasHora, puestas: true },
  { id: 'importe', texto: 'Importe producido', corto: 'Importe', mejor: 'mas', valor: (x) => x.importe, importe: true },
  { id: 'suspendidos', texto: 'Trabajos suspendidos', corto: 'Suspendidos', mejor: 'menos', valor: (x) => x.suspendidos },
];

export function promedioEquipo(personas, metrica) {
  const vals = personas.map(metrica.valor).filter((v) => v !== null && v !== undefined && (metrica.id !== 'promedio' || v > 0));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** Planilla con el resumen por persona, el promedio por servicio y cada trabajo con su tiempo. */
export function planillaProduccion({ empresa, rangoTexto, resumen, nombreDe, conImportes }) {
  const dia = (m) => (m ? m / 1440 : '');
  const titulo = `Producción del equipo — ${empresa}`;

  const enc1 = ['Persona', 'Trabajos finalizados', 'Con tiempo', 'Horas trabajadas', 'Promedio por trabajo', 'Puestas equivalentes', 'Puestas por hora', 'Suspendidos', 'Ayudas'];
  if (conImportes) enc1.push('Importe producido');
  const f1 = [[{ v: titulo, s: ESTILO.titulo }], [{ v: rangoTexto, s: ESTILO.subtitulo }], [], enc1.map((v) => ({ v, s: ESTILO.encabezado }))];
  resumen.personas.forEach((x) => {
    const fila = [
      { v: nombreDe(x.id), s: ESTILO.texto },
      { v: x.trabajos, s: ESTILO.decimal },
      { v: x.medidos, s: ESTILO.decimal },
      { v: dia(x.minutos), s: ESTILO.horas },
      { v: dia(x.promedio), s: ESTILO.horas },
      { v: Math.round(x.equivalente * 100) / 100, s: ESTILO.decimal },
      { v: x.puestasHora === null ? '' : Math.round(x.puestasHora * 100) / 100, s: ESTILO.decimal },
      { v: x.suspendidos, s: ESTILO.decimal },
      { v: x.ayudas, s: ESTILO.decimal },
    ];
    if (conImportes) fila.push({ v: Math.round(x.importe * 100) / 100, s: ESTILO.dinero });
    f1.push(fila);
  });

  // Promedio por servicio: filas = servicios, columnas = personas
  const gente = resumen.personas.filter((x) => x.trabajos);
  const enc2 = ['Servicio', ...gente.map((x) => nombreDe(x.id))];
  const f2 = [[{ v: 'Tiempo promedio por servicio', s: ESTILO.titulo }], [{ v: `${rangoTexto} · entre paréntesis, la cantidad de trabajos con tiempo`, s: ESTILO.subtitulo }], [], enc2.map((v) => ({ v, s: ESTILO.encabezado }))];
  resumen.servicios.forEach((s) => {
    f2.push([
      { v: s, s: ESTILO.texto },
      ...gente.map((x) => {
        const sv = x.servicios[s];
        if (!sv?.medidos) return { v: sv?.trabajos ? 'sin tiempo' : '', s: ESTILO.texto };
        return { v: `${textoCorto(sv.minutos / sv.medidos)} (${sv.medidos})`, s: ESTILO.texto };
      }),
    ]);
  });

  const enc3 = ['Fecha', 'Responsable', 'Servicio', 'Trabajo', 'Dirección', 'Detalle', 'Tiempo', 'Puestas equivalentes'];
  if (conImportes) enc3.push('Importe');
  const f3 = [[{ v: 'Trabajos y tiempos', s: ESTILO.titulo }], [], enc3.map((v) => ({ v, s: ESTILO.encabezado }))];
  resumen.personas
    .flatMap((x) => x.lista)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : 1))
    .forEach((t) => {
      const fila = [
        { v: t.fecha, tipo: 'fecha', s: ESTILO.fecha },
        { v: nombreDe(t.responsable), s: ESTILO.texto },
        { v: t.servicio, s: ESTILO.texto },
        { v: t.titulo, s: ESTILO.texto },
        { v: t.direccion, s: ESTILO.texto },
        { v: t.detalle, s: ESTILO.texto },
        t.total > 0 ? { v: dia(t.total), s: ESTILO.horas } : { v: 'sin tiempo', s: ESTILO.texto },
        { v: Math.round(t.equivalente * 100) / 100, s: ESTILO.decimal },
      ];
      if (conImportes) fila.push({ v: t.importe, s: ESTILO.dinero });
      f3.push(fila);
    });

  return crearXlsx([
    { nombre: 'Resumen', columnas: [26, 12, 11, 13, 13, 13, 12, 12, 10, 15], filas: f1, combinar: ['A1:J1', 'A2:J2'], fijarFilas: 4 },
    { nombre: 'Por servicio', columnas: [32, ...gente.map(() => 18)], filas: f2, combinar: [], fijarFilas: 4 },
    { nombre: 'Trabajos', columnas: [12, 22, 24, 30, 30, 42, 10, 12, 14], filas: f3, combinar: ['A1:I1'], fijarFilas: 3 },
  ]);
}

// "1 h 05" / "45 min"
export function textoCorto(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
