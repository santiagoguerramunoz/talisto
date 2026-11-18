// Admin: responder a mano una conversación de WhatsApp (o devolvérsela al bot).
import { clienteUsuario, supabaseAdmin } from '@/lib/servidor';
import { enviar, enviarPlantilla, whatsappConfigurado } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { usuario, db } = await clienteUsuario(request);
  if (!usuario) return Response.json({ error: 'Tenés que iniciar sesión.' }, { status: 401 });
  const { data: yo } = await db.from('perfiles').select('es_admin').eq('id', usuario.id).maybeSingle();
  if (!yo?.es_admin) return Response.json({ error: 'Solo para administradores.' }, { status: 403 });

  const { conversacion, texto, bot } = await request.json().catch(() => ({}));
  const admin = supabaseAdmin();
  const { data: conv } = await admin.from('wa_conversaciones').select('*').eq('id', conversacion).maybeSingle();
  if (!conv) return Response.json({ error: 'No encontramos la conversación.' }, { status: 404 });
  if (bot) {
    await admin.from('wa_conversaciones').update({ humano: false, paso: 'inicio', datos: {} }).eq('id', conv.id);
    return Response.json({ ok: true });
  }
  const t = String(texto || '').trim().slice(0, 4000);
  if (!t) return Response.json({ error: 'Escribí el mensaje.' }, { status: 400 });
  if (!whatsappConfigurado()) return Response.json({ error: 'WhatsApp todavía no está configurado en Vercel.' }, { status: 503 });
  try {
    const dentro24 = conv.ultimo_entrante && Date.now() - new Date(conv.ultimo_entrante).getTime() < 23.5 * 3600e3;
    const r = dentro24 ? await enviar(conv.telefono, { texto: t }) : await enviarPlantilla(conv.telefono, t);
    await admin.from('wa_mensajes').insert({ conversacion_id: conv.id, direccion: 'saliente', texto: t, tipo: 'persona', wa_id: r?.messages?.[0]?.id || null, datos: { admin: usuario.id } });
    await admin.from('wa_conversaciones').update({ humano: true }).eq('id', conv.id);
    return Response.json({ ok: true, plantilla: !dentro24 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }
}
