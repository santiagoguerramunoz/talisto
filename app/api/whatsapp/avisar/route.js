// Manda por WhatsApp los avisos pendientes (técnico tomó el pedido, cotizaciones, pagos, visitas).
// La llama la base cuando hay avisos nuevos (pg_net); también salen con cada mensaje que llega y con la tarea diaria.
// No necesita clave: solo manda lo que ya está en la cola.
import { hayServicio, origenDe } from '@/lib/servidor';
import { enviarPendientes } from '@/lib/whatsappServidor';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function atender(request) {
  if (!hayServicio()) return Response.json({ ok: false, motivo: 'sin configurar' }, { status: 503 });
  const n = await enviarPendientes(origenDe(request)).catch((e) => {
    console.error('[whatsapp] avisos', e.message);
    return 0;
  });
  return Response.json({ ok: true, enviados: n });
}

export const POST = atender;
export const GET = atender;
