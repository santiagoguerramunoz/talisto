'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import DireccionRelevamiento, { UBICACION_VACIA, filaUbicacion, ubicacionMarcada } from './DireccionRelevamiento';
import { supabase } from '@/lib/supabase';
import { AVISO_SQL_UBICACION, consultarRelevamientos, guardarRelevamiento } from '@/lib/relevamientos';
import { combinar, fechaISO, fechaLarga, horaHHMM, minutos, textoHora } from '@/lib/fechas';
import { choquesConBloques } from '@/lib/agenda';
import { ESTADOS, linkWhatsapp, mensajeError } from '@/lib/util';
import { hhmm, useEquipoAsignable } from '@/lib/equipo';

function sumarMinutos(hora, n) {
  const total = Math.min(minutos(hora) + n, 23 * 60 + 59);
  return textoHora(Math.max(total, 0));
}

const TIPOS = [
  ['trabajo', 'Trabajo', 'maletin'],
  ['relevamiento', 'Relevamiento', 'relevamiento'],
];

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
  equipo: equipoProp = null,
}) {
  const equipoPanel = useEquipoAsignable();
  const equipo = equipoProp || equipoPanel;
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
        tipo: turno.tipo || 'trabajo',
        flexible: !!turno.flexible,
        pedido: '',
        relevamientoId: null,
        ubic: { ...UBICACION_VACIA, direccion_id: turno.direccion_id || '' },
        cliente_id: turno.cliente_id || '',
        titulo: turno.titulo || '',
        direccion_id: turno.direccion_id || '',
        fecha: fechaISO(new Date(turno.inicio)),
        desde: horaHHMM(turno.inicio),
        hasta: horaHHMM(turno.fin),
        monto: turno.monto_acordado ?? '',
        estado: turno.estado,
        notas: turno.notas || '',
        asignado_a: turno.asignado_a || '',
      });
      if (turno.tipo === 'relevamiento') {
        consultarRelevamientos((campos) => supabase.from('relevamientos').select(campos).eq('turno_id', turno.id).maybeSingle()).then(
          ({ data }) => {
            if (!data) return;
            const propia = !!data.direccion || (data.lat !== null && data.lat !== undefined);
            setForm((f) =>
              f
                ? {
                    ...f,
                    pedido: data.pedido || '',
                    relevamientoId: data.id,
                    ubic: propia
                      ? { otra: true, direccion_id: '', direccion: data.direccion || '', referencia: data.referencia || '', lat: data.lat ?? null, lng: data.lng ?? null }
                      : { ...UBICACION_VACIA, direccion_id: data.direccion_id || f.direccion_id },
                  }
                : f
            );
          }
        );
      }
    } else {
      const clienteId = inicial?.cliente_id || '';
      const cliente = clientes.find((c) => c.id === clienteId);
      const desde = inicial?.hora || '09:00';
      const esRelevamiento = inicial?.tipo === 'relevamiento';
      setForm({
        tipo: esRelevamiento ? 'relevamiento' : 'trabajo',
        flexible: esRelevamiento,
        pedido: inicial?.pedido || '',
        relevamientoId: null,
        ubic: { ...UBICACION_VACIA, direccion_id: cliente?.direcciones?.[0]?.id || '' },
        cliente_id: clienteId,
        titulo: '',
        direccion_id: cliente?.direcciones?.[0]?.id || '',
        fecha: inicial?.fecha || fechaISO(new Date()),
        desde,
        hasta: sumarMinutos(desde, esRelevamiento ? 240 : 60),
        monto: '',
        estado: 'confirmado',
        notas: '',
        asignado_a: inicial?.asignado_a || '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, turno, inicial]);

  const cliente = useMemo(() => clientes.find((c) => c.id === form?.cliente_id), [clientes, form?.cliente_id]);
  const direcciones = cliente?.direcciones || [];

  if (!form) return null;

  const esRelevamiento = form.tipo === 'relevamiento';
  const esVisitaApp = form.tipo === 'visita';
  const conEquipo = !!equipo?.hayEquipo && equipo.disponible;
  const asignables = conEquipo ? equipo.equipo.filter((p) => p.trabaja || p.usuario_id === form.asignado_a) : [];
  const sesiones = (turno?.tiempos || []).filter((t) => t?.inicio);
  const cambiar = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));

  function cambiarCliente(id) {
    const c = clientes.find((x) => x.id === id);
    const primera = c?.direcciones?.[0]?.id || '';
    setForm((f) => ({ ...f, cliente_id: id, direccion_id: primera, ubic: { ...f.ubic, direccion_id: primera } }));
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
    if (
      esRelevamiento &&
      !ubicacionMarcada(form.ubic, direcciones) &&
      !window.confirm('Este relevamiento no tiene la dirección marcada en el mapa, así que no se va a ver en el mapa. ¿Guardar igual?')
    ) {
      return;
    }
    const activo = form.estado === 'pendiente' || form.estado === 'confirmado';
    if (activo && !(esRelevamiento && form.flexible)) {
      const choques = choquesConBloques({ fecha: form.fecha, desde: form.desde, hasta: form.hasta, bloques, indice });
      if (choques.length && !window.confirm(`Este turno se superpone con el horario fijo de ${choques.join(', ')}. ¿Guardar igual?`)) {
        return;
      }
    }
    setGuardando(true);
    const ubicacion = esRelevamiento ? filaUbicacion(form.ubic, direcciones) : null;
    const fila = {
      profesional_id: profesionalId,
      cliente_id: form.cliente_id || null,
      direccion_id: esRelevamiento
        ? form.cliente_id ? ubicacion.direccion_id : null
        : form.cliente_id && form.direccion_id ? form.direccion_id : null,
      titulo: form.titulo.trim() || null,
      inicio: combinar(form.fecha, form.desde).toISOString(),
      fin: combinar(form.fecha, form.hasta).toISOString(),
      monto_acordado: form.monto === '' ? null : Number(form.monto),
      estado: form.estado,
      notas: form.notas.trim() || null,
    };
    if (conEquipo) fila.asignado_a = form.asignado_a || null;
    if (esRelevamiento) {
      fila.tipo = 'relevamiento';
      fila.flexible = !!form.flexible;
    } else if (turno?.tipo === 'relevamiento') {
      fila.tipo = 'trabajo';
      fila.flexible = false;
    }

    const consulta = turno?.id
      ? supabase.from('turnos').update(fila).eq('id', turno.id).select('id').single()
      : supabase.from('turnos').insert(fila).select('id').single();
    const { data, error: err } = await consulta;
    if (err) {
      setGuardando(false);
      setError(mensajeError(err));
      return;
    }

    if (esRelevamiento) {
      const { error: errRel, sinUbicacion } = await guardarRelevamiento({
        profesional_id: profesionalId,
        turno_id: data.id,
        cliente_id: fila.cliente_id,
        pedido: form.pedido.trim() || null,
        ...ubicacion,
        direccion_id: fila.direccion_id,
      });
      if (errRel || sinUbicacion) {
        setGuardando(false);
        setError(
          errRel ? `El turno se guardó, pero no la ficha del relevamiento: ${mensajeError(errRel)}` : `El relevamiento se guardó sin la dirección. ${AVISO_SQL_UBICACION}`
        );
        onGuardado?.();
        return;
      }
    }
    setGuardando(false);
    onGuardado?.();
    onCerrar();
  }

  async function eliminar() {
    const que = esRelevamiento ? 'este relevamiento de la agenda (la ficha con lo relevado se conserva)' : 'este turno';
    if (!turno?.id || !window.confirm(`¿Eliminar ${que}?`)) return;
    const { error: err } = await supabase.from('turnos').delete().eq('id', turno.id);
    if (err) setError(mensajeError(err));
    else {
      onGuardado?.();
      onCerrar();
    }
  }

  const usaOtra = esRelevamiento && (form.ubic.otra || direcciones.length === 0);
  const direccionElegida = direcciones.find((d) => d.id === (esRelevamiento ? form.ubic.direccion_id : form.direccion_id));
  const dia = fechaLarga(combinar(form.fecha, '00:00')).toLowerCase();
  const textoLugar = usaOtra ? form.ubic.direccion?.trim() : direccionElegida?.direccion;
  const lugar = textoLugar ? ` en ${textoLugar}` : '';
  const firma = nombreProfesional ? ` — ${nombreProfesional}` : '';
  let textoWhatsapp = '';
  if (cliente) {
    textoWhatsapp = esRelevamiento
      ? `Hola ${cliente.nombre}! Paso a ver el trabajo el ${dia}${form.flexible ? ` entre las ${form.desde} y las ${form.hasta}` : ` a las ${form.desde}`}${lugar}. ¡Gracias!${firma}`
      : `Hola ${cliente.nombre}! Te confirmo el ${dia} de ${form.desde} a ${form.hasta}${lugar}. ¡Gracias!${firma}`;
  }
  const whatsapp = cliente?.telefono ? linkWhatsapp(cliente.telefono, textoWhatsapp) : '';

  const titulo = turno?.id ? (esRelevamiento ? 'Relevamiento' : 'Editar turno') : esRelevamiento ? 'Nuevo relevamiento' : 'Nuevo turno';

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={titulo}
      pie={
        <div className="flex gap-2">
          {turno?.id && (
            <button type="button" className="btn btn-peligro px-3" onClick={eliminar} aria-label="Eliminar">
              <Icon name="borrar" />
            </button>
          )}
          <button type="button" className="btn btn-menta flex-1" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : esRelevamiento ? 'Guardar relevamiento' : 'Guardar turno'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {!esVisitaApp && (
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-navy-850 p-1.5">
            {TIPOS.map(([valor, texto, icono]) => (
              <button
                key={valor}
                type="button"
                onClick={() =>
                  setForm((f) => {
                    if (f.tipo === valor) return f;
                    const aRelevamiento = valor === 'relevamiento';
                    return {
                      ...f,
                      tipo: valor,
                      flexible: aRelevamiento ? (turno ? f.flexible : true) : false,
                      // la dirección elegida pasa de un tipo al otro
                      ubic: aRelevamiento && !f.ubic.otra ? { ...f.ubic, direccion_id: f.direccion_id } : f.ubic,
                      direccion_id: aRelevamiento ? f.direccion_id : f.ubic.otra ? '' : f.ubic.direccion_id,
                    };
                  })
                }
                className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition ${form.tipo === valor ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}
              >
                <Icon name={icono} className="h-4 w-4" /> {texto}
              </button>
            ))}
          </div>
        )}

        {esRelevamiento && form.relevamientoId && (
          <Link href={`/panel/relevamientos/${form.relevamientoId}`} onClick={onCerrar} className="btn btn-sec w-full border-marca-naranja/50">
            <Icon name="relevamiento" /> Abrir la ficha del relevamiento
          </Link>
        )}

        <div>
          <label className="etiqueta" htmlFor="t-cliente">Cliente</label>
          <select id="t-cliente" className="campo" value={form.cliente_id} onChange={(e) => cambiarCliente(e.target.value)}>
            <option value="">— Sin cliente (escribir título) —</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </div>

        {conEquipo && (
          <div>
            <label className="etiqueta" htmlFor="t-asig">Asignado a</label>
            <select id="t-asig" className="campo" value={form.asignado_a} onChange={(e) => cambiar('asignado_a', e.target.value)}>
              <option value="">— Sin asignar —</option>
              {asignables.map((p) => (
                <option key={p.usuario_id} value={p.usuario_id}>{p.nombre}</option>
              ))}
            </select>
            {form.asignado_a && <p className="mt-1 text-xs text-tinta-400">Le aparece en Mis tickets con la dirección, para iniciarlo y finalizarlo.</p>}
          </div>
        )}

        {(sesiones.length > 0 || turno?.resolucion) && (
          <div className="rounded-xl border border-navy-700 bg-navy-850 p-3 text-sm">
            {sesiones.map((t, i) => (
              <p key={i} className="text-xs text-tinta-300">
                {t.por && equipo?.nombreDe(t.por) ? `${equipo.nombreDe(t.por)}: ` : ''}inició {hhmm(t.inicio)}{t.fin ? ` · terminó ${hhmm(t.fin)}` : ' · trabajando ahora'}
              </p>
            ))}
            {turno?.resolucion && (
              <p className="mt-1.5 whitespace-pre-line text-tinta-100">
                <b className="block text-xs uppercase tracking-wide text-menta-300">{turno.estado === 'realizado' ? 'Cómo quedó' : 'Nota de quien lo hizo'}</b>
                {turno.resolucion}
              </p>
            )}
          </div>
        )}

        {!form.cliente_id && (
          <div>
            <label className="etiqueta" htmlFor="t-titulo">Título</label>
            <input id="t-titulo" className="campo" value={form.titulo} onChange={(e) => cambiar('titulo', e.target.value)} placeholder={esRelevamiento ? 'Ej. Relevar baño en Pocitos' : 'Ej. Comprar materiales'} />
          </div>
        )}

        {esRelevamiento && (
          <div>
            <p className="etiqueta">Dirección del relevamiento</p>
            <DireccionRelevamiento
              direcciones={direcciones}
              valor={form.ubic}
              onChange={(ubic) => cambiar('ubic', ubic)}
              nombreCliente={cliente?.nombre}
            />
          </div>
        )}

        {form.cliente_id && !esRelevamiento && (
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

        {esRelevamiento && (
          <div>
            <label className="etiqueta" htmlFor="t-pedido">¿Qué pide el cliente?</label>
            <textarea
              id="t-pedido"
              rows={3}
              className="campo"
              value={form.pedido}
              onChange={(e) => cambiar('pedido', e.target.value)}
              placeholder="Ej. Cambiar el tablero, agregar 3 enchufes en el living y revisar la puesta a tierra"
            />
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-3 sm:col-span-1">
            <label className="etiqueta" htmlFor="t-fecha">Fecha</label>
            <input id="t-fecha" type="date" className="campo" value={form.fecha} onChange={(e) => e.target.value && cambiar('fecha', e.target.value)} />
          </div>
          <div className="col-span-3 grid grid-cols-2 gap-2 sm:col-span-2">
            <div>
              <label className="etiqueta" htmlFor="t-desde">{esRelevamiento && form.flexible ? 'Entre las' : 'Desde'}</label>
              <input id="t-desde" type="time" step="900" className="campo" value={form.desde} onChange={(e) => cambiarDesde(e.target.value)} />
            </div>
            <div>
              <label className="etiqueta" htmlFor="t-hasta">{esRelevamiento && form.flexible ? 'y las' : 'Hasta'}</label>
              <input id="t-hasta" type="time" step="900" className="campo" value={form.hasta} onChange={(e) => e.target.value && cambiar('hasta', e.target.value)} />
            </div>
          </div>
        </div>

        {esRelevamiento && (
          <label className="flex items-start gap-3 rounded-xl bg-navy-850 p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#2cc79b]" checked={form.flexible} onChange={(e) => cambiar('flexible', e.target.checked)} />
            <span>
              <b className="text-tinta-100">Horario flexible</b>
              <span className="block text-tinta-400">
                Paso en algún momento de esa franja. No bloquea la agenda: podés agendar otras cosas en ese horario.
              </span>
            </span>
          </label>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="etiqueta" htmlFor="t-monto">{esRelevamiento ? 'Costo de la visita (UYU)' : 'Precio mano de obra (UYU)'}</label>
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
          <textarea id="t-notas" rows={2} className="campo" value={form.notas} onChange={(e) => cambiar('notas', e.target.value)} placeholder={esRelevamiento ? 'Quién recibe, timbre, horarios de portería…' : 'Qué hay que hacer, qué llevar…'} />
        </div>

        {esVisitaApp && (
          <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">Visita técnica reservada por TaListo!</p>
        )}

        {whatsapp && (
          <a href={whatsapp} target="_blank" rel="noreferrer" className="btn btn-sec w-full">
            <Icon name="whatsapp" /> {esRelevamiento ? 'Avisar al cliente por WhatsApp' : 'Confirmar por WhatsApp'}
          </a>
        )}

        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}
