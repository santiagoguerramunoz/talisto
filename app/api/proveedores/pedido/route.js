// Manda la orden de compra al sistema del proveedor (si recibe pedidos por API).
import { clienteUsuario, hayServicio, supabaseAdmin } from '@/lib/servidor';
import { encabezadoClave, esUuid, traer } from '@/lib/servidorProveedores';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const sinCache = { 'Cache-Control': 'no-store, max-age=0' };
const responder = (datos, status = 200) => Response.json(datos, { status, headers: sinCache });
const corto = (v, n = 200) => (v === null || v === undefined ? null : String(v).slice(0, n));

export async function POST(request) {
  const { usuario, db } = await clienteUsuario(request);
  if (!usuario) return responder({ error: 'Tenés que iniciar sesión.' }, 401);
  const { orden_id: id, comprador = {}, reenviar = false } = await request.json().catch(() => ({}));
  if (!esUuid(id)) return responder({ error: 'Orden no válida.' }, 400);

  const { data: cfg, error } = await db.rpc('config_pedido', { p_orden: id });
  if (error || !cfg) return responder({ error: error?.message || 'No podés enviar esta orden.' }, 403);
  const { data: orden } = await db.from('ordenes_compra').select('*').eq('id', id).maybeSingle();
  if (!orden) return responder({ error: 'No encontramos la orden.' }, 404);
  if (orden.estado === 'cancelada') return responder({ error: 'La orden está cancelada.' }, 400);
  if (orden.envio?.ok && !reenviar) return responder({ error: 'Esta orden ya se mandó al proveedor.', yaEnviada: true }, 409);

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (cfg.tiene_clave) {
    if (!hayServicio()) return responder({ error: 'Para usar la clave de la API falta cargar SUPABASE_SERVICE_ROLE_KEY en Vercel.' }, 503);
    const { data: clave } = await supabaseAdmin().rpc('clave_proveedor', { p_proveedor: cfg.proveedor_id });
    Object.assign(headers, encabezadoClave(cfg.auth_header, clave));
  }

  const pedido = {
    tipo: 'orden_de_compra',
    origen: 'TaListo!',
    id: orden.id,
    numero: orden.numero,
    fecha: orden.fecha,
    moneda: orden.moneda,
    iva_incluido: orden.iva_incluido,
    comprador: {
      nombre: corto(comprador.nombre),
      razon_social: corto(comprador.razon_social),
      rut: corto(comprador.rut, 30),
      telefono: corto(comprador.telefono, 40),
      email: corto(comprador.email, 120),
      direccion: corto(comprador.direccion),
    },
    entrega: corto(orden.entrega, 500),
    notas: corto(orden.notas, 2000),
    items: (orden.items || []).map((i) => ({
      codigo: i.codigo || null,
      descripcion: i.item,
      cantidad: Number(i.cantidad) || 0,
      unidad: i.unidad || 'u',
      precio_unitario: Number(i.precio) || 0,
    })),
    subtotal: Number(orden.subtotal) || 0,
  };

  let envio;
  try {
    const r = await traer(cfg.pedido_url, { metodo: 'POST', headers, cuerpo: JSON.stringify(pedido), max: 256 * 1024, espera: 15000 });
    const texto = new TextDecoder().decode(r.bytes).slice(0, 500);
    envio = { ok: r.status >= 200 && r.status < 300, status: r.status, en: new Date().toISOString(), respuesta: texto };
  } catch (e) {
    envio = { ok: false, status: 0, en: new Date().toISOString(), respuesta: e?.message || 'No pudimos conectarnos con el proveedor.' };
  }
  const cambios = { envio };
  if (envio.ok && orden.estado === 'borrador') cambios.estado = 'enviada';
  await db.from('ordenes_compra').update(cambios).eq('id', id);
  if (!envio.ok) {
    const msg = envio.status ? `El proveedor no recibió la orden (respondió ${envio.status}).` : envio.respuesta;
    return responder({ error: msg, envio }, 502);
  }
  return responder({ ok: true, envio });
}
