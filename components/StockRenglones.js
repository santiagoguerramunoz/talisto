'use client';

import { useMemo, useState } from 'react';
import Icon from './Icon';
import { aBase, cant, conUnidad, desglose, errorCantidad } from '@/lib/stock';

const norm = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

let contador = 0;
export function nuevoRenglon(material, valor = '', pres = '') {
  contador += 1;
  return { key: `${material.id}-${contador}`, material, pres, valor: valor === null || valor === undefined ? '' : String(valor), costo: '' };
}

/**
 * Renglones de un movimiento de stock.
 * modo: 'salida' (muestra lo que hay y no deja pasarse) · 'entrada' (cualquier material, con costo) · 'conteo'
 * disponible / sistema: { material_id: cantidad en unidades mínimas }
 */
export default function StockRenglones({
  catalogo = [],
  disponible = null,
  sistema = null,
  renglones,
  onChange,
  modo = 'salida',
  conCosto = false,
  onCrearMaterial = null,
  vacio = '',
}) {
  const [buscando, setBuscando] = useState(renglones.length === 0 && modo !== 'conteo');
  const [q, setQ] = useState('');

  // lo que ya se cargó de cada material (en unidades mínimas)
  const usado = useMemo(() => {
    const u = {};
    renglones.forEach((r) => {
      const b = aBase(r.valor, r.pres, r.material);
      if (b !== null) u[r.material.id] = (u[r.material.id] || 0) + b;
    });
    return u;
  }, [renglones]);

  const opciones = useMemo(() => {
    const t = norm(q).trim();
    return catalogo
      .filter((m) => m.activo !== false)
      .filter((m) => modo !== 'salida' || (disponible?.[m.id] || 0) > 0)
      .filter((m) => !t || t.split(/\s+/).every((p) => norm(`${m.nombre} ${m.codigo || ''} ${m.marca || ''} ${m.categoria || ''}`).includes(p)))
      .slice(0, 50);
  }, [catalogo, q, modo, disponible]);

  function agregar(m) {
    onChange([...renglones, nuevoRenglon(m)]);
    setQ('');
    setBuscando(false);
  }
  const cambiar = (key, campo, valor) => onChange(renglones.map((r) => (r.key === key ? { ...r, [campo]: valor } : r)));
  const quitar = (key) => {
    const resto = renglones.filter((r) => r.key !== key);
    onChange(resto);
    if (!resto.length) setBuscando(true);
  };

  return (
    <div className="space-y-2">
      {renglones.map((r) => (
        <Renglon
          key={r.key}
          r={r}
          modo={modo}
          disp={disponible ? disponible[r.material.id] || 0 : null}
          sis={sistema ? sistema[r.material.id] || 0 : null}
          usadoTotal={usado[r.material.id] || 0}
          conCosto={conCosto}
          onCambiar={(campo, valor) => cambiar(r.key, campo, valor)}
          onQuitar={() => quitar(r.key)}
        />
      ))}

      {buscando ? (
        <div className="rounded-xl border border-navy-700 bg-navy-850 p-2">
          <div className="flex items-center gap-2">
            <Icon name="buscar" className="ml-1 h-4 w-4 shrink-0 text-tinta-400" />
            <input
              className="campo py-2 text-sm"
              placeholder="Buscar material por nombre o código"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Buscar material"
            />
            {renglones.length > 0 && (
              <button type="button" className="shrink-0 rounded-lg p-2 text-tinta-400 hover:text-tinta-100" onClick={() => setBuscando(false)} aria-label="Cerrar búsqueda">
                <Icon name="cerrar" className="h-4 w-4" />
              </button>
            )}
          </div>
          <ul className="mt-1.5 max-h-64 overflow-y-auto">
            {opciones.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => agregar(m)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left hover:bg-navy-800">
                  <span className="min-w-0">
                    <b className="block truncate text-sm">{m.nombre}</b>
                    <span className="block truncate text-[11px] text-tinta-400">{[m.codigo, m.marca].filter(Boolean).join(' · ') || `Va en ${m.unidad}`}</span>
                  </span>
                  {disponible && <span className="shrink-0 text-xs font-semibold text-tinta-300">{conUnidad(disponible[m.id] || 0, m)}</span>}
                </button>
              </li>
            ))}
            {!opciones.length && (
              <li className="px-2 py-3 text-sm text-tinta-400">
                {vacio || (modo === 'salida' ? 'No hay materiales con stock en ese lugar.' : q ? 'No hay materiales con ese nombre.' : 'Todavía no hay materiales cargados.')}
              </li>
            )}
          </ul>
          {onCrearMaterial && (
            <button type="button" className="chip chip-activo mt-1.5" onClick={() => onCrearMaterial(q.trim())}>
              <Icon name="mas" className="h-3.5 w-3.5" /> Crear material{q.trim() ? ` "${q.trim()}"` : ''}
            </button>
          )}
        </div>
      ) : (
        <button type="button" className="btn btn-sec w-full py-2 text-sm" onClick={() => setBuscando(true)}>
          <Icon name="mas" className="h-4 w-4" /> Agregar material
        </button>
      )}
    </div>
  );
}

function Renglon({ r, modo, disp, sis, usadoTotal, conCosto, onCambiar, onQuitar }) {
  const m = r.material;
  const base = aBase(r.valor, r.pres, m);
  const conteo = modo === 'conteo';
  const err = r.valor === '' ? '' : errorCantidad(base, m, { conteo });
  const excede = modo === 'salida' && disp !== null && usadoTotal > disp + 1e-9;
  const presentaciones = m.presentaciones || [];
  const dif = conteo && base !== null && !err ? base - (sis || 0) : null;
  const desg = disp !== null ? desglose(disp, m) : null;
  return (
    <div className={`rounded-xl border bg-navy-850 p-2.5 ${excede ? 'border-red-500/50' : 'border-navy-700'}`}>
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <b className="block text-sm leading-snug">{m.nombre}</b>
          {(m.codigo || m.marca) && <span className="text-[11px] text-tinta-400">{[m.codigo, m.marca].filter(Boolean).join(' · ')}</span>}
        </span>
        <button type="button" onClick={onQuitar} className="shrink-0 rounded-lg p-1.5 text-tinta-400 hover:text-red-300" aria-label={`Quitar ${m.nombre}`}>
          <Icon name="cerrar" className="h-4 w-4" />
        </button>
      </div>
      <div className={`mt-2 grid items-end gap-2 ${presentaciones.length ? 'grid-cols-[minmax(0,6rem)_1fr]' : 'grid-cols-[minmax(0,8rem)_auto]'}`}>
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-tinta-400">{conteo ? 'Contaste' : 'Cantidad'}</span>
          <input
            className="campo px-2 py-1.5 text-sm"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={r.valor}
            onChange={(e) => onCambiar('valor', e.target.value)}
            aria-label={`Cantidad de ${m.nombre}`}
          />
        </label>
        {presentaciones.length ? (
          <label className="block min-w-0">
            <span className="mb-0.5 block text-[11px] text-tinta-400">En</span>
            <select className="campo px-2 py-1.5 text-sm" value={r.pres} onChange={(e) => onCambiar('pres', e.target.value)} aria-label={`Presentación de ${m.nombre}`}>
              <option value="">{m.unidad} (suelto)</option>
              {presentaciones.map((p) => (
                <option key={p.nombre} value={p.nombre}>
                  {p.nombre} · {cant(p.factor, m.decimales)} {m.unidad}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="pb-2 text-sm text-tinta-300">{m.unidad}</span>
        )}
      </div>
      {conCosto && (
        <label className="mt-2 block">
          <span className="mb-0.5 block text-[11px] text-tinta-400">Costo por {r.pres || m.unidad} ($, opcional)</span>
          <input className="campo px-2 py-1.5 text-sm" type="number" inputMode="decimal" min="0" step="any" value={r.costo} onChange={(e) => onCambiar('costo', e.target.value)} />
        </label>
      )}
      <p className="mt-1.5 space-x-1 text-[11px] leading-relaxed">
        {r.pres && base !== null && !err && <span className="text-tinta-200">= {conUnidad(base, m)}</span>}
        {modo === 'salida' && disp !== null && (
          <span className={excede ? 'font-semibold text-red-300' : 'text-tinta-400'}>
            {excede ? 'No alcanza: hay ' : 'Hay '}
            {conUnidad(disp, m)}
            {desg ? ` (${desg})` : ''}
          </span>
        )}
        {conteo && (
          <span className="text-tinta-400">
            Según el sistema: {conUnidad(sis || 0, m)}
            {dif !== null && (
              <b className={dif === 0 ? 'ml-1 text-menta-300' : 'ml-1 text-amber-300'}>
                {dif === 0 ? '· coincide' : `· diferencia ${dif > 0 ? '+' : '−'}${conUnidad(Math.abs(dif), m)}`}
              </b>
            )}
          </span>
        )}
        {err && <span className="block font-semibold text-amber-300">{err}</span>}
      </p>
    </div>
  );
}
