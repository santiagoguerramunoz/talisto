'use client';

import { useEffect, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import SelectorUbicacion from './SelectorUbicacion';
import ControlTiempo from './ControlTiempo';
import EditorMateriales from './EditorMateriales';
import { supabase } from '@/lib/supabase';
import { fechaISO, minutos } from '@/lib/fechas';
import { equivalenteOrden, importePuestas } from '@/lib/liquidacion';
import { limpiarMateriales, materialesParaEditar, numero, pesos, totalesMateriales } from '@/lib/precios';
import { cerrarTiempos, iniciarTiempos, sesionAbierta } from '@/lib/tiempos';
import { ESTADOS_TRABAJO, estadoTrabajo } from '@/lib/trabajos';
import { AVISO_SQL_04, faltaSql04 } from '@/lib/sql';
import { linkGoogleMaps, linkWaze, mensajeError } from '@/lib/util';
import { hhmm, useEquipoAsignable } from '@/lib/equipo';
import { Reloj } from './ControlTiempo';

function Contador({ etiqueta, ayuda, valor, onChange }) {
  const v = Number(valor) || 0;
  const fijar = (n) => onChange(Math.max(0, Math.round(n * 2) / 2));
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-850 p-3">
      <p className="text-sm font-bold">{etiqueta}</p>
      {ayuda && <p className="text-xs text-tinta-400">{ayuda}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <button type="button" onClick={() => fijar(v - 0.5)} className="grid h-10 w-10 place-items-center rounded-xl bg-navy-700 text-xl font-bold" aria-label={`Restar media ${etiqueta}`}>−</button>
        <span className="min-w-12 text-center text-2xl font-extrabold tabular-nums">{v.toLocaleString('es-UY', { minimumFractionDigits: v % 1 ? 1 : 0 })}</span>
        <button type="button" onClick={() => fijar(v + 0.5)} className="grid h-10 w-10 place-items-center rounded-xl bg-menta-500 text-xl font-bold text-navy-950" aria-label={`Sumar media ${etiqueta}`}>+</button>
      </div>
    </div>
  );
}

function formDesde(orden, empresas, inicial) {
  if (orden) {
    return {
      id: orden.id,
      empresa_id: orden.empresa_id,
      numero_cliente: orden.numero_cliente || '',
      numero_ticket: orden.numero_ticket || '',
      ticketOriginal: orden.numero_ticket || '',
      fecha: orden.fecha,
      fecha_inicio: orden.fecha_inicio || null,
      conHorario: !!orden.hora_inicio,
      desde: orden.hora_inicio ? String(orden.hora_inicio).slice(0, 5) : '09:00',
      hasta: orden.hora_fin ? String(orden.hora_fin).slice(0, 5) : '',
      cliente_final: orden.cliente_final || '',
      ubicacion: { direccion: orden.direccion || '', lat: orden.lat, lng: orden.lng },
      referencia: orden.referencia || '',
      pedido: orden.pedido || '',
      realizado: orden.realizado || '',
      acondicionamientos: Number(orden.acondicionamientos || 0),
      moes: Number(orden.moes || 0),
      precio: orden.precio_acondicionamiento ?? '',
      factor: orden.factor_moe ?? 1.75,
      mano_obra: orden.mano_obra ?? '',
      materiales: materialesParaEditar(orden.materiales),
      estado: estadoTrabajo(orden.estado),
      tiempos: Array.isArray(orden.tiempos) ? orden.tiempos : [],
      minutos_manual: orden.minutos_manual ?? null,
      nota_estado: orden.nota_estado || '',
      asignado_a: orden.asignado_a || '',
      cerrado_por: orden.cerrado_por || null,
      cerrado_en: orden.cerrado_en || null,
    };
  }
  const empresa = empresas.find((e) => e.id === inicial?.empresa_id) || empresas[0];
  return {
    id: null,
    empresa_id: empresa?.id || '',
    numero_cliente: '',
    numero_ticket: '',
    ticketOriginal: '',
    fecha: inicial?.fecha || fechaISO(new Date()),
    fecha_inicio: null,
    conHorario: false,
    desde: '09:00',
    hasta: '',
    cliente_final: '',
    ubicacion: { direccion: '', lat: null, lng: null },
    referencia: '',
    pedido: '',
    realizado: '',
    acondicionamientos: 1,
    moes: 0,
    precio: empresa?.precio_acondicionamiento ?? '',
    factor: empresa?.factor_moe ?? 1.75,
    mano_obra: '',
    materiales: [],
    estado: 'pendiente',
    tiempos: [],
    minutos_manual: null,
    nota_estado: '',
    asignado_a: inicial?.asignado_a || '',
  };
}

// En una empresa, el inicio y el fin los marca quien hace el trabajo (desde Mis tickets)
function TiempoDelEquipo({ trabajo, nombre }) {
  const estado = estadoTrabajo(trabajo.estado);
  const info = ESTADOS_TRABAJO[estado] || ESTADOS_TRABAJO.pendiente;
  const sesiones = (trabajo.tiempos || []).filter((t) => t?.inicio);
  const corriendo = !!sesionAbierta(trabajo.tiempos);
  return (
    <div className={`rounded-2xl border p-4 ${corriendo ? 'border-[#0a84ff]/60 bg-[#0a84ff]/10' : 'border-navy-700 bg-navy-850'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${info.clase}`}>
          {corriendo && <span className="h-2 w-2 animate-pulse rounded-full bg-[#0a84ff]" />}
          {info.texto}
        </span>
        <Reloj tiempos={trabajo.tiempos} minutosManual={trabajo.minutos_manual} className="text-xl font-extrabold" />
      </div>
      {sesiones.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-tinta-300">
          {sesiones.map((t, i) => (
            <li key={i}>
              {new Date(t.inicio).toLocaleDateString('es-UY', { day: 'numeric', month: 'short' })}: {hhmm(t.inicio)} a {t.fin ? hhmm(t.fin) : 'ahora'}
              {t.lat_i != null && ' · con ubicación'}
            </li>
          ))}
        </ul>
      )}
      {estado === 'suspendido' && trabajo.nota_estado && <p className="mt-1 text-sm text-red-200">Motivo: {trabajo.nota_estado}</p>}
      <p className="mt-2 text-xs text-tinta-400">
        {nombre ? `Lo inicia y lo finaliza ${nombre} desde Mis tickets.` : 'Asignalo a alguien del equipo: lo inicia y lo finaliza desde Mis tickets.'}
      </p>
    </div>
  );
}

/** Trabajo de un cliente B2B: ticket, dirección, Iniciar/Finalizar, puestas, MOE, mano de obra y materiales. */
export default function FormTrabajoB2B({ abierto, onCerrar, onGuardado, profesionalId, empresas = [], orden, inicial, margenDefecto = 30, equipo: equipoProp = null }) {
  const equipoPanel = useEquipoAsignable();
  const equipo = equipoProp || equipoPanel;
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) {
      setForm(null);
      return;
    }
    setError('');
    setAviso('');
    setForm(formDesde(orden, empresas, inicial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, orden, inicial]);

  if (!form) return null;

  const cambiar = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const empresa = empresas.find((e) => e.id === form.empresa_id);
  // Empresa con equipo: se asigna a alguien y, si no soy la cuenta principal, el tiempo lo marca esa persona
  const conEquipo = !!equipo?.hayEquipo && equipo.disponible;
  const tiempoDelEquipo = conEquipo && !equipo.esDueno;
  const asignables = conEquipo ? equipo.equipo.filter((p) => p.trabaja || p.usuario_id === form.asignado_a) : [];

  function cambiarEmpresa(id) {
    const e = empresas.find((x) => x.id === id);
    setForm((f) => ({ ...f, empresa_id: id, precio: e?.precio_acondicionamiento ?? f.precio, factor: e?.factor_moe ?? f.factor }));
  }

  const calculo = {
    acondicionamientos: form.acondicionamientos,
    moes: form.moes,
    factor_moe: Number(form.factor) || 1.75,
    precio_acondicionamiento: form.precio === '' ? null : Number(form.precio),
  };
  const equivalente = equivalenteOrden(calculo);
  const puestas = importePuestas(calculo);
  const mat = totalesMateriales(form.materiales);
  const manoObra = numero(form.mano_obra) ?? 0;
  const total = (puestas || 0) + manoObra + mat.venta;

  /**
   * Guarda todo el formulario (más los cambios de una acción del cronómetro).
   * Devuelve true si se guardó.
   */
  async function guardar(cambios = {}, { cerrar = true } = {}) {
    setError('');
    const f = { ...form, ...cambios };
    if (!f.empresa_id) {
      setError('Elegí el cliente B2B.');
      return false;
    }
    if (!f.numero_ticket.trim() && !f.numero_cliente.trim()) {
      setError('Poné al menos el número de ticket o el número de cliente.');
      return false;
    }
    if (f.conHorario && f.hasta && minutos(f.hasta) <= minutos(f.desde)) {
      setError('La hora de fin tiene que ser después de la de inicio.');
      return false;
    }

    // Aviso si ese ticket ya está cargado (solo si es nuevo o cambió)
    const ticket = f.numero_ticket.trim();
    if (ticket && ticket !== f.ticketOriginal) {
      let q = supabase.from('ordenes').select('id, fecha').eq('empresa_id', f.empresa_id).eq('numero_ticket', ticket).limit(1);
      if (f.id) q = q.neq('id', f.id);
      const { data: repetida } = await q;
      if (repetida?.length && !window.confirm(`El ticket ${ticket} ya está cargado (${repetida[0].fecha}). ¿Guardar igual?`)) return false;
    }

    // Si no queda "en curso", el cronómetro se frena
    const tiempos = f.estado === 'en_curso' || tiempoDelEquipo ? f.tiempos : cerrarTiempos(f.tiempos);

    setGuardando(true);
    const fila = {
      profesional_id: profesionalId,
      empresa_id: f.empresa_id,
      numero_cliente: f.numero_cliente.trim() || null,
      numero_ticket: ticket || null,
      fecha: f.fecha,
      fecha_inicio: f.fecha_inicio || null,
      hora_inicio: f.conHorario ? f.desde : null,
      hora_fin: f.conHorario && f.hasta ? f.hasta : null,
      cliente_final: f.cliente_final.trim() || null,
      direccion: f.ubicacion.direccion?.trim() || null,
      referencia: f.referencia.trim() || null,
      lat: f.ubicacion.lat ?? null,
      lng: f.ubicacion.lng ?? null,
      pedido: f.pedido.trim() || null,
      realizado: f.realizado.trim() || null,
      acondicionamientos: f.acondicionamientos,
      moes: f.moes,
      precio_acondicionamiento: f.precio === '' ? null : Number(f.precio),
      factor_moe: Number(f.factor) || 1.75,
      mano_obra: numero(f.mano_obra),
      materiales: limpiarMateriales(f.materiales),
      estado: f.estado,
      tiempos,
      minutos_manual: f.minutos_manual,
      nota_estado: f.estado === 'suspendido' ? f.nota_estado?.trim() || null : null,
    };
    if (conEquipo) fila.asignado_a = f.asignado_a || null;
    if (tiempoDelEquipo) {
      // El cronómetro lo maneja quien hace el trabajo. Lo que esa persona completa al cerrar
      // (estado, resolución, puestas, día) solo se manda si acá se cambió, para no pisarlo.
      delete fila.tiempos;
      if (f.id && orden) {
        const original = { ...formDesde(orden, empresas, null), estado: estadoTrabajo(orden.estado) };
        if (f.estado === original.estado) {
          delete fila.estado;
          delete fila.nota_estado;
        }
        if (f.realizado === original.realizado) delete fila.realizado;
        if (f.acondicionamientos === original.acondicionamientos) delete fila.acondicionamientos;
        if (f.moes === original.moes) delete fila.moes;
        if (f.fecha === original.fecha) delete fila.fecha;
        if ((f.fecha_inicio || null) === (original.fecha_inicio || null)) delete fila.fecha_inicio;
      }
    }
    const consulta = f.id
      ? supabase.from('ordenes').update(fila).eq('id', f.id).select('id').single()
      : supabase.from('ordenes').insert(fila).select('id').single();
    const { data, error: err } = await consulta;
    setGuardando(false);
    if (err) {
      setError(faltaSql04(err) ? AVISO_SQL_04 : mensajeError(err));
      return false;
    }
    onGuardado?.();
    if (cerrar) onCerrar();
    else setForm({ ...f, id: data.id, tiempos, ticketOriginal: ticket });
    return true;
  }

  async function accionTiempo(accion, datos = {}) {
    const ahora = new Date().toISOString();
    const hoy = fechaISO(new Date());
    setAviso('');
    if (accion === 'iniciar') {
      // Se trabaja hoy: el trabajo pasa a la agenda de hoy
      return guardar(
        { estado: 'en_curso', tiempos: iniciarTiempos(form.tiempos, ahora), fecha: hoy, fecha_inicio: form.fecha_inicio || hoy, nota_estado: '' },
        { cerrar: false }
      );
    }
    if (accion === 'finalizar') {
      const ok = await guardar({ estado: 'finalizado', tiempos: cerrarTiempos(form.tiempos, ahora) }, { cerrar: false });
      if (ok) setAviso('Trabajo terminado. Completá lo realizado, las puestas y los materiales, y tocá Guardar.');
      return ok;
    }
    if (accion === 'suspender') {
      return guardar({ estado: 'suspendido', tiempos: cerrarTiempos(form.tiempos, ahora), nota_estado: datos.motivo || '' }, { cerrar: false });
    }
    if (accion === 'otro_dia') {
      return guardar(
        { estado: 'multidia', tiempos: cerrarTiempos(form.tiempos, ahora), fecha: datos.fecha, fecha_inicio: form.fecha_inicio || form.fecha },
        { cerrar: false }
      );
    }
    if (accion === 'reabrir') return guardar({ estado: 'pendiente' }, { cerrar: false });
    if (accion === 'corregir') return guardar({ minutos_manual: datos.minutos }, { cerrar: false });
    return false;
  }

  async function eliminar() {
    if (!form.id || !window.confirm('¿Eliminar este trabajo?')) return;
    const { error: err } = await supabase.from('ordenes').delete().eq('id', form.id);
    if (err) return setError(mensajeError(err));
    onGuardado?.();
    onCerrar();
  }

  const ubic = form.ubicacion;
  const tienePin = ubic.lat !== null && ubic.lat !== undefined;
  const corriendo = !!sesionAbierta(form.tiempos);

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={form.id ? `Trabajo ${form.numero_ticket ? `Tk ${form.numero_ticket}` : 'B2B'}` : 'Nuevo trabajo B2B'}
      pie={
        <div className="flex gap-2">
          {form.id && (
            <button type="button" className="btn btn-peligro px-3" onClick={eliminar} aria-label="Eliminar trabajo">
              <Icon name="borrar" />
            </button>
          )}
          <button type="button" className="btn btn-menta flex-1" onClick={() => guardar()} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {empresas.length > 1 ? (
          <div>
            <label className="etiqueta" htmlFor="o-empresa">Cliente B2B</label>
            <select id="o-empresa" className="campo" value={form.empresa_id} onChange={(e) => cambiarEmpresa(e.target.value)}>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>{e.nombre}</option>
              ))}
            </select>
          </div>
        ) : empresa ? (
          <p className="flex items-center gap-2 text-sm text-tinta-300">
            <span className="h-3 w-3 rounded-full" style={{ background: empresa.color }} /> Trabajo B2B de <b className="text-tinta-100">{empresa.nombre}</b>
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="etiqueta" htmlFor="o-cli">Nº de cliente</label>
            <input id="o-cli" className="campo" value={form.numero_cliente} onChange={(e) => cambiar('numero_cliente', e.target.value)} placeholder="Ej. 55310" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="o-tk">Nº de ticket</label>
            <input id="o-tk" className="campo" value={form.numero_ticket} onChange={(e) => cambiar('numero_ticket', e.target.value)} placeholder="Ej. 88812" />
          </div>
        </div>

        {conEquipo && (
          <div>
            <label className="etiqueta" htmlFor="o-asig">Asignado a</label>
            <select id="o-asig" className="campo" value={form.asignado_a} onChange={(e) => cambiar('asignado_a', e.target.value)}>
              <option value="">— Sin asignar —</option>
              {asignables.map((p) => (
                <option key={p.usuario_id} value={p.usuario_id}>{p.nombre}</option>
              ))}
            </select>
            {form.cerrado_en && (
              <p className="mt-1 text-xs text-menta-300">
                Cerrado {form.cerrado_por ? `por ${equipo.nombreDe(form.cerrado_por) || 'el equipo'} ` : ''}el{' '}
                {new Date(form.cerrado_en).toLocaleDateString('es-UY', { day: 'numeric', month: 'short' })} a las {hhmm(form.cerrado_en)}
              </p>
            )}
          </div>
        )}

        {/* Iniciar / Finalizar */}
        {tiempoDelEquipo ? (
          <TiempoDelEquipo trabajo={form} nombre={form.asignado_a ? equipo.nombreDe(form.asignado_a) : ''} />
        ) : (
          <ControlTiempo trabajo={form} onAccion={accionTiempo} ocupado={guardando} />
        )}
        {aviso && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{aviso}</p>}

        <div>
          <label className="etiqueta" htmlFor="o-fecha">Fecha</label>
          <input id="o-fecha" type="date" className="campo" value={form.fecha} onChange={(e) => e.target.value && cambiar('fecha', e.target.value)} />
          {form.fecha_inicio && form.fecha_inicio !== form.fecha && (
            <p className="mt-1 text-xs text-[#8cc4ee]">Multi día: empezó el {form.fecha_inicio.split('-').reverse().join('/')}</p>
          )}
          <label className="mt-2 flex items-center gap-2.5 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-[#2cc79b]" checked={form.conHorario} onChange={(e) => cambiar('conHorario', e.target.checked)} />
            Tiene horario
          </label>
          {form.conHorario && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input type="time" step="900" className="campo" value={form.desde} onChange={(e) => e.target.value && cambiar('desde', e.target.value)} aria-label="Desde" />
              <input type="time" step="900" className="campo" value={form.hasta} onChange={(e) => cambiar('hasta', e.target.value)} aria-label="Hasta (opcional)" />
            </div>
          )}
        </div>

        <div>
          <label className="etiqueta" htmlFor="o-final">Cliente final (nombre o detalle)</label>
          <input id="o-final" className="campo" value={form.cliente_final} onChange={(e) => cambiar('cliente_final', e.target.value)} placeholder="Opcional · no se guarda en tus clientes" />
        </div>

        <div>
          <span className="etiqueta">Dirección</span>
          <SelectorUbicacion valor={ubic} onChange={(u) => cambiar('ubicacion', u)} alto={180} />
          <input className="campo mt-2" value={form.referencia} onChange={(e) => cambiar('referencia', e.target.value)} placeholder="Referencia: apto, timbre, portería…" />
          {tienePin && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <a href={linkGoogleMaps(ubic)} target="_blank" rel="noreferrer" className="btn btn-sec py-2 text-sm"><Icon name="ir" className="h-4 w-4" /> Ir</a>
              <a href={linkWaze(ubic)} target="_blank" rel="noreferrer" className="btn btn-sec py-2 text-sm">Waze</a>
            </div>
          )}
        </div>

        <div>
          <label className="etiqueta" htmlFor="o-pedido">Qué hay que hacer</label>
          <textarea id="o-pedido" rows={2} className="campo" value={form.pedido} onChange={(e) => cambiar('pedido', e.target.value)} placeholder="Lo que dice el ticket" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="o-real">Detalle de lo realizado</label>
          <textarea id="o-real" rows={3} className="campo" value={form.realizado} onChange={(e) => cambiar('realizado', e.target.value)} placeholder="Esto va a la planilla de liquidación" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Contador etiqueta="Puestas" ayuda="Dispositivo con hasta 15 m de cable" valor={form.acondicionamientos} onChange={(v) => cambiar('acondicionamientos', v)} />
          <Contador etiqueta="MOE" ayuda={`Mano de obra especial (= ${Number(form.factor) || 1.75} puestas)`} valor={form.moes} onChange={(v) => cambiar('moes', v)} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="etiqueta" htmlFor="o-precio">Precio por puesta (UYU)</label>
            <input id="o-precio" type="number" inputMode="decimal" min="0" className="campo" value={form.precio} onChange={(e) => cambiar('precio', e.target.value)} placeholder="Sin definir" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="o-factor">1 MOE equivale a</label>
            <input id="o-factor" type="number" inputMode="decimal" min="0.25" step="0.25" className="campo" value={form.factor} onChange={(e) => cambiar('factor', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="etiqueta" htmlFor="o-mo">Precio mano de obra (UYU)</label>
          <input id="o-mo" type="number" inputMode="decimal" min="0" className="campo" value={form.mano_obra} onChange={(e) => cambiar('mano_obra', e.target.value)} placeholder="Opcional · aparte de las puestas" />
        </div>

        <EditorMateriales
          materiales={form.materiales}
          onChange={(m) => cambiar('materiales', m)}
          margenDefecto={margenDefecto}
          titulo="Materiales"
          textoAgregar="Añadir materiales"
          vacio="Si tuviste que comprar materiales para la tarea, agregalos acá con el proveedor y su precio."
        />

        {/* Resumen del importe */}
        <div className="rounded-xl bg-navy-850 p-3 text-sm">
          <div className="flex justify-between text-tinta-300">
            <span>{equivalente.toLocaleString('es-UY', { maximumFractionDigits: 3 })} puestas equivalentes</span>
            <span>{puestas === null ? 'sin precio' : pesos(puestas)}</span>
          </div>
          {manoObra > 0 && (
            <div className="mt-1 flex justify-between text-tinta-300">
              <span>Mano de obra</span>
              <span>{pesos(manoObra)}</span>
            </div>
          )}
          {mat.venta > 0 && (
            <div className="mt-1 flex justify-between text-tinta-300">
              <span>Materiales</span>
              <span>{pesos(mat.venta)}</span>
            </div>
          )}
          <div className="mt-2 flex justify-between border-t border-navy-700 pt-2 text-base font-extrabold">
            <span>Total del trabajo</span>
            <span className="text-menta-300">{pesos(total)}</span>
          </div>
          <p className="mt-1 text-xs text-tinta-500">Costos y proveedores no salen en la planilla: solo los precios finales.</p>
        </div>

        <div>
          <label className="etiqueta" htmlFor="o-estado">Estado</label>
          <select
            id="o-estado"
            className="campo"
            value={form.estado}
            onChange={(e) => {
              const estado = e.target.value;
              setForm((f) => ({ ...f, estado, tiempos: estado === 'en_curso' && !tiempoDelEquipo ? iniciarTiempos(f.tiempos) : f.tiempos }));
            }}
          >
            {Object.entries(ESTADOS_TRABAJO)
              .filter(([valor]) => !tiempoDelEquipo || !['en_curso', 'multidia'].includes(valor) || valor === form.estado)
              .map(([valor, e]) => (
                <option key={valor} value={valor}>{e.texto}</option>
              ))}
          </select>
          {corriendo && !tiempoDelEquipo && <p className="mt-1 text-xs text-tinta-400">Si lo pasás a otro estado, el cronómetro se frena al guardar.</p>}
        </div>

        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}
