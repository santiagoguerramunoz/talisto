'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import FormTurno from '@/components/FormTurno';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { useAlVolver } from '@/lib/useAlVolver';
import { useDatosAgenda } from '@/lib/useDatosAgenda';
import { indexarClientes } from '@/lib/agenda';
import { fechaISO, inicioDia, sumarDias } from '@/lib/fechas';
import { ESTADOS_RELEVAMIENTO, consultarRelevamientos, enElMapa, faltaTabla, textoCuando, ubicacionRelevamiento } from '@/lib/relevamientos';
import { monto } from '@/lib/util';

const FILTROS = [
  ['pendiente', 'Pendientes'],
  ['relevado', 'Relevados'],
  ['presupuestado', 'Presupuestados'],
  ['todos', 'Todos'],
];

export default function Relevamientos() {
  const { profesional } = usePanel();
  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState('pendiente');
  const [nuevo, setNuevo] = useState(null);

  // Clientes y horarios fijos para el formulario de nuevo relevamiento
  const hoy = useMemo(() => inicioDia(new Date()), []);
  const { datos } = useDatosAgenda(profesional.id, hoy.getTime(), sumarDias(hoy, 1).getTime());
  const indice = useMemo(() => indexarClientes(datos.clientes), [datos.clientes]);

  const cargar = useCallback(async () => {
    const { data, error: err } = await consultarRelevamientos((campos) =>
      supabase.from('relevamientos').select(campos).eq('profesional_id', profesional.id).order('creado_en', { ascending: false })
    );
    if (err) {
      setError(faltaTabla(err) ? 'Falta correr en Supabase el archivo 02_relevamientos.sql para activar los relevamientos.' : err.message);
    } else {
      setError('');
      setLista(data || []);
    }
    setCargando(false);
  }, [profesional.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);
  useAlVolver(cargar);

  const cuenta = (estado) => lista.filter((r) => r.estado === estado).length;
  const visibles = lista
    .filter((r) => filtro === 'todos' || r.estado === filtro)
    .sort((a, b) => {
      if (filtro === 'pendiente') {
        const fa = a.turnos?.inicio ? new Date(a.turnos.inicio).getTime() : Infinity;
        const fb = b.turnos?.inicio ? new Date(b.turnos.inicio).getTime() : Infinity;
        return fa - fb;
      }
      return new Date(b.actualizado_en) - new Date(a.actualizado_en);
    });

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold">Relevamientos</h1>
          <button className="btn btn-menta py-2" onClick={() => setNuevo({ fecha: fechaISO(new Date()), hora: '09:00', tipo: 'relevamiento' })}>
            <Icon name="mas" /> Nuevo
          </button>
        </div>
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
          {FILTROS.map(([valor, texto]) => {
            const n = valor === 'todos' ? lista.length : cuenta(valor);
            return (
              <button key={valor} onClick={() => setFiltro(valor)} className={`chip shrink-0 ${filtro === valor ? 'chip-activo' : ''}`}>
                {texto}
                {n > 0 && <span className="rounded-full bg-navy-700 px-1.5 text-[11px] text-tinta-100">{n}</span>}
              </button>
            );
          })}
        </div>
      </header>

      <div className="px-4 pt-4">
        {error && <p className="mb-3 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">{error}</p>}
        {cargando ? (
          <p className="text-tinta-400">Cargando…</p>
        ) : visibles.length === 0 ? (
          <div className="tarjeta p-6 text-center">
            <Icon name="relevamiento" className="mx-auto h-8 w-8 text-marca-naranja" />
            <p className="mt-2 font-bold">{filtro === 'pendiente' ? 'No tenés relevamientos pendientes' : 'No hay relevamientos acá'}</p>
            <p className="mt-1 text-sm text-tinta-400">
              Un relevamiento es una visita para ver el trabajo que pide el cliente. Agendalo con <b>Nuevo</b> o desde el + de la agenda.
            </p>
          </div>
        ) : (
          <ul className="lista-pc space-y-2">
            {visibles.map((r) => {
              const estado = ESTADOS_RELEVAMIENTO[r.estado] || ESTADOS_RELEVAMIENTO.pendiente;
              const c = r.clientes;
              const lugar = ubicacionRelevamiento(r);
              const faltaMapa = r.estado === 'pendiente' && !enElMapa(lugar);
              return (
                <li key={r.id}>
                  <Link href={`/panel/relevamientos/${r.id}`} className="tarjeta block p-4 hover:bg-navy-850">
                    <div className="flex items-start gap-3">
                      <span
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-extrabold text-navy-950"
                        style={{ background: c?.color || '#94a3b8' }}
                      >
                        {(c?.nombre || r.turnos?.titulo || '?').trim().slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-bold">{c?.nombre || r.turnos?.titulo || 'Sin cliente'}</p>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${estado.clase}`}>{estado.texto}</span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-sm text-tinta-300">{r.pedido || 'Sin detalle del pedido'}</p>
                        {lugar?.direccion ? (
                          <p className="mt-1 flex items-center gap-1 truncate text-xs text-tinta-300">
                            <Icon name="pin" className="h-3.5 w-3.5 shrink-0 text-marca-naranja" />
                            <span className="truncate">{lugar.direccion}</span>
                          </p>
                        ) : null}
                        {faltaMapa && (
                          <p className="mt-1 text-xs font-semibold text-amber-300">
                            {lugar ? 'Sin marcar en el mapa' : 'Sin dirección'}: tocá para agregarla
                          </p>
                        )}
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tinta-400">
                          <span className="inline-flex items-center gap-1"><Icon name="reloj" className="h-3.5 w-3.5" /> {textoCuando(r.turnos)}</span>
                          {r.fotos?.length > 0 && <span className="inline-flex items-center gap-1"><Icon name="camara" className="h-3.5 w-3.5" /> {r.fotos.length}</span>}
                          {r.mano_obra ?? r.costo_estimado ? <span className="font-semibold text-tinta-300">MO {monto(r.mano_obra ?? r.costo_estimado)}</span> : null}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <FormTurno
        abierto={!!nuevo}
        onCerrar={() => setNuevo(null)}
        onGuardado={cargar}
        profesionalId={profesional.id}
        nombreProfesional={profesional.nombre_publico}
        clientes={datos.clientes}
        bloques={datos.bloques}
        indice={indice}
        inicial={nuevo}
      />
    </>
  );
}
