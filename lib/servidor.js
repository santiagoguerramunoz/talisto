// Solo para el servidor (rutas /api). Nunca importar desde una página.
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const ORDEN_PLAN = { free: 0, pro: 1, business: 2 };

// Mercado Pago queda activo cuando están cargadas en Vercel:
//   MP_ACCESS_TOKEN (credencial de producción) y SUPABASE_SERVICE_ROLE_KEY
export function mpConfigurado() {
  return !!(process.env.MP_ACCESS_TOKEN && process.env.SUPABASE_SERVICE_ROLE_KEY && URL_SB);
}

export function supabaseAdmin() {
  return createClient(URL_SB, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Usuario que hace el pedido (token de sesión en Authorization: Bearer …)
export async function usuarioDe(request) {
  const h = request.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token || !URL_SB || !ANON) return null;
  const cliente = createClient(URL_SB, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await cliente.auth.getUser(token);
  return error ? null : data.user;
}

// Cliente de Supabase que actúa como el usuario que hace el pedido (respeta sus permisos)
export async function clienteUsuario(request) {
  const h = request.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token || !URL_SB || !ANON) return { usuario: null, db: null };
  const db = createClient(URL_SB, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await db.auth.getUser(token);
  return error || !data?.user ? { usuario: null, db: null } : { usuario: data.user, db };
}

export const hayServicio = () => !!(process.env.SUPABASE_SERVICE_ROLE_KEY && URL_SB);

export async function mp(ruta, { method = 'GET', body, idempotencia } = {}) {
  const r = await fetch(`https://api.mercadopago.com${ruta}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      // la misma clave hace que un reintento no cobre ni devuelva dos veces
      ...(method === 'POST' ? { 'X-Idempotency-Key': idempotencia || crypto.randomUUID() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(datos.message || `Mercado Pago respondió ${r.status}`);
    e.status = r.status;
    e.datos = datos;
    throw e;
  }
  return datos;
}

// Firma de las notificaciones de Mercado Pago (si está MP_WEBHOOK_SECRET).
// Sin la clave igual es seguro: el estado real siempre se consulta a la API de Mercado Pago.
export function firmaValida(request, idDato) {
  const secreto = process.env.MP_WEBHOOK_SECRET;
  if (!secreto) return true;
  const firma = request.headers.get('x-signature') || '';
  const pedido = request.headers.get('x-request-id') || '';
  const partes = Object.fromEntries(firma.split(',').map((p) => p.trim().split('=')));
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-z0-9]+$/i.test(String(idDato || '')) ? String(idDato).toLowerCase() : String(idDato || '');
  let manifiesto = '';
  if (id) manifiesto += `id:${id};`;
  if (pedido) manifiesto += `request-id:${pedido};`;
  manifiesto += `ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', secreto).update(manifiesto).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(partes.v1));
  } catch {
    return false;
  }
}

// Aplica el estado de una suscripción (preapproval) de Mercado Pago al plan del usuario
export async function aplicarSuscripcion(pre) {
  const [usuarioId, planPedido] = String(pre?.external_reference || '').split(':');
  if (!usuarioId || !['pro', 'business'].includes(planPedido)) return { ignorado: 'referencia' };
  const db = supabaseAdmin();
  const { data: actual } = await db.from('planes').select('*').eq('usuario_id', usuarioId).maybeSingle();
  const autorizada = pre.status === 'authorized';
  const esLaActual = !actual?.mp_preapproval_id || actual.mp_preapproval_id === pre.id;

  // Un aviso viejo de otra suscripción (que no está autorizada) no cambia nada
  if (!autorizada && !esLaActual) return { ignorado: 'otra suscripcion' };

  const proximo = pre.next_payment_date ? new Date(pre.next_payment_date) : null;
  const cambios = {
    usuario_id: usuarioId,
    mp_preapproval_id: pre.id,
    mp_plan: planPedido,
    mp_estado: pre.status,
    mp_email: pre.payer_email || actual?.mp_email || null,
    mp_proximo_cobro: proximo ? proximo.toISOString() : null,
  };
  const regaloVigente =
    actual?.origen === 'regalo' &&
    (!actual.vence_en || new Date(actual.vence_en) > new Date()) &&
    (ORDEN_PLAN[actual.plan] ?? 0) >= ORDEN_PLAN[planPedido];

  if (autorizada && !regaloVigente) {
    // Vale hasta el próximo cobro + 3 días de gracia
    const base = proximo || new Date(Date.now() + 31 * 864e5);
    Object.assign(cambios, { plan: planPedido, origen: 'mercadopago', vence_en: new Date(base.getTime() + 3 * 864e5).toISOString() });
  }
  // Pausada o cancelada: sigue el período ya pagado (vence_en no se toca)

  const { error } = await db.from('planes').upsert(cambios, { onConflict: 'usuario_id' });
  if (error) throw new Error(error.message);

  // Si cambió de suscripción (ej. de Pro a Business), se cancela la anterior para no cobrar dos veces
  if (autorizada && actual?.mp_preapproval_id && actual.mp_preapproval_id !== pre.id && actual.mp_estado === 'authorized') {
    await mp(`/preapproval/${actual.mp_preapproval_id}`, { method: 'PUT', body: { status: 'cancelled' } }).catch(() => {});
  }
  return { ok: true };
}

// Dirección pública de la app (para volver de Mercado Pago y recibir sus avisos)
export function origenDe(request) {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/$/, '');
  const h = request.headers;
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

// Pago de TaListo! Match consultado a Mercado Pago → se aplica en la base (idempotente)
export async function aplicarPagoMatch(pago) {
  const ref = String(pago?.external_reference || '');
  if (!ref.startsWith('match:')) return { ignorado: 'referencia' };
  const op = ref.slice(6);
  if (!/^[0-9a-f-]{36}$/i.test(op)) return { ignorado: 'referencia' };
  // costo de Mercado Pago que paga TaListo! (no se guarda nada de la tarjeta)
  const costo = (pago.fee_details || []).filter((f) => !f.fee_payer || f.fee_payer === 'collector').reduce((s, f) => s + Number(f.amount || 0), 0);
  const db = supabaseAdmin();
  const { data, error } = await db.rpc('match_aplicar_pago', {
    p_op: op,
    p: {
      id: String(pago.id),
      status: pago.status,
      status_detail: pago.status_detail,
      transaction_amount: pago.transaction_amount,
      currency_id: pago.currency_id,
      external_reference: ref,
      fee: Math.round(costo * 100) / 100,
      date_approved: pago.date_approved,
    },
  });
  if (error) throw new Error(error.message);
  await pushSistema().catch(() => {});
  return data;
}

// Manda por push los avisos que generó el sistema (sin un usuario detrás)
export async function pushSistema() {
  const { clavesVapid, enviarPush } = await import('./webpush');
  const vapid = clavesVapid();
  if (!vapid || !hayServicio()) return 0;
  const db = supabaseAdmin();
  const { data } = await db.rpc('avisos_para_push_sistema');
  let n = 0;
  for (const aviso of data || []) {
    for (const sub of aviso.subs || []) {
      const r = await enviarPush(sub, { titulo: aviso.titulo, cuerpo: aviso.cuerpo || '', url: aviso.url || '/', tag: `${aviso.tipo}-${aviso.id}` }, vapid);
      if (r.ok) n += 1;
    }
  }
  return n;
}
