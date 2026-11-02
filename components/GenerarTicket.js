'use client';

import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { usePanel } from './PanelContext';
import { supabase } from '@/lib/supabase';
import { avisar } from '@/lib/avisos';
import { combinar, fechaISO, sumarDias } from '@/lib/fechas';
import { useEquipoAsignable } from '@/lib/equipo';
import { numero } from '@/lib/precios';
import { numeroPresupuesto } from '@/lib/presupuestos';
import { mensajeError } from '@/lib/util';

const DURACIONES = [
  [30, '30 min'],
  [60, '1 h'],
  [90, '1 h 30'],
  [120, '2 h'],
  [180, '3 h'],
  [240, '4 h'],
  [480, 'Día entero'],
];
export const numeroTicket = (n) => String(n || 0).padStart(4, '0');
const esTarea = (m) => m.unidad === 'tarea' || /^mano de obra/i.test(String(m.item || ''));
let sec = 0;
const linea = (m = {}) => ({ k: ++sec, usar: true, item: m.item || '', cantidad: String(m.cantidad ?? 1), unidad: m.unidad || 'u', producto_id: m.producto_id || null });

/**
 * Genera el ticket de un trabajo: desde un presupuesto aceptado o suelto (mantenimiento programado, etc.).
 * Quien agenda elige día, hora y operario; si no, queda "Por agendar" para coordinación.
 */
export default function GenerarTicket({ abierto, cuenta, presupuesto = null, onCerrar, onListo }) {
  const panel = usePanel();
  const equipo = useEquipoAsignable();
  const puedeAgendar = !panel.empresa || panel.yo?.id === cuenta || ['agenda', 'tickets_asignar'].some((p) => (panel.permisos || []).includes(p));
  const [clientes, setClientes] = useState([]);
  const [f, setF] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [hecho, setHecho] = useState(null);

  useEffect(() => {
    if (!abierto) return;
    setError('');
    setHecho(null);
    supabase
      .from('clientes')
      .select('id, nombre, telefono, direcciones(id, etiqueta, direccion, lat, lng)')
      .eq('profesional_id', cuenta)
      .order('nombre')
      .then(({ data }) => setClientes(data || []));
    const items = presupuesto?.items || [];
    const tareas = items.filter(esTarea).map((m) => `• ${String(m.item).replace(/^mano de obra:\s*/i, '')}`);
    const mats = items.filter((m) => !esTarea(m) && String(m.item || '').trim());
    setF({
      cliente_id: presupuesto?.cliente_id || '',
      nuevoNombre: presupuesto?.cliente_id ? '' : presupuesto?.cliente_nombre || '',
      telefono: '',
      direccion_id: '',
      direccion: presupuesto?.cliente_direccion || '',
      titulo: presupuesto?.titulo || '',
      pedido: [presupuesto?.titulo, ...tareas, presupuesto?.mano_obra > 0 && presupuesto?.mano_obra_texto ? `• ${presupuesto.mano_obra_texto}` : null]
        .filter(Boolean)
        .join('\n'),
      agendar: puedeAgendar,
      fecha: fechaISO(sumarDias(new Date(), 1)),
      hora: '09:00',
      minutos: 120,
      asignado: '',
      conMateriales: presupuesto ? presupuesto.con_materiales !== false && mats.length > 0 : false,
      materiales: mats.map(linea),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, presupuesto?.id]);

  const cliente = useMemo(() => clientes.find((c) => c.id === f?.cliente_id), [clientes, f?.cliente_id]);
  // la dirección del presupuesto, si coincide con una del cliente
  useEffect(() => {
    if (!f || !cliente || f.direccion_id) return;
    const dirs = cliente.direcciones || [];
    const igual = dirs.find((d) => d.direccion?.trim().toLowerCase() === f.direccion.trim().toLowerCase());
    if (igual || (!f.direccion.trim() && dirs[0])) setF((x) => ({ ...x, direccion_id: (igual || dirs[0]).id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente]);

  if (!abierto || !f) return null;
  const set = (cambios) => setF((x) => ({ ...x, ...cambios }));
  const cambiarLinea = (k, cambios) => set({ materiales: f.materiales.map((m) => (m.k === k ? { ...m, ...cambios } : m)) });
  const operarios = (equipo.equipo || []).filter((p) => p.trabaja);

  async function generar() {
    setError('');
    if (!f.cliente_id && !f.nuevoNombre.trim()) return setError('Elegí el cliente o escribí su nombre.');
    if (!f.titulo.trim() && !f.pedido.trim()) return setError('Contá qué hay que hacer.');
    if (f.agendar && puedeAgendar && (!f.fecha || !f.hora)) return setError('Elegí el día y la hora, o dejalo por agendar.');
    const mats = f.conMateriales
      ? f.materiales.filter((m) => m.usar && m.item.trim()).map((m) => ({ item: m.item.trim(), cantidad: numero(m.cantidad) || 1, unidad: m.unidad || 'u', producto_id: m.producto_id }))
      : [];
    if (f.conMateriales && !mats.length) return setError('Marcá al menos un material, o sacá "Lleva materiales".');
    setGuardando(true);
    const { data, error: err } = await supabase.rpc('generar_ticket', {
      p_cuenta: cuenta,
      p_presupuesto: presupuesto?.id || null,
      p_cliente: f.cliente_id || null,
      p_cliente_nombre: f.cliente_id ? null : f.nuevoNombre.trim(),
      p_telefono: f.cliente_id ? null : f.telefono.trim() || null,
      p_direccion_id: f.direccion_id && f.direccion_id !== 'otra' ? f.direccion_id : null,
      p_direccion: !f.direccion_id || f.direccion_id === 'otra' ? f.direccion.trim() || null : null,
      p_lat: null,
      p_lng: null,
      p_titulo: f.titulo.trim() || null,
      p_pedido: f.pedido.trim() || null,
      p_inicio: f.agendar && puedeAgendar ? combinar(f.fecha, f.hora).toISOString() : null,
      p_minutos: Number(f.minutos) || 120,
      p_asignado: f.agendar && puedeAgendar && f.asignado ? f.asignado : null,
      p_con_materiales: f.conMateriales,
      p_materiales: mats,
      p_tipo: 'trabajo',
    });
    setGuardando(false);
    if (err) return setError(mensajeError(err));
    avisar();
    setHecho(data);
  }

  if (hecho) {
    return (
      <Modal
        abierto
        onCerrar={() => onListo?.(hecho)}
        titulo="Ticket generado"
        pie={
          <button type="button" className="btn btn-menta w-full" onClick={() => onListo?.(hecho)}>
            Listo
          </button>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-2xl border border-menta-500/40 bg-menta-500/10 p-4">
            <Icon name="check" className="h-6 w-6 shrink-0 text-menta-300" />
            <p className="text-sm text-tinta-100">
              <b className="block text-lg">Ticket Nº {numeroTicket(hecho.numero)}</b>
              {presupuesto && <>Del presupuesto Nº {numeroPresupuesto(presupuesto.numero)}. </>}
              {hecho.estado === 'por_agendar' ? 'Quedó por agendar: coordinación ya recibió el aviso.' : 'Quedó agendado y la persona asignada recibió el aviso.'}
            </p>
          </div>
          {hecho.pedido_id && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">
              <Icon name="caja" className="mt-0.5 h-4 w-4 shrink-0" /> Salió el pedido de materiales: Stock tiene que aprobarlo y entregarlos.
            </p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      abierto
      onCerrar={() => !guardando && onCerrar()}
      titulo={presupuesto ? `Generar ticket · Presupuesto Nº ${numeroPresupuesto(presupuesto.numero)}` : 'Nuevo ticket'}
      pie={
        <button type="button" className="btn btn-menta w-full py-3 font-extrabold" onClick={generar} disabled={guardando}>
          <Icon name="maletin" className="h-5 w-5" /> {guardando ? 'Generando…' : 'Generar ticket'}
        </button>
      }
    >
      <div className="space-y-4">
        {/* Cliente y lugar */}
        <section className="space-y-2">
          <label className="etiqueta" htmlFor="gt-cli">Cliente</label>
          <select id="gt-cli" className="campo" value={f.cliente_id} onChange={(e) => set({ cliente_id: e.target.value, direccion_id: '' })}>
            <option value="">— Cliente nuevo —</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          {!f.cliente_id && (
            <div className="grid grid-cols-[1fr_9rem] gap-2">
              <input className="campo" value={f.nuevoNombre} onChange={(e) => set({ nuevoNombre: e.target.value })} placeholder="Nombre del cliente" aria-label="Nombre del cliente" />
              <input className="campo" type="tel" value={f.telefono} onChange={(e) => set({ telefono: e.target.value })} placeholder="Teléfono" aria-label="Teléfono" />
            </div>
          )}
          {cliente?.direcciones?.length > 0 && (
            <select className="campo" value={f.direccion_id} onChange={(e) => set({ direccion_id: e.target.value })} aria-label="Dirección">
              {cliente.direcciones.map((d) => (
                <option key={d.id} value={d.id}>{d.etiqueta ? `${d.etiqueta}: ` : ''}{d.direccion}</option>
              ))}
              <option value="otra">Otra dirección…</option>
            </select>
          )}
          {(!cliente?.direcciones?.length || f.direccion_id === 'otra') && (
            <input className="campo" value={f.direccion} onChange={(e) => set({ direccion: e.target.value })} placeholder="Dirección del trabajo" aria-label="Dirección del trabajo" />
          )}
        </section>

        {/* Qué hay que hacer */}
        <section className="space-y-2">
          <label className="etiqueta" htmlFor="gt-tit">Trabajo</label>
          <input id="gt-tit" className="campo" value={f.titulo} onChange={(e) => set({ titulo: e.target.value })} placeholder="Ej. Mantenimiento mensual de bombas" maxLength={160} />
          <textarea rows={3} className="campo" value={f.pedido} onChange={(e) => set({ pedido: e.target.value })} placeholder="Qué hay que hacer (lo ve el operario)" aria-label="Qué hay que hacer" maxLength={2000} />
        </section>

        {/* Cuándo y quién */}
        <section className="space-y-2">
          <p className="etiqueta">Cuándo y quién</p>
          {puedeAgendar ? (
            <>
              <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-navy-850 p-1.5">
                {[
                  [true, 'Agendar ahora'],
                  [false, 'Por agendar'],
                ].map(([v, t]) => (
                  <button key={t} type="button" onClick={() => set({ agendar: v })} className={`rounded-xl py-2 text-sm font-bold ${f.agendar === v ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}>
                    {t}
                  </button>
                ))}
              </div>
              {f.agendar ? (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_7rem_7rem]">
                    <input type="date" className="campo col-span-2 min-w-0 sm:col-span-1" value={f.fecha} onChange={(e) => e.target.value && set({ fecha: e.target.value })} aria-label="Día" />
                    <input type="time" step="900" className="campo min-w-0" value={f.hora} onChange={(e) => e.target.value && set({ hora: e.target.value })} aria-label="Hora" />
                    <select className="campo min-w-0" value={f.minutos} onChange={(e) => set({ minutos: Number(e.target.value) })} aria-label="Duración">
                      {DURACIONES.map(([m, t]) => (
                        <option key={m} value={m}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <select className="campo" value={f.asignado} onChange={(e) => set({ asignado: e.target.value })} aria-label="Operario">
                    <option value="">Sin asignar todavía</option>
                    {operarios.map((p) => (
                      <option key={p.usuario_id} value={p.usuario_id}>{p.nombre.replace(' (cuenta principal)', '')}</option>
                    ))}
                  </select>
                </>
              ) : (
                <p className="text-xs text-tinta-400">Queda en Equipo en ruta → Por agendar, para elegir el día y el operario después.</p>
              )}
            </>
          ) : (
            <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-300">Queda <b>por agendar</b>: coordinación recibe el aviso y elige el día y el operario.</p>
          )}
        </section>

        {/* Materiales */}
        <section className="space-y-2">
          <label className="flex items-center gap-3 rounded-xl border border-navy-700 bg-navy-850 p-3 text-sm">
            <Icon name="caja" className="h-5 w-5 shrink-0 text-menta-300" />
            <span className="min-w-0 flex-1">
              <b className="block">Lleva materiales</b>
              <span className="text-xs text-tinta-400">Sale un pedido de materiales que tiene que aprobar Stock. El operario los ve en el ticket.</span>
            </span>
            <input type="checkbox" className="h-5 w-5 accent-[#2cc79b]" checked={f.conMateriales} onChange={(e) => set({ conMateriales: e.target.checked, materiales: e.target.checked && !f.materiales.length ? [linea()] : f.materiales })} />
          </label>
          {f.conMateriales && (
            <ul className="space-y-1.5">
              {f.materiales.map((m) => (
                <li key={m.k} className="grid grid-cols-[auto_1fr_4.5rem_3.5rem] items-center gap-1.5">
                  <input type="checkbox" className="h-5 w-5 accent-[#2cc79b]" checked={m.usar} onChange={(e) => cambiarLinea(m.k, { usar: e.target.checked })} aria-label={`Usar ${m.item}`} />
                  <input className="campo px-2 py-1.5 text-sm" value={m.item} onChange={(e) => cambiarLinea(m.k, { item: e.target.value })} placeholder="Material" aria-label="Material" />
                  <input className="campo px-2 py-1.5 text-sm" inputMode="decimal" value={m.cantidad} onChange={(e) => cambiarLinea(m.k, { cantidad: e.target.value.replace(/[^\d.,]/g, '') })} aria-label="Cantidad" />
                  <input className="campo px-2 py-1.5 text-sm" value={m.unidad} onChange={(e) => cambiarLinea(m.k, { unidad: e.target.value })} aria-label="Unidad" />
                </li>
              ))}
              <li>
                <button type="button" className="chip text-xs" onClick={() => set({ materiales: [...f.materiales, linea()] })}>
                  <Icon name="mas" className="h-3.5 w-3.5" /> Agregar material
                </button>
              </li>
            </ul>
          )}
        </section>

        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}
