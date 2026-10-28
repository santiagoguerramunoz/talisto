'use client';

import { useEffect, useRef } from 'react';

// Vuelve a cargar los datos solo: al volver a la app (o a la pestaña), al recuperar
// la conexión y cada cierto tiempo mientras la pantalla está a la vista.
export function useAlVolver(recargar, cadaMs = 60000) {
  const ref = useRef(recargar);
  ref.current = recargar;

  useEffect(() => {
    const siVisible = () => {
      if (document.visibilityState === 'visible') ref.current?.();
    };
    document.addEventListener('visibilitychange', siVisible);
    window.addEventListener('online', siVisible);
    const intervalo = setInterval(siVisible, cadaMs);
    return () => {
      document.removeEventListener('visibilitychange', siVisible);
      window.removeEventListener('online', siVisible);
      clearInterval(intervalo);
    };
  }, [cadaMs]);
}
