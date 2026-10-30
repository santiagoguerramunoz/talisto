'use client';

import { useEffect, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { supabase } from '@/lib/supabase';
import { avisar } from '@/lib/avisos';
import { mensajeError } from '@/lib/util';

const UNIDADES = ['u', 'm', 'm²', 'm³', 'kg', 'l', 'rollo', 'caja', 'h'];
let sec = 0;
const renglon = (tipo = 'material') => ({ k: ++sec, tipo, descripcion: '', cantidad: '1', unidad: tipo === 'tarea' ? 'tarea' : 'u' });

export const ESTADO_COTIZACION = {
  pendiente: { texto: 'Esperando presupuesto', clase: 'bg-amber-400/15 text-amber-300' },
  presupuestada: { texto: 'Presupuestada', clase: 'bg-menta-500/15 text-menta-300' },
  descartada: { texto: 'Descartada', clase: 'bg-navy-700 text-tinta-400' },
};

/**
 * Desde el lugar: lo que hay que cotizar (materiales y tareas) para que Administración o Ventas armen el presupuesto.
 */
export default function PedirCotizacion({ abierto, cuenta, item, onCerrar, onListo }) {
  const [renglones, setRenglones] = useState(() => [renglon()]);
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setRenglones([renglon()]);
    setNota('');
    setError('');
  }, [abierto]);

  const cambiar = (k, cambios) => setRenglones((rs) => rs.map((r) => (r.k === k ? { ...r, ...cambios } : r)));
  const quitar = (k) => setRenglones((rs) => (rs.length > 1 ? rs.filter((r) => r.k !== k) : [renglon()]));

  async function enviar() {
    setError('');
    const items = renglones
      .filter((r) => r.descripcion.trim())
      .map((r) => ({ tipo: r.tipo, descripcion: r.descripcion.trim(), cantidad: Number(String(r.cantidad).replace(',', '.')) || 1, unidad: r.unidad }));
    if (!items.length) return setError('Escribí al menos un material o una tarea.');
    if (items.some((i) => i.cantidad <= 0)) return setError('Revisá las cantidades.');
    setGuardando(true);
    const { data, error: err } = await supabase.rpc('pedir_cotizacion', {
      p_cuenta: cuenta,
      p_tipo: item.rpc,
      p_trabajo: item.id,
      p_items: items,
      p_nota: nota.trim() || null,
    });
    setGuardando(false);
    if (err) return setError(mensajeError(err));
    avisar();
    onListo?.(data);
  }

  if (!abierto || !item) return null;
  return (
    <Modal
      abierto
      onCerrar={() => !guardando && onCerrar()}
      titulo="Pedir cotización"
      pie={
        <button type="button" className="btn btn-menta w-full py-3 font-extrabold" onClick={enviar} disabled={guardando}>
          <Icon name="calculadora" className="h-5 w-5" /> {guardando ? 'Enviando…' : 'Enviar a Ventas / Administración'}
        </button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-tinta-300">
          <b className="text-tinta-100">{item.titulo}</b>
          <span className="block text-xs">Anotá lo que hace falta. Ventas arma el presupuesto y te avisamos cuando esté.</span>
        </p>

        <ul className="space-y-2">
          {renglones.map((r, i) => (
            <li key={r.k} className="rounded-xl border border-navy-700 bg-navy-850 p-2.5">
              <div className="mb-2 flex items-center gap-2">
                <div className="grid grid-cols-2 rounded-lg bg-navy-900 p-0.5 text-xs font-bold">
                  {[
                    ['material', 'Material'],
                    ['tarea', 'Tarea'],
                  ].map(([v, t]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => cambiar(r.k, { tipo: v, unidad: v === 'tarea' ? 'tarea' : r.unidad === 'tarea' ? 'u' : r.unidad })}
                      className={`rounded-md px-2.5 py-1 ${r.tipo === v ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-tinta-500">Renglón {i + 1}</span>
                <button type="button" onClick={() => quitar(r.k)} className="ml-auto rounded-lg p-1.5 text-tinta-400 hover:bg-navy-800" aria-label="Quitar renglón">
                  <Icon name="borrar" className="h-4 w-4" />
                </button>
              </div>
              <input
                className="campo"
                value={r.descripcion}
                onChange={(e) => cambiar(r.k, { descripcion: e.target.value })}
                maxLength={200}
                placeholder={r.tipo === 'tarea' ? 'Ej. Cambiar tablero eléctrico' : 'Ej. Cable 2,5 mm'}
                aria-label="Qué es"
              />
              <div className="mt-2 grid grid-cols-[1fr_7rem] gap-2">
                <input
                  className="campo"
                  inputMode="decimal"
                  value={r.cantidad}
                  onChange={(e) => cambiar(r.k, { cantidad: e.target.value.replace(/[^\d.,]/g, '') })}
                  aria-label="Cantidad"
                  placeholder="Cantidad"
                />
                {r.tipo === 'tarea' ? (
                  <span className="campo grid place-items-center text-sm text-tinta-400">tarea</span>
                ) : (
                  <select className="campo" value={r.unidad} onChange={(e) => cambiar(r.k, { unidad: e.target.value })} aria-label="Unidad">
                    {UNIDADES.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-sec py-2 text-sm" onClick={() => setRenglones((rs) => [...rs, renglon('material')])}>
            <Icon name="mas" className="h-4 w-4" /> Material
          </button>
          <button type="button" className="btn btn-sec py-2 text-sm" onClick={() => setRenglones((rs) => [...rs, renglon('tarea')])}>
            <Icon name="mas" className="h-4 w-4" /> Tarea
          </button>
        </div>
        <div>
          <label className="etiqueta" htmlFor="pc-nota">Nota para Ventas (opcional)</label>
          <textarea id="pc-nota" rows={2} className="campo" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={1000} placeholder="Medidas, marca, urgencia, fotos que mandaste por WhatsApp…" />
        </div>
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}
