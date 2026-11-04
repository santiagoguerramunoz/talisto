'use client';

import { useEffect, useState } from 'react';
import Modal from './Modal';
import { supabase } from '@/lib/supabase';
import {
  clavePlanilla, conDia, conFecha, diaDeCierre, fechaCierre, fechaCierreTexto, leerCierres, nombrePlanilla, problemaCierre, rangoPlanilla,
} from '@/lib/periodos';
import { sumarMeses } from '@/lib/fechas';
import { mensajeError } from '@/lib/util';

const AVISO_SQL = 'Falta correr en Supabase el archivo 16_ordenes_ia_cierres.sql.';

// Opciones del día de cierre: '' es fin de mes
export function OpcionesDiaCierre() {
  return (
    <>
      <option value="">Fin de mes</option>
      {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
        <option key={d} value={d}>El día {d}</option>
      ))}
    </>
  );
}

// Guarda el cierre en el cliente. Devuelve el texto del error ('' si salió bien).
export async function guardarCierres(clienteId, cierres) {
  const { data, error } = await supabase.from('clientes').update({ cierre_planilla: cierres }).eq('id', clienteId).select('id');
  if (error) return error.code === '42703' || /cierre_planilla/i.test(error.message || '') ? AVISO_SQL : mensajeError(error);
  return data?.length ? '' : 'Tu usuario no tiene permiso para cambiar los datos de este cliente.';
}

/** Cuándo cierra la planilla que se está viendo y, desde ahí en adelante, las de todos los meses. */
export default function CierrePlanilla({ abierto, onCerrar, onGuardado, empresa, periodo }) {
  const [dia, setDia] = useState('');
  const [fechaManual, setFechaManual] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cierres = leerCierres(empresa?.cierre_planilla);
  const diaActual = diaDeCierre(cierres, periodo);

  useEffect(() => {
    if (!abierto) return;
    setDia(diaActual ?? '');
    setFechaManual(null);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, empresa?.id, periodo.anio, periodo.mes]);

  if (!abierto || !empresa) return null;

  const diaNuevo = dia === '' ? null : Number(dia);
  const cambioDia = diaNuevo !== diaActual;
  const base = cambioDia ? conDia(cierres, periodo, diaNuevo) : cierres;
  const fecha = fechaManual ?? fechaCierre(base, periodo);
  const puntual = !!cierres.fechas[clavePlanilla(periodo)] && !cambioDia && fechaManual === null;

  // Cómo quedaría: si la fecha no es la del día de siempre, queda como excepción de esta planilla
  const sinExcepcion = conFecha(base, periodo, null);
  const nuevo = fecha === fechaCierre(sinExcepcion, periodo) ? sinExcepcion : conFecha(base, periodo, fecha);
  const problema = problemaCierre(nuevo, periodo, fecha);
  const rango = problema ? null : rangoPlanilla(nuevo, periodo);
  const siguiente = rango ? rangoPlanilla(nuevo, sumarMeses(periodo, 1)) : null;

  async function guardar() {
    if (problema) return setError(problema);
    setGuardando(true);
    const err = await guardarCierres(empresa.id, nuevo);
    setGuardando(false);
    if (err) return setError(err);
    onGuardado?.(nuevo);
    onCerrar();
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Cierre de la planilla"
      pie={
        <button type="button" className="btn btn-menta w-full" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-tinta-300">
          Las planillas de <b className="text-tinta-100">{empresa.nombre}</b> pueden cerrar cualquier día. Al día siguiente abre sola la planilla nueva.
        </p>

        <div>
          <label className="etiqueta" htmlFor="c-dia">Cierra todos los meses</label>
          <select id="c-dia" className="campo" value={dia} onChange={(e) => { setDia(e.target.value); setFechaManual(null); setError(''); }}>
            <OpcionesDiaCierre />
          </select>
          <p className="mt-1 text-xs text-tinta-400">Rige desde la planilla de {nombrePlanilla(periodo)}. Las anteriores no cambian.</p>
        </div>

        <div>
          <label className="etiqueta" htmlFor="c-fecha">{nombrePlanilla(periodo)} cierra el</label>
          <input id="c-fecha" type="date" className="campo" value={fecha} onChange={(e) => { setFechaManual(e.target.value); setError(''); }} />
          <p className="mt-1 text-xs text-tinta-400">
            {puntual ? 'Es una fecha puntual de esta planilla. ' : 'Si un mes cierra distinto, cambiá solo esta fecha. '}
            {puntual && (
              <button type="button" className="font-semibold text-marca-naranja" onClick={() => setFechaManual(fechaCierre(sinExcepcion, periodo))}>
                Volver al día de siempre
              </button>
            )}
          </p>
        </div>

        {rango && (
          <div className="rounded-xl bg-navy-850 p-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-tinta-300">{nombrePlanilla(periodo)}</span>
              <b>{fechaCierreTexto(rango.desde)} al {fechaCierreTexto(rango.cierre)}</b>
            </div>
            <div className="mt-1 flex justify-between gap-3">
              <span className="text-tinta-300">{nombrePlanilla(sumarMeses(periodo, 1))}</span>
              <b>{fechaCierreTexto(siguiente.desde)} al {fechaCierreTexto(siguiente.cierre)}</b>
            </div>
          </div>
        )}

        {(error || problema) && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error || problema}</p>}
      </div>
    </Modal>
  );
}
