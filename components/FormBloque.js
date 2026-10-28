'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { supabase } from '@/lib/supabase';
import { DIAS, DIA_LETRA, SEMANA_ORDEN, desdeISO, fechaISO, fechaLarga, minutos } from '@/lib/fechas';
import { mensajeError } from '@/lib/util';

/**
 * Horario fijo que se repite: "Grupo Gamma, lun-mar-mié de 9 a 17".
 * fechaContexto: si se abrió desde un día de la agenda, permite suspenderlo solo ese día.
 */
export default function FormBloque({ abierto, onCerrar, onGuardado, profesionalId, clientes = [], bloque, inicial, fechaContexto }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) {
      setForm(null);
      return;
    }
    setError('');
    if (bloque) {
      setForm({
        cliente_id: bloque.cliente_id || '',
        titulo: bloque.titulo || '',
        direccion_id: bloque.direccion_id || '',
        dias: (bloque.dias || []).map(Number),
        desde: String(bloque.hora_inicio).slice(0, 5),
        hasta: String(bloque.hora_fin).slice(0, 5),
        fecha_desde: bloque.fecha_desde,
        fecha_hasta: bloque.fecha_hasta || '',
        monto: bloque.monto ?? '',
        notas: bloque.notas || '',
      });
    } else {
      const c = clientes.find((x) => x.id === inicial?.cliente_id);
      const dow = inicial?.fecha ? desdeISO(inicial.fecha).getDay() : 1;
      setForm({
        cliente_id: inicial?.cliente_id || '',
        titulo: '',
        direccion_id: c?.direcciones?.[0]?.id || '',
        dias: [dow],
        desde: '09:00',
        hasta: '17:00',
        fecha_desde: inicial?.fecha || fechaISO(new Date()),
        fecha_hasta: '',
        monto: '',
        notas: '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, bloque, inicial]);

  const cliente = useMemo(() => clientes.find((c) => c.id === form?.cliente_id), [clientes, form?.cliente_id]);
  const direcciones = cliente?.direcciones || [];

  if (!form) return null;

  const cambiar = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));

  function alternarDia(d) {
    setForm((f) => ({ ...f, dias: f.dias.includes(d) ? f.dias.filter((x) => x !== d) : [...f.dias, d] }));
  }

  function cambiarCliente(id) {
    const c = clientes.find((x) => x.id === id);
    setForm((f) => ({ ...f, cliente_id: id, direccion_id: c?.direcciones?.[0]?.id || '' }));
  }

  async function guardar() {
    setError('');
    if (!form.cliente_id && !form.titulo.trim()) return setError('Elegí un cliente o escribí un título.');
    if (form.dias.length === 0) return setError('Marcá al menos un día.');
    if (minutos(form.hasta) <= minutos(form.desde)) return setError('La hora de fin tiene que ser después de la de inicio.');
    if (form.fecha_hasta && form.fecha_hasta < form.fecha_desde) return setError('La fecha de fin no puede ser anterior al inicio.');

    setGuardando(true);
    const fila = {
      profesional_id: profesionalId,
      cliente_id: form.cliente_id || null,
      direccion_id: form.cliente_id && form.direccion_id ? form.direccion_id : null,
      titulo: form.titulo.trim() || null,
      dias: form.dias,
      hora_inicio: form.desde,
      hora_fin: form.hasta,
      fecha_desde: form.fecha_desde,
      fecha_hasta: form.fecha_hasta || null,
      monto: form.monto === '' ? null : Number(form.monto),
      notas: form.notas.trim() || null,
    };
    const consulta = bloque?.id
      ? supabase.from('bloques_fijos').update(fila).eq('id', bloque.id)
      : supabase.from('bloques_fijos').insert(fila);
    const { error: err } = await consulta;
    setGuardando(false);
    if (err) return setError(mensajeError(err));
    onGuardado?.();
    onCerrar();
  }

  async function suspenderEseDia() {
    if (!bloque?.id || !fechaContexto) return;
    const { error: err } = await supabase.from('bloques_excepciones').insert({ bloque_id: bloque.id, fecha: fechaContexto });
    if (err) return setError(mensajeError(err));
    onGuardado?.();
    onCerrar();
  }

  async function eliminar() {
    if (!bloque?.id || !window.confirm('¿Eliminar este horario fijo de todas las semanas?')) return;
    const { error: err } = await supabase.from('bloques_fijos').delete().eq('id', bloque.id);
    if (err) return setError(mensajeError(err));
    onGuardado?.();
    onCerrar();
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={bloque?.id ? 'Horario fijo' : 'Nuevo horario fijo'}
      pie={
        <div className="flex gap-2">
          {bloque?.id && (
            <button type="button" className="btn btn-peligro px-3" onClick={eliminar} aria-label="Eliminar horario fijo">
              <Icon name="borrar" />
            </button>
          )}
          <button type="button" className="btn btn-menta flex-1" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar horario fijo'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-xl bg-navy-850 p-3 text-sm text-tinta-300">
          <Icon name="repetir" className="mt-0.5 h-4 w-4 shrink-0 text-menta-400" />
          Se repite todas las semanas en los días que marques. Ideal para clientes fijos.
        </p>

        <div>
          <label className="etiqueta" htmlFor="b-cliente">Cliente</label>
          <select id="b-cliente" className="campo" value={form.cliente_id} onChange={(e) => cambiarCliente(e.target.value)}>
            <option value="">— Sin cliente (escribir título) —</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </div>

        {!form.cliente_id && (
          <div>
            <label className="etiqueta" htmlFor="b-titulo">Título</label>
            <input id="b-titulo" className="campo" value={form.titulo} onChange={(e) => cambiar('titulo', e.target.value)} placeholder="Ej. Curso de actualización" />
          </div>
        )}

        {form.cliente_id && direcciones.length > 0 && (
          <div>
            <label className="etiqueta" htmlFor="b-dir">Dirección</label>
            <select id="b-dir" className="campo" value={form.direccion_id} onChange={(e) => cambiar('direccion_id', e.target.value)}>
              <option value="">— Sin dirección —</option>
              {direcciones.map((d) => (
                <option key={d.id} value={d.id}>{d.etiqueta} · {d.direccion}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <span className="etiqueta">Días</span>
          <div className="grid grid-cols-7 gap-1.5">
            {SEMANA_ORDEN.map((d) => (
              <button
                key={d}
                type="button"
                title={DIAS[d]}
                onClick={() => alternarDia(d)}
                className={`h-11 rounded-xl text-sm font-bold ${form.dias.includes(d) ? 'bg-menta-500 text-navy-950' : 'border border-navy-600 bg-navy-850 text-tinta-300'}`}
              >
                {DIA_LETRA[d]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="etiqueta" htmlFor="b-desde">Desde</label>
            <input id="b-desde" type="time" step="900" className="campo" value={form.desde} onChange={(e) => e.target.value && cambiar('desde', e.target.value)} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="b-hasta">Hasta</label>
            <input id="b-hasta" type="time" step="900" className="campo" value={form.hasta} onChange={(e) => e.target.value && cambiar('hasta', e.target.value)} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="b-fdesde">Empieza el</label>
            <input id="b-fdesde" type="date" className="campo" value={form.fecha_desde} onChange={(e) => e.target.value && cambiar('fecha_desde', e.target.value)} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="b-fhasta">Termina el (opcional)</label>
            <input id="b-fhasta" type="date" className="campo" value={form.fecha_hasta} onChange={(e) => cambiar('fecha_hasta', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="etiqueta" htmlFor="b-monto">Monto acordado por jornada (UYU)</label>
          <input id="b-monto" type="number" inputMode="decimal" min="0" className="campo" value={form.monto} onChange={(e) => cambiar('monto', e.target.value)} placeholder="Opcional" />
        </div>

        <div>
          <label className="etiqueta" htmlFor="b-notas">Notas</label>
          <textarea id="b-notas" rows={2} className="campo" value={form.notas} onChange={(e) => cambiar('notas', e.target.value)} />
        </div>

        {bloque?.id && fechaContexto && (
          <button type="button" className="btn btn-sec w-full" onClick={suspenderEseDia}>
            No se hace el {fechaLarga(desdeISO(fechaContexto)).toLowerCase()}
          </button>
        )}

        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}
