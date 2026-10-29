import { aplicarSuscripcion, mp, mpConfigurado, supabaseAdmin, usuarioDe } from '@/lib/servidor';

export const dynamic = 'force-dynamic';

const NOMBRES = { pro: 'Pro', business: 'Business' };
const sinCache = { 'Cache-Control': 'no-store, max-age=0' };
const responder = (datos, status = 200) => Response.json(datos, { status, headers: sinCache });

// ¿Está habilitada la suscripción con Mercado Pago?
export function GET() {
  return responder({ disponible: mpConfigurado() });
}

// Crea la suscripción y devuelve el link de pago de Mercado Pago
export async function POST(request) {
  if (!mpConfigurado()) return responder({ error: 'La suscripción con Mercado Pago todavía no está habilitada.' }, 503);
  const usuario = await usuarioDe(request);
  if (!usuario) return responder({ error: 'Tenés que iniciar sesión.' }, 401);

  const { plan, email } = await request.json().catch(() => ({}));
  if (!NOMBRES[plan]) return responder({ error: 'Plan no válido.' }, 400);
  const correo = String(email || usuario.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return responder({ error: 'Poné el email de tu cuenta de Mercado Pago.' }, 400);

  const db = supabaseAdmin();
  const { data: config } = await db.from('configuracion').select('*').eq('id', 1).maybeSingle();
  const precio = Number(plan === 'business' ? config?.precio_business : config?.precio_pro) || 0;
  if (precio <= 0) return responder({ error: 'TaListo! todavía no definió el precio de este plan.' }, 400);

  const origen = new URL(request.url).origin;
  let pre;
  try {
    pre = await mp('/preapproval', {
      method: 'POST',
      body: {
        reason: `TaListo! ${NOMBRES[plan]}`,
        external_reference: `${usuario.id}:${plan}`,
        payer_email: correo,
        auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: precio, currency_id: config?.moneda || 'UYU' },
        back_url: `${origen}/panel/planes?mp=volver`,
        status: 'pending',
      },
    });
  } catch (e) {
    console.error('MP preapproval', e.status, e.datos);
    return responder({ error: 'Mercado Pago no pudo crear la suscripción. Revisá el email e intentá de nuevo.' }, 502);
  }

  // Se guarda como pendiente (si ya tiene una autorizada, esa sigue vigente hasta que se autorice la nueva)
  const { data: actual } = await db.from('planes').select('mp_estado').eq('usuario_id', usuario.id).maybeSingle();
  if (actual?.mp_estado !== 'authorized') {
    await db.from('planes').upsert(
      { usuario_id: usuario.id, mp_preapproval_id: pre.id, mp_plan: plan, mp_estado: pre.status || 'pending', mp_email: correo },
      { onConflict: 'usuario_id' }
    );
  }
  return responder({ url: pre.init_point || pre.sandbox_init_point });
}

// Al volver de Mercado Pago (?preapproval_id=…): confirma el estado sin esperar el aviso
export async function PUT(request) {
  if (!mpConfigurado()) return responder({ error: 'La suscripción con Mercado Pago todavía no está habilitada.' }, 503);
  const usuario = await usuarioDe(request);
  if (!usuario) return responder({ error: 'Tenés que iniciar sesión.' }, 401);
  const { preapproval_id: id } = await request.json().catch(() => ({}));
  if (!id || !/^[\w-]{6,64}$/.test(String(id))) return responder({ error: 'Falta la suscripción.' }, 400);
  try {
    const pre = await mp(`/preapproval/${id}`);
    if (!String(pre.external_reference || '').startsWith(`${usuario.id}:`)) return responder({ error: 'Esa suscripción no es tuya.' }, 403);
    await aplicarSuscripcion(pre);
    return responder({ estado: pre.status });
  } catch (e) {
    console.error('MP verificar', e.status, e.message);
    return responder({ error: 'No pudimos confirmar el pago todavía.' }, 502);
  }
}

// Cancela la suscripción: el plan sigue hasta el final del período pago
export async function DELETE(request) {
  if (!mpConfigurado()) return responder({ error: 'La suscripción con Mercado Pago todavía no está habilitada.' }, 503);
  const usuario = await usuarioDe(request);
  if (!usuario) return responder({ error: 'Tenés que iniciar sesión.' }, 401);
  const db = supabaseAdmin();
  const { data: actual } = await db.from('planes').select('mp_preapproval_id, mp_estado').eq('usuario_id', usuario.id).maybeSingle();
  if (!actual?.mp_preapproval_id) return responder({ error: 'No tenés una suscripción activa.' }, 400);
  try {
    await mp(`/preapproval/${actual.mp_preapproval_id}`, { method: 'PUT', body: { status: 'cancelled' } });
  } catch (e) {
    console.error('MP cancelar', e.status, e.datos);
    return responder({ error: 'Mercado Pago no pudo cancelar la suscripción. Intentá de nuevo en unos minutos.' }, 502);
  }
  await db.from('planes').update({ mp_estado: 'cancelled' }).eq('usuario_id', usuario.id);
  return responder({ ok: true });
}
