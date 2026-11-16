import { supabase } from './supabase';
import { invitacionPendiente } from './empresa';

// Decide a qué pantalla va cada usuario después de entrar
export async function rutaSegunPerfil(userId) {
  // Si llegó por una invitación a una empresa, vuelve a la invitación
  const invitacion = typeof window !== 'undefined' ? invitacionPendiente() : '';
  if (invitacion) return `/unirme?c=${encodeURIComponent(invitacion)}`;
  // Venía de una pantalla de TaListo! Match (por ejemplo, volviendo de pagar): vuelve ahí
  const volver = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('volver') || '' : '';
  if (/^\/(match|admin)(\/|$)/.test(volver)) return volver;
  const { data: perfil } = await supabase.from('perfiles').select('rol, es_admin').eq('id', userId).maybeSingle();
  if (perfil?.rol === 'profesional') return '/panel';
  if (perfil?.es_admin) return '/admin';
  return '/inicio';
}
