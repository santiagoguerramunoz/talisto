'use client';

import Icon from './Icon';
import SelectorUbicacion from './SelectorUbicacion';

const OTRA = '__otra__';

export const UBICACION_VACIA = { otra: false, direccion_id: '', direccion: '', referencia: '', lat: null, lng: null };

// Lo que hay que guardar según lo elegido
export function filaUbicacion(valor, direcciones = []) {
  const otra = valor.otra || direcciones.length === 0;
  if (!otra) {
    return { direccion_id: valor.direccion_id || null, direccion: null, referencia: null, lat: null, lng: null };
  }
  return {
    direccion_id: null,
    direccion: valor.direccion?.trim() || null,
    referencia: valor.referencia?.trim() || null,
    lat: valor.lat ?? null,
    lng: valor.lat === null || valor.lat === undefined ? null : valor.lng,
  };
}

// ¿Va a aparecer en el mapa?
export function ubicacionMarcada(valor, direcciones = []) {
  const otra = valor.otra || direcciones.length === 0;
  if (otra) return valor.lat !== null && valor.lat !== undefined;
  const d = direcciones.find((x) => x.id === valor.direccion_id);
  return !!d && d.lat !== null && d.lat !== undefined;
}

/**
 * Dónde es el relevamiento: una dirección del cliente u otro lugar (obra nueva, etc.) con su punto en el mapa.
 * valor: { otra, direccion_id, direccion, referencia, lat, lng }
 */
export default function DireccionRelevamiento({ direcciones = [], valor, onChange, nombreCliente = 'el cliente' }) {
  const otra = valor.otra || direcciones.length === 0;
  const elegida = otra ? null : direcciones.find((d) => d.id === valor.direccion_id);

  return (
    <div className="space-y-2">
      {direcciones.length > 0 && (
        <select
          className="campo"
          aria-label="Dirección del relevamiento"
          value={otra ? OTRA : valor.direccion_id || ''}
          onChange={(e) =>
            e.target.value === OTRA
              ? onChange({ ...valor, otra: true, direccion_id: '' })
              : onChange({ ...valor, otra: false, direccion_id: e.target.value })
          }
        >
          {!valor.direccion_id && !otra && <option value="">Elegí una dirección…</option>}
          {direcciones.map((d) => (
            <option key={d.id} value={d.id}>{d.etiqueta} · {d.direccion}</option>
          ))}
          <option value={OTRA}>Otra dirección (obra nueva, otro lugar…)</option>
        </select>
      )}

      {otra ? (
        <>
          <SelectorUbicacion valor={valor} onChange={(v) => onChange({ ...valor, ...v })} alto={200} placeholder="Dirección del relevamiento" />
          <input
            className="campo"
            value={valor.referencia || ''}
            onChange={(e) => onChange({ ...valor, referencia: e.target.value })}
            placeholder="Referencia: apto, piso, entre calles, portón…"
            aria-label="Referencia"
          />
        </>
      ) : elegida ? (
        elegida.lat === null || elegida.lat === undefined ? (
          <p className="rounded-xl bg-amber-400/10 p-3 text-xs text-amber-200">
            Esta dirección no está marcada en el mapa. Marcala en la ficha de {nombreCliente} o elegí &quot;Otra dirección&quot;.
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-tinta-400">
            <Icon name="pin" className="h-3.5 w-3.5 text-marca-naranja" /> Se ve en el mapa mientras esté pendiente.
          </p>
        )
      ) : null}
    </div>
  );
}
