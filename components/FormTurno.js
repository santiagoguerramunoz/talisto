'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { supabase } from '@/lib/supabase';
import { combinar, fechaISO, fechaLarga, horaHHMM, minutos, textoHora } from '@/lib/fechas';
import { choquesConBloques } from '@/lib/agenda';
import { ESTADOS, linkWhatsapp, mensajeError } from '@/lib/util';

function sumarMinutos(hora, n) {
  const total = Math.min(minutos(hora) + n, 23 * 60 + 59);
  return textoHora(Math.max(total, 0));
}

export default function FormTurno({
  abierto,
  onCerrar,
  onGuardado,
  profesionalId,
  nombreProfesional = '',
  clientes = [],
  bloques = [],
  indice,
  turno,
  inicial,
}) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) {
      setForm(null);
      return;
    }
    setError('');
    if (turno) {
      setForm({
        cliente_id: turno.cliente_id || '',
        titulo: turno.titulo || '',
        direccion_id: turno.direccion_id || '',
        fecha: fechaISO(new Date(turno.inicio)),
        desde: horaHHMM(turno.inicio),
        hasta: horaHHMM(turno.fin),
        monto: turno.monto_acordado ?? '',
        estado: turno.estado,
        notas: turno.notas || '',
      });
    } else {
      const clienteId = inicial?.cliente_id || '';
      const cliente = clientes.find((c) => c.id === clienteId);
      const desde = inicial?.hora || '09:00';
      setForm({
        cliente_id: clienteId,
        titulo: '',
        direccion_id: cliente?.direcciones?.[0]?.id || '',
        fecha: inicial?.fecha || fechaISO(new Date()),
        desde,
        hasta: sumarMinutos(desde, 60),
        monto: '',
        estado: 'confirmado',
        notas: '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, turno, inicial]);

  const cliente = useMemo(() => clientes.find((c) => c.id === form?.cliente_id), [clientes, form?.cliente_id]);
  const direcciones = cliente?.direcciones || [];

  if (!form) return null;

  const cambiar = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));

  function cambiarCliente(id) {
    const c = clientes.find((x) => x.id === id);
    setForm((f) => ({ ...f, cliente_id: id, direccion_id: c?.direcciones?.[0]?.id || '' }));
  }

  function cambiarDesde(valor) {
    if (!valor) return;
    setForm((f) => {
      const duracion = Math.max(minutos(f.hasta) - minutos(f.desde), 30);
      return { ...f, desde: valor, hasta: sumarMinutos(valor, duracion) };
    });
  }

  async function guardar() {
    setError('');
    if (!form.cliente_id && !form.titulo.trim()) {
      setError('Elegí un cliente o escribí un título.');
      return;
    }
    if (minutos(form.hasta) <= minutos(form.desde)) {
      setError('La hora de fin tiene que ser después de la de inicio.');
      return;
    }
    const activo = form.estado === 'pendiente' || form.estado === 'confirmado';
    if (activo) {
      const choques = choquesConBloques({ fecha: form.fecha, desde: form.desde, hasta: form.hasta, bloques, indice });
      if (choques.length && !window.confirm(`Este turno se superpone con el horario fijo de ${choques.join(', ')}. ¿Guardar igual?`)) {
        return;
      }
    }
    setGuardando(true);
    const fila = {
      profesional_id: profesionalId,
      cliente_id: form.cliente_id || null,
      direccion_id: form.cliente_id && form.direccion_id ? form.direccion_id : null,
      titulo: form.titulo.trim() || null,
      inicio: combinar(form.fecha, form.desde).toISOString(),
      fin: combinar(form.fecha, form.hasta).toISOString(),
      monto_acordado: form.monto === '' ? null : Number(form.monto),
      estado: form.estado,
      notas: form.notas.trim() || null,
    };
    const consulta = turno?.id
      ? supabase.from('turnos').update(fila).eq('id', turno.id)
      : supabase.from('turnos').insert(fila);
    const { error: err } = await consulta;
    setGuardando(false);
    if (err) {
      setError(mensajeError(err));
      return;
    }
    onGuardado?.();
    onCerrar();
  }

  async function eliminar() {
    if (!turno?.id || !window.confirm('¿Eliminar este turno?')) return;
    const { error: err } = await supabase.from('turnos').delete().eq('id', turno.id);
    if (err) setError(mensajeError(err));
    else {
      onGuardado?.();
      onCerrar();
    }
  }

  const direccionElegida = direcciones.find((d) => d.id === form.direccion_id);
  const textoWhatsapp = cliente
    ? `Hola ${cliente.nombre}! Te confirmo el ${fechaLarga(combinar(form.fecha, '00:00')).toLowerCase()} de ${form.desde} a ${form.hasta}` +
      `${direccionElegida ? ` en ${direccionElegida.direccion}` : ''}. ¡Gracias!${nombreProfesional ? ` — ${nombreProfesional}` : ''}`
    : '';
  const whatsapp = cliente?.telefono ? linkWhatsapp(cliente.telefono, textoWhatsapp) : '';

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={turno?.id ? 'Editar turno' : 'Nuevo turno'}
      pie={
        <div className="flex gap-2">
          {turno?.id && (
            <button type="button" className="btn btn-peligro px-3" onClick={eliminar} aria-label="Eliminar turno">
              <Icon name="borrar" />
            </button>
          )}
          <button type="button" className="btn btn-menta flex-1" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar turno'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="etiqueta" htmlFor="t-cliente">Cliente</label>
          <select id="t-cliente" className="campo" value={form.cliente_id} onChange={(e) => cambiarCliente(e.target.value)}>
            <option value="">— Sin cliente (escribir título) —</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </div>

        {!form.cliente_id && (
          <div>
            <label className="etiqueta" htmlFor="t-titulo">Título</label>
            <input id="t-titulo" className="campo" value={form.titulo} onChange={(e) => cambiar('titulo', e.target.value)} placeholder="Ej. Comprar materiales" />
          </div>
        )}

        {form.cliente_id && (
          <div>
            <label className="etiqueta" htmlFor="t-dir">Dirección</label>
            {direcciones.length ? (
              <select id="t-dir" className="campo" value={form.direccion_id} onChange={(e) => cambiar('direccion_id', e.target.value)}>
                <option value="">— Sin dirección —</option>
                {direcciones.map((d) => (
                  <option key={d.id} value={d.id}>{d.etiqueta} · {d.direccion}</option>
                ))}
              </select>
            ) : (
              <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">Este cliente no tiene direcciones. Agregalas desde Clientes.</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-3 sm:col-span-1">
            <label className="etiqueta" htmlFor="t-fecha">Fecha</label>
            <input id="t-fecha" type="date" className="campo" value={form.fecha} onChange={(e) => e.target.value && cambiar('fecha', e.target.value)} />
          </div>
          <div className="col-span-3 grid grid-cols-2 gap-2 sm:col-span-2">
            <div>
              <label className="etiqueta" htmlFor="t-desde">Desde</label>
              <input id="t-desde" type="time" step="900" className="campo" value={form.desde} onChange={(e) => cambiarDesde(e.target.value)} />
            </div>
            <div>
              <label className="etiqueta" htmlFor="t-hasta">Hasta</label>
              <input id="t-hasta" type="time" step="900" className="campo" value={form.hasta} onChange={(e) => e.target.value && cambiar('hasta', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="etiqueta" htmlFor="t-monto">Monto acordado (UYU)</label>
            <input id="t-monto" type="number" inputMode="decimal" min="0" className="campo" value={form.monto} onChange={(e) => cambiar('monto', e.target.value)} placeholder="Opcional" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="t-estado">Estado</label>
            <select id="t-estado" className="campo" value={form.estado} onChange={(e) => cambiar('estado', e.target.value)}>
              {Object.entries(ESTADOS).map(([valor, texto]) => (
                <option key={valor} value={valor}>{texto}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="etiqueta" htmlFor="t-notas">Notas</label>
          <textarea id="t-notas" rows={2} className="campo" value={form.notas} onChange={(e) => cambiar('notas', e.target.value)} placeholder="Qué hay que hacer, qué llevar…" />
        </div>

        {turno?.tipo === 'visita' && (
          <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">Visita técnica reservada por TaListo!</p>
        )}

        {whatsapp && (
          <a href={whatsapp} target="_blank" rel="noreferrer" className="btn btn-sec w-full">
            <Icon name="whatsapp" /> Confirmar por WhatsApp
          </a>
        )}

        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}
