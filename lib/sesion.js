import { supabase } from './supabase';

// Decide a qué pantalla va cada usuario después de entrar
export async function rutaSegunPerfil(userId) {
  const { data: perfil } = await supabase.from('perfiles').select('rol, es_admin').eq('id', userId).maybeSingle();
  if (perfil?.rol === 'profesional') return '/panel';
  if (perfil?.es_admin) return '/admin';
  return '/inicio';
}
