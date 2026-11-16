// TaListo! Match: una vez por día vence reservas sin pagar y confirma las visitas que el cliente no respondió.
// (También corre sola cuando alguien abre Match.) Vercel la llama con CRON_SECRET.
import { hayServicio, pushSistema, supabaseAdmin } from '@/lib/servidor';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const secreto = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') || '';
  const esCron = secreto ? auth === `Bearer ${secreto}` : (request.headers.get('user-agent') || '').includes('vercel-cron');
  if (!esCron) return Response.json({ ok: false }, { status: 401 });
  if (!hayServicio()) return Response.json({ ok: false, motivo: 'sin configurar' }, { status: 503 });
  const { data, error } = await supabaseAdmin().rpc('match_procesar_vencidos');
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const push = await pushSistema().catch(() => 0);
  return Response.json({ ok: true, ...data, push });
}
