'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import Mapa from '@/components/Mapa';
import FormDireccion from '@/components/FormDireccion';
import FormTurno from '@/components/FormTurno';
import FormBloque from '@/components/FormBloque';
import SelectorColor from '@/components/SelectorColor';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { cargarClientes } from '@/lib/clientes';
import SeccionEmpresa from '@/components/SeccionEmpresa';
import { useAlVolver } from '@/lib/useAlVolver';
import { indexarClientes } from '@/lib/agenda';
import { fechaCorta, fechaISO, horaHHMM, textoDias } from '@/lib/fechas';
import { ESTADOS, linkGoogleMaps, linkWaze, linkWhatsapp, mensajeError, monto } from '@/lib/util';


export default function DetalleCliente() {
  const { id } = useParams();
  const router = useRouter();
  const { profesional } = usePanel();

  const [clientes, setClientes] = useState([]);
  const [bloques, setBloques] = useState([]);
  const [proximos, setProximos] = useState([]);
  const [pasados, setPasados] = useState([]);
  const [cargando, setCargando] = useState(true);

  const [modalDir, setModalDir] = useState(null);
  const [modalTurno, setModalTurno] = useState(null);
  const [modalBloque, setModalBloque] = useState(null);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    const ahora = new Date().toISOString();
    const [cl, bl, prox, pas] = await Promise.all([
      cargarClientes(profesional.id, 'email, notas'),
      supabase.from('bloques_fijos').select('*, bloques_excepciones(fecha)').eq('profesional_id', profesional.id),
      supabase.from('turnos').select('*').eq('cliente_id', id).gte('fin', ahora).neq('estado', 'cancelado').order('inicio').limit(20),
      supabase.from('turnos').select('*').eq('cliente_id', id).lt('fin', ahora).order('inicio', { ascending: false }).limit(10),
    ]);
    if (!(cl.error || bl.error || prox.error || pas.error)) {
      setClientes(cl.data || []);
      setBloques(bl.data || []);
      setProximos(prox.data || []);
      setPasados(pas.data || []);
    }
    setCargando(false);
  }, [id, profesional.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useAlVolver(cargar);

  const cliente = clientes.find((c) => c.id === id);
  const indice = useMemo(() => indexarClientes(clientes), [clientes]);
  const misBloques = bloques.filter((b) => b.cliente_id === id);
  const direcciones = cliente?.direcciones || [];
  const nombreDir = (dirId) => direcciones.find((d) => d.id === dirId);

  if (cargando) return <p className="p-4 text-tinta-400">Cargando…</p>;
  if (!cliente) {
    return (
      <div className="p-4">
        <p className="text-tinta-300">No encontramos este cliente.</p>
        <Link href="/panel/clientes" className="btn btn-sec mt-4">Volver a clientes</Link>
      </div>
    );
  }

  async function guardarCliente() {
    setError('');
    if (!form.nombre.trim()) return setError('El nombre no puede quedar vacío.');
    const { error: err } = await supabase
      .from('clientes')
      .update({
        nombre: form.nombre.trim(),
        telefono: form.telefono.trim() || null,
        email: form.email.trim() || null,
        notas: form.notas.trim() || null,
        color: form.color,
      })
      .eq('id', id);
    if (err) return setError(mensajeError(err));
    setEditando(false);
    cargar();
  }

  async function borrarCliente() {
    if (!window.confirm(`¿Eliminar a ${cliente.nombre}? Se borran sus direcciones y horarios fijos. Los turnos quedan en la agenda sin cliente.`)) return;
    const { error: err } = await supabase.from('clientes').delete().eq('id', id);
    if (err) return setError(mensajeError(err));
    router.replace('/panel/clientes');
  }

  async function borrarDireccion(d) {
    if (!window.confirm(`¿Eliminar la dirección "${d.etiqueta}"?`)) return;
    const { error: err } = await supabase.from('direcciones').delete().eq('id', d.id);
    if (err) window.alert(mensajeError(err));
    cargar();
  }

  const whatsapp = linkWhatsapp(cliente.telefono);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/panel/clientes" className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver">
            <Icon name="izq" />
          </Link>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full font-extrabold text-navy-950" style={{ background: cliente.color }}>
            {cliente.nombre.trim().slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-extrabold">{cliente.nombre}</h1>
            {cliente.telefono && <p className="text-xs text-tinta-400">{cliente.telefono}</p>}
          </div>
          <button
            className="rounded-full p-2 text-tinta-300 hover:bg-navy-800"
            aria-label="Editar cliente"
            onClick={() => {
              setForm({
                nombre: cliente.nombre,
                telefono: cliente.telefono || '',
                email: cliente.email || '',
                notas: cliente.notas || '',
                color: cliente.color,
              });
              setError('');
              setEditando(true);
            }}
          >
            <Icon name="editar" />
          </button>
        </div>
        {(cliente.telefono || whatsapp) && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <a href={`tel:${cliente.telefono}`} className="btn btn-sec py-2 text-sm"><Icon name="telefono" className="h-4 w-4" /> Llamar</a>
            <a href={whatsapp} target="_blank" rel="noreferrer" className="btn btn-sec py-2 text-sm"><Icon name="whatsapp" className="h-4 w-4" /> WhatsApp</a>
          </div>
        )}
      </header>

      <div className="space-y-6 px-4 pt-4">
        {cliente.notas && <p className="rounded-xl bg-navy-900 p-3 text-sm text-tinta-300">{cliente.notas}</p>}

        {'es_empresa' in cliente && <SeccionEmpresa cliente={cliente} onGuardado={cargar} />}

        {/* Horarios acordados */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="titulo-seccion">Horarios acordados</h2>
            <div className="flex gap-2">
              <button className="chip" onClick={() => setModalBloque({ inicial: { cliente_id: id, fecha: fechaISO(new Date()) } })}>
                <Icon name="repetir" className="h-3.5 w-3.5" /> Fijo
              </button>
              <button className="chip chip-activo" onClick={() => setModalTurno({ inicial: { cliente_id: id, fecha: fechaISO(new Date()), hora: '09:00' } })}>
                <Icon name="mas" className="h-3.5 w-3.5" /> Turno
              </button>
            </div>
          </div>
          {misBloques.length === 0 && proximos.length === 0 ? (
            <p className="tarjeta p-4 text-sm text-tinta-400">Sin horarios. Agregá un turno puntual o un horario fijo que se repita cada semana.</p>
          ) : (
            <ul className="tarjeta divide-y divide-navy-800 overflow-hidden">
              {misBloques.map((b) => {
                const d = nombreDir(b.direccion_id);
                return (
                  <li key={b.id}>
                    <button onClick={() => setModalBloque({ bloque: b })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-navy-850">
                      <Icon name="repetir" className="h-5 w-5 shrink-0 text-menta-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          {textoDias(b.dias)} · {String(b.hora_inicio).slice(0, 5)}–{String(b.hora_fin).slice(0, 5)}
                        </span>
                        <span className="block truncate text-xs text-tinta-400">
                          {d ? `${d.etiqueta} · ${d.direccion}` : 'Sin dirección'}
                          {b.monto ? ` · ${monto(b.monto)} por jornada` : ''}
                          {b.fecha_hasta ? ` · hasta ${fechaCorta(new Date(`${b.fecha_hasta}T00:00`))}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {proximos.map((t) => {
                const d = nombreDir(t.direccion_id);
                return (
                  <li key={t.id}>
                    <button onClick={() => setModalTurno({ turno: t })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-navy-850">
                      <Icon name="reloj" className="h-5 w-5 shrink-0 text-tinta-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          {fechaCorta(t.inicio)} · {horaHHMM(t.inicio)}–{horaHHMM(t.fin)}
                        </span>
                        <span className="block truncate text-xs text-tinta-400">
                          {d ? d.etiqueta : 'Sin dirección'}
                          {t.monto_acordado ? ` · ${monto(t.monto_acordado)}` : ''}
                          {t.estado !== 'confirmado' ? ` · ${ESTADOS[t.estado]}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Direcciones */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="titulo-seccion">Direcciones</h2>
            <button className="chip chip-activo" onClick={() => setModalDir({ direccion: null })}>
              <Icon name="mas" className="h-3.5 w-3.5" /> Agregar
            </button>
          </div>
          {direcciones.length === 0 ? (
            <p className="tarjeta p-4 text-sm text-tinta-400">Este cliente todavía no tiene direcciones.</p>
          ) : (
            <>
              <Mapa
                alto={200}
                puntos={direcciones.map((d) => ({
                  lat: d.lat,
                  lng: d.lng,
                  color: cliente.color,
                  etiqueta: d.etiqueta.slice(0, 1).toUpperCase(),
                  popup: `${d.etiqueta}\n${d.direccion}`,
                }))}
              />
              <ul className="mt-3 space-y-2">
                {direcciones.map((d) => (
                  <li key={d.id} className="tarjeta p-4">
                    <div className="flex items-start gap-3">
                      <Icon name="pin" className="mt-0.5 h-5 w-5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold">{d.etiqueta}</p>
                        <p className="text-sm text-tinta-300">{d.direccion}</p>
                        {d.referencia && <p className="mt-0.5 text-xs text-tinta-400">{d.referencia}</p>}
                        {(d.lat === null || d.lng === null) && <p className="mt-1 text-xs text-amber-300">Sin ubicación en el mapa</p>}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      <a href={linkGoogleMaps(d)} target="_blank" rel="noreferrer" className="btn btn-sec px-2 py-2 text-xs">
                        <Icon name="ir" className="h-4 w-4" /> Maps
                      </a>
                      <a href={linkWaze(d)} target="_blank" rel="noreferrer" className="btn btn-sec px-2 py-2 text-xs">Waze</a>
                      <button onClick={() => setModalDir({ direccion: d })} className="btn btn-sec px-2 py-2 text-xs">
                        <Icon name="editar" className="h-4 w-4" />
                      </button>
                      <button onClick={() => borrarDireccion(d)} className="btn btn-peligro px-2 py-2 text-xs" aria-label="Eliminar dirección">
                        <Icon name="borrar" className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* Historial */}
        {pasados.length > 0 && (
          <section>
            <h2 className="titulo-seccion mb-2">Últimos trabajos</h2>
            <ul className="tarjeta divide-y divide-navy-800 overflow-hidden">
              {pasados.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setModalTurno({ turno: t })} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-navy-850">
                    <span>
                      {fechaCorta(t.inicio)} · {horaHHMM(t.inicio)}
                      <span className="ml-2 text-xs text-tinta-400">{ESTADOS[t.estado]}</span>
                    </span>
                    <span className="font-semibold text-tinta-300">{t.monto_acordado ? monto(t.monto_acordado) : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <FormDireccion abierto={!!modalDir} onCerrar={() => setModalDir(null)} onGuardado={cargar} clienteId={id} direccion={modalDir?.direccion} />
      <FormTurno
        abierto={!!modalTurno}
        onCerrar={() => setModalTurno(null)}
        onGuardado={cargar}
        profesionalId={profesional.id}
        nombreProfesional={profesional.nombre_publico}
        clientes={clientes}
        bloques={bloques}
        indice={indice}
        turno={modalTurno?.turno}
        inicial={modalTurno?.inicial}
      />
      <FormBloque
        abierto={!!modalBloque}
        onCerrar={() => setModalBloque(null)}
        onGuardado={cargar}
        profesionalId={profesional.id}
        clientes={clientes}
        bloque={modalBloque?.bloque}
        inicial={modalBloque?.inicial}
      />

      <Modal
        abierto={editando}
        onCerrar={() => setEditando(false)}
        titulo="Editar cliente"
        pie={
          <div className="flex gap-2">
            <button className="btn btn-peligro px-3" onClick={borrarCliente} aria-label="Eliminar cliente"><Icon name="borrar" /></button>
            <button className="btn btn-menta flex-1" onClick={guardarCliente}>Guardar</button>
          </div>
        }
      >
        {form && (
          <div className="space-y-4">
            <div>
              <label className="etiqueta" htmlFor="e-nombre">Nombre o empresa</label>
              <input id="e-nombre" className="campo" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="etiqueta" htmlFor="e-tel">Celular</label>
                <input id="e-tel" type="tel" className="campo" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
              </div>
              <div>
                <label className="etiqueta" htmlFor="e-email">Email</label>
                <input id="e-email" type="email" className="campo" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="etiqueta" htmlFor="e-notas">Notas</label>
              <textarea id="e-notas" rows={3} className="campo" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} placeholder="Contacto en la empresa, horarios de portería…" />
            </div>
            <SelectorColor valor={form.color} onChange={(color) => setForm({ ...form, color })} />
            {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
          </div>
        )}
      </Modal>
    </>
  );
}
