'use client';

import { useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import ElegirLugar from '@/components/ElegirLugar';
import { supabase } from '@/lib/supabase';
import { lugarCompleto, textoUbicacion } from '@/lib/lugares';
import { mensajeError } from '@/lib/util';

// Ubicación de la cuenta (país, región y localidad). Si falta, pide completarla.
export default function MiUbicacion({ className = '' }) {
  const [u, setU] = useState(undefined); // undefined = cargando, null = falta el SQL 29
  const [editar, setEditar] = useState(false);
  const [valor, setValor] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    supabase.rpc('mi_ubicacion').then(({ data, error: e }) => setU(e ? null : data || {}));
  }, []);

  if (!u) return null;

  function abrir() {
    setValor({ pais: u.pais, region_id: u.region_id, localidad_id: u.localidad_id, localidad_nombre: u.localidad || '', localidad_nueva: '' });
    setError('');
    setEditar(true);
  }

  async function guardar(e) {
    e.preventDefault();
    setError('');
    setGuardando(true);
    const { data, error: err } = await supabase.rpc('mi_ubicacion_guardar', {
      p_pais: valor.pais,
      p_region: valor.region_id,
      p_localidad: valor.localidad_id || null,
      p_localidad_nueva: valor.localidad_id ? null : (valor.localidad_nueva || '').trim() || null,
    });
    setGuardando(false);
    if (err) return setError(mensajeError(err));
    setU(data);
    setEditar(false);
  }

  if (editar) {
    return (
      <form onSubmit={guardar} className={`tarjeta space-y-4 p-4 ${className}`}>
        <h2 className="font-bold">Tu ubicación</h2>
        <ElegirLugar value={valor} onChange={setValor} id="mi-ubicacion" />
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        <div className="flex gap-2">
          <button className="btn btn-menta flex-1" disabled={guardando || !lugarCompleto(valor)}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          <button type="button" className="btn btn-sec" onClick={() => setEditar(false)}>Cancelar</button>
        </div>
      </form>
    );
  }

  const falta = !u.region_id || !u.localidad_id;
  return (
    <button
      type="button"
      onClick={abrir}
      className={`tarjeta flex w-full items-center gap-3 p-4 text-left hover:bg-navy-850 ${falta ? 'border-amber-400/40' : ''} ${className}`}
    >
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy-800 ${falta ? 'text-amber-300' : 'text-menta-400'}`}>
        <Icon name="ubicacion" />
      </span>
      <span className="min-w-0 flex-1">
        {falta ? (
          <>
            <b className="block">Completá tu ubicación</b>
            <span className="text-sm text-tinta-300">Así te mostramos técnicos, proveedores y novedades de tu zona.</span>
          </>
        ) : (
          <>
            <span className="block text-xs text-tinta-400">Tu ubicación</span>
            <b className="block truncate">{textoUbicacion(u)}</b>
            {u.localidad_pendiente && <span className="text-xs text-tinta-400">{u.localidad}: en revisión</span>}
          </>
        )}
      </span>
      <span className="text-sm font-semibold text-menta-400">{falta ? 'Completar' : 'Cambiar'}</span>
    </button>
  );
}
