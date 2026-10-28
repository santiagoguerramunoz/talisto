// Trabajos de clientes B2B (tabla ordenes)

export const ESTADOS_TRABAJO = {
  pendiente: { texto: 'Pendiente', clase: 'bg-amber-400/15 text-amber-300', punto: 'bg-amber-400' },
  en_curso: { texto: 'En curso', clase: 'bg-[#0a84ff]/20 text-[#8cc8ff]', punto: 'bg-[#0a84ff]' },
  suspendido: { texto: 'Suspendido', clase: 'bg-red-500/15 text-red-300', punto: 'bg-red-400' },
  multidia: { texto: 'Multi día', clase: 'bg-[#176ba8]/25 text-[#8cc4ee]', punto: 'bg-[#5aa9e6]' },
  finalizado: { texto: 'Finalizado', clase: 'bg-menta-500/15 text-menta-300', punto: 'bg-menta-400' },
  cancelado: { texto: 'Cancelado', clase: 'bg-navy-700 text-tinta-400', punto: 'bg-navy-500' },
};

// "realizado" es el nombre anterior de "finalizado"
export const estadoTrabajo = (estado) => (estado === 'realizado' ? 'finalizado' : estado || 'pendiente');
export const esFinalizado = (o) => estadoTrabajo(o?.estado) === 'finalizado';
export const ESTADOS_ABIERTOS = ['en_curso', 'suspendido', 'multidia'];
export const estaAbierto = (o) => ESTADOS_ABIERTOS.includes(estadoTrabajo(o?.estado));

export const identificadorTrabajo = (o) =>
  o?.numero_ticket ? `Tk ${o.numero_ticket}` : o?.numero_cliente ? `Cliente ${o.numero_cliente}` : 'Trabajo';
