// Webhook de WhatsApp (Meta): verificación y mensajes que escriben los clientes.
// URL para configurar en Meta: https://<tu-dominio>/api/whatsapp  (campo "messages")
import { hayServicio, origenDe } from '@/lib/servidor';
import { firmaMetaValida, whatsappConfigurado } from '@/lib/whatsapp';
import { atenderMensaje, enviarPendientes } from '@/lib/whatsappServidor';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Meta verifica la URL una vez con hub.challenge
export function GET(request) {
  const u = new URL(request.url);
  const ok = u.searchParams.get('hub.mode') === 'subscribe' && process.env.WHATSAPP_VERIFY_TOKEN
    && u.searchParams.get('hub.verify_token') === process.env.WHATSAPP_VERIFY_TOKEN;
  if (ok) return new Response(u.searchParams.get('hub.challenge') || '', { status: 200 });
  return Response.json({ ok: true, servicio: 'WhatsApp de TaListo!', configurado: whatsappConfigurado() }, { status: u.searchParams.has('hub.mode') ? 403 : 200 });
}

export async function POST(request) {
  const cuerpo = await request.text();
  if (!firmaMetaValida(cuerpo, request.headers.get('x-hub-signature-256'))) return Response.json({ ok: false }, { status: 401 });
  if (!whatsappConfigurado() || !hayServicio()) return Response.json({ ok: false, motivo: 'sin configurar' });
  let datos;
  try {
    datos = JSON.parse(cuerpo);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const origen = origenDe(request);
  for (const entrada of datos.entry || []) {
    for (const cambio of entrada.changes || []) {
      const v = cambio.value || {};
      for (const m of v.messages || []) {
        const contacto = (v.contacts || []).find((c) => c.wa_id === m.from);
        try {
          await atenderMensaje(m, contacto?.profile?.name, origen);
        } catch (e) {
          console.error('[whatsapp] mensaje', m.id, e.message);
        }
      }
    }
  }
  await enviarPendientes(origen).catch((e) => console.error('[whatsapp] avisos', e.message));
  // siempre 200: si no, Meta reintenta el mismo mensaje
  return Response.json({ ok: true });
}
