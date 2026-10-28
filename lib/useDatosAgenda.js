'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useAlVolver } from './useAlVolver';
import { cargarClientes, cargarOrdenes } from './clientes';
import { fechaISO } from './fechas';

// Carga clientes, horarios fijos, horario de trabajo, turnos y órdenes de empresa entre dos fechas (ms).
// Se actualiza sola al volver a la app y cada minuto.
export function useDatosAgenda(profesionalId, desdeMs, hastaMs) {
  const [datos, setDatos] = useState({ clientes: [], bloques: [], turnos: [], horarios: [], ordenes: [], cargando: true, error: null });
  const pedido = useRef(0);

  const recargar = useCallback(async () => {
    if (!profesionalId) return;
    const numero = ++pedido.current;
    const [cl, bl, tu, ho, or] = await Promise.all([
      cargarClientes(profesionalId),
      supabase.from('bloques_fijos').select('*, bloques_excepciones(fecha)').eq('profesional_id', profesionalId),
      supabase
        .from('turnos')
        .select('*')
        .eq('profesional_id', profesionalId)
        .gte('inicio', new Date(desdeMs).toISOString())
        .lt('inicio', new Date(hastaMs).toISOString())
        .order('inicio'),
      supabase.from('horarios_trabajo').select('*').eq('profesional_id', profesionalId),
      cargarOrdenes(profesionalId, fechaISO(new Date(desdeMs)), fechaISO(new Date(hastaMs))),
    ]);
    if (numero !== pedido.current) return; // llegó una respuesta más nueva
    const error = cl.error || bl.error || tu.error || ho.error || or.error || null;
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
