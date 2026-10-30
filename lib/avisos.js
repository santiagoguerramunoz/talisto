'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

// Avisos de la app (SQL 11): campanita, pantalla de avisos y notificaciones push en este dispositivo.

const CLAVE_PUBLICA = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
const EVENTO = 'talisto-avisos';
const sinFuncion = (e) => !!e && (e.code === 'PGRST202' || e.code === '42883' || e.code === '42P01' || e.code === 'PGRST205');

async function token() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

let espera = null;
/**
 * Entrega por push los avisos que generó lo que acabo de hacer (asignar, cerrar, mover stock…).
 * La base decide a quién le llega; esto solo los manda a sus dispositivos. No falla nunca.
 */
export function avisar() {
  if (typeof window === 'undefined') return;
  clearTimeout(espera);
  espera = setTimeout(async () => {
    try {
      const t = await token();
      if (!t) return;
      await fetch('/api/avisos', { method: 'POST', headers: { Authorization: `Bearer ${t}` }, keepalive: true });
    } catch {
      /* sin conexión: se reintenta con el próximo aviso */
    }
    window.dispatchEvent(new Event(EVENTO));
  }, 700);
}

/** Cantidad de avisos sin leer (se actualiza sola) */
export function useAvisosSinLeer() {
  const [n, setN] = useState(0);
  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('avisos_sin_leer');
    if (!error) setN(Number(data) || 0);
    else if (sinFuncion(error)) setN(0);
  }, []);
  useEffect(() => {
    cargar();
    const t = setInterval(() => document.visibilityState === 'visible' && cargar(), 45000);
    const alVolver = () => document.visibilityState === 'visible' && cargar();
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener(EVENTO, cargar);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener(EVENTO, cargar);
    };
  }, [cargar]);
  return n;
}
export const avisosCambiaron = () => typeof window !== 'undefined' && window.dispatchEvent(new Event(EVENTO));

const desdeB64u = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const esIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalada = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);

/**
 * Estado de las notificaciones en este dispositivo:
 * 'sin_claves' (falta configurarlas) · 'no_soportado' · 'instalar' (iPhone sin instalar) · 'bloqueado' · 'activo' · 'inactivo'
 */
export async function estadoPush() {
  if (!CLAVE_PUBLICA) return 'sin_claves';
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return esIos() && !instalada() ? 'instalar' : 'no_soportado';
  }
  if (Notification.permission === 'denied') return 'bloqueado';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'activo' : 'inactivo';
  } catch {
    return 'inactivo';
  }
}

/** Pide permiso y deja este dispositivo recibiendo los avisos */
export async function activarPush() {
  if (!CLAVE_PUBLICA) throw new Error('Las notificaciones al celular todavía no están configuradas.');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error(esIos() ? 'En iPhone, primero instalá la app: Compartir → Agregar a inicio, y abrila desde ahí.' : 'Este navegador no permite notificaciones.');
  }
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') throw new Error('No diste permiso. Lo podés activar en los ajustes del navegador para este sitio.');
  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: desdeB64u(CLAVE_PUBLICA) });
  const j = sub.toJSON();
  const { error } = await supabase.rpc('guardar_suscripcion_push', {
    p_endpoint: j.endpoint,
    p_p256dh: j.keys?.p256dh,
    p_auth: j.keys?.auth,
    p_agente: navigator.userAgent.slice(0, 200),
  });
  if (error) throw error;
  return true;
}

export async function desactivarPush() {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.rpc('quitar_suscripcion_push', { p_endpoint: sub.endpoint });
    await sub.unsubscribe().catch(() => {});
  }
}

export function haceRato(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString('es-UY', { day: 'numeric', month: 'short' });
}
