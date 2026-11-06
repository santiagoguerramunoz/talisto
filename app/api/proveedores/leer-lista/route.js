// Lee una tanda (unas páginas del PDF o una foto) de la lista de precios de un proveedor con IA.
// La app manda la lista de a tandas; la primera abre la lectura y las demás la siguen.
// No carga nada: los productos se cargan después de revisarlos, con la importación de siempre.
// El plan, el permiso, el tope y los reintentos los controla la base (SQL 18) con el usuario que lo pide.
import { pedirJsonGemini } from '@/lib/gemini';
import { ESQUEMA_LISTA, SISTEMA_LISTA, limpiarLista, pedidoLista } from '@/lib/listasIA';
import { clienteUsuario } from '@/lib/servidor';

export const dynamic = 'force-dynamic';
export const maxDuration = 180; // Gemini gratis puede tardar: ver lib/gemini.js

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BASE64 = 4_000_000; // el pedido entero tiene que pasar los 4,5 MB de Vercel

const sinCache = { 'Cache-Control': 'no-store, max-age=0' };
const responder = (datos, status = 200) => Response.json(datos, { status, headers: sinCache });
const esUuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
const entero = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);

export async function POST(request) {
  const { usuario, db } = await clienteUsuario(request);
  if (!usuario) return responder({ error: 'Tenés que iniciar sesión.', fatal: true }, 401);
  if (!process.env.GEMINI_API_KEY) {
    return responder({ error: 'La lectura con IA todavía no está activada: falta cargar GEMINI_API_KEY en Vercel.', fatal: true }, 503);
  }

  const cuerpo = await request.json().catch(() => ({}));
  const { proveedor_id: proveedor } = cuerpo;
  if (!esUuid(proveedor)) return responder({ error: 'Proveedor no válido.', fatal: true }, 400);
  let lectura = esUuid(cuerpo.lectura) ? cuerpo.lectura : null;
  const tandas = entero(cuerpo.tandas, 1, 40);
  if (!lectura && !tandas) return responder({ error: 'La lista tiene que ir en 1 a 40 tandas.', fatal: true }, 400);
  const archivos = (Array.isArray(cuerpo.archivos) ? cuerpo.archivos : []).filter(
    (a) => a && TIPOS.includes(a.tipo) && typeof a.datos === 'string' && /^[A-Za-z0-9+/=]+$/.test(a.datos.slice(0, 200))
  );
  if (archivos.length !== 1) return responder({ error: 'Cada tanda va con un archivo: unas páginas del PDF o una foto.', fatal: true }, 400);
  if (archivos[0].datos.length > MAX_BASE64) return responder({ error: 'Esta parte de la lista pesa demasiado.', grande: true }, 413);
  const p = cuerpo.parte || {};
  const parte = {
    n: entero(p.n, 1, 200) ?? 1,
    de: entero(p.de, 1, 200) ?? 1,
    desde: entero(p.desde, 1, 2000) ?? 1,
    hasta: entero(p.hasta, 1, 2000) ?? entero(p.desde, 1, 2000) ?? 1,
    tipo: p.tipo === 'foto' ? 'foto' : 'pdf',
  };

  // Abre la lectura (primera tanda) o sigue la que ya está
  let uso = null;
  if (!lectura) {
    const { data, error } = await db.rpc('iniciar_lectura_lista', { p_proveedor: proveedor, p_tandas: tandas });
    if (error) {
      const sinSql = error.code === 'PGRST202' || error.code === '42883';
      return responder(
        { error: sinSql ? 'Falta activar la lectura de listas en PDF: corré el SQL 18 en Supabase.' : [error.message, error.hint].filter(Boolean).join(' '), fatal: true },
        error.code === 'TL002' ? 429 : sinSql ? 503 : 403
      );
    }
    lectura = data.id;
    uso = { usadas: data.usadas, limite: data.limite };
  }
  const { data: tanda, error: et } = await db.rpc('tanda_lectura_lista', { p_id: lectura });
  if (et || tanda?.proveedor_id !== proveedor) {
    return responder({ error: et?.message || 'Esta lectura es de otro proveedor. Empezá de nuevo.', fatal: true, lectura }, 410);
  }

  const { data: prov } = await db.from('proveedores').select('nombre, moneda, iva_incluido').eq('id', proveedor).maybeSingle();
  let lista;
  try {
    lista = limpiarLista(
      await pedirJsonGemini({
        archivos,
        pedido: pedidoLista({ proveedor: prov?.nombre || '', moneda: prov?.moneda, ivaIncluido: !!prov?.iva_incluido, parte }),
        sistema: SISTEMA_LISTA,
        esquema: ESQUEMA_LISTA,
        etiqueta: 'listas',
        maxTokens: 32000,
        espera: 60000, // una lista larga tarda en escribirse: no sumar otro modelo enseguida
      })
    );
  } catch (e) {
    return responder({ error: e.message, motivo: e.motivo || (e.final ? 'archivo' : 'otro'), fatal: e.motivo === 'cupo', lectura }, 502);
  }

  const { data: leida } = await db.rpc('tanda_lista_leida', { p_id: lectura, p_productos: lista.productos.length });
  return responder({ lectura, ...(leida || uso || {}), ...lista });
}
