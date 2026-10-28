'use client';

import { useEffect, useState } from 'react';
import Icon from './Icon';
import { fechaISO, sumarDias } from '@/lib/fechas';
import { ESTADOS_TRABAJO, estadoTrabajo } from '@/lib/trabajos';
import { horasMinutos, leerHorasMinutos, msTrabajados, sesionAbierta, textoReloj } from '@/lib/tiempos';

// Cronómetro que se actualiza solo mientras el trabajo está corriendo
export function Reloj({ tiempos, minutosManual = null, className = '' }) {
  const corriendo = !!sesionAbierta(tiempos);
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!corriendo) return undefined;
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [corriendo]);
  const milis = minutosManual !== null && minutosManual !== undefined && !corriendo ? Number(minutosManual) * 60000 : msTrabajados(tiempos, ahora);
  return <span className={`tabular-nums ${className}`}>{textoReloj(milis)}</span>;
}

/**
 * Iniciar / Finalizar un trabajo B2B.
 * onAccion(accion, datos): 'iniciar' | 'finalizar' | 'suspender' {motivo} | 'otro_dia' {fecha} | 'reabrir' | 'corregir' {minutos}
 */
export default function ControlTiempo({ trabajo, onAccion, ocupado = false }) {
  const estado = estadoTrabajo(trabajo.estado);
  const info = ESTADOS_TRABAJO[estado] || ESTADOS_TRABAJO.pendiente;
  const corriendo = !!sesionAbierta(trabajo.tiempos);
  const yaEmpezo = (trabajo.tiempos || []).length > 0;
  const [paso, setPaso] = useState(null); // null | 'elegir' | 'suspender' | 'otro_dia' | 'corregir'
  const [motivo, setMotivo] = useState('');
  const [otroDia, setOtroDia] = useState(() => fechaISO(sumarDias(new Date(), 1)));
  const [corregido, setCorregido] = useState('');

  useEffect(() => {
    setPaso(null);
  }, [estado]);

  const accion = async (nombre, datos) => {
    const ok = await onAccion(nombre, datos);
    if (ok !== false) {
      setPaso(null);
      setMotivo('');
    }
  };

  return (
    <div
      className={`rounded-2xl border p-4 ${
        corriendo ? 'border-[#0a84ff]/60 bg-[#0a84ff]/10' : estado === 'finalizado' ? 'border-menta-500/40 bg-menta-500/5' : 'border-navy-700 bg-navy-850'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${info.clase}`}>
          {corriendo && <span className="h-2 w-2 animate-pulse rounded-full bg-[#0a84ff]" />}
          {info.texto}
        </span>
        <span className="text-xs text-tinta-400">
          {trabajo.minutos_manual !== null && trabajo.minutos_manual !== undefined ? 'Tiempo corregido a mano' : 'Tiempo en el trabajo'}
        </span>
      </div>
      <p className="mt-2 text-center">
        <Reloj tiempos={trabajo.tiempos} minutosManual={trabajo.minutos_manual} className="text-4xl font-extrabold" />
      </p>
      {estado === 'suspendido' && trabajo.nota_estado && <p className="mt-1 text-center text-sm text-red-200">Motivo: {trabajo.nota_estado}</p>}
      {estado === 'multidia' && <p className="mt-1 text-center text-sm text-[#8cc4ee]">Sigue el {trabajo.fecha?.split('-').reverse().join('/')}</p>}

      {/* Acciones principales */}
      {paso === null && (
        <div className="mt-3 space-y-2">
          {corriendo ? (
            <button type="button" className="btn w-full bg-red-500 py-3.5 text-base font-extrabold text-white hover:bg-red-400" onClick={() => setPaso('elegir')} disabled={ocupado}>
              <Icon name="parar" /> Finalizar
            </button>
          ) : estado === 'finalizado' ? (
            <button type="button" className="btn btn-sec w-full" onClick={() => accion('reabrir')} disabled={ocupado}>
              Reabrir el trabajo
            </button>
          ) : estado !== 'cancelado' ? (
            <button type="button" className="btn btn-menta w-full py-3.5 text-base font-extrabold" onClick={() => accion('iniciar')} disabled={ocupado}>
              <Icon name="play" /> {yaEmpezo ? 'Retomar' : 'Iniciar'}
            </button>
          ) : null}
          <button
            type="button"
            className="w-full text-center text-xs font-semibold text-tinta-400 hover:text-tinta-100"
            onClick={() => {
              setCorregido(trabajo.minutos_manual !== null && trabajo.minutos_manual !== undefined ? horasMinutos(trabajo.minutos_manual) : '');
              setPaso('corregir');
            }}
          >
            Corregir el tiempo a mano
          </button>
        </div>
      )}

      {/* ¿Cómo queda? */}
      {paso === 'elegir' && (
        <div className="mt-3 space-y-2">
          <p className="text-center text-sm font-semibold">¿Cómo queda el trabajo?</p>
          <button type="button" className="btn btn-menta w-full" onClick={() => accion('finalizar')} disabled={ocupado}>
            <Icon name="check" /> Terminado
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-sec" onClick={() => setPaso('suspender')} disabled={ocupado}>
              Suspendido
            </button>
            <button type="button" className="btn btn-sec" onClick={() => setPaso('otro_dia')} disabled={ocupado}>
              Sigue otro día
            </button>
          </div>
          <button type="button" className="w-full text-center text-xs font-semibold text-tinta-400" onClick={() => setPaso(null)}>
            Volver (sigue corriendo)
          </button>
        </div>
      )}

      {paso === 'suspender' && (
        <div className="mt-3 space-y-2">
          <label className="etiqueta" htmlFor="ct-motivo">¿Por qué se suspende?</label>
          <input id="ct-motivo" className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Falta material, no estaba el cliente…" />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-sec" onClick={() => setPaso('elegir')}>Volver</button>
            <button type="button" className="btn btn-menta" onClick={() => accion('suspender', { motivo: motivo.trim() })} disabled={ocupado}>
              Suspender
            </button>
          </div>
        </div>
      )}

      {paso === 'otro_dia' && (
        <div className="mt-3 space-y-2">
          <label className="etiqueta" htmlFor="ct-dia">Orden multi día: ¿qué día seguís?</label>
          <input id="ct-dia" type="date" className="campo" value={otroDia} min={fechaISO(new Date())} onChange={(e) => e.target.value && setOtroDia(e.target.value)} />
          <p className="text-xs text-tinta-400">El tiempo se va sumando. El trabajo aparece en la agenda ese día.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-sec" onClick={() => setPaso('elegir')}>Volver</button>
            <button type="button" className="btn btn-menta" onClick={() => accion('otro_dia', { fecha: otroDia })} disabled={ocupado}>
              Pasar a ese día
            </button>
          </div>
        </div>
      )}

      {paso === 'corregir' && (
        <div className="mt-3 space-y-2">
          <label className="etiqueta" htmlFor="ct-corr">Tiempo total (horas:minutos)</label>
          <input id="ct-corr" className="campo text-center text-lg font-bold" inputMode="numeric" value={corregido} onChange={(e) => setCorregido(e.target.value)} placeholder="Ej. 2:30" />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-sec" onClick={() => accion('corregir', { minutos: null })} disabled={ocupado}>
              Usar el cronómetro
            </button>
            <button
              type="button"
              className="btn btn-menta"
              onClick={() => {
                const min = leerHorasMinutos(corregido);
                if (min !== null) accion('corregir', { minutos: min });
              }}
              disabled={ocupado || leerHorasMinutos(corregido) === null}
            >
              Guardar tiempo
            </button>
          </div>
          <button type="button" className="w-full text-center text-xs font-semibold text-tinta-400" onClick={() => setPaso(null)}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
