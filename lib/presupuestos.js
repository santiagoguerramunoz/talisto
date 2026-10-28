import { numero, limpiarMateriales } from './precios';

export const ESTADOS_PRESUPUESTO = {
  borrador: { texto: 'Borrador', clase: 'bg-navy-700 text-tinta-300' },
  enviado: { texto: 'Enviado', clase: 'bg-[#176ba8]/25 text-[#8cc4ee]' },
  aceptado: { texto: 'Aceptado', clase: 'bg-menta-500/15 text-menta-300' },
  rechazado: { texto: 'Rechazado', clase: 'bg-red-500/15 text-red-300' },
};

export const numeroPresupuesto = (n) => String(n || 0).padStart(4, '0');

export function sumarDiasISO(iso, dias) {
  const [a, m, d] = String(iso).split('-').map(Number);
  const f = new Date(a, m - 1, d + Number(dias || 0));
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
}

export const fechaUY = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

// Datos base de un presupuesto nuevo, con los ajustes del profesional
export function presupuestoNuevo({ profesionalId, ajustes, cliente, relevamiento, lugar, items = [], manoObra = null, titulo = '' }) {
  return {
    profesional_id: profesionalId,
    cliente_id: cliente?.id || null,
    relevamiento_id: relevamiento?.id || null,
    cliente_nombre: cliente?.nombre || null,
    cliente_direccion: lugar?.direccion || null,
    titulo: titulo || null,
    items: limpiarMateriales(items),
    mano_obra: numero(manoObra),
    mano_obra_texto: 'Mano de obra',
    iva_porcentaje: numero(ajustes?.iva_porcentaje) ?? 22,
    validez_dias: Number(ajustes?.validez_presupuesto) || 15,
    notas: ajustes?.condiciones_presupuesto || null,
  };
}
