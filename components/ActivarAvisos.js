'use client';

import { useEffect, useState } from 'react';
import Icon from './Icon';
import { activarPush, desactivarPush, estadoPush } from '@/lib/avisos';
import { mensajeError } from '@/lib/util';

const CLAVE_NO = 'talisto_avisos_no';

/**
 * Activar las notificaciones en este dispositivo.
 * compacto: tarjeta para invitar (se puede descartar) · completo: estado y botón en la pantalla de avisos
 */
export default function ActivarAvisos({ compacto = false, texto = 'Te avisamos al celular cuando te asignan un trabajo, aunque tengas la app cerrada.' }) {
  const [estado, setEstado] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [descartado, setDescartado] = useState(false);

  useEffect(() => {
    estadoPush().then(setEstado);
    try {
      setDescartado(window.localStorage.getItem(CLAVE_NO) === 'si');
    } catch {
      /* sin almacenamiento */
    }
  }, []);

  async function activar() {
    setOcupado(true);
    setError('');
    try {
      await activarPush();
      setEstado('activo');
    } catch (e) {
      setError(e.message ? mensajeError(e) : 'No se pudo activar.');
      setEstado(await estadoPush());
    }
    setOcupado(false);
  }

  async function desactivar() {
    setOcupado(true);
    await desactivarPush().catch(() => {});
    setEstado('inactivo');
    setOcupado(false);
  }

  if (!estado || estado === 'sin_claves') {
    return compacto ? null : (
      <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">
        Los avisos quedan acá en la app. Para que lleguen al celular con la app cerrada, la cuenta principal tiene que activarlos (se configuran una sola vez desde el panel de administración).
      </p>
    );
  }
  if (compacto && (estado === 'activo' || estado === 'no_soportado' || descartado)) return null;

  if (compacto) {
    return (
      <section className="rounded-2xl border border-menta-500/40 bg-menta-500/10 p-4">
        <p className="flex items-center gap-2 font-bold text-tinta-100">
          <Icon name="campana" className="h-5 w-5 text-menta-300" /> ¿Activás los avisos en este celular?
        </p>
        <p className="mt-1 text-sm text-tinta-300">
          {estado === 'instalar' ? 'En iPhone, primero instalá la app (Compartir → Agregar a inicio) y abrila desde ahí.' : estado === 'bloqueado' ? 'Están bloqueados: habilitalos en los ajustes del navegador para este sitio.' : texto}
        </p>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn btn-sec"
            onClick={() => {
              try {
                window.localStorage.setItem(CLAVE_NO, 'si');
              } catch {
                /* nada */
              }
              setDescartado(true);
            }}
          >
            Ahora no
          </button>
          <button type="button" className="btn btn-menta" onClick={activar} disabled={ocupado || estado === 'instalar' || estado === 'bloqueado'}>
            {ocupado ? 'Activando…' : 'Activar'}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="tarjeta p-4">
      <p className="flex items-center gap-2 font-bold">
        <Icon name="celular" className="h-5 w-5 text-menta-300" /> Notificaciones en este dispositivo
      </p>
      <p className="mt-1 text-sm text-tinta-300">
        {estado === 'activo'
          ? 'Activadas: te llegan aunque la app esté cerrada.'
          : estado === 'instalar'
            ? 'En iPhone, primero instalá la app (Compartir → Agregar a inicio) y abrila desde ahí.'
            : estado === 'bloqueado'
              ? 'Están bloqueadas: habilitalas en los ajustes del navegador para este sitio.'
              : estado === 'no_soportado'
                ? 'Este navegador no permite notificaciones. Los avisos quedan igual acá en la app.'
                : 'Apagadas en este dispositivo.'}
      </p>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      {estado === 'activo' ? (
        <button type="button" className="btn btn-sec mt-3 w-full" onClick={desactivar} disabled={ocupado}>Desactivar en este dispositivo</button>
      ) : estado === 'inactivo' ? (
        <button type="button" className="btn btn-menta mt-3 w-full" onClick={activar} disabled={ocupado}>
          {ocupado ? 'Activando…' : 'Activar notificaciones'}
        </button>
      ) : null}
    </section>
  );
}
