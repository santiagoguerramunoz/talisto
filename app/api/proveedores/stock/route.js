// Revisa precio y stock de los productos de un presupuesto u orden de compra.
// Si el proveedor tiene API de stock, lo consulta en el momento; si no, usa la última lista cargada.
import { clienteUsuario, hayServicio, supabaseAdmin } from '@/lib/servidor';
import { encabezadoClave, esUuid, stockDeRespuesta, traer } from '@/lib/servidorProveedores';
import { leerNumero, valorEn } from '@/lib/planillas';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const sinCache = { 'Cache-Control': 'no-store, max-age=0' };
const responder = (datos, status = 200) => Response.json(datos, { status, headers: sinCache });

async function enTandas(lista, n, fn) {
  const salida = [];
  for (let i = 0; i < lista.length; i += n) salida.push(...(await Promise.all(lista.slice(i, i + n).map(fn))));
  return salida;
}

export async function POST(request) {
  const { usuario, db } = await clienteUsuario(request);
  if (!usuario) return responder({ error: 'Tenés que iniciar sesión.' }, 401);
  const { cuenta, productos } = await request.json().catch(() => ({}));
  const ids = [...new Set((Array.isArray(productos) ? productos : []).filter(esUuid))].slice(0, 80);
  if (!esUuid(cuenta) || !ids.length) return responder({ productos: [] });

  const { data, error } = await db.rpc('productos_para_revisar', { p_cuenta: cuenta, p_ids: ids });
  if (error) return responder({ error: 'No tenés permiso para revisar estos productos.' }, 403);

  const admin = hayServicio() ? supabaseAdmin() : null;
  const claves = {};
  const resultado = await enTandas(data || [], 4, async (p) => {
    const base = {
      id: p.id,
      precio: p.precio,
      activo: p.activo,
      stock: p.stock,
      stock_en: p.stock_en,
      unidad: p.unidad,
      proveedor_id: p.proveedor_id,
      proveedor: p.proveedor,
      moneda: p.moneda,
      origen: p.stock === null || p.stock === undefined ? 'sin_dato' : 'lista',
    };
    if (!p.stock_url) return base;
    try {
      const headers = { Accept: 'application/json' };
      if (p.tiene_clave) {
        if (!admin) return { ...base, aviso: 'Falta SUPABASE_SERVICE_ROLE_KEY para consultar la API.' };
        if (!(p.proveedor_id in claves)) claves[p.proveedor_id] = (await admin.rpc('clave_proveedor', { p_proveedor: p.proveedor_id })).data;
        Object.assign(headers, encabezadoClave(p.auth_header, claves[p.proveedor_id]));
      }
      const url = p.stock_url.replace(/\{codigo\}/g, encodeURIComponent(p.codigo));
      const r = await traer(url, { headers, max: 512 * 1024, espera: 8000 });
      if (r.status >= 400) return { ...base, aviso: `El proveedor respondió ${r.status}` };
      let json;
      try {
        json = JSON.parse(new TextDecoder().decode(r.bytes));
      } catch {
        const n = leerNumero(new TextDecoder().decode(r.bytes));
        json = n;
      }
      const stock = stockDeRespuesta(json, p.mapeo?.stock_vivo, valorEn, leerNumero);
      const precioVivo = p.mapeo?.precio_vivo ? leerNumero(valorEn(json, p.mapeo.precio_vivo)) : null;
      if (stock === null) return { ...base, aviso: 'No encontramos el stock en la respuesta del proveedor' };
      const ahora = new Date().toISOString();
      if (admin) {
        await admin
          .from('productos_proveedor')
          .update({ stock, stock_en: ahora, ...(precioVivo !== null ? { precio: Math.round(precioVivo * 100) / 100 } : {}) })
          .eq('id', p.id);
      }
      return { ...base, stock, stock_en: ahora, origen: 'vivo', ...(precioVivo !== null ? { precio: precioVivo } : {}) };
    } catch (e) {
      return { ...base, aviso: e?.message || 'No pudimos consultar el stock' };
    }
  });
  return responder({ productos: resultado });
}
