'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { usePanel } from '@/components/PanelContext';

const sinFuncion = (e) => !!e && (e.code === 'PGRST202' || e.code === '42883');

/**
 * Datos de la empresa para asignar trabajos (SQL 08).
 * cuenta: la cuenta dueña de los datos (en una empresa, la principal)
 * esDueno: soy la cuenta principal → puedo marcar inicio/fin en todo
 * hayEquipo: la cuenta tiene una empresa con equipo
 * puedeAsignar: puedo elegir a quién le toca cada trabajo
 * puedeMonitorear: puedo ver la pantalla "Equipo en ruta"
 */
export function useContextoEquipo() {
  const panel = usePanel() || {};
  const { yo, profesional, empresa, permisos, espacios } = panel;
  const esDueno = !!yo && !!profesional && yo.id === profesional.id;
  const hayEquipo = empresa ? true : !!espacios?.miEmpresa;
  const lista = permisos || [];
  const puedeAsignar = hayEquipo && (esDueno || lista.includes('tickets_asignar') || lista.includes('agenda'));
  const puedeMonitorear = puedeAsignar;
  const trabajaTickets = !!empresa && lista.includes('tickets_trabajar');
  return {
    cuenta: profesional?.id || null,
    nombreCuenta: profesional?.nombre_publico || 'Cuenta principal',
    yo: yo?.id || null,
    esDueno,
    hayEquipo,
    puedeAsignar,
    puedeMonitorear,
    trabajaTickets,
    empresa: empresa || espacios?.miEmpresa || null,
  };
}

const cache = new Map(); // cuenta → { cuando, lista }

/** Personas a las que se les puede asignar un trabajo (incluye la cuenta principal). */
export function useEquipoAsignable() {
  const ctx = useContextoEquipo();
  const [equipo, setEquipo] = useState(() => cache.get(ctx.cuenta)?.lista || []);
  const [disponible, setDisponible] = useState(true);

  const cargar = useCallback(
    async (forzar = false) => {
      if (!ctx.puedeAsignar || !ctx.cuenta) return [];
      const guardado = cache.get(ctx.cuenta);
      if (!forzar && guardado?.lista && Date.now() - guardado.cuando < 60000) {
        setEquipo(guardado.lista);
        return guardado.lista;
      }
      // varias pantallas lo piden a la vez: una sola consulta
      let consulta = !forzar && guardado?.pendiente;
      if (!consulta) {
        consulta = supabase.rpc('equipo_asignable', { p_cuenta: ctx.cuenta });
        cache.set(ctx.cuenta, { ...guardado, pendiente: consulta });
      }
      const { data, error } = await consulta;
      if (error) {
        cache.delete(ctx.cuenta);
        if (sinFuncion(error)) setDisponible(false);
        return [];
      }
      const lista = [
        { usuario_id: ctx.cuenta, nombre: `${ctx.nombreCuenta} (cuenta principal)`, trabaja: true, principal: true },
        ...(data || []).filter((p) => p.usuario_id !== ctx.cuenta),
      ];
      cache.set(ctx.cuenta, { cuando: Date.now(), lista });
      setEquipo(lista);
      return lista;
    },
    [ctx.puedeAsignar, ctx.cuenta, ctx.nombreCuenta]
  );

  useEffect(() => {
    cargar();
  }, [cargar]);

  const nombreDe = useCallback((id) => equipo.find((p) => p.usuario_id === id)?.nombre?.replace(' (cuenta principal)', '') || '', [equipo]);

  return { ...ctx, equipo: disponible ? equipo : [], disponible, recargar: () => cargar(true), nombreDe };
}

// Iniciales para el pin de cada persona en el mapa
export function iniciales(nombre = '') {
  const partes = String(nombre).replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((partes[0]?.[0] || '?') + (partes[1]?.[0] || '')).toUpperCase();
}

// Ubicación actual del celular (una vez), sin trabar si la persona no la permite
export function ubicacionActual(espera = 8000) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    let listo = false;
    const fin = (v) => {
      if (!listo) {
        listo = true;
        resolve(v);
      }
    };
    setTimeout(() => fin(null), espera + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => fin({ lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy || 0) }),
      () => fin(null),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: espera }
    );
  });
}

export const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');

export function haceCuanto(iso, ahora = Date.now()) {
  if (!iso) return '';
  const min = Math.round((ahora - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString('es-UY', { day: 'numeric', month: 'short' });
}
