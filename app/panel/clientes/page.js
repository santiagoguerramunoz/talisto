'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import { usePanel } from '@/components/PanelContext';
import SelectorColor from '@/components/SelectorColor';
import { supabase } from '@/lib/supabase';
import { useAlVolver } from '@/lib/useAlVolver';
import { COLORES, mensajeError } from '@/lib/util';

export default function Clientes() {
  const router = useRouter();
  const { profesional } = usePanel();
  const [clientes, setClientes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [nuevo, setNuevo] = useState(false);
  const [form, setForm] = useState({ nombre: '', telefono: '', color: COLORES[0] });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('clientes')
      .select('id, nombre, telefono, color, direcciones(id, etiqueta), bloques_fijos(id)')
      .eq('profesional_id', profesional.id)
      .order('nombre');
    if (!err) setClientes(data || []);
    setCargando(false);
  }, [profesional.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useAlVolver(cargar);

  async function crear() {
    setError('');
    if (!form.nombre.trim()) return setError('Escribí el nombre del cliente.');
    setGuardando(true);
    const { data, error: err } = await supabase
      .from('clientes')
      .insert({ profesional_id: profesional.id, nombre: form.nombre.trim(), telefono: form.telefono.trim() || null, color: form.color })
      .select('id')
      .single();
    setGuardando(false);
    if (err) return setError(mensajeError(err));
    router.push(`/panel/clientes/${data.id}`);
  }

  const q = busqueda.trim().toLowerCase();
  const filtrados = q
    ? clientes.filter((c) => c.nombre.toLowerCase().includes(q) || (c.telefono || '').includes(q))
    : clientes;

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold">Clientes</h1>
          <button
            className="btn btn-menta py-2"
            onClick={() => {
              setForm({ nombre: '', telefono: '', color: COLORES[clientes.length % COLORES.length] });
              setError('');
              setNuevo(true);
            }}
          >
            <Icon name="mas" /> Nuevo
          </button>
        </div>
        <div className="relative mt-3">
          <Icon name="buscar" className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-tinta-500" />
          <input className="campo pl-9" placeholder="Buscar por nombre o teléfono" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
      </header>

      <div className="px-4 pt-4">
        {cargando ? (
          <p className="text-tinta-400">Cargando…</p>
        ) : filtrados.length === 0 ? (
          <div className="tarjeta p-6 text-center">
            <p className="font-bold">{q ? 'No hay clientes con ese nombre' : 'Todavía no cargaste clientes'}</p>
            {!q && <p className="mt-1 text-sm text-tinta-400">Agregá tus clientes con sus direcciones para tenerlos a mano en la agenda.</p>}
          </div>
        ) : (
          <ul className="tarjeta divide-y divide-navy-800 overflow-hidden">
            {filtrados.map((c) => (
              <li key={c.id}>
                <Link href={`/panel/clientes/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-navy-850">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-extrabold text-navy-950" style={{ background: c.color }}>
                    {c.nombre.trim().slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.nombre}</span>
                    <span className="block truncate text-xs text-tinta-400">
                      {c.direcciones?.length || 0} {c.direcciones?.length === 1 ? 'dirección' : 'direcciones'}
                      {c.bloques_fijos?.length ? ` · ${c.bloques_fijos.length} horario${c.bloques_fijos.length > 1 ? 's' : ''} fijo${c.bloques_fijos.length > 1 ? 's' : ''}` : ''}
                      {c.telefono ? ` · ${c.telefono}` : ''}
                    </span>
                  </span>
                  <Icon name="der" className="h-4 w-4 text-tinta-500" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        abierto={nuevo}
        onCerrar={() => setNuevo(false)}
        titulo="Nuevo cliente"
        pie={
          <button className="btn btn-menta w-full" onClick={crear} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Crear y agregar direcciones'}
          </button>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="etiqueta" htmlFor="c-nombre">Nombre o empresa</label>
            <input id="c-nombre" className="campo" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej. Grupo Gamma, Don Mario" autoFocus />
          </div>
          <div>
            <label className="etiqueta" htmlFor="c-tel">Celular / WhatsApp</label>
            <input id="c-tel" type="tel" inputMode="tel" className="campo" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} placeholder="099 123 456" />
          </div>
          <SelectorColor valor={form.color} onChange={(color) => setForm({ ...form, color })} />
          {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        </div>
      </Modal>
    </>
  );
}
