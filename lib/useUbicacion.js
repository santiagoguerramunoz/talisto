'use client';

import { useEffect, useState } from 'react';

// Ubicación del dispositivo en vivo (se actualiza mientras te movés).
// Si vas en movimiento, el GPS también da el rumbo (hacia dónde vas).
export function useUbicacion(activo = true) {
  const [ubicacion, setUbicacion] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!activo) return undefined;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setError('Este dispositivo no permite obtener la ubicación.');
      return undefined;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError('');
        const enMovimiento = (p.coords.speed || 0) > 1 && Number.isFinite(p.coords.heading);
        setUbicacion({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          precision: p.coords.accuracy,
          rumboGps: enMovimiento ? p.coords.heading : null,
        });
      },
      (e) => {
        setError(
          e.code === 1
            ? 'Permití el acceso a tu ubicación (en el candado de la barra de direcciones o en los ajustes del celular) para verte en el mapa.'
            : 'No pudimos obtener tu ubicación. Revisá que el GPS esté prendido.'
        );
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [activo]);

  return { ubicacion, error };
}
