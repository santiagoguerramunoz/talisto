'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useAlVolver } from './useAlVolver';

const CAMPOS_CLIENTE = 'id, nombre, color, telefono, direcciones(id, etiqueta, direccion, referencia, lat, lng)';

// Carga clientes, horarios fijos, horario de trabajo y los turnos entre dos fechas (en milisegundos).
// Se actualiza sola al volver a la app y cada minuto.
export function useDatosAgenda(profesionalId, desdeMs, hastaMs) {
  const [datos, setDatos] = useState({ clientes: [], bloques: [], turnos: [], horarios: [], cargando: true, error: null });
  const pedido = useRef(0);

  const recargar = useCallback(async () => {
    if (!profesionalId) return;
    const numero = ++pedido.current;
    const [cl, bl, tu, ho] = await Promise.all([
      supabase.from('clientes').select(CAMPOS_CLIENTE).eq('profesional_id', profesionalId).order('nombre'),
      supabase.from('bloques_fijos').select('*, bloques_excepciones(fecha)').eq('profesional_id', profesionalId),
      supabase
        .from('turnos')
        .select('*')
        .eq('profesional_id', profesionalId)
        .gte('inicio', new Date(desdeMs).toISOString())
        .lt('inicio', new Date(hastaMs).toISOString())
        .order('inicio'),
      supabase.from('horarios_trabajo').select('*').eq('profesional_id', profesionalId),
    ]);
    if (numero !== pedido.current) return; // llegó una respuesta más nueva
    const error = cl.error || bl.error || tu.error || ho.error || null;
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
