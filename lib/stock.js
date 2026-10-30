import { supabase } from './supabase';
import { numero, r2 } from './precios';
import { mensajeError } from './util';
import { ESTILO, crearXlsx } from './xlsx';
import { avisar } from './avisos';

// Stock de la empresa, del equipo y de cada trabajo (SQL 10)

export const AVISO_SQL_10 = 'Falta activar el stock: corré el SQL 10 en Supabase.';
const sinFuncion = (e) => !!e && (e.code === 'PGRST202' || e.code === '42883' || e.code === '42P01' || e.code === 'PGRST205');
export const textoError = (e) => (sinFuncion(e) ? AVISO_SQL_10 : mensajeError(e));
export const esFaltaSql = sinFuncion;

// Lo que mueve stock puede generar avisos (entregas para confirmar, respuestas): se mandan por push
const MUEVEN_STOCK = new Set([
  'stock_transferir', 'stock_a_trabajo', 'stock_desde_trabajo', 'stock_responder', 'stock_cancelar', 'stock_anular', 'recibir_orden_compra',
]);

export async function rpcStock(nombre, args) {
  const { data, error } = await supabase.rpc(nombre, args);
  if (error) throw error;
  if (MUEVEN_STOCK.has(nombre)) avisar();
  return data;
}

export const TIPOS_MOV = {
  ingreso: { texto: 'Ingreso', icono: 'descargar' },
  transferencia: { texto: 'Entrega', icono: 'ruta' },
  a_trabajo: { texto: 'A un trabajo', icono: 'herramienta' },
  devolucion: { texto: 'Devolución', icono: 'repetir' },
  devolucion_proveedor: { texto: 'Devuelto al proveedor', icono: 'empresa' },
  conteo: { texto: 'Conteo', icono: 'check' },
  baja: { texto: 'Baja', icono: 'borrar' },
  anulacion: { texto: 'Anulación', icono: 'cerrar' },
};

export const ESTADOS_MOV = {
  hecho: { texto: 'Hecho', clase: 'bg-menta-500/15 text-menta-300' },
  pendiente: { texto: 'Por confirmar', clase: 'bg-amber-400/15 text-amber-300' },
  rechazado: { texto: 'Rechazado', clase: 'bg-red-500/15 text-red-300' },
  cancelado: { texto: 'Cancelado', clase: 'bg-navy-700 text-tinta-300' },
};

export const MOTIVOS_INGRESO = { compra: 'Compra', inicial: 'Stock inicial', otro: 'Otro' };
export const MOTIVOS_BAJA = { rotura: 'Rotura', perdida: 'Pérdida', vencido: 'Vencido', robo: 'Robo', otro: 'Otro' };
export const ESTADOS_TRABAJO_TEXTO = {
  pendiente: 'pendiente', en_curso: 'en curso', multidia: 'sigue otro día', suspendido: 'suspendido', finalizado: 'terminado',
  cancelado: 'cancelado', confirmado: 'confirmado', realizado: 'realizado', borrado: 'borrado',
};
export const estadoTrabajo = (e) => ESTADOS_TRABAJO_TEXTO[e] || e || '';

export const MOTIVOS_DEVOLUCION = { sobrante: 'Sobró', error: 'Se cargó de más', cancelado: 'Trabajo cancelado' };

// Unidad mínima en la que se lleva el stock
export const UNIDADES = [
  { id: 'u', texto: 'Unidad (u)', decimales: 0 },
  { id: 'm', texto: 'Metro (m)', decimales: 2 },
  { id: 'm²', texto: 'Metro cuadrado (m²)', decimales: 2 },
  { id: 'm³', texto: 'Metro cúbico (m³)', decimales: 3 },
  { id: 'kg', texto: 'Kilo (kg)', decimales: 3 },
  { id: 'g', texto: 'Gramo (g)', decimales: 0 },
  { id: 'l', texto: 'Litro (l)', decimales: 2 },
  { id: 'ml', texto: 'Mililitro (ml)', decimales: 0 },
  { id: 'par', texto: 'Par', decimales: 0 },
  { id: 'juego', texto: 'Juego', decimales: 0 },
];

export const numeroMov = (n) => `Nº ${String(n || 0).padStart(5, '0')}`;
const r3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

// 12,5
export function cant(n, decimales = 3) {
  return (Number(n) || 0).toLocaleString('es-UY', { maximumFractionDigits: decimales });
}
// 12,5 m
export const conUnidad = (n, m) => `${cant(n, m?.decimales ?? 3)} ${m?.unidad || 'u'}`;

// Presentaciones de mayor a menor (las que traen más de 1)
const presentacionesOrdenadas = (m) =>
  [...(m?.presentaciones || [])].filter((p) => Number(p.factor) > 1).sort((a, b) => Number(b.factor) - Number(a.factor));

/** 245,5 m con rollos de 100 m → "2 × Rollo 100 m + 45,5 m" (null si no hay presentaciones que entren) */
export function desglose(n, m) {
  let resto = Number(n) || 0;
  const pres = presentacionesOrdenadas(m);
  if (!pres.length || resto <= 0) return null;
  const partes = [];
  for (const p of pres) {
    const k = Math.floor((resto + 1e-9) / Number(p.factor));
    if (k > 0) {
      partes.push(`${k} × ${p.nombre}`);
      resto = r3(resto - k * Number(p.factor));
    }
  }
  if (!partes.length) return null;
  if (resto > 0) partes.push(`${cant(resto, m.decimales)} ${m.unidad}`);
  return partes.join(' + ');
}

export function factorDe(m, pres) {
  if (!pres) return 1;
  const p = (m?.presentaciones || []).find((x) => x.nombre === pres);
  return p ? Number(p.factor) : null;
}

/** Cantidad cargada (en la presentación elegida) → unidades mínimas */
export function aBase(valor, pres, m) {
  const v = numero(valor);
  const f = factorDe(m, pres);
  if (v === null || f === null) return null;
  return r3(v * f);
}

export function errorCantidad(base, m, { conteo = false } = {}) {
  if (base === null || base === undefined) return 'Poné la cantidad';
  if (conteo ? base < 0 : base <= 0) return conteo ? 'No puede ser negativo' : 'Tiene que ser más que 0';
  const d = Number(m?.decimales ?? 0);
  const escala = 10 ** d;
  if (Math.abs(base * escala - Math.round(base * escala)) > 1e-6) {
    return d === 0 ? `Va por ${m.unidad === 'u' ? 'unidades enteras' : `${m.unidad} enteros`}` : `Hasta ${d} ${d === 1 ? 'decimal' : 'decimales'}`;
  }
  return '';
}

/** Cómo se cargó un renglón: "1 × Rollo 100 m (100 m)" o "12,5 m" */
export function textoRenglon(i) {
  const m = { unidad: i.unidad, decimales: i.decimales };
  if (i.presentacion && i.cantidad_presentacion !== null && i.cantidad_presentacion !== undefined && Number(i.factor) !== 1) {
    return `${cant(i.cantidad_presentacion)} × ${i.presentacion} (${conUnidad(i.cantidad, m)})`;
  }
  return conUnidad(i.cantidad, m);
}

/** Título del comprobante según lo que pasó */
export function tituloMov(m) {
  if (m.tipo === 'anulacion') return `Anulación del ${numeroMov(m.anula_numero)}`;
  if (m.tipo === 'transferencia') return m.destino_tipo === 'operario' ? 'Entrega' : 'Pase entre lugares';
  if (m.tipo === 'devolucion') return m.origen_tipo === 'trabajo' ? 'Devolución de un trabajo' : 'Devolución al depósito';
  if (m.tipo === 'ingreso') return m.orden_compra_id ? 'Recepción de compra' : `Ingreso${m.motivo && m.motivo !== 'compra' ? ` · ${MOTIVOS_INGRESO[m.motivo] || m.motivo}` : ''}`;
  if (m.tipo === 'baja') return `Baja · ${MOTIVOS_BAJA[m.motivo] || m.motivo || ''}`;
  if (m.tipo === 'conteo') return m.motivo === 'inicial' ? 'Conteo inicial' : 'Conteo';
  return TIPOS_MOV[m.tipo]?.texto || m.tipo;
}

/** De dónde a dónde */
export function rutaMov(m) {
  switch (m.tipo) {
    case 'ingreso':
      return `${m.proveedor || MOTIVOS_INGRESO[m.motivo] || 'Ingreso'} → ${m.destino || '—'}`;
    case 'devolucion_proveedor':
      return `${m.origen || '—'} → ${m.proveedor || 'Proveedor'}`;
    case 'baja':
    case 'conteo':
      return m.origen || '—';
    case 'anulacion':
      return [m.origen, m.destino].filter(Boolean).join(' → ') || '—';
    default:
      return `${m.origen || '—'} → ${m.destino || '—'}`;
  }
}

export function resumenItems(items = [], max = 3) {
  const t = items.slice(0, max).map((i) => `${i.nombre} ${textoRenglon(i)}`);
  if (items.length > max) t.push(`y ${items.length - max} más`);
  return t.join(' · ');
}

export function fechaHora(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-UY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Renglones del editor → lo que esperan las funciones de la base. Devuelve { items, error } */
export function renglonesAItems(renglones, { conteo = false, conCosto = false } = {}) {
  const items = [];
  for (const r of renglones) {
    if (conteo && (r.valor === '' || r.valor === null || r.valor === undefined)) continue;
    const base = aBase(r.valor, r.pres, r.material);
    const err = errorCantidad(base, r.material, { conteo });
    if (err) return { items: [], error: `${r.material.nombre}: ${err}` };
    const it = r.pres
      ? { material_id: r.material.id, presentacion: r.pres, cantidad_presentacion: numero(r.valor) }
      : { material_id: r.material.id, cantidad: base };
    if (conCosto && numero(r.costo) !== null) it.costo = r3(numero(r.costo) / (factorDe(r.material, r.pres) || 1));
    items.push(it);
  }
  if (!items.length) return { items, error: conteo ? 'Completá lo que contaste de al menos un material' : 'Agregá al menos un material' };
  return { items, error: '' };
}

/** Materiales de una respuesta de la base (material_id → id) */
export const normalizarMaterial = (m) => ({ ...m, id: m.id || m.material_id });

/** Texto para compartir un comprobante (WhatsApp, etc.) */
export function textoComprobante(m, empresa = '') {
  return [
    `${m.remito ? `Remito Nº ${String(m.remito).padStart(6, '0')} · ` : ''}${tituloMov(m)} ${numeroMov(m.numero)}${empresa ? ` · ${empresa}` : ''}`,
    `${fechaHora(m.creado_en)} · ${rutaMov(m)}`,
    '',
    ...(m.items || []).map((i) => `• ${i.nombre}: ${textoRenglon(i)}${i.recibido !== null && i.recibido !== undefined && Number(i.recibido) !== Number(i.cantidad) ? ` (recibido ${cant(i.recibido)} ${i.unidad})` : ''}`),
    m.nota ? `\nNota: ${m.nota}` : '',
    m.por ? `Hecho por ${m.por}` : '',
    m.huella ? `Sello ${m.huella.slice(0, 12)}` : '',
  ]
    .filter((l, k, a) => l !== '' || a[k - 1] !== '')
    .join('\n');
}

/** Total de un material en depósitos y personas del equipo */
export const totalMaterial = (m) => (m.lugares || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
export const bajoMinimo = (m) =>
  m.activo !== false && m.stock_minimo !== null && m.stock_minimo !== undefined && totalMaterial(m) + Number(m.transito || 0) < Number(m.stock_minimo);

/** Planilla con el stock de cada material por lugar */
export function planillaExistencias({ materiales = [], lugares = [], veCostos = false }) {
  const cols = lugares.filter((l) => l.tipo !== 'trabajo');
  const enc = ['Material', 'Código', 'Marca', 'Categoría', 'Unidad', ...cols.map((l) => l.nombre), 'Total', 'En obra', 'En camino', 'Mínimo', ...(veCostos ? ['Costo', 'Valor'] : [])].map(
    (v) => ({ v, s: ESTILO.encabezado })
  );
  const num = (v) => ({ v: Number(v) || 0, s: ESTILO.decimal });
  const filas = materiales
    .filter((m) => m.activo !== false)
    .map((m) => {
      const por = Object.fromEntries((m.lugares || []).map((l) => [l.ubicacion_id, Number(l.cantidad)]));
      const total = totalMaterial(m);
      const costo = m.costo === null || m.costo === undefined ? null : Number(m.costo);
      return [
        { v: m.nombre, s: ESTILO.texto },
        { v: m.codigo || '', s: ESTILO.texto },
        { v: m.marca || '', s: ESTILO.texto },
        { v: m.categoria || '', s: ESTILO.texto },
        { v: m.unidad, s: ESTILO.texto },
        ...cols.map((l) => num(por[l.id])),
        num(total),
        num(m.en_obra),
        num(m.transito),
        m.stock_minimo === null || m.stock_minimo === undefined ? { v: '', s: ESTILO.decimal } : num(m.stock_minimo),
        ...(veCostos ? [{ v: costo ?? '', s: ESTILO.dinero }, { v: costo === null ? '' : r2(total * costo), s: ESTILO.dinero }] : []),
      ];
    });
  return crearXlsx([
    {
      nombre: 'Stock',
      columnas: [38, 12, 14, 16, 8, ...cols.map(() => 13), 10, 10, 10, 10, ...(veCostos ? [12, 14] : [])],
      filas: [enc, ...filas],
      fijarFilas: 1,
    },
  ]);
}

export function bajarArchivo(bytes, nombre, tipo) {
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
