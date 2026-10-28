'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Hacia dónde apunta el celular (0 = norte, 90 = este), como la flecha de Mapas.
// En iPhone hay que pedir permiso con un toque (activar). En Android funciona solo.
export function useBrujula() {
  const [rumbo, setRumbo] = useState(null);
  const [necesitaPermiso, setNecesitaPermiso] = useState(false);
  const limpiar = useRef(null);
  const ultimo = useRef({ valor: null, t: 0 });

  const escuchar = useCallback(() => {
    if (limpiar.current) return;
    const anguloPantalla = () => (window.screen?.orientation?.angle ?? window.orientation ?? 0) || 0;
    const publicar = (grados) => {
      if (!Number.isFinite(grados)) return;
      const valor = (grados + anguloPantalla() + 360) % 360;
      const ahora = Date.now();
      const prev = ultimo.current;
      const diferencia = prev.valor === null ? 360 : Math.abs(((valor - prev.valor + 540) % 360) - 180);
      if (diferencia < 4 || ahora - prev.t < 120) return;
      ultimo.current = { valor, t: ahora };
      setRumbo(Math.round(valor));
    };
    const alOrientar = (e) => {
      if (typeof e.webkitCompassHeading === 'number') publicar(e.webkitCompassHeading); // iPhone
      else if (e.absolute && typeof e.alpha === 'number') publicar(360 - e.alpha); // Android
    };
    const tieneAbsoluta = 'ondeviceorientationabsolute' in window;
    const evento = tieneAbsoluta ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(evento, alOrientar, true);
    limpiar.current = () => window.removeEventListener(evento, alOrientar, true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.DeviceOrientationEvent === 'undefined') return undefined;
    if (typeof window.DeviceOrientationEvent.requestPermission === 'function') setNecesitaPermiso(true);
    else escuchar();
    return () => {
      limpiar.current?.();
      limpiar.current = null;
    };
  }, [escuchar]);

  const activar = useCallback(async () => {
    const DOE = typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined;
    if (!DOE || typeof DOE.requestPermission !== 'function') return;
    try {
      const respuesta = await DOE.requestPermission();
      if (respuesta === 'granted') {
        setNecesitaPermiso(false);
        escuchar();
      }
    } catch {
      // el usuario no dio permiso
    }
  }, [escuchar]);

  return { rumbo, necesitaPermiso, activar };
}
