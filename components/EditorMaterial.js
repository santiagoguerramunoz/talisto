'use client';

import { useEffect, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { supabase } from '@/lib/supabase';
import { numero } from '@/lib/precios';
import { UNIDADES, cant, textoError } from '@/lib/stock';

const DECIMALES = [
  [0, 'No: va en enteros'],
  [1, 'Sí, 1 decimal'],
  [2, 'Sí, 2 decimales'],
  [3, 'Sí, 3 decimales'],
];

function formDesde(m, nombreInicial) {
  const conocida = UNIDADES.some((u) => u.id === (m?.unidad || 'u'));
  return {
    nombre: m?.nombre || nombreInicial || '',
    codigo: m?.codigo || '',
    marca: m?.marca || '',
    categoria: m?.categoria || '',
    unidad: conocida ? m?.unidad || 'u' : 'otra',
    otraUnidad: conocida ? '' : m?.unidad || '',
    decimales: m?.decimales ?? 0,
    presentaciones: (m?.presentaciones || []).map((p) => ({ nombre: p.nombre, factor: String(p.factor) })),
    stock_minimo: m?.stock_minimo === null || m?.stock_minimo === undefined ? '' : String(Number(m.stock_minimo)),
    notas: m?.notas || '',
    costo: m?.costo === null || m?.costo === undefined ? '' : String(Number(m.costo)),
  };
}

/** Alta y edición de un material del stock (unidad mínima, presentaciones, mínimo y costo) */
export default function EditorMaterial({ abierto, onCerrar, onGuardado, cuenta, material = null, nombreInicial = '', veCostos = false }) {
  const [f, setF] = useState(() => formDesde(material, nombreInicial));
  const [estado, setEstado] = useState({ guardando: false, error: '' });

  useEffect(() => {
    if (abierto) {
      setF(formDesde(material, nombreInicial));
      setEstado({ guardando: false, error: '' });
    }
  }, [abierto, material, nombreInicial]);

  const cambiar = (campo, valor) => setF((x) => ({ ...x, [campo]: valor }));
  const unidad = f.unidad === 'otra' ? f.otraUnidad.trim() || 'u' : f.unidad;

  function elegirUnidad(id) {
    const u = UNIDADES.find((x) => x.id === id);
    setF((x) => ({ ...x, unidad: id, decimales: material ? x.decimales : u ? u.decimales : x.decimales }));
  }
  const cambiarPres = (k, campo, valor) =>
    setF((x) => ({ ...x, presentaciones: x.presentaciones.map((p, j) => (j === k ? { ...p, [campo]: valor } : p)) }));

  async function guardar() {
    setEstado({ guardando: true, error: '' });
    if (!f.nombre.trim()) return setEstado({ guardando: false, error: 'Poné el nombre del material.' });
    const presentaciones = [];
    for (const p of f.presentaciones) {
      if (!p.nombre.trim() && !String(p.factor).trim()) continue;
      const fac = numero(p.factor);
      if (!p.nombre.trim() || fac === null || fac <= 0) {
        return setEstado({ guardando: false, error: 'Cada presentación lleva nombre (ej. Caja x 100) y cuántos trae.' });
      }
      presentaciones.push({ nombre: p.nombre.trim(), factor: fac });
    }
    const fila = {
      profesional_id: cuenta,
      nombre: f.nombre.trim(),
      codigo: f.codigo.trim() || null,
      marca: f.marca.trim() || null,
      categoria: f.categoria.trim() || null,
      unidad,
      decimales: Number(f.decimales) || 0,
      presentaciones,
      stock_minimo: numero(f.stock_minimo),
      notas: f.notas.trim() || null,
    };
    const consulta = material
      ? supabase.from('materiales').update(fila).eq('id', material.id).select('*').single()
      : supabase.from('materiales').insert(fila).select('*').single();
    const { data, error } = await consulta;
    if (error) return setEstado({ guardando: false, error: textoError(error) });
    let costo = material?.costo ?? null;
    const nuevoCosto = numero(f.costo);
    if (veCostos && nuevoCosto !== null && nuevoCosto !== Number(material?.costo ?? NaN)) {
      const { error: e2 } = await supabase
        .from('materiales_costos')
        .upsert({ material_id: data.id, profesional_id: cuenta, costo: nuevoCosto, moneda: 'UYU' }, { onConflict: 'material_id' });
      if (!e2) costo = nuevoCosto;
    }
    setEstado({ guardando: false, error: '' });
    onGuardado?.({ ...data, costo });
    onCerrar();
  }

  async function archivar(activo) {
    setEstado({ guardando: true, error: '' });
    const { data, error } = await supabase.from('materiales').update({ activo }).eq('id', material.id).select('*').single();
    if (error) return setEstado({ guardando: false, error: textoError(error) });
    setEstado({ guardando: false, error: '' });
    onGuardado?.({ ...data, costo: material.costo });
    onCerrar();
  }

  async function borrar() {
    if (!window.confirm(`¿Borrar ${material.nombre}? Solo se puede si nunca tuvo movimientos.`)) return;
    setEstado({ guardando: true, error: '' });
    const { error } = await supabase.from('materiales').delete().eq('id', material.id);
    if (error) return setEstado({ guardando: false, error: textoError(error) });
    onGuardado?.(null);
    onCerrar();
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={() => !estado.guardando && onCerrar()}
      titulo={material ? 'Material' : 'Nuevo material'}
      pie={
        <button type="button" className="btn btn-menta w-full" onClick={guardar} disabled={estado.guardando}>
          {estado.guardando ? 'Guardando…' : material ? 'Guardar cambios' : 'Crear material'}
        </button>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="etiqueta" htmlFor="mt-nom">Nombre</label>
          <input id="mt-nom" className="campo" value={f.nombre} onChange={(e) => cambiar('nombre', e.target.value)} maxLength={200} placeholder="Ej. Cable unipolar 2 mm²" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="etiqueta" htmlFor="mt-cod">Código</label>
            <input id="mt-cod" className="campo" value={f.codigo} onChange={(e) => cambiar('codigo', e.target.value)} maxLength={60} placeholder="Opcional" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="mt-mar">Marca</label>
            <input id="mt-mar" className="campo" value={f.marca} onChange={(e) => cambiar('marca', e.target.value)} maxLength={80} placeholder="Opcional" />
          </div>
        </div>
        <div>
          <label className="etiqueta" htmlFor="mt-cat">Categoría</label>
          <input id="mt-cat" className="campo" value={f.categoria} onChange={(e) => cambiar('categoria', e.target.value)} maxLength={80} placeholder="Ej. Cables, Protecciones, Tornillería" />
        </div>

        <section className="space-y-3 rounded-2xl border border-navy-700 p-3">
          <div>
            <label className="etiqueta" htmlFor="mt-uni">Unidad mínima</label>
            <select id="mt-uni" className="campo" value={f.unidad} onChange={(e) => elegirUnidad(e.target.value)}>
              {UNIDADES.map((u) => (
                <option key={u.id} value={u.id}>{u.texto}</option>
              ))}
              <option value="otra">Otra…</option>
            </select>
            {f.unidad === 'otra' && (
              <input className="campo mt-2" value={f.otraUnidad} onChange={(e) => cambiar('otraUnidad', e.target.value)} maxLength={12} placeholder="Ej. placa, tira, bolsa" aria-label="Otra unidad" />
            )}
            <p className="mt-1 text-xs text-tinta-400">El stock se lleva siempre en esta unidad: lo más chico que se usa en un trabajo.</p>
          </div>
          <div>
            <label className="etiqueta" htmlFor="mt-dec">¿Se usa una parte? (decimales)</label>
            <select id="mt-dec" className="campo" value={f.decimales} onChange={(e) => cambiar('decimales', Number(e.target.value))}>
              {DECIMALES.map(([v, t]) => (
                <option key={v} value={v}>{t}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-tinta-400">
              {Number(f.decimales) === 0 ? `Se mueve de a 1 ${unidad}.` : `Se puede usar ${cant(1 / 10 ** Number(f.decimales) * 5, 3)} ${unidad}, por ejemplo.`}
            </p>
          </div>

          <div>
            <p className="etiqueta">Cómo viene (presentaciones)</p>
            <p className="-mt-1 mb-2 text-xs text-tinta-400">Caja, rollo, bolsa, paquete… y cuántos {unidad} trae. Así cargás por caja y se desglosa solo.</p>
            <div className="space-y-2">
              {f.presentaciones.map((p, k) => (
                <div key={k} className="grid grid-cols-[1fr_5.5rem_auto] items-center gap-2">
                  <input className="campo px-2 py-1.5 text-sm" value={p.nombre} onChange={(e) => cambiarPres(k, 'nombre', e.target.value)} maxLength={30} placeholder="Ej. Rollo 100 m" aria-label="Nombre de la presentación" />
                  <span className="flex items-center gap-1">
                    <input className="campo px-2 py-1.5 text-sm" type="number" inputMode="decimal" min="0" step="any" value={p.factor} onChange={(e) => cambiarPres(k, 'factor', e.target.value)} aria-label={`Cuántos ${unidad} trae`} />
                    <span className="text-xs text-tinta-400">{unidad}</span>
                  </span>
                  <button type="button" className="rounded-lg p-1.5 text-tinta-400 hover:text-red-300" onClick={() => setF((x) => ({ ...x, presentaciones: x.presentaciones.filter((_, j) => j !== k) }))} aria-label="Quitar presentación">
                    <Icon name="cerrar" className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {f.presentaciones.length < 8 && (
                <button type="button" className="chip" onClick={() => setF((x) => ({ ...x, presentaciones: [...x.presentaciones, { nombre: '', factor: '' }] }))}>
                  <Icon name="mas" className="h-3.5 w-3.5" /> Agregar presentación
                </button>
              )}
            </div>
          </div>
        </section>

        <div className={`grid gap-2 ${veCostos ? 'grid-cols-2' : ''}`}>
          <div>
            <label className="etiqueta" htmlFor="mt-min">Stock mínimo ({unidad})</label>
            <input id="mt-min" className="campo" type="number" inputMode="decimal" min="0" step="any" value={f.stock_minimo} onChange={(e) => cambiar('stock_minimo', e.target.value)} placeholder="Opcional" />
          </div>
          {veCostos && (
            <div>
              <label className="etiqueta" htmlFor="mt-cos">Costo por {unidad} ($)</label>
              <input id="mt-cos" className="campo" type="number" inputMode="decimal" min="0" step="any" value={f.costo} onChange={(e) => cambiar('costo', e.target.value)} placeholder="Último costo" />
            </div>
          )}
        </div>
        <p className="-mt-2 text-xs text-tinta-400">Con el mínimo, te avisa cuando el stock de la empresa baja de esa cantidad.</p>

        <div>
          <label className="etiqueta" htmlFor="mt-not">Notas</label>
          <textarea id="mt-not" rows={2} className="campo" value={f.notas} onChange={(e) => cambiar('notas', e.target.value)} maxLength={500} />
        </div>

        {material && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-sec" onClick={() => archivar(!material.activo)} disabled={estado.guardando}>
              {material.activo ? 'Archivar' : 'Volver a activar'}
            </button>
            <button type="button" className="btn btn-peligro" onClick={borrar} disabled={estado.guardando}>
              <Icon name="borrar" /> Borrar
            </button>
          </div>
        )}
        {estado.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>}
      </div>
    </Modal>
  );
}
