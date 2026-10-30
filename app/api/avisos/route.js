// Manda por push los avisos que generó quien hace el pedido (asignaciones, cierres, stock, cotizaciones).
// La base decide quién recibe cada aviso; acá solo se entregan a sus celulares y computadoras.
import { clienteUsuario } from '@/lib/servidor';
import { clavesVapid, enviarPush } from '@/lib/webpush';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const sinCache = { 'Cache-Control': 'no-store, max-age=0' };
const responder = (datos, status = 200) => Response.json(datos, { status, headers: sinCache });

export async function GET() {
  // la app pregunta si las notificaciones al celular están activas
  return responder({ push: !!clavesVapid() });
}

export async function POST(request) {
  const vapid = clavesVapid();
  if (!vapid) return responder({ push: false });
  const { usuario, db } = await clienteUsuario(request);
  if (!usuario) return responder({ error: 'Tenés que iniciar sesión.' }, 401);

  const { data, error } = await db.rpc('avisos_para_push');
  if (error) return responder({ push: true, enviados: 0 });
  const envios = [];
  for (const aviso of data || []) {
    for (const sub of aviso.subs || []) {
      envios.push({ sub, datos: { titulo: aviso.titulo, cuerpo: aviso.cuerpo || '', url: aviso.url || '/panel', tag: `${aviso.tipo}-${aviso.id}` } });
    }
  }
  let enviados = 0;
  const vencidos = new Set();
  for (let i = 0; i < envios.length; i += 6) {
    const tanda = await Promise.all(envios.slice(i, i + 6).map((e) => enviarPush(e.sub, e.datos, vapid)));
    tanda.forEach((r, k) => {
      if (r.ok) enviados += 1;
      if (r.borrar) vencidos.add(envios[i + k].sub.endpoint);
    });
  }
  await Promise.all([...vencidos].map((endpoint) => db.rpc('quitar_suscripcion_push', { p_endpoint: endpoint })));
  return responder({ push: true, avisos: (data || []).length, enviados });
}
