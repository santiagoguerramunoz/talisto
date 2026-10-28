'use client';

import { useEffect, useState } from 'react';

// Ruta real por calles con OSRM (OpenStreetMap). Gratis y sin clave.
// Para mucho uso en producción conviene un servidor propio o un plan pago (ver README).
const SERVIDOR = 'https://router.project-osrm.org/route/v1/driving/';

/**
 * paradas: [{ lat, lng }] en el orden del recorrido
 * origen: { lat, lng } o null (si viene, la ruta sale desde ahí)
 * Devuelve { trazado: [[lat,lng]...], distancia (m), duracion (s), tramos: [{distancia, duracion}], cargando, error }
 */
export function useRuta(paradas, origen) {
  const [estado, setEstado] = useState({ trazado: null, distancia: 0, duracion: 0, tramos: [], cargando: false, error: '' });

  const puntos = [...(origen ? [origen] : []), ...paradas].filter(
    (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && p.lat !== null && p.lng !== null
  );
  // El origen se redondea (~100 m) para no recalcular la ruta con cada movimiento del GPS
  const clave = puntos
    .map((p, i) => {
      const dec = origen && i === 0 ? 3 : 5;
      return `${Number(p.lng).toFixed(dec)},${Number(p.lat).toFixed(dec)}`;
    })
    .join(';');

  useEffect(() => {
    if (puntos.length < 2) {
      setEstado({ trazado: null, distancia: 0, duracion: 0, tramos: [], cargando: false, error: '' });
      return undefined;
    }
    const control = new AbortController();
    setEstado((e) => ({ ...e, cargando: true, error: '' }));
    fetch(`${SERVIDOR}${clave}?overview=full&geometries=geojson&steps=false`, { signal: control.signal })
      .then((r) => r.json())
      .then((datos) => {
        const ruta = datos?.routes?.[0];
        if (datos.code !== 'Ok' || !ruta) throw new Error('sin ruta');
        setEstado({
          trazado: ruta.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          distancia: ruta.distance,
          duracion: ruta.duration,
          tramos: (ruta.legs || []).map((l) => ({ distancia: l.distance, duracion: l.duration })),
          cargando: false,
          error: '',
        });
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setEstado({ trazado: null, distancia: 0, duracion: 0, tramos: [], cargando: false, error: 'No se pudo calcular la ruta por calles en este momento.' });
      });
    return () => control.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  return estado;
}

export function textoDistancia(metros) {
  if (!metros) return '0 km';
  if (metros < 1000) return `${Math.round(metros / 10) * 10} m`;
  return `${(metros / 1000).toLocaleString('es-UY', { maximumFractionDigits: 1 })} km`;
}

export function textoDuracion(segundos) {
  const min = Math.max(1, Math.round((segundos || 0) / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h} h ${resto} min` : `${h} h`;
}
