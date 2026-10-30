import { supabase } from './supabase';

// Planes de TaListo! (los límites reales los controla la base: SQL 05)
export const NOMBRE_PLAN = { free: 'Free', pro: 'Pro', business: 'Business' };
export const ORDEN_PLAN = { free: 0, pro: 1, business: 2 };

export const esPro = (plan) => plan === 'pro' || plan === 'business';
export const esBusiness = (plan) => plan === 'business';

// Qué incluye cada plan (pantalla de planes y avisos)
export const FUNCIONES = [
  { texto: 'Agenda: turnos, horarios fijos y relevamientos', free: true, pro: true, business: true },
  { texto: 'Clientes B2B y B2C con sus direcciones', free: true, pro: true, business: true },
  { texto: 'Mapa con tu ubicación y la ruta del día', free: true, pro: true, business: true },
  { texto: 'Clientes que te encuentran y reservan visita', free: true, pro: true, business: true },
  { texto: 'Trabajos B2B con tiempo, puestas y liquidación', free: 'Hasta 2 empresas', pro: true, business: true },
  { texto: 'Planillas de liquidación en Excel', free: '6 por mes', pro: 'Sin límite', business: 'Sin límite' },
  { texto: 'Presupuestos en PDF con IVA', free: false, pro: true, business: true },
  { texto: 'Materiales con costo, proveedor y margen', free: false, pro: true, business: true },
  { texto: 'Mis gastos: movilidad, insumos, viáticos…', free: false, pro: true, business: true },
  { texto: 'Finanzas: ingresos, gastos y ganancia del mes', free: false, pro: true, business: true },
  { texto: 'Tu logo y los datos de tu negocio', free: false, pro: true, business: true },
  { texto: 'Proveedores: listas de precios, stock y órdenes de compra', free: false, pro: true, business: true },
  { texto: 'Empresa con cuentas para tu equipo y roles', free: false, pro: false, business: true },
  { texto: 'Invitaciones por email o QR y bloqueo de cuentas', free: false, pro: false, business: true },
  { texto: 'Tickets y rutas para tus operarios, en tiempo real', free: false, pro: false, business: true },
  { texto: 'Stock de la empresa y de cada operario', free: false, pro: false, business: 'Muy pronto' },
];

// Si todavía no se corrió el SQL 05, la app sigue funcionando como antes (todo habilitado)
const SIN_PLANES = {
  plan: 'pro',
  sinSql: true,
  origen: 'free',
  exportaciones_mes: 0,
  limite_exportaciones: null,
  limite_empresas_b2b: null,
};

export async function cargarPlan() {
  const { data, error } = await supabase.rpc('mi_plan');
  if (error) {
    // función inexistente (falta el SQL) o error de red: no bloquear a nadie por eso; la base igual controla
    return { ...SIN_PLANES, error: error.code === 'PGRST202' || error.code === '42883' ? null : error };
  }
  return { ...SIN_PLANES, ...data, sinSql: false };
}

// Errores de la base por el plan (TL001: función Pro · TL002: límite alcanzado)
export const errorDePlan = (e) => !!e && (e.code === 'TL001' || e.code === 'TL002');

// Registra una planilla exportada. Devuelve { ok, error, usadas, limite }
// cuenta: en una empresa, la cuenta principal (la planilla cuenta para ella)
export async function registrarExportacion(detalle, cuenta = null) {
  const args = { p_tipo: 'planilla', p_detalle: detalle || null };
  if (cuenta) args.p_cuenta = cuenta;
  const { data, error } = await supabase.rpc('registrar_exportacion', args);
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') return { ok: true };
    return { ok: false, error };
  }
  return { ok: true, usadas: data?.usadas, limite: data?.limite };
}

export function textoVencimiento(plan) {
  if (!plan?.vence_en) return null;
  return new Date(plan.vence_en).toLocaleDateString('es-UY', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function precioPlan(plan, cual) {
  const n = Number(cual === 'business' ? plan?.precio_business : plan?.precio_pro) || 0;
  return n > 0 ? `${plan?.moneda || 'UYU'} ${n.toLocaleString('es-UY')} / mes` : null;
}
