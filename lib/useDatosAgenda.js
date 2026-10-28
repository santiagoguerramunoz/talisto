'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useAlVolver } from './useAlVolver';
import { cargarClientes, cargarOrdenes, cargarTrabajosEnCurso } from './clientes';
import { cargarRelevamientosMapa } from './relevamientos';
import { fechaISO } from './fechas';

// Carga clientes, horarios fijos, horario de trabajo, turnos y órdenes de empresa entre dos fechas (ms),
// y los relevamientos pendientes (de cualquier fecha: se ven siempre en el mapa).
// Se actualiza sola al volver a la app y cada minuto.
export function useDatosAgenda(profesionalId, desdeMs, hastaMs) {
  const [datos, setDatos] = useState({ clientes: [], bloques: [], turnos: [], horarios: [], ordenes: [], relevamientos: [], enCurso: [], cargando: true, error: null });
  const pedido = useRef(0);

  const recargar = useCallback(async () => {
    if (!profesionalId) return;
    const numero = ++pedido.current;
    const desdeIso = new Date(desdeMs).toISOString();
    const hastaIso = new Date(hastaMs).toISOString();
    const [cl, bl, tu, ho, or, re, ec] = await Promise.all([
      cargarClientes(profesionalId),
      supabase.from('bloques_fijos').select('*, bloques_excepciones(fecha)').eq('profesional_id', profesionalId),
      supabase
        .from('turnos')
        .select('*')
        .eq('profesional_id', profesionalId)
        .gte('inicio', desdeIso)
        .lt('inicio', hastaIso)
        .order('inicio'),
      supabase.from('horarios_trabajo').select('*').eq('profesional_id', profesionalId),
      cargarOrdenes(profesionalId, fechaISO(new Date(desdeMs)), fechaISO(new Date(hastaMs))),
      cargarRelevamientosMapa(profesionalId, desdeIso, hastaIso),
      cargarTrabajosEnCurso(profesionalId),
    ]);
    if (numero !== pedido.current) return; // llegó una respuesta más nueva
    const error = cl.error || bl.error || tu.error || ho.error || or.error || re.error || null;
    if (error) {
      // Sin conexión u otro problema: se mantiene lo que ya estaba en pantalla
      setDatos((d) => ({ ...d, cargando: false, error }));
      return;
    }
    setDatos({
      clientes: cl.data || [],
      bloques: bl.data || [],
      turnos: tu.data || [],
      horarios: ho.data || [],
      ordenes: or.data || [],
      relevamientos: re.data || [],
      enCurso: ec.data || [],
      cargando: false,
      error: null,
    });
  }, [profesionalId, desdeMs, hastaMs]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  useAlVolver(recargar, 60000);

  return { datos, recargar };
}
