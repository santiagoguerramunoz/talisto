import { COLORES } from './util';
import { numero, pesos, r2 } from './precios';

export const CATEGORIAS_BASE = [
  { nombre: 'Movilidad', icono: 'auto', color: '#5aa9e6', ejemplo: 'Ej. Ida y vuelta a Pocitos' },
  { nombre: 'Insumos', icono: 'caja', color: '#f6c344', ejemplo: 'Ej. Cinta, tarugos, precintos' },
  { nombre: 'Viáticos', icono: 'cafe', color: '#f472b6', ejemplo: 'Ej. Almuerzo en la obra' },
  { nombre: 'Herramientas', icono: 'herramienta', color: '#a78bfa', ejemplo: 'Ej. Mechas, pinza nueva' },
  { nombre: 'Otros', icono: 'etiqueta', color: '#94a3b8', ejemplo: 'Ej. Fotocopias, estacionamiento' },
];

export const TIPOS_MOVILIDAD = { bus: 'Bus', vehiculo: 'Vehículo propio', otro: 'Otro' };

// Categorías fijas + las que agregó el usuario
export function categoriasDe(ajustes) {
  const propias = (ajustes?.categorias_gastos || [])
    .filter((c) => c && !CATEGORIAS_BASE.some((b) => b.nombre.toLowerCase() === c.toLowerCase()))
    .map((nombre, i) => ({ nombre, icono: 'etiqueta', color: COLORES[i % COLORES.length], ejemplo: '', propia: true }));
  return [...CATEGORIAS_BASE, ...propias];
}

export function infoCategoria(nombre, categorias) {
  return categorias.find((c) => c.nombre === nombre) || { nombre, icono: 'etiqueta', color: '#94a3b8', ejemplo: '' };
}

// Bus: boletos × precio · Vehículo: km ÷ consumo (km por litro) × precio del litro
export function calcularMovilidad({ tipo, cantidad, precio_unitario, km, consumo_km_litro }) {
  if (tipo === 'bus') {
    const c = numero(cantidad);
    const p = numero(precio_unitario);
    return { litros: null, monto: c !== null && p !== null ? r2(c * p) : null };
  }
  if (tipo === 'vehiculo') {
    const k = numero(km);
    const consumo = numero(consumo_km_litro);
    const p = numero(precio_unitario);
    if (k === null || !consumo) return { litros: null, monto: null };
    const litros = k / consumo;
    return { litros: r2(litros), monto: p !== null ? r2(litros * p) : null };
  }
  return { litros: null, monto: null };
}

export function detalleGasto(g) {
  const n = (v, d = 1) => Number(v).toLocaleString('es-UY', { maximumFractionDigits: d });
  if (g.tipo === 'bus' && g.cantidad !== null && g.cantidad !== undefined) {
    return `${n(g.cantidad, 0)} ${Number(g.cantidad) === 1 ? 'boleto' : 'boletos'}${g.precio_unitario ? ` × ${pesos(g.precio_unitario)}` : ''}`;
  }
  if (g.tipo === 'vehiculo' && g.km !== null && g.km !== undefined) {
    return `${n(g.km)} km${g.litros ? ` · ${n(g.litros, 2)} L` : ''}${g.precio_unitario ? ` × ${pesos(g.precio_unitario)}` : ''}`;
  }
  return '';
}

export function totalesPorCategoria(gastos = []) {
  const t = {};
  gastos.forEach((g) => {
    const c = g.categoria || 'Otros';
    if (!t[c]) t[c] = { total: 0, cantidad: 0 };
    t[c].total = r2(t[c].total + Number(g.monto || 0));
    t[c].cantidad += 1;
  });
  return t;
}
