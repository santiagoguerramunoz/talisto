export const COLORES = ['#34d3a6', '#60a5fa', '#fb923c', '#f472b6', '#a78bfa', '#facc15', '#f87171', '#22d3ee'];

export const DEPARTAMENTOS = ['Artigas', 'Canelones', 'Cerro Largo', 'Colonia', 'Durazno', 'Flores', 'Florida',
  'Lavalleja', 'Maldonado', 'Montevideo', 'Paysandú', 'Río Negro', 'Rivera', 'Rocha', 'Salto', 'San José',
  'Soriano', 'Tacuarembó', 'Treinta y Tres'];

export const TIPOS_TARIFA = {
  hora: 'Por hora',
  visita: 'Por visita',
  trabajo: 'Por trabajo',
  m2: 'Por m²',
  a_convenir: 'A convenir',
};

export const SUFIJO_TARIFA = { hora: '/ hora', visita: '/ visita', trabajo: '/ trabajo', m2: '/ m²', a_convenir: '' };

export const ESTADOS = {
  pendiente: 'Pendiente',
  confirmado: 'Confirmado',
  realizado: 'Realizado',
  cancelado: 'Cancelado',
};

export const CENTRO_MONTEVIDEO = [-34.9011, -56.1645];

export function monto(n, moneda = 'UYU') {
  if (n === null || n === undefined || n === '') return '';
  return `${moneda} ${Number(n).toLocaleString('es-UY', { maximumFractionDigits: 2 })}`;
}

export function escapar(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Celular uruguayo a formato internacional para WhatsApp: 099 123 456 -> 59899123456
export function telefonoInternacional(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('598')) return d;
  if (d.startsWith('0')) d = d.slice(1);
  return `598${d}`;
}

export function linkWhatsapp(tel, texto = '') {
  const n = telefonoInternacional(tel);
  if (!n) return '';
  return `https://wa.me/${n}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}

export function linkGoogleMaps(dir) {
  if (!dir) return '';
  if (dir.lat != null && dir.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${dir.lat},${dir.lng}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${dir.direccion}, Uruguay`)}`;
}

export function linkWaze(dir) {
  if (!dir) return '';
  if (dir.lat != null && dir.lng != null) return `https://waze.com/ul?ll=${dir.lat},${dir.lng}&navigate=yes`;
  return `https://waze.com/ul?q=${encodeURIComponent(`${dir.direccion}, Uruguay`)}&navigate=yes`;
}

// Ruta con varias paradas en Google Maps (sale desde donde estás)
export function linkRutaDelDia(direcciones) {
  const pts = direcciones
    .filter((d) => d && d.lat != null && d.lng != null)
    .map((d) => `${d.lat},${d.lng}`);
  if (pts.length === 0) return '';
  const destino = pts[pts.length - 1];
  const paradas = pts.slice(0, -1).slice(0, 9);
  let url = `https://www.google.com/maps/dir/?api=1&destination=${destino}&travelmode=driving`;
  if (paradas.length) url += `&waypoints=${encodeURIComponent(paradas.join('|'))}`;
  return url;
}

export function mensajeError(error) {
  if (!error) return '';
  const msg = error.message || String(error);
  // Límites del plan (SQL 05): el mensaje ya viene listo, con la sugerencia
  if (error.code === 'TL001' || error.code === 'TL002') return [msg, error.hint].filter(Boolean).join(' ');
  if (error.code === '23P01' || msg.includes('turnos_sin_superposicion')) {
    return 'Ya hay otro turno en ese horario para la misma persona.';
  }
  if (msg.includes('comision_menor_o_igual_al_precio')) return 'La comisión no puede ser mayor que el precio de la visita.';
  if (msg.includes('row-level security')) return 'No tenés permiso para hacer eso.';
  if (msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos.';
  if (msg.includes('Email not confirmed')) return 'Tenés que confirmar tu email antes de entrar. Revisá tu bandeja de entrada.';
  if (msg.includes('User already registered')) return 'Ya existe una cuenta con ese email.';
  if (msg.includes('Password should be')) return 'La contraseña debe tener al menos 6 caracteres.';
  if (msg.includes('Failed to fetch')) return 'No hay conexión con el servidor. Revisá tu internet.';
  return msg;
}
