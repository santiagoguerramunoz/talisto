// TaListo! Match: vence reservas sin pagar, confirma las visitas que el cliente no respondió y manda los avisos pendientes
// (al celular y por WhatsApp). La llama Supabase cada minuto (pg_cron, SQL 27) con la llave que guarda en la base,
// y Vercel una vez por día (con CRON_SECRET si está cargada). También corre sola cuando alguien abre Match.
import { hayServicio, origenDe, pushSistema, supabaseAdmin } from '@/lib/servidor';
import { enviarPendientes } from '@/lib/whatsappServidor';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const secreto = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') || '';
  let esCron = secreto ? auth === `Bearer ${secreto}` : (request.headers.get('user-agent') || '').includes('vercel-cron');
  if (!hayServicio()) return Response.json({ ok: false, motivo: 'sin configurar' }, { status: 503 });
  if (!esCron && auth.startsWith('Bearer ')) {
    const { data: valida } = await supabaseAdmin().rpc('cron_llave_valida', { p_llave: auth.slice(7) });
    esCron = valida === true;
  }
  if (!esCron) return Response.json({ ok: false }, { status: 401 });
  const { data, error } = await supabaseAdmin().rpc('match_procesar_vencidos');
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const push = await pushSistema().catch(() => 0);
  const whatsapp = await enviarPendientes(origenDe(request)).catch(() => 0);
  return Response.json({ ok: true, ...data, push, whatsapp });
}
