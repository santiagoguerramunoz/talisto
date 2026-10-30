import { supabase } from './supabase';

// Permisos que puede tener un rol de la empresa (los controla la base: SQL 06)
export const PERMISOS = [
  { id: 'agenda', texto: 'Agenda de la empresa', detalle: 'Ver y organizar turnos, horarios fijos y relevamientos. Incluye los montos de los turnos.' },
  { id: 'clientes', texto: 'Clientes', detalle: 'Ver, cargar y editar clientes y sus direcciones.' },
  { id: 'relevamientos', texto: 'Relevamientos', detalle: 'Cargar relevamientos con materiales y fotos.' },
  { id: 'tickets_asignar', texto: 'Agendar tickets', detalle: 'Crear tickets B2B y asignarlos al personal. Incluye los importes de los trabajos.' },
  { id: 'tickets_trabajar', texto: 'Trabajar en tickets', detalle: 'Iniciarse en un cliente, ticket o relevamiento asignado y finalizarlo, sin ver importes.' },
  { id: 'presupuestos', texto: 'Presupuestos', detalle: 'Hacer y enviar presupuestos a los clientes.' },
  { id: 'importes', texto: 'Importes y ganancias', detalle: 'Ver la facturación, los ingresos y las ganancias en Finanzas.' },
  { id: 'gastos', texto: 'Gastos', detalle: 'Ver y cargar los gastos de la empresa.' },
  { id: 'compras', texto: 'Compras', detalle: 'Proveedores, listas de precios y órdenes de compra. Ve el stock y recibe las compras.' },
  { id: 'stock', texto: 'Stock y depósito', detalle: 'Mover el stock: ingresos, entregas al equipo, materiales a los trabajos, devoluciones, conteos y bajas.' },
  { id: 'equipo', texto: 'Equipo', detalle: 'Invitar cuentas y asignar o bloquear roles.' },
  { id: 'comisiones', texto: 'Comisiones', detalle: 'Asignar el % de comisión de cada vendedor, editar las comisiones y marcarlas como pagadas (Gerencia general).' },
];
export const TEXTO_PERMISO = Object.fromEntries(PERMISOS.map((p) => [p.id, p.texto]));

// Qué permisos habilitan cada sección del menú cuando se trabaja en una empresa
export const SECCIONES = {
  '/panel': ['agenda', 'tickets_trabajar'],
  '/panel/equipo': ['tickets_asignar', 'agenda'],
  '/panel/relevamientos': ['relevamientos'],
  '/panel/clientes': ['clientes'],
  '/panel/mapa': ['agenda'],
  '/panel/finanzas': ['importes', 'presupuestos', 'gastos', 'tickets_asignar', 'compras', 'stock', 'comisiones'],
  '/panel/perfil': null, // siempre
};

export const tiene = (permisos, alguno) => !alguno || alguno.some((p) => (permisos || []).includes(p));

const CLAVE_ESPACIO = 'talisto_espacio';
const CLAVE_INVITACION = 'talisto_invitacion';

function leer(clave) {
  try {
    return window.localStorage.getItem(clave) || '';
  } catch {
    return '';
  }
}
function escribir(clave, valor) {
  try {
    if (valor) window.localStorage.setItem(clave, valor);
    else window.localStorage.removeItem(clave);
  } catch {
    /* sin almacenamiento: queda en Personal */
  }
}
export const espacioGuardado = () => leer(CLAVE_ESPACIO);
export const guardarEspacio = (id) => escribir(CLAVE_ESPACIO, id || '');
export const invitacionPendiente = () => leer(CLAVE_INVITACION);
export const guardarInvitacion = (codigo) => escribir(CLAVE_INVITACION, codigo || '');

const sinFuncion = (e) => !!e && (e.code === 'PGRST202' || e.code === '42883');

// Empresas en las que estoy, la mía (si soy la cuenta principal) e invitaciones para mi email
export async function cargarEspacios() {
  const [m, mia, inv] = await Promise.all([supabase.rpc('mis_empresas'), supabase.rpc('mi_empresa'), supabase.rpc('mis_invitaciones')]);
  if (sinFuncion(m.error)) return { disponible: false, empresas: [], miEmpresa: null, invitaciones: [] };
  return {
    disponible: true,
    empresas: m.data || [],
    miEmpresa: mia.data || null,
    invitaciones: inv.data || [],
  };
}

export const usable = (e) => e && e.estado === 'activo' && e.activa && (e.permisos || []).length > 0;

export function linkInvitacion(codigo) {
  const origen = typeof window !== 'undefined' ? window.location.origin : 'https://talisto-ashen.vercel.app';
  return `${origen}/unirme?c=${encodeURIComponent(codigo)}`;
}

export function textoInvitacion(empresa, link) {
  return `Te invito a sumarte a ${empresa} en TaListo!. Entrá con este link y aceptá la invitación: ${link}`;
}
