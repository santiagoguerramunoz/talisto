'use client';

import { useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import { supabase } from '@/lib/supabase';
import { avisar } from '@/lib/avisos';
import { fechaISO, sumarDias } from '@/lib/fechas';
import { mensajeError } from '@/lib/util';

const DURACIONES = [
  [60, '1 hora'],
  [120, '2 horas'],
  [180, '3 horas'],
  [240, '4 horas'],
  [360, '6 horas'],
  [480, '8 horas'],
];

// Trabajos de varios días que siguen otro día, pero todavía sin fecha (SQL 30)
export default function ContinuacionesPendientes({ lista = [], nombreDe, onCambio }) {
  const [coordinar, setCoordinar] = useState(null);
  if (!lista.length) return null;
  return (
    <section className="mb-3 rounded-2xl border border-[#5aa9e6]/50 bg-[#176ba8]/15 p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-bold text-[#a9d4f5]">
        <Icon name="agenda" className="h-4 w-4" /> Pendiente de coordinar continuación ({lista.length})
      </p>
      <ul className="space-y-2">
        {lista.map((t) => (
          <li key={`${t.tipo}-${t.id}`} className="flex items-center gap-3 rounded-xl bg-navy-900 p-2.5">
            <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: t.color }} />
            <span className="min-w-0 flex-1">
              <b className="block truncate text-sm">{t.titulo}</b>
              <span className="block truncate text-xs text-tinta-400">
                Multi día{t.desde ? ` · trabajado el ${t.desde.slice(8, 10)}/${t.desde.slice(5, 7)}` : ''}
                {nombreDe && t.asignado_a ? ` · ${nombreDe(t.asignado_a)}` : ''}
                {t.avance ? ` · ${t.avance}` : ''}
              </span>
            </span>
            <button type="button" className="btn btn-menta shrink-0 px-3 py-2 text-sm" onClick={() => setCoordinar(t)}>
              Elegir día
            </button>
          </li>
        ))}
      </ul>
      {coordinar && (
        <CoordinarContinuacion
          trabajo={coordinar}
          onCerrar={() => setCoordinar(null)}
          onListo={() => {
            setCoordinar(null);
            onCambio?.();
          }}
        />
      )}
    </section>
  );
}

export function CoordinarContinuacion({ trabajo, onCerrar, onListo }) {
  const esTurno = trabajo.tipo === 'turno';
  const [fecha, setFecha] = useState(fechaISO(sumarDias(new Date(), 1)));
  const [hora, setHora] = useState(esTurno ? '09:00' : '');
  const [duracion, setDuracion] = useState(
    DURACIONES.reduce((a, [m]) => (Math.abs(m - (trabajo.minutos || 120)) < Math.abs(a - (trabajo.minutos || 120)) ? m : a), 120)
  );
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setError('');
    if (!fecha) return setError('Elegí el día.');
    if (esTurno && !hora) return setError('Elegí la hora.');
    setGuardando(true);
    const { error: err } = await supabase.rpc('coordinar_continuacion', {
      p_tipo: trabajo.tipo,
      p_id: trabajo.id,
      p_fecha: fecha,
      p_hora: hora || null,
      p_minutos: hora ? duracion : null,
    });
    setGuardando(false);
    if (err) return setError(mensajeError(err));
    avisar();
    onListo();
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo="¿Cuándo se sigue?"
      pie={
        <button type="button" className="btn btn-menta w-full" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Agendar continuación'}
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-tinta-300">
          <b className="text-tinta-100">{trabajo.titulo}</b> es un trabajo de varios días. Elegí cuándo se continúa.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta" htmlFor="cc-fecha">Día</label>
            <input id="cc-fecha" type="date" className="campo" value={fecha} min={fechaISO(new Date())} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="cc-hora">Hora{esTurno ? '' : ' (opcional)'}</label>
            <input id="cc-hora" type="time" className="campo" value={hora} onChange={(e) => setHora(e.target.value)} />
          </div>
        </div>
        {hora && (
          <div>
            <label className="etiqueta" htmlFor="cc-dur">¿Cuánto va a llevar?</label>
            <select id="cc-dur" className="campo" value={duracion} onChange={(e) => setDuracion(Number(e.target.value))}>
              {DURACIONES.map(([m, t]) => (
                <option key={m} value={m}>{t}</option>
              ))}
            </select>
          </div>
        )}
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}

// Lo que se hizo un día de un trabajo de varios días (se abre desde la agenda)
export function DetalleJornada({ evento, onCerrar, onCoordinar }) {
  const j = evento.jornada;
  const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' }) : '');
  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo="Día trabajado"
      pie={
        j.estado === 'pendiente' && onCoordinar ? (
          <button type="button" className="btn btn-menta w-full" onClick={onCoordinar}>
            Elegir cuándo se sigue
          </button>
        ) : (
          <button type="button" className="btn btn-sec w-full" onClick={onCerrar}>
            Cerrar
          </button>
        )
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="mt-1 h-10 w-1 shrink-0 rounded-full" style={{ background: evento.color }} />
          <div className="min-w-0">
            <b className="block">{evento.titulo}</b>
            <span className="text-sm text-tinta-300">
              {j.fecha.slice(8, 10)}/{j.fecha.slice(5, 7)}
              {j.desde ? ` · ${hora(j.desde)}–${hora(j.hasta)}` : j.hasta ? ` · hasta las ${hora(j.hasta)}` : ''}
            </span>
          </div>
        </div>
        <p className={`rounded-xl p-3 text-sm font-semibold ${j.estado === 'pendiente' ? 'bg-amber-400/10 text-amber-200' : 'bg-[#176ba8]/20 text-[#a9d4f5]'}`}>
          {evento.leyenda}
        </p>
        {j.avance && (
          <div>
            <p className="etiqueta">Avance de ese día</p>
            <p className="whitespace-pre-line text-sm text-tinta-200">{j.avance}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
