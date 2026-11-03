'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { numero } from './precios';

// Inteligencia de compras (SQL 15): historial de precios, comparador, alertas y precios para presupuestos.

export const sinInteligencia = (e) => !!e && (e.code === 'PGRST202' || e.code === '42883' || e.code === '42P01' || e.code === 'PGRST205');
export const MENSAJE_FALTA_SQL = 'Falta activar la inteligencia de compras: corré el SQL 15 en Supabase.';

// Colores de cada proveedor en los gráficos (se distinguen bien sobre el fondo oscuro)
export const COLORES_PROVEEDOR = ['#4fe0b6', '#5aa9e6', '#ec8328', '#c4a5ff', '#f2c94c', '#ff8fa3', '#7be0a5', '#8cc8ff'];

export const TIPOS_ALERTA = {
  aumento: { texto: 'Aumento', clase: 'bg-red-500/15 text-red-300', icono: 'arriba' },
  baja: { texto: 'Baja', clase: 'bg-menta-500/15 text-menta-300', icono: 'abajo' },
  mas_barato: { texto: 'Más barato en otro', clase: 'bg-[#0a84ff]/20 text-[#8cc8ff]', icono: 'dinero' },
  inconsistencia: { texto: 'Revisar documento', clase: 'bg-amber-400/15 text-amber-300', icono: 'documento' },
  incompleto: { texto: 'Datos incompletos', clase: 'bg-amber-400/15 text-amber-300', icono: 'documento' },
  desactualizado: { texto: 'Precio viejo', clase: 'bg-navy-700 text-tinta-300', icono: 'reloj' },
};

// "+20 %" / "−13,2 %"
export function pct(v, { signo = true } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const t = Math.abs(n).toLocaleString('es-UY', { maximumFractionDigits: 1 });
  return `${signo ? (n > 0 ? '+' : n < 0 ? '−' : '') : ''}${t} %`;
}

// Pesos sin decimales si es entero ("$ 1.500", "$ 36,07")
export function pesos(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const entero = Math.abs(n - Math.round(n)) < 0.005;
  return `$ ${n.toLocaleString('es-UY', { minimumFractionDigits: entero ? 0 : 2, maximumFractionDigits: entero ? 0 : 2 })}`;
}

export function haceDias(iso) {
  if (!iso) return '';
  const d = Math.round((Date.now() - new Date(`${String(iso).slice(0, 10)}T12:00:00`).getTime()) / 86400000);
  if (d <= 0) return 'hoy';
  if (d === 1) return 'ayer';
  if (d < 60) return `hace ${d} días`;
  const m = Math.round(d / 30);
  return m < 24 ? `hace ${m} meses` : `hace ${Math.round(d / 365)} años`;
}

export const unidadTexto = (u) => (u === 'u' ? 'unidad' : u || 'unidad');

/**
 * Precios de compra para los renglones de un presupuesto o ticket (último costo, mejor precio, si está viejo).
 * Devuelve { [indice]: info } o null mientras no hay datos. Solo consulta con `activo` (Business y quien ve costos).
 */
export function usePreciosCompra(cuenta, lineas, activo) {
  const [porLinea, setPorLinea] = useState(null);
  const ultima = useRef('');
  const items = (lineas || [])
    .map((m, i) => ({ i, producto_id: m.producto_id || null, descripcion: String(m.item || '').trim(), unidad: m.unidad || '' }))
    .filter((x) => x.producto_id || x.descripcion.length >= 3);
  const clave = JSON.stringify(items.map((x) => [x.i, x.producto_id, x.descripcion.toLowerCase(), x.unidad]));

  useEffect(() => {
    if (!activo || !cuenta || !items.length) {
      setPorLinea(null);
      return undefined;
    }
    if (clave === ultima.current) return undefined;
    let vivo = true;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('mejores_precios', { p_cuenta: cuenta, p_items: items });
      if (!vivo) return;
      ultima.current = clave;
      if (error) {
        setPorLinea(null);
        return;
      }
      const mapa = {};
      (data || []).forEach((x) => {
        mapa[x.i] = x;
      });
      setPorLinea(mapa);
    }, 600);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, cuenta, clave]);

  return porLinea;
}

/**
 * Costo en la moneda del renglón a partir de un precio en pesos por unidad del renglón.
 * USD sin cotización → null (no se inventa).
 */
export function costoEnMoneda(pesosUnidad, monedaRenglon, cotizacion) {
  const v = Number(pesosUnidad);
  if (!Number.isFinite(v)) return null;
  if (monedaRenglon !== 'USD') return Math.round(v * 100) / 100;
  const c = numero(cotizacion);
  return c > 0 ? Math.round((v / c) * 100) / 100 : null;
}
