import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const faltaConfiguracion = !url || !key;

// Si faltan las variables de entorno se usa un valor de relleno para que la app compile;
// la pantalla muestra un aviso para completar el archivo .env.local
export const supabase = createClient(
  url || 'https://falta-configurar.supabase.co',
  key || 'falta-configurar'
);
