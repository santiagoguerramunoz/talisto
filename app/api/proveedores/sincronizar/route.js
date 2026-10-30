// Trae la lista de precios del proveedor (link publicado o API) y la carga en TaListo!.
// Los permisos los controla la base con el usuario que lo pide; la clave de la API solo se lee acá.
import { clienteUsuario, hayServicio, supabaseAdmin } from '@/lib/servidor';
import { encabezadoClave, esUuid, traer } from '@/lib/servidorProveedores';
import { CAMPOS, adivinarMapeo, leerTabla, productosDe } from '@/lib/planillas';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const sinCache = { 'Cache-Control': 'no-store, max-age=0' };
const responder = (datos, status = 200) => Response.json(datos, { status, headers: sinCache });

export async function POST(request) {
  const { usuario, db } = await clienteUsuario(request);
  if (!usuario) return responder({ error: 'Tenés que iniciar sesión.' }, 401);
  const { proveedor_id: id, probar = false } = await request.json().catch(() => ({}));
  if (!esUuid(id)) return responder({ error: 'Proveedor no válido.' }, 400);

  const { data: cfg, error } = await db.rpc('config_proveedor', { p_proveedor: id });
  if (error || !cfg) return responder({ error: 'No podés actualizar este proveedor.' }, 403);
  if (!['url', 'api'].includes(cfg.fuente) || !cfg.fuente_url) {
    return responder({ error: 'Este proveedor no tiene un link ni una API para actualizar la lista.' }, 400);
  }
  if (!probar && cfg.sincronizado_en && Date.now() - new Date(cfg.sincronizado_en).getTime() < 60000) {
    return responder({ error: 'La lista se actualizó hace menos de un minuto. Esperá un momento.' }, 429);
  }

  const anotar = (texto) => db.rpc('anotar_sincronizacion', { p_proveedor: id, p_resumen: texto });

  const headers = { Accept: 'application/json, text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*' };
  if (cfg.tiene_clave) {
    if (!hayServicio()) {
      return responder({ error: 'Para usar la clave de la API falta cargar SUPABASE_SERVICE_ROLE_KEY en Vercel.' }, 503);
    }
    const { data: clave } = await supabaseAdmin().rpc('clave_proveedor', { p_proveedor: id });
    Object.assign(headers, encabezadoClave(cfg.auth_header, clave));
  }

  let tabla;
  try {
    const r = await traer(cfg.fuente_url, { headers });
    if (r.status >= 400) {
      const msg = r.status === 401 || r.status === 403 ? 'El proveedor no aceptó la clave de la API.' : `El proveedor respondió con un error (${r.status}).`;
      if (!probar) await anotar(msg);
      return responder({ error: msg }, 502);
    }
    tabla = await leerTabla(r.bytes, { formato: cfg.formato || 'auto', rutaLista: cfg.mapeo?.lista || '' });
  } catch (e) {
    const msg = e?.message || 'No pudimos leer la lista del proveedor.';
    if (!probar) await anotar(msg);
    return responder({ error: msg }, 502);
  }

  // El mapeo guardado manda; lo que falta se adivina por el nombre de las columnas
  const guardado = Object.fromEntries(CAMPOS.map((c) => [c.id, cfg.mapeo?.[c.id]]).filter(([, v]) => v));
  const mapeo = { ...adivinarMapeo(tabla.campos), ...guardado };
  const productos = productosDe(tabla.filas, mapeo);

  if (probar) {
    return responder({ ok: true, campos: tabla.campos, mapeo, filas: tabla.filas.length, muestra: productos.slice(0, 5), total: productos.length });
  }
  if (!productos.length) {
    const msg = `No encontramos productos con descripción y precio (${tabla.filas.length} filas leídas). Revisá qué columna es cada dato.`;
    await anotar(msg);
    return responder({ error: msg, campos: tabla.campos, mapeo }, 422);
  }
  if (productos.length > 60000) return responder({ error: 'La lista tiene más de 60.000 productos.' }, 413);

  const { data: inicio, error: e1 } = await db.rpc('iniciar_importacion', { p_proveedor: id });
  if (e1) return responder({ error: 'No podés actualizar este proveedor.' }, 403);
  const suma = { nuevos: 0, actualizados: 0, omitidos: 0 };
  for (let i = 0; i < productos.length; i += 2000) {
    const { data, error: e2 } = await db.rpc('importar_productos', { p_proveedor: id, p_filas: productos.slice(i, i + 2000) });
    if (e2) {
      await anotar(`Se cortó la carga: ${e2.message}`);
      return responder({ error: `Se cortó la carga: ${e2.message}` }, 500);
    }
    suma.nuevos += data.nuevos;
    suma.actualizados += data.actualizados;
    suma.omitidos += data.omitidos;
  }
  const resumen = `${cfg.fuente === 'api' ? 'API' : 'Link'}: ${suma.nuevos + suma.actualizados} productos (${suma.nuevos} nuevos)`;
  const { data: cierre } = await db.rpc('cerrar_importacion', { p_proveedor: id, p_inicio: inicio, p_resumen: resumen });
  return responder({ ok: true, ...suma, ...(cierre || {}), resumen });
}
