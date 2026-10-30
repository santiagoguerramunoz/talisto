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

// Texto para avisarle al cliente por WhatsApp (recordatorio o el día que se sigue)
const DIAS_TXT = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export function textoRecordatorio({ negocio = '', cliente = '', fechaIso, hora = '', sigue = false }) {
  const [a, m, d] = String(fechaIso || '').split('-').map(Number);
  const f = a ? new Date(a, m - 1, d) : null;
  const dia = f ? `el ${DIAS_TXT[f.getDay()]} ${f.getDate()}/${f.getMonth() + 1}` : 'pronto';
  const nombre = String(cliente || '').trim().split(/\s+/)[0];
  return `Hola${nombre ? ` ${nombre}` : ''}! Te escribimos de ${negocio || 'la empresa'}. ${sigue ? 'Seguimos con el trabajo' : 'Te recordamos la visita'} ${dia}${hora ? ` a las ${String(hora).slice(0, 5)}` : ''}. Si necesitás cambiar algo, respondé este mensaje. ¡Gracias!`;
}
