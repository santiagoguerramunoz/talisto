// TaListo! Match: el admin aprueba una devolución y se hace en Mercado Pago (sobre el pago original).
// La base controla que sea admin y el monto; la misma devolución nunca se manda dos veces.
import { clienteUsuario, mp, mpConfigurado, pushSistema, supabaseAdmin } from '@/lib/servidor';

export const dynamic = 'force-dynamic';

const responder = (datos, status = 200) => Response.json(datos, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request) {
  const { usuario, db } = await clienteUsuario(request);
  if (!usuario) return responder({ error: 'Tenés que iniciar sesión.' }, 401);
  const { devolucion, monto, nota } = await request.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/i.test(String(devolucion || ''))) return responder({ error: 'Devolución no válida.' }, 400);
  if (!mpConfigurado()) return responder({ error: 'Mercado Pago no está configurado (MP_ACCESS_TOKEN).' }, 503);

  const { data: d, error } = await db.rpc('admin_aprobar_devolucion', {
    p_id: devolucion,
    p_monto: monto === undefined || monto === null || monto === '' ? null : Number(monto),
    p_nota: nota || null,
  });
  if (error) return responder({ error: error.message }, 400);
  if (!d?.mp_pago_id) return responder({ error: 'La operación no tiene un pago de Mercado Pago para devolver.' }, 400);

  const admin = supabaseAdmin();
  try {
    const r = await mp(`/v1/payments/${d.mp_pago_id}/refunds`, {
      method: 'POST',
      idempotencia: `match-refund-${d.id}`,
      body: { amount: Number(d.monto) },
    });
    const { data: res, error: e2 } = await admin.rpc('match_devolucion_resultado', { p_id: d.id, p_ok: true, p_refund_id: String(r.id || '') });
    if (e2) throw new Error(e2.message);
    await pushSistema().catch(() => {});
    return responder({ ok: true, resultado: res?.resultado, refund: r.id });
  } catch (e) {
    const msg = e.datos?.message || e.message || 'Mercado Pago no respondió';
    console.error('[match] devolución', d.id, e.status, e.datos || e.message);
    await admin.rpc('match_devolucion_resultado', { p_id: d.id, p_ok: false, p_refund_id: null, p_error: msg }).catch(() => {});
    return responder({ error: `Mercado Pago no hizo la devolución: ${msg}` }, 502);
  }
}
