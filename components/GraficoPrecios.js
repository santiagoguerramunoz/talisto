'use client';

import { useEffect, useRef, useState } from 'react';
import { COLORES_PROVEEDOR, pesos } from '@/lib/compras';
import { fechaUY } from '@/lib/presupuestos';

// Ancho real del gráfico (así el texto queda del mismo tamaño en el celular y en la PC)
export function useAncho(inicial = 340) {
  const ref = useRef(null);
  const [ancho, setAncho] = useState(inicial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setAncho(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, ancho];
}

const dia = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00`).getTime();

/**
 * Evolución del precio de un artículo: una línea por proveedor (precio sin IVA, en pesos, por unidad del artículo).
 * historial: [{ id, fecha, proveedor, precio_base_uyu, anulado }]
 */
export default function GraficoPrecios({ historial = [], unidad = 'u' }) {
  const [foco, setFoco] = useState(null);
  const [ref, W] = useAncho();
  const puntos = historial.filter((h) => !h.anulado && Number(h.precio_base_uyu) > 0);
  if (puntos.length < 2) return null;
  const nombres = [...new Set(puntos.map((h) => h.proveedor || 'Sin proveedor'))];
  const color = (n) => COLORES_PROVEEDOR[nombres.indexOf(n) % COLORES_PROVEEDOR.length];
  const H = 190;
  const m = { l: 56, r: 12, t: 12, b: 26 };
  const t0 = Math.min(...puntos.map((h) => dia(h.fecha)));
  const t1 = Math.max(...puntos.map((h) => dia(h.fecha)));
  const vals = puntos.map((h) => Number(h.precio_base_uyu));
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.15 || hi * 0.1 || 1;
  const y0 = Math.max(0, lo - pad);
  const y1 = hi + pad;
  const x = (t) => m.l + (t1 === t0 ? (W - m.l - m.r) / 2 : ((t - t0) / (t1 - t0)) * (W - m.l - m.r));
  const y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const marcas = [y0, (y0 + y1) / 2, y1];
  const series = nombres.map((n) => ({
    n,
    pts: puntos.filter((h) => (h.proveedor || 'Sin proveedor') === n).sort((a, b) => dia(a.fecha) - dia(b.fecha) || a.id - b.id),
  }));
  const activo = foco ? puntos.find((h) => h.id === foco) : null;

  return (
    <figure ref={ref}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tinta-300">
        {nombres.map((n) => (
          <span key={n} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: color(n) }} /> {n}
          </span>
        ))}
        <span className="ml-auto min-h-[1rem] text-right text-tinta-400">
          {activo ? (
            <>
              <b className="text-tinta-100">{pesos(activo.precio_base_uyu)}</b> · {activo.proveedor} · {fechaUY(activo.fecha)}
            </>
          ) : (
            `Sin IVA, por ${unidad === 'u' ? 'unidad' : unidad}`
          )}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Evolución del precio por proveedor">
        {marcas.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="#1b3157" strokeDasharray="3 4" />
            <text x={m.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#7d8fae">
              {pesos(v)}
            </text>
          </g>
        ))}
        <text x={m.l} y={H - 6} fontSize="11" fill="#7d8fae">{fechaUY(new Date(t0).toISOString())}</text>
        {t1 !== t0 && (
          <text x={W - m.r} y={H - 6} fontSize="11" fill="#7d8fae" textAnchor="end">{fechaUY(new Date(t1).toISOString())}</text>
        )}
        {series.map((s) => (
          <g key={s.n}>
            {s.pts.length > 1 && (
              <polyline
                points={s.pts.map((h) => `${x(dia(h.fecha))},${y(Number(h.precio_base_uyu))}`).join(' ')}
                fill="none"
                stroke={color(s.n)}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {s.pts.map((h) => (
              <circle
                key={h.id}
                cx={x(dia(h.fecha))}
                cy={y(Number(h.precio_base_uyu))}
                r={foco === h.id ? 6 : 4}
                fill={color(s.n)}
                stroke="#0a1428"
                strokeWidth="2"
                tabIndex={0}
                onMouseEnter={() => setFoco(h.id)}
                onMouseLeave={() => setFoco(null)}
                onFocus={() => setFoco(h.id)}
                onBlur={() => setFoco(null)}
                onClick={() => setFoco(h.id)}
              >
                <title>{`${s.n} · ${fechaUY(h.fecha)} · ${pesos(h.precio_base_uyu)}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
    </figure>
  );
}

/** Barras horizontales para comparar el último precio de cada proveedor (el más barato resaltado) */
export function BarrasProveedores({ filas = [] }) {
  const validas = filas.filter((f) => Number(f.precio_base_uyu) > 0);
  if (validas.length < 2) return null;
  const max = Math.max(...validas.map((f) => Number(f.precio_base_uyu)));
  return (
    <ul className="space-y-1.5" aria-label="Comparación de precios entre proveedores">
      {validas.map((f, i) => (
        <li key={`${f.proveedor_id}-${f.origen}-${i}`} className="grid grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate text-tinta-300" title={f.proveedor}>{f.proveedor}</span>
          <span className="h-3 overflow-hidden rounded-full bg-navy-800">
            <span
              className={`block h-full rounded-full ${f.mejor ? 'bg-menta-400' : 'bg-[#5aa9e6]/70'}`}
              style={{ width: `${Math.max(4, (Number(f.precio_base_uyu) / max) * 100)}%` }}
            />
          </span>
          <b className={`tabular-nums ${f.mejor ? 'text-menta-300' : 'text-tinta-100'}`}>{pesos(f.precio_base_uyu)}</b>
        </li>
      ))}
    </ul>
  );
}
