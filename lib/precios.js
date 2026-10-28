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
