// TaListo! Match: arma el pago de Mercado Pago (Checkout Pro) de una operación del cliente.
// El importe sale de la base (nunca del navegador) y el pago se confirma solo con el aviso de Mercado Pago.
import { clienteUsuario, mp, mpConfigurado, origenDe, supabaseAdmin } from '@/lib/servidor';

export const dynamic = 'force-dynamic';

const responder = (datos, status = 200) => Response.json(datos, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request) {
  const { usuario, db } = await clienteUsuario(request);
  if (!usuario) return responder({ error: 'Tenés que iniciar sesión.' }, 401);
  const { operacion } = await request.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/i.test(String(operacion || ''))) return responder({ error: 'Operación no válida.' }, 400);

  // valida que sea del usuario, que esté para pagar y que no se haya vencido
  const { data: op, error } = await db.rpc('operacion_a_pagar', { p_op: operacion });
  if (error) return responder({ error: error.message }, 400);
  if (!mpConfigurado()) {
    return responder({ error: 'Los pagos con Mercado Pago todavía no están activos en TaListo!. Probá más tarde.' }, 503);
  }

  const origen = origenDe(request);
  const volver = (estado) => `${origen}/match/solicitud/${op.solicitud}?pago=${estado}`;
  try {
    const pref = await mp('/checkout/preferences', {
      method: 'POST',
      body: {
        items: [{ id: op.id, title: op.titulo, description: `TaListo! Match · ${op.profesional || 'el primero disponible'}`, quantity: 1, unit_price: Number(op.importe), currency_id: 'UYU' }],
        external_reference: `match:${op.id}`,
        payer: op.email ? { email: op.email } : undefined,
        back_urls: { success: volver('ok'), failure: volver('error'), pending: volver('pendiente') },
        auto_return: 'approved',
        notification_url: `${origen}/api/mercadopago/webhook?source_news=webhooks`,
        binary_mode: true, // aprobado o rechazado: sin pagos en efectivo que lleguen tarde
        expires: true,
        expiration_date_to: op.vence,
        statement_descriptor: 'TALISTO',
      },
    });
    await supabaseAdmin().rpc('match_guardar_preferencia', { p_op: op.id, p_pref: pref.id });
    return responder({ url: pref.init_point });
  } catch (e) {
    console.error('[match] preferencia', op.id, e.status, e.datos || e.message);
    return responder({ error: 'Mercado Pago no respondió. Probá de nuevo en un momento.' }, 502);
  }
}
