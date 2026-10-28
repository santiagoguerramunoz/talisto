'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { faltaTabla } from './sql';

export const AJUSTES_DEFECTO = {
  iva_porcentaje: 22,
  margen_materiales: 30,
  validez_presupuesto: 15,
  condiciones_presupuesto: '',
  razon_social: '',
  rut: '',
  telefono: '',
  email: '',
  direccion: '',
  logo_url: null,
  precio_boleto: null,
  precio_combustible: null,
  consumo_km_litro: null,
  categorias_gastos: [],
};

export async function cargarAjustes(profesionalId) {
  const { data, error } = await supabase.from('ajustes').select('*').eq('profesional_id', profesionalId).maybeSingle();
  if (error) return { ajustes: { ...AJUSTES_DEFECTO }, error: faltaTabla(error) ? null : error, faltaSql: faltaTabla(error) };
  const limpio = Object.fromEntries(Object.entries(data || {}).filter(([, v]) => v !== null && v !== undefined));
  return { ajustes: { ...AJUSTES_DEFECTO, ...limpio }, error: null, faltaSql: false };
}

export async function guardarAjustes(profesionalId, cambios) {
  return supabase
    .from('ajustes')
    .upsert({ profesional_id: profesionalId, ...cambios, actualizado_en: new Date().toISOString() }, { onConflict: 'profesional_id' })
    .select()
    .single();
}

export function useAjustes(profesionalId) {
  const [estado, setEstado] = useState({ ajustes: { ...AJUSTES_DEFECTO }, cargando: true, faltaSql: false, error: null });

  const recargar = useCallback(async () => {
    if (!profesionalId) return;
    const r = await cargarAjustes(profesionalId);
    setEstado({ ...r, cargando: false });
  }, [profesionalId]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const guardar = useCallback(
    async (cambios) => {
      const r = await guardarAjustes(profesionalId, cambios);
      if (!r.error) setEstado((e) => ({ ...e, ajustes: { ...e.ajustes, ...cambios } }));
      return r;
    },
    [profesionalId]
  );

  return { ...estado, recargar, guardar };
}
