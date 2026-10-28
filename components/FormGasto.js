'use client';

import { useEffect, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { supabase } from '@/lib/supabase';
import { fechaISO } from '@/lib/fechas';
import { TIPOS_MOVILIDAD, calcularMovilidad } from '@/lib/gastos';
import { numero, pesos } from '@/lib/precios';
import { AVISO_SQL_04, faltaSql04 } from '@/lib/sql';
import { mensajeError } from '@/lib/util';

const valor = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Alta / edición de un gasto.
 * ajustes: valores por defecto (precio del boleto, combustible, consumo) y categorías propias
 * onGuardarAjustes(cambios): para recordar esos valores o agregar una categoría
 */
export default function FormGasto({ abierto, onCerrar, onGuardado, profesionalId, gasto, inicial, ajustes, categorias, onGuardarAjustes }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [nuevaCategoria, setNuevaCategoria] = useState(null);

  useEffect(() => {
    if (!abierto) {
      setForm(null);
      return;
    }
    setError('');
    setNuevaCategoria(null);
    if (gasto) {
      setForm({
        fecha: gasto.fecha,
        categoria: gasto.categoria,
        tipo: gasto.tipo || 'otro',
        descripcion: gasto.descripcion || '',
        cantidad: valor(gasto.cantidad),
        precio_unitario: valor(gasto.precio_unitario),
        km: valor(gasto.km),
        consumo_km_litro: valor(gasto.consumo_km_litro),
        monto: valor(gasto.monto),
        recordar: false,
      });
    } else {
      const categoria = inicial?.categoria || 'Movilidad';
      setForm({
        fecha: inicial?.fecha || fechaISO(new Date()),
        categoria,
        tipo: ajustes?.consumo_km_litro ? 'vehiculo' : 'bus',
        descripcion: '',
        cantidad: '2',
        precio_unitario: '',
        km: '',
        consumo_km_litro: valor(ajustes?.consumo_km_litro),
        monto: '',
        recordar: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, gasto, inicial]);

  // Precio por defecto según el tipo de movilidad
  useEffect(() => {
    if (!form || gasto) return;
    if (form.categoria !== 'Movilidad') return;
    const defecto = form.tipo === 'bus' ? ajustes?.precio_boleto : form.tipo === 'vehiculo' ? ajustes?.precio_combustible : null;
    setForm((f) => ({ ...f, precio_unitario: valor(defecto) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.tipo, form?.categoria]);

  if (!form) return null;

  const cambiar = (campo, v) => setForm((f) => ({ ...f, [campo]: v }));
  const esMovilidad = form.categoria === 'Movilidad';
  const calculado = esMovilidad && form.tipo !== 'otro';
  const calc = calculado ? calcularMovilidad(form) : { litros: null, monto: null };
  const info = categorias.find((c) => c.nombre === form.categoria);

  async function agregarCategoria() {
    const nombre = (nuevaCategoria || '').trim().slice(0, 40);
    if (!nombre) return;
    if (!categorias.some((c) => c.nombre.toLowerCase() === nombre.toLowerCase())) {
      const { error: err } = await onGuardarAjustes({ categorias_gastos: [...(ajustes?.categorias_gastos || []), nombre] });
      if (err) return setError(faltaSql04(err) ? AVISO_SQL_04 : mensajeError(err));
    }
    setNuevaCategoria(null);
    cambiar('categoria', nombre);
  }

  async function guardar() {
    setError('');
    const montoFinal = calculado ? calc.monto : numero(form.monto);
    if (montoFinal === null || montoFinal < 0) {
      setError(
        calculado
          ? form.tipo === 'bus'
            ? 'Poné la cantidad de boletos y el precio del boleto.'
            : 'Poné los km, el consumo del vehículo y el precio del combustible.'
          : 'Poné el monto.'
      );
      return;
    }
    setGuardando(true);
    const fila = {
      profesional_id: profesionalId,
      fecha: form.fecha,
      categoria: form.categoria,
      tipo: esMovilidad && form.tipo !== 'otro' ? form.tipo : null,
      descripcion: form.descripcion.trim() || null,
      cantidad: calculado && form.tipo === 'bus' ? numero(form.cantidad) : null,
      precio_unitario: calculado ? numero(form.precio_unitario) : null,
      km: calculado && form.tipo === 'vehiculo' ? numero(form.km) : null,
      consumo_km_litro: calculado && form.tipo === 'vehiculo' ? numero(form.consumo_km_litro) : null,
      litros: calculado && form.tipo === 'vehiculo' ? calc.litros : null,
      monto: montoFinal,
    };
    const consulta = gasto?.id ? supabase.from('gastos').update(fila).eq('id', gasto.id) : supabase.from('gastos').insert(fila);
    const { error: err } = await consulta;
    if (err) {
      setGuardando(false);
      setError(faltaSql04(err) ? AVISO_SQL_04 : mensajeError(err));
      return;
    }
    // Recordar precio del boleto / combustible / consumo para la próxima
    if (calculado && form.recordar) {
      const cambios =
        form.tipo === 'bus'
          ? { precio_boleto: numero(form.precio_unitario) }
          : { precio_combustible: numero(form.precio_unitario), consumo_km_litro: numero(form.consumo_km_litro) };
      await onGuardarAjustes(cambios);
    }
    setGuardando(false);
    onGuardado?.();
    onCerrar();
  }

  async function eliminar() {
    if (!gasto?.id || !window.confirm('¿Eliminar este gasto?')) return;
    const { error: err } = await supabase.from('gastos').delete().eq('id', gasto.id);
    if (err) return setError(mensajeError(err));
    onGuardado?.();
    onCerrar();
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={gasto?.id ? 'Editar gasto' : 'Nuevo gasto'}
      pie={
        <div className="flex gap-2">
          {gasto?.id && (
            <button type="button" className="btn btn-peligro px-3" onClick={eliminar} aria-label="Eliminar gasto">
              <Icon name="borrar" />
            </button>
          )}
          <button type="button" className="btn btn-menta flex-1" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : `Guardar${calculado && calc.monto !== null ? ` ${pesos(calc.monto)}` : ''}`}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="etiqueta">Categoría</span>
          <div className="flex flex-wrap gap-1.5">
            {categorias.map((c) => (
              <button key={c.nombre} type="button" onClick={() => cambiar('categoria', c.nombre)} className={`chip ${form.categoria === c.nombre ? 'chip-activo' : ''}`}>
                <Icon name={c.icono} className="h-3.5 w-3.5" /> {c.nombre}
              </button>
            ))}
            {nuevaCategoria === null ? (
              <button type="button" onClick={() => setNuevaCategoria('')} className="chip border-dashed">
                <Icon name="mas" className="h-3.5 w-3.5" /> Nueva
              </button>
            ) : (
              <span className="flex w-full gap-2">
                <input className="campo py-2 text-sm" value={nuevaCategoria} onChange={(e) => setNuevaCategoria(e.target.value)} placeholder="Ej. Celular, Seguro, Ropa de trabajo" autoFocus />
                <button type="button" className="btn btn-sec shrink-0 py-2" onClick={agregarCategoria}>Agregar</button>
              </span>
            )}
          </div>
        </div>

        {esMovilidad && (
          <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-navy-850 p-1.5">
            {Object.entries(TIPOS_MOVILIDAD).map(([v, texto]) => (
              <button
                key={v}
                type="button"
                onClick={() => cambiar('tipo', v)}
                className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold ${form.tipo === v ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}
              >
                {v !== 'otro' && <Icon name={v === 'bus' ? 'bus' : 'auto'} className="h-4 w-4" />} {texto}
              </button>
            ))}
          </div>
        )}

        {calculado && form.tipo === 'bus' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="etiqueta" htmlFor="g-cant">Boletos</label>
              <input id="g-cant" type="number" inputMode="numeric" min="0" className="campo" value={form.cantidad} onChange={(e) => cambiar('cantidad', e.target.value)} />
            </div>
            <div>
              <label className="etiqueta" htmlFor="g-boleto">Precio del boleto</label>
              <input id="g-boleto" type="number" inputMode="decimal" min="0" className="campo" value={form.precio_unitario} onChange={(e) => cambiar('precio_unitario', e.target.value)} placeholder="UYU" />
            </div>
          </div>
        )}

        {calculado && form.tipo === 'vehiculo' && (
          <div className="space-y-2">
            <div>
              <label className="etiqueta" htmlFor="g-km">Km recorridos</label>
              <input id="g-km" type="number" inputMode="decimal" min="0" className="campo" value={form.km} onChange={(e) => cambiar('km', e.target.value)} placeholder="Ej. 45" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="etiqueta" htmlFor="g-consumo">Consumo (km por litro)</label>
                <input id="g-consumo" type="number" inputMode="decimal" min="0" className="campo" value={form.consumo_km_litro} onChange={(e) => cambiar('consumo_km_litro', e.target.value)} placeholder="Ej. 12" />
              </div>
              <div>
                <label className="etiqueta" htmlFor="g-litro">Combustible ($ por litro)</label>
                <input id="g-litro" type="number" inputMode="decimal" min="0" className="campo" value={form.precio_unitario} onChange={(e) => cambiar('precio_unitario', e.target.value)} placeholder="UYU" />
              </div>
            </div>
            {calc.litros !== null && (
              <p className="text-sm text-tinta-300">
                Gastaste unos <b className="text-tinta-100">{calc.litros.toLocaleString('es-UY')} litros</b>
                {calc.monto !== null && <> · <b className="text-menta-300">{pesos(calc.monto)}</b></>}
              </p>
            )}
          </div>
        )}

        {calculado && (
          <label className="flex items-center gap-2.5 text-sm text-tinta-300">
            <input type="checkbox" className="h-5 w-5 accent-[#2cc79b]" checked={form.recordar} onChange={(e) => cambiar('recordar', e.target.checked)} />
            Recordar {form.tipo === 'bus' ? 'el precio del boleto' : 'el consumo y el precio del combustible'} para la próxima
          </label>
        )}

        {!calculado && (
          <div>
            <label className="etiqueta" htmlFor="g-monto">Monto (UYU)</label>
            <input id="g-monto" type="number" inputMode="decimal" min="0" className="campo text-lg font-bold" value={form.monto} onChange={(e) => cambiar('monto', e.target.value)} placeholder="0" />
          </div>
        )}

        <div>
          <label className="etiqueta" htmlFor="g-desc">Detalle</label>
          <input id="g-desc" className="campo" value={form.descripcion} onChange={(e) => cambiar('descripcion', e.target.value)} placeholder={info?.ejemplo || 'Opcional'} />
        </div>

        <div>
          <label className="etiqueta" htmlFor="g-fecha">Fecha</label>
          <input id="g-fecha" type="date" className="campo" value={form.fecha} onChange={(e) => e.target.value && cambiar('fecha', e.target.value)} />
        </div>

        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}
