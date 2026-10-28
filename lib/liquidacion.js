import { crearXlsx, ESTILO, letraColumna } from './xlsx';
import { MESES } from './fechas';

const mesTexto = (mes) => MESES[mes - 1].charAt(0).toUpperCase() + MESES[mes - 1].slice(1);

const redondear = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function equivalenteOrden(o) {
  return Number(o.acondicionamientos || 0) + Number(o.moes || 0) * Number(o.factor_moe || 1.75);
}

export function importeOrden(o) {
  if (o.precio_acondicionamiento === null || o.precio_acondicionamiento === undefined || o.precio_acondicionamiento === '') return null;
  return equivalenteOrden(o) * Number(o.precio_acondicionamiento);
}

export function totalesOrdenes(ordenes) {
  return ordenes.reduce(
    (t, o) => {
      const imp = importeOrden(o);
      return {
        cantidad: t.cantidad + 1,
        acondicionamientos: t.acondicionamientos + Number(o.acondicionamientos || 0),
        moes: t.moes + Number(o.moes || 0),
        equivalente: t.equivalente + equivalenteOrden(o),
        importe: t.importe + (imp || 0),
        sinPrecio: t.sinPrecio + (imp === null ? 1 : 0),
      };
    },
    { cantidad: 0, acondicionamientos: 0, moes: 0, equivalente: 0, importe: 0, sinPrecio: 0 }
  );
}

export function textoHorario(o) {
  const h = (t) => (t ? String(t).slice(0, 5) : '');
  if (o.hora_inicio && o.hora_fin) return `${h(o.hora_inicio)}–${h(o.hora_fin)}`;
  return h(o.hora_inicio);
}

/**
 * Arma la planilla de liquidación del mes (.xlsx) para una empresa.
 * ordenes: solo las realizadas del mes, ordenadas por fecha.
 */
export function planillaLiquidacion({ empresa, ordenes, anio, mes, profesional }) {
  const titulo = `Liquidación ${empresa.nombre} — ${mesTexto(mes)} ${anio}`;
  const precios = [...new Set(ordenes.map((o) => o.precio_acondicionamiento).filter((p) => p !== null && p !== undefined))];
  const factores = [...new Set(ordenes.map((o) => Number(o.factor_moe || 1.75)))];
  const fmt = (n) => Number(n).toLocaleString('es-UY', { maximumFractionDigits: 2 });
  const precioTexto = precios.length === 1 ? `$ ${fmt(precios[0])}` : precios.length ? 'según cada orden' : 'sin definir';
  const factorTexto = factores.length === 1 ? fmt(factores[0]) : 'según cada orden';
  const subtitulo = `${profesional ? `${profesional} · ` : ''}Precio por acondicionamiento: ${precioTexto} · 1 MOE = ${factorTexto} acondicionamientos`;

  const encabezados = [
    'Nº cliente',
    'Nº ticket',
    'Fecha',
    'Horario',
    'Dirección',
    'Detalle de lo realizado',
    'Acondicionamientos',
    'MOE',
    'Equivalente (acond.)',
    'Importe',
  ];

  const filas = [
    [{ v: titulo, s: ESTILO.titulo }],
    [{ v: subtitulo, s: ESTILO.subtitulo }],
    [],
    encabezados.map((v) => ({ v, s: ESTILO.encabezado })),
  ];
  const primeraDatos = filas.length + 1;

  ordenes.forEach((o) => {
    const imp = importeOrden(o);
    filas.push([
      { v: o.numero_cliente || '', s: ESTILO.texto },
      { v: o.numero_ticket || '', s: ESTILO.texto },
      { v: o.fecha, tipo: 'fecha', s: ESTILO.fecha },
      { v: textoHorario(o), s: ESTILO.texto },
      { v: [o.direccion, o.referencia].filter(Boolean).join(' · '), s: ESTILO.texto },
      { v: [o.realizado || o.pedido, o.cliente_final ? `(${o.cliente_final})` : ''].filter(Boolean).join(' '), s: ESTILO.texto },
      { v: Number(o.acondicionamientos || 0), s: ESTILO.decimal },
      { v: Number(o.moes || 0), s: ESTILO.decimal },
      { v: redondear(equivalenteOrden(o)), s: ESTILO.decimal },
      imp === null ? { v: '', s: ESTILO.dinero } : { v: redondear(imp), s: ESTILO.dinero },
    ]);
  });

  const ultimaDatos = filas.length;
  const t = totalesOrdenes(ordenes);
  const filaTotal = filas.length + 1;
  const suma = (col, valor, estilo) =>
    ordenes.length
      ? { f: `SUM(${col}${primeraDatos}:${col}${ultimaDatos})`, v: redondear(valor), s: estilo }
      : { v: 0, s: estilo };
  filas.push([
    { v: `Totales (${t.cantidad} ${t.cantidad === 1 ? 'orden' : 'órdenes'})`, s: ESTILO.totalTexto },
    { v: '', s: ESTILO.totalTexto },
    { v: '', s: ESTILO.totalTexto },
    { v: '', s: ESTILO.totalTexto },
    { v: '', s: ESTILO.totalTexto },
    { v: '', s: ESTILO.totalTexto },
    suma('G', t.acondicionamientos, ESTILO.totalDecimal),
    suma('H', t.moes, ESTILO.totalDecimal),
    suma('I', t.equivalente, ESTILO.totalDecimal),
    suma('J', t.importe, ESTILO.totalDinero),
  ]);

  const ultimaCol = letraColumna(encabezados.length - 1);
  return crearXlsx([
    {
      nombre: `${mesTexto(mes)} ${anio}`,
      columnas: [13, 13, 12, 12, 34, 46, 19, 9, 13, 14],
      filas,
      combinar: [`A1:${ultimaCol}1`, `A2:${ultimaCol}2`, `A${filaTotal}:F${filaTotal}`],
      fijarFilas: 4,
    },
  ]);
}

export function nombreArchivoLiquidacion(empresa, anio, mes) {
  const limpio = String(empresa.nombre || 'empresa')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `Liquidacion-${limpio}-${anio}-${String(mes).padStart(2, '0')}.xlsx`;
}
