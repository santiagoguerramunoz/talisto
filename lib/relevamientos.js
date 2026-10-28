import { fechaCorta, horaHHMM } from './fechas';

export const ESTADOS_RELEVAMIENTO = {
  pendiente: { texto: 'Pendiente', clase: 'bg-amber-400/15 text-amber-300' },
  relevado: { texto: 'Relevado', clase: 'bg-menta-500/15 text-menta-300' },
  presupuestado: { texto: 'Presupuestado', clase: 'bg-[#176ba8]/25 text-[#8cc4ee]' },
  descartado: { texto: 'Descartado', clase: 'bg-navy-700 text-tinta-400' },
};

export const CAMPOS_RELEVAMIENTO =
  'id, turno_id, cliente_id, direccion_id, pedido, estado, notas, medidas, materiales, horas_estimadas, costo_estimado, fotos, relevado_en, creado_en, actualizado_en, ' +
  'turnos(*), clientes(id, nombre, color, telefono), direcciones(id, etiqueta, direccion, referencia, lat, lng)';

// "Mar 3/11 · entre 09:00 y 13:00"
export function textoCuando(turno) {
  if (!turno) return 'Sin fecha en la agenda';
  const dia = fechaCorta(turno.inicio);
  return turno.flexible
    ? `${dia} · entre ${horaHHMM(turno.inicio)} y ${horaHHMM(turno.fin)}`
    : `${dia} · ${horaHHMM(turno.inicio)}–${horaHHMM(turno.fin)}`;
}

export const CARPETA_FOTOS = 'relevamientos';
