// Lee una orden de trabajo (foto, PDF o texto de un mail) con IA y devuelve los tickets para revisar.
// No crea nada: los tickets los carga la persona después de revisarlos, con sus propios permisos.
// El plan, el permiso y el tope del mes los controla la base con el usuario que lo pide.
import { pedirJsonGemini } from '@/lib/gemini';
import { ESQUEMA_ORDEN, MAX_TEXTO, SISTEMA_ORDEN, limpiarLectura, pedidoOrden } from '@/lib/ordenesIA';
import { clienteUsuario } from '@/lib/servidor';

export const dynamic = 'force-dynamic';
export const maxDuration = 180; // Gemini gratis puede tardar: ver lib/gemini.js

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BASE64 = 4_000_000; // ~3 MB de archivos (el pedido entero tiene que pasar los 4,5 MB de Vercel)
const ZONA = 'America/Montevideo';

const sinCache = { 'Cache-Control': 'no-store, max-age=0' };
const responder = (datos, status = 200) => Response.json(datos, { status, headers: sinCache });
const esUuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

export async function POST(request) {
  const { usuario, db } = await clienteUsuario(request);
  if (!usuario) return responder({ error: 'Tenés que iniciar sesión.' }, 401);
  if (!process.env.GEMINI_API_KEY) {
    return responder({ error: 'La lectura con IA todavía no está activada: falta cargar GEMINI_API_KEY en Vercel.', codigo: 'sin_clave' }, 503);
  }

  const cuerpo = await request.json().catch(() => ({}));
  const { cuenta } = cuerpo;
  if (!esUuid(cuenta)) return responder({ error: 'Cuenta no válida.' }, 400);
  const archivos = (Array.isArray(cuerpo.archivos) ? cuerpo.archivos : []).filter(
    (a) => a && TIPOS.includes(a.tipo) && typeof a.datos === 'string' && /^[A-Za-z0-9+/=]+$/.test(a.datos.slice(0, 200))
  );
  const texto = typeof cuerpo.texto === 'string' ? cuerpo.texto.trim() : '';
  if (!archivos.length && !texto) return responder({ error: 'Sacale una foto a la orden, subí el PDF o pegá el texto del mail.' }, 400);
  if (archivos.length > 3) return responder({ error: 'Hasta 3 fotos o archivos por orden.' }, 400);
  if (archivos.reduce((s, a) => s + a.datos.length, 0) > MAX_BASE64) {
    return responder({ error: 'Los archivos son muy grandes (máximo 3 MB entre todos).' }, 413);
  }
  if (texto.length > MAX_TEXTO) return responder({ error: 'El texto es muy largo: pegá solo la parte de las órdenes.' }, 413);
  const empresas = (Array.isArray(cuerpo.empresas) ? cuerpo.empresas : [])
    .filter((e) => typeof e === 'string')
    .map((e) => e.slice(0, 120))
    .slice(0, 50);

  const origen = archivos.some((a) => a.tipo === 'application/pdf') ? 'pdf' : archivos.length ? 'foto' : 'texto';
  const { data: inicio, error } = await db.rpc('iniciar_lectura_orden', { p_cuenta: cuenta, p_origen: origen });
  if (error) {
    const sinSql = error.code === 'PGRST202' || error.code === '42883';
    return responder(
      { error: sinSql ? 'Falta activar la lectura de órdenes: corré el SQL 16 en Supabase.' : error.message, codigo: error.code, pista: error.hint },
      error.code === 'TL002' ? 429 : sinSql ? 503 : 403
    );
  }

  let lectura;
  try {
    const ahora = new Date();
    lectura = limpiarLectura(
      await pedirJsonGemini({
        archivos,
        pedido: pedidoOrden({
          hoy: ahora.toLocaleDateString('en-CA', { timeZone: ZONA }),
          diaSemana: ahora.toLocaleDateString('es-UY', { weekday: 'long', timeZone: ZONA }),
          empresas,
          texto,
        }),
        sistema: SISTEMA_ORDEN,
        esquema: ESQUEMA_ORDEN,
        etiqueta: 'ordenes',
      })
    );
  } catch (e) {
    await db.rpc('terminar_lectura_orden', { p_id: inicio.id, p_ordenes: null, p_error: e.message });
    return responder({ error: e.message }, 502);
  }
  if (!lectura.legible) {
    await db.rpc('terminar_lectura_orden', { p_id: inicio.id, p_ordenes: null, p_error: 'No se pudo leer' });
    return responder({ error: 'No encontramos una orden de trabajo para leer. Probá con otra foto, bien de frente y con luz (no cuenta para el tope).' }, 422);
  }
  await db.rpc('terminar_lectura_orden', { p_id: inicio.id, p_ordenes: lectura.ordenes.length, p_error: null });
  return responder({ ordenes: lectura.ordenes, usadas: inicio.usadas, limite: inicio.limite });
}
