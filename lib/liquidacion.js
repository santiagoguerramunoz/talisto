import { crearXlsx, ESTILO, letraColumna } from './xlsx';
import { MESES } from './fechas';
import { numero, r2, totalesMateriales } from './precios';
import { minutosTrabajo } from './tiempos';

const mesTexto = (mes) => MESES[mes - 1].charAt(0).toUpperCase() + MESES[mes - 1].slice(1);

// Puestas equivalentes: puestas + MOE × factor (1 MOE = 1,75 puestas)
export function equivalenteOrden(o) {
  return Number(o.acondicionamientos || 0) + Number(o.moes || 0) * Number(o.factor_moe || 1.75);
}

const sinPrecio = (o) => o.precio_acondicionamiento === null || o.precio_acondicionamiento === undefined || o.precio_acondicionamiento === '';

// Lo que se cobra por puestas y MOE
export function importePuestas(o) {
  if (sinPrecio(o)) return null;
  return r2(equivalenteOrden(o) * Number(o.precio_acondicionamiento));
}

// Total del trabajo: puestas + mano de obra + materiales (a precio de venta)
export function importeOrden(o) {
  const puestas = importePuestas(o);
  const manoObra = numero(o.mano_obra) ?? 0;
  const materiales = totalesMateriales(o.materiales || []).venta;
  if (puestas === null && !manoObra && !materiales) return null;
  return r2((puestas || 0) + manoObra + materiales);
}

export function totalesOrdenes(ordenes, ahora = Date.now()) {
  return ordenes.reduce(
    (t, o) => {
      const imp = importeOrden(o);
      const mat = totalesMateriales(o.materiales || []);
      const faltaPrecio = sinPrecio(o) && equivalenteOrden(o) > 0;
      return {
        cantidad: t.cantidad + 1,
        acondicionamientos: t.acondicionamientos + Number(o.acondicionamientos || 0),
        moes: t.moes + Number(o.moes || 0),
        equivalente: t.equivalente + equivalenteOrden(o),
        puestas: r2(t.puestas + (importePuestas(o) || 0)),
        manoObra: r2(t.manoObra + (numero(o.mano_obra) ?? 0)),
        materiales: r2(t.materiales + mat.venta),
        costoMateriales: r2(t.costoMateriales + mat.costo),
        minutos: t.minutos + minutosTrabajo(o, ahora),
        importe: r2(t.importe + (imp || 0)),
        sinPrecio: t.sinPrecio + (faltaPrecio ? 1 : 0),
      };
    },
    { cantidad: 0, acondicionamientos: 0, moes: 0, equivalente: 0, puestas: 0, manoObra: 0, materiales: 0, costoMateriales: 0, minutos: 0, importe: 0, sinPrecio: 0 }
  );
}

export function textoHorario(o) {
  const h = (t) => (t ? String(t).slice(0, 5) : '');
  if (o.hora_inicio && o.hora_fin) return `${h(o.hora_inicio)}–${h(o.hora_fin)}`;
  return h(o.hora_inicio);
}

const ddmm = (iso) => {
  const [, m, d] = String(iso).split('-');
  return `${d}/${m}`;
};

/**
 * Planilla de liquidación del mes (.xlsx) para un cliente B2B.
 * ordenes: los trabajos finalizados del mes, ordenados por fecha.
 * Solo lleva precios de venta: costos, márgenes y proveedores no salen.
 */
export function planillaLiquidacion({ empresa, ordenes, anio, mes, profesional }) {
  const titulo = `Liquidación ${empresa.nombre} — ${mesTexto(mes)} ${anio}`;
  const precios = [...new Set(ordenes.map((o) => o.precio_acondicionamiento).filter((p) => p !== null && p !== undefined))];
  const factores = [...new Set(ordenes.map((o) => Number(o.factor_moe || 1.75)))];
  const fmt = (n) => Number(n).toLocaleString('es-UY', { maximumFractionDigits: 2 });
  const precioTexto = precios.length === 1 ? `$ ${fmt(precios[0])}` : precios.length ? 'según cada trabajo' : 'sin definir';
  const factorTexto = factores.length === 1 ? fmt(factores[0]) : 'según cada trabajo';
  const subtitulo = `${profesional ? `${profesional} · ` : ''}Precio por puesta: ${precioTexto} · 1 MOE = ${factorTexto} puestas`;

  const encabezados = [
    'Nº cliente',
    'Nº ticket',
    'Fecha',
    'Horario',
    'Dirección',
    'Detalle de lo realizado',
    'Puestas',
    'MOE',
    'Equivalente (puestas)',
    'Tiempo',
    'Mano de obra',
    'Materiales',
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
    const min = minutosTrabajo(o);
    const mat = totalesMateriales(o.materiales || []).venta;
    const mo = numero(o.mano_obra) ?? 0;
    const variosDias = o.fecha_inicio && o.fecha_inicio !== o.fecha;
    filas.push([
      { v: o.numero_cliente || '', s: ESTILO.texto },
      { v: o.numero_ticket || '', s: ESTILO.texto },
      variosDias ? { v: `${ddmm(o.fecha_inicio)} al ${ddmm(o.fecha)}`, s: ESTILO.texto } : { v: o.fecha, tipo: 'fecha', s: ESTILO.fecha },
      { v: textoHorario(o), s: ESTILO.texto },
      { v: [o.direccion, o.referencia].filter(Boolean).join(' · '), s: ESTILO.texto },
      { v: [o.realizado || o.pedido, o.cliente_final ? `(${o.cliente_final})` : ''].filter(Boolean).join(' '), s: ESTILO.texto },
      { v: Number(o.acondicionamientos || 0), s: ESTILO.decimal },
      { v: Number(o.moes || 0), s: ESTILO.decimal },
      { v: r2(equivalenteOrden(o)), s: ESTILO.decimal },
      min > 0 ? { v: min / 1440, s: ESTILO.horas } : { v: '', s: ESTILO.horas },
      mo ? { v: mo, s: ESTILO.dinero } : { v: '', s: ESTILO.dinero },
      mat ? { v: mat, s: ESTILO.dinero } : { v: '', s: ESTILO.dinero },
      imp === null ? { v: '', s: ESTILO.dinero } : { v: imp, s: ESTILO.dinero },
    ]);
  });

  const ultimaDatos = filas.length;
  const t = totalesOrdenes(ordenes);
  const filaTotal = filas.length + 1;
  const suma = (col, valor, estilo) =>
    ordenes.length ? { f: `SUM(${col}${primeraDatos}:${col}${ultimaDatos})`, v: valor, s: estilo } : { v: 0, s: estilo };
  filas.push([
    { v: `Totales (${t.cantidad} ${t.cantidad === 1 ? 'trabajo' : 'trabajos'})`, s: ESTILO.totalTexto },
    { v: '', s: ESTILO.totalTexto },
    { v: '', s: ESTILO.totalTexto },
    { v: '', s: ESTILO.totalTexto },
    { v: '', s: ESTILO.totalTexto },
    { v: '', s: ESTILO.totalTexto },
    suma('G', r2(t.acondicionamientos), ESTILO.totalDecimal),
    suma('H', r2(t.moes), ESTILO.totalDecimal),
    suma('I', r2(t.equivalente), ESTILO.totalDecimal),
    suma('J', t.minutos / 1440, ESTILO.totalHoras),
    suma('K', t.manoObra, ESTILO.totalDinero),
    suma('L', t.materiales, ESTILO.totalDinero),
    suma('M', t.importe, ESTILO.totalDinero),
  ]);

  const ultimaCol = letraColumna(encabezados.length - 1);
  const hojas = [
    {
      nombre: `${mesTexto(mes)} ${anio}`,
      columnas: [12, 12, 12, 11, 30, 42, 9, 8, 13, 9, 13, 13, 14],
      filas,
      combinar: [`A1:${ultimaCol}1`, `A2:${ultimaCol}2`, `A${filaTotal}:F${filaTotal}`],
      fijarFilas: 4,
    },
  ];

  // Detalle de materiales (solo precio de venta)
  const conMateriales = ordenes.filter((o) => totalesMateriales(o.materiales || []).items > 0);
  if (conMateriales.length) {
    const enc = ['Nº ticket', 'Nº cliente', 'Material', 'Cantidad', 'Unidad', 'Precio unitario', 'Importe'];
    const f2 = [[{ v: `Materiales — ${mesTexto(mes)} ${anio}`, s: ESTILO.titulo }], [], enc.map((v) => ({ v, s: ESTILO.encabezado }))];
    const desde = f2.length + 1;
    conMateriales.forEach((o) =>
      (o.materiales || [])
        .filter((m) => String(m.item || '').trim())
        .forEach((m) => {
          const cant = numero(m.cantidad) ?? 0;
          const precio = numero(m.precio) ?? 0;
          f2.push([
            { v: o.numero_ticket || '', s: ESTILO.texto },
            { v: o.numero_cliente || '', s: ESTILO.texto },
            { v: m.item, s: ESTILO.texto },
            { v: cant, s: ESTILO.decimal },
            { v: m.unidad || 'u', s: ESTILO.texto },
            { v: precio, s: ESTILO.dinero },
            { v: r2(cant * precio), s: ESTILO.dinero },
          ]);
        })
    );
    const hasta = f2.length;
    f2.push([
      { v: 'Total materiales', s: ESTILO.totalTexto },
      { v: '', s: ESTILO.totalTexto },
      { v: '', s: ESTILO.totalTexto },
      { v: '', s: ESTILO.totalTexto },
      { v: '', s: ESTILO.totalTexto },
      { v: '', s: ESTILO.totalTexto },
      { f: `SUM(G${desde}:G${hasta})`, v: t.materiales, s: ESTILO.totalDinero },
    ]);
    hojas.push({ nombre: 'Materiales', columnas: [12, 12, 40, 10, 9, 15, 14], filas: f2, combinar: ['A1:G1', `A${f2.length}:F${f2.length}`], fijarFilas: 3 });
  }

  return crearXlsx(hojas);
}

export function nombreArchivoLiquidacion(empresa, anio, mes) {
  const limpio = String(empresa.nombre || 'cliente')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `Liquidacion-${limpio}-${anio}-${String(mes).padStart(2, '0')}.xlsx`;
}
