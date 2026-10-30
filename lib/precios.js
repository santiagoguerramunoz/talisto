// Cuentas de materiales, márgenes, mano de obra e IVA

export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function numero(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Precio final a partir del costo y el margen (%)
export function precioConMargen(costo, margen) {
  const c = numero(costo);
  if (c === null) return null;
  return r2(c * (1 + (numero(margen) || 0) / 100));
}

// Margen (%) a partir del costo y el precio final
export function margenDePrecio(costo, precio) {
  const c = numero(costo);
  const p = numero(precio);
  if (c === null || p === null || c === 0) return null;
  return Math.round(((p - c) / c) * 1000) / 10;
}

export const importeLinea = (m) => r2((numero(m.cantidad) ?? 0) * (numero(m.precio) ?? 0));
export const costoLinea = (m) => r2((numero(m.cantidad) ?? 0) * (numero(m.costo) ?? 0));

// Lo que se guarda en la base
export function limpiarMateriales(lista = []) {
  return (lista || [])
    .filter((m) => String(m.item || '').trim())
    .map((m) => ({
      item: String(m.item).trim(),
      cantidad: numero(m.cantidad),
      unidad: String(m.unidad || '').trim() || 'u',
      proveedor: String(m.proveedor || '').trim() || null,
      costo: numero(m.costo),
      margen: numero(m.margen),
      precio: numero(m.precio),
      // en los presupuestos mixtos, cada renglón en su moneda
      ...(m.moneda === 'USD' ? { moneda: 'USD' } : {}),
      // producto del catálogo de un proveedor (para revisar stock y armar la orden de compra)
      ...(m.producto_id ? { producto_id: m.producto_id, proveedor_id: m.proveedor_id || null, codigo: m.codigo || null } : {}),
    }));
}

// Para editar en el formulario (todo como texto)
export function materialesParaEditar(lista = []) {
  return (Array.isArray(lista) ? lista : []).map((m) => ({
    item: m.item || '',
    cantidad: m.cantidad ?? '',
    unidad: m.unidad || 'u',
    proveedor: m.proveedor || '',
    costo: m.costo ?? '',
    margen: m.margen ?? '',
    precio: m.precio ?? '',
    moneda: m.moneda === 'USD' ? 'USD' : 'UYU',
    ...(m.producto_id ? { producto_id: m.producto_id, proveedor_id: m.proveedor_id || null, codigo: m.codigo || null } : {}),
  }));
}

export function totalesMateriales(lista = []) {
  const t = (lista || []).reduce(
    (acc, m) => ({
      costo: acc.costo + costoLinea(m),
      venta: acc.venta + importeLinea(m),
      items: acc.items + (String(m.item || '').trim() ? 1 : 0),
    }),
    { costo: 0, venta: 0, items: 0 }
  );
  const costo = r2(t.costo);
  const venta = r2(t.venta);
  return { costo, venta, items: t.items, ganancia: r2(venta - costo), margen: costo > 0 ? Math.round(((venta - costo) / costo) * 1000) / 10 : null };
}

// Totales de un presupuesto (igual que los calcula la base)
export function totalesPresupuesto({ items = [], mano_obra, iva_porcentaje }) {
  const mat = totalesMateriales(items);
  const manoObra = numero(mano_obra) ?? 0;
  const subtotal = r2(mat.venta + manoObra);
  const iva = r2((subtotal * (numero(iva_porcentaje) ?? 0)) / 100);
  return { ...mat, manoObra, subtotal, iva, total: r2(subtotal + iva), gananciaTotal: r2(subtotal - mat.costo) };
}

// "$ 1.234,50"
export function pesos(n, { decimales = true } = {}) {
  const v = Number(n) || 0;
  return `$ ${v.toLocaleString('es-UY', { minimumFractionDigits: decimales ? 2 : 0, maximumFractionDigits: decimales ? 2 : 0 })}`;
}

// ---------------------------------------------------------------------
// Presupuestos en pesos, dólares o mixtos (SQL 12)
// ---------------------------------------------------------------------
export const MONEDAS_PRESUPUESTO = [
  ['UYU', 'Pesos', '$'],
  ['USD', 'Dólares', 'US$'],
  ['mixto', 'Mixto', '$ y US$'],
];

// "US$ 1.234,50" o "$ 1.234,50"
export function dinero(n, moneda = 'UYU', { decimales = true } = {}) {
  const v = Number(n) || 0;
  const t = v.toLocaleString('es-UY', { minimumFractionDigits: decimales ? 2 : 0, maximumFractionDigits: decimales ? 2 : 0 });
  return moneda === 'USD' ? `US$ ${t}` : `$ ${t}`;
}

// En qué moneda va un renglón según la moneda del presupuesto
export const monedaLinea = (m, moneda = 'UYU') => (moneda === 'mixto' ? (m?.moneda === 'USD' ? 'USD' : 'UYU') : moneda === 'USD' ? 'USD' : 'UYU');

/**
 * Totales de cada moneda y la equivalencia en pesos (igual que los calcula la base).
 * { UYU: {venta, costo, manoObra, subtotal, iva, total}, USD: {…}, equivalente: {subtotal, iva, total, costo}, usaUYU, usaUSD }
 */
export function totalesMonedas({ items = [], mano_obra, mano_obra_moneda = 'UYU', iva_porcentaje, moneda = 'UYU', cotizacion }) {
  const pct = numero(iva_porcentaje) ?? 0;
  const base = () => ({ venta: 0, costo: 0, manoObra: 0 });
  const t = { UYU: base(), USD: base() };
  (items || []).forEach((m) => {
    const k = monedaLinea(m, moneda);
    t[k].venta += importeLinea(m);
    t[k].costo += costoLinea(m);
  });
  const moMoneda = moneda === 'mixto' ? (mano_obra_moneda === 'USD' ? 'USD' : 'UYU') : monedaLinea({}, moneda);
  t[moMoneda].manoObra = numero(mano_obra) ?? 0;
  for (const k of ['UYU', 'USD']) {
    const x = t[k];
    x.venta = r2(x.venta);
    x.costo = r2(x.costo);
    x.subtotal = r2(x.venta + x.manoObra);
    x.iva = r2((x.subtotal * pct) / 100);
    x.total = r2(x.subtotal + x.iva);
    x.ganancia = r2(x.subtotal - x.costo);
  }
  const cot = numero(cotizacion) || 0;
  const equivalente = {
    subtotal: r2(t.UYU.subtotal + t.USD.subtotal * cot),
    iva: r2(t.UYU.iva + t.USD.iva * cot),
    costo: r2(t.UYU.costo + t.USD.costo * cot),
  };
  equivalente.total = r2(equivalente.subtotal + equivalente.iva);
  const usaUSD = moneda === 'USD' || (moneda === 'mixto' && (t.USD.subtotal > 0 || t.USD.costo > 0));
  const usaUYU = moneda === 'UYU' || (moneda === 'mixto' && (t.UYU.subtotal > 0 || !usaUSD));
  return { ...t, equivalente, usaUSD, usaUYU, cotizacion: cot, moneda };
}

// "US$ 1.220,00 + $ 2.074,00"
export function textoTotales(tm, campo = 'total') {
  const partes = [];
  if (tm.usaUSD) partes.push(dinero(tm.USD[campo], 'USD'));
  if (tm.usaUYU) partes.push(dinero(tm.UYU[campo], 'UYU'));
  return partes.join(' + ') || dinero(0);
}
