import { aplicarSuscripcion, firmaValida, mp, mpConfigurado } from '@/lib/servidor';

export const dynamic = 'force-dynamic';

// Notificaciones de Mercado Pago (Tus integraciones > Webhooks > "Planes y suscripciones")
// URL: https://<tu-dominio>/api/mercadopago/webhook
export async function POST(request) {
  const url = new URL(request.url);
  const cuerpo = await request.json().catch(() => ({}));
  const tipo = cuerpo.type || cuerpo.topic || url.searchParams.get('type') || url.searchParams.get('topic');
  const id = url.searchParams.get('data.id') || cuerpo?.data?.id || url.searchParams.get('id');

  if (!mpConfigurado()) return Response.json({ ok: false, motivo: 'sin configurar' }, { status: 503 });
  if (!id) return Response.json({ ok: true, ignorado: 'sin id' });
  if (!firmaValida(request, id)) return Response.json({ ok: false, motivo: 'firma' }, { status: 401 });

  try {
    if (tipo === 'subscription_preapproval' || tipo === 'preapproval') {
      await aplicarSuscripcion(await mp(`/preapproval/${id}`));
    } else if (tipo === 'subscription_authorized_payment' || tipo === 'authorized_payment') {
      const pago = await mp(`/authorized_payments/${id}`);
      if (pago?.preapproval_id) await aplicarSuscripcion(await mp(`/preapproval/${pago.preapproval_id}`));
    }
  } catch (e) {
    console.error('Webhook Mercado Pago', tipo, id, e.message);
    return Response.json({ ok: false }, { status: 500 }); // Mercado Pago reintenta
  }
  return Response.json({ ok: true });
}

export function GET() {
  return Response.json({ ok: true, servicio: 'webhook Mercado Pago de TaListo!' });
}
