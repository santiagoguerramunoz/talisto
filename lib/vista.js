'use client';

import { useEffect, useState } from 'react';
import { esPro } from './planes';

// Vista para PC (Pro, Business y admin): barra lateral, pantallas a lo ancho y listas en columnas.
// Se elige en Perfil: automática (PC en pantallas grandes), siempre PC o siempre celular. Queda en este navegador.

const CLAVE = 'talisto_vista';
const EVENTO = 'talisto-vista';
export const OPCIONES_VISTA = [
  ['auto', 'Automática', 'PC en pantallas grandes, celular en el teléfono'],
  ['pc', 'PC', 'Barra lateral y todo a lo ancho (en tablets y computadoras)'],
  ['celular', 'Celular', 'Como en el teléfono, también en la computadora'],
];

export function leerVista() {
  try {
    const v = window.localStorage.getItem(CLAVE);
    return v === 'pc' || v === 'celular' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function guardarVista(v) {
  try {
    if (v === 'auto') window.localStorage.removeItem(CLAVE);
    else window.localStorage.setItem(CLAVE, v);
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: v }));
}

/** ¿Este plan puede usar la vista PC? */
export const vistaPcHabilitada = (estado) =>
  !!estado && (esPro(estado.plan?.plan) || esPro(estado.planPersonal?.plan) || !!estado.perfil?.es_admin);

/** Devuelve { pc, preferencia, elegir } y marca <html data-vista="pc"> para los estilos `pc:` */
export function useVistaPc(habilitada) {
  const [preferencia, setPreferencia] = useState('auto');
  const [ancho, setAncho] = useState(0);

  useEffect(() => {
    setPreferencia(leerVista());
    const medir = () => setAncho(window.innerWidth);
    medir();
    const cambio = (e) => setPreferencia(e.detail || leerVista());
    window.addEventListener('resize', medir);
    window.addEventListener(EVENTO, cambio);
    return () => {
      window.removeEventListener('resize', medir);
      window.removeEventListener(EVENTO, cambio);
    };
  }, []);

  const pc = !!habilitada && ((preferencia === 'pc' && ancho >= 768) || (preferencia === 'auto' && ancho >= 1100));

  useEffect(() => {
    const raiz = document.documentElement;
    if (pc) raiz.dataset.vista = 'pc';
    else delete raiz.dataset.vista;
    return () => {
      delete raiz.dataset.vista;
    };
  }, [pc]);

  return { pc, preferencia, elegir: guardarVista };
}
