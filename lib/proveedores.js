import { supabase } from './supabase';
import { crearXlsx, ESTILO } from './xlsx';
import { numero, pesos, r2 } from './precios';

// Proveedores, listas de precios y órdenes de compra (SQL 09)

export const FUENTES = {
  planilla: { texto: 'Planilla Excel o CSV', corto: 'Planilla', icono: 'documento', ayuda: 'El proveedor te pasa su lista en Excel o CSV y la subís acá cada vez que cambia.' },
  url: { texto: 'Link publicado', corto: 'Link', icono: 'compartir', ayuda: 'Un link a la lista (por ejemplo una planilla de Google publicada como CSV). TaListo! la actualiza cuando tocás Actualizar.' },
  api: { texto: 'API del proveedor', corto: 'API', icono: 'ajustes', ayuda: 'El sistema del proveedor da la lista, el stock en el momento y recibe las órdenes de compra.' },
  manual: { texto: 'A mano', corto: 'A mano', icono: 'editar', ayuda: 'Cargás los productos y precios uno por uno.' },
};

export const ESTADOS_COMPRA = {
  borrador: { texto: 'Borrador', clase: 'bg-navy-700 text-tinta-200' },
  enviada: { texto: 'Enviada', clase: 'bg-[#0a84ff]/20 text-[#8cc8ff]' },
  confirmada: { texto: 'Confirmada', clase: 'bg-amber-400/15 text-amber-300' },
  parcial: { texto: 'Recibida en parte', clase: 'bg-menta-500/10 text-menta-200' },
  recibida: { texto: 'Recibida', clase: 'bg-menta-500/15 text-menta-300' },
  cancelada: { texto: 'Cancelada', clase: 'bg-red-500/15 text-red-300' },
};

export const numeroOrden = (n) => String(n || 0).padStart(4, '0');
export const sinFuncion = (e) => !!e && (e.code === 'PGRST202' || e.code === '42883' || e.code === '42P01' || e.code === 'PGRST205');
export const AVISO_SQL_09 = 'Falta activar los proveedores: corré el SQL 09 en Supabase.';

export const simboloMoneda = (m) => (m === 'USD' ? 'US$' : '$');
export function importe(n, moneda = 'UYU') {
  const v = Number(n) || 0;
  return moneda === 'USD' ? `US$ ${v.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : pesos(v);
}

// Llama a las rutas del servidor con la sesión del usuario
export async function apiProveedores(ruta, cuerpo) {
  const { data } = await supabase.auth.getSession();
  const r = await fetch(`/api/proveedores/${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
    body: JSON.stringify(cuerpo || {}),
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(datos.error || 'No se pudo completar. Intentá de nuevo.');
    e.datos = datos;
    throw e;
  }
  return datos;
}

// Carga una lista de precios por tandas. onProgreso(hechos, total)
export async function importarProductos(proveedorId, productos, { onProgreso, resumen } = {}) {
  const { data: inicio, error: e1 } = await supabase.rpc('iniciar_importacion', { p_proveedor: proveedorId });
  if (e1) throw e1;
  const suma = { nuevos: 0, actualizados: 0, omitidos: 0 };
  for (let i = 0; i < productos.length; i += 2000) {
    const { data, error } = await supabase.rpc('importar_productos', { p_proveedor: proveedorId, p_filas: productos.slice(i, i + 2000) });
    if (error) throw error;
    suma.nuevos += data.nuevos;
    suma.actualizados += data.actualizados;
    suma.omitidos += data.omitidos;
    onProgreso?.(Math.min(i + 2000, productos.length), productos.length);
  }
  const texto = resumen || `Planilla: ${suma.nuevos + suma.actualizados} productos (${suma.nuevos} nuevos)`;
  const { data: cierre, error: e3 } = await supabase.rpc('cerrar_importacion', { p_proveedor: proveedorId, p_inicio: inicio, p_resumen: texto });
  if (e3) throw e3;
  return { ...suma, ...cierre };
}

// Revisa stock y precio actual de los productos (en vivo si el proveedor tiene API)
export async function revisarProductos(cuenta, ids) {
  const lista = [...new Set((ids || []).filter(Boolean))];
  if (!lista.length) return {};
  const { productos } = await apiProveedores('stock', { cuenta, productos: lista });
  return Object.fromEntries((productos || []).map((p) => [p.id, p]));
}

// Estado del stock para una cantidad pedida
export function estadoStock(info, cantidad) {
  if (!info) return null;
  if (info.activo === false) return { tipo: 'baja', texto: 'Ya no está en la lista', clase: 'text-red-300' };
  const s = info.stock;
  if (s === null || s === undefined) return { tipo: 'sin_dato', texto: 'Sin dato de stock', clase: 'text-tinta-400' };
  const pedido = numero(cantidad) ?? 0;
  if (s <= 0) return { tipo: 'sin', texto: 'Sin stock', clase: 'text-red-300' };
  if (s < pedido) return { tipo: 'poco', texto: `Solo hay ${Number(s).toLocaleString('es-UY')}`, clase: 'text-amber-300' };
  return { tipo: 'ok', texto: `Hay stock (${Number(s).toLocaleString('es-UY')})`, clase: 'text-menta-300' };
}

const CLAVE_COTIZACION = 'talisto_cotizacion_usd';
export function cotizacionGuardada() {
  try {
    return Number(window.localStorage.getItem(CLAVE_COTIZACION)) || '';
  } catch {
    return '';
  }
}
export function guardarCotizacion(v) {
  try {
    window.localStorage.setItem(CLAVE_COTIZACION, String(v));
  } catch {
    /* sin almacenamiento */
  }
}

// Producto del catálogo → línea de materiales (costo en pesos, margen por defecto)
export function lineaDesdeProducto(p, { margen = 30, cotizacion = null } = {}) {
  const costo = p.moneda === 'USD' && cotizacion ? r2(Number(p.precio) * Number(cotizacion)) : Number(p.precio);
  return {
    item: p.nombre,
    cantidad: '1',
    unidad: p.unidad || 'u',
    proveedor: p.proveedor,
    costo: String(costo),
    margen: String(margen),
    precio: String(r2(costo * (1 + (Number(margen) || 0) / 100))),
    producto_id: p.id,
    proveedor_id: p.proveedor_id,
    codigo: p.codigo,
  };
}

// Texto para WhatsApp / email
export function textoOrden(orden, negocio = {}) {
  const lineas = (orden.items || [])
    .filter((i) => String(i.item || '').trim())
    .map((i) => `• ${Number(i.cantidad || 0).toLocaleString('es-UY')} ${i.unidad || 'u'} — ${i.item}${i.codigo ? ` (cód. ${i.codigo})` : ''}`);
  return [
    `Hola${orden.proveedor_datos?.contacto ? ` ${orden.proveedor_datos.contacto}` : ''}! Les paso la orden de compra Nº ${numeroOrden(orden.numero)}${negocio.nombre ? ` de ${negocio.nombre}` : ''}:`,
    '',
    ...lineas,
    '',
    `Total estimado: ${importe(orden.subtotal, orden.moneda)}${orden.iva_incluido ? ' (IVA incluido)' : ' + IVA'}`,
    orden.entrega ? `Entrega: ${orden.entrega}` : '',
    orden.notas ? `Notas: ${orden.notas}` : '',
    '',
    'Por favor confirmen disponibilidad y fecha de entrega. ¡Gracias!',
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
}

// Planilla modelo para pasarle al proveedor
export function planillaModelo() {
  const enc = ['Código', 'Descripción', 'Marca', 'Unidad', 'Precio', 'Stock', 'Categoría'].map((v) => ({ v, s: ESTILO.encabezado }));
  const ej = [
    ['TERM-20', 'Llave térmica bipolar 20A', 'Marca', 'u', 625, 12, 'Protecciones'],
    ['CAB-2', 'Cable unipolar 2 mm²', '', 'm', 52.5, 300, 'Cables'],
  ].map((f) => f.map((v, k) => ({ v, s: k === 4 ? ESTILO.dinero : k === 5 ? ESTILO.decimal : ESTILO.texto })));
  return crearXlsx([{ nombre: 'Lista de precios', columnas: [14, 42, 16, 10, 12, 10, 18], filas: [enc, ...ej], fijarFilas: 1 }]);
}
