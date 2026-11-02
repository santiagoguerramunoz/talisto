// Lee una factura, e-ticket, remito o comprobante con IA y devuelve los datos para revisar.
// Se activa cargando en Vercel GEMINI_API_KEY (Google, modelo gemini-3.8-flash; opcional GEMINI_MODEL)
// o ANTHROPIC_API_KEY (Claude; opcional ANTHROPIC_MODEL). Si están las dos, usa Gemini.
// El plan, el permiso y el tope del mes los controla la base con el usuario que lo pide.
import { clienteUsuario } from '@/lib/servidor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODELO = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const MODELO_GEMINI = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BASE64 = 4_000_000; // ~3 MB de archivos (el pedido entero tiene que pasar los 4,5 MB de Vercel)

const sinCache = { 'Cache-Control': 'no-store, max-age=0' };
const responder = (datos, status = 200) => Response.json(datos, { status, headers: sinCache });
const esUuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

const HERRAMIENTA = {
  name: 'comprobante',
  description: 'Devuelve los datos leídos del comprobante.',
  input_schema: {
    type: 'object',
    properties: {
      legible: { type: 'boolean', description: 'false si la imagen no es un comprobante o no se puede leer' },
      tipo: {
        type: 'string',
        enum: ['compra', 'gasto'],
        description:
          'compra: factura, e-factura o remito de materiales, repuestos o productos para trabajar o para el stock (ferretería, barraca, casa de electricidad, sanitaria, etc.). gasto: combustible, peaje, estacionamiento, comida, servicios, herramientas sueltas, cualquier otro gasto.',
      },
      tipo_documento: { type: 'string', description: 'e-Factura, e-Ticket, Factura, Remito, Recibo, Ticket…' },
      numero: { type: ['string', 'null'], description: 'Serie y número del comprobante, ej. A-12345' },
      fecha: { type: ['string', 'null'], description: 'Fecha del comprobante en formato AAAA-MM-DD' },
      moneda: { type: 'string', enum: ['UYU', 'USD'] },
      proveedor: {
        type: 'object',
        description: 'Quien emite el comprobante (el vendedor), no el cliente',
        properties: {
          nombre: { type: ['string', 'null'], description: 'Nombre comercial o razón social' },
          rut: { type: ['string', 'null'], description: 'RUT del emisor (12 dígitos en Uruguay)' },
          telefono: { type: ['string', 'null'] },
          direccion: { type: ['string', 'null'] },
          email: { type: ['string', 'null'] },
        },
      },
      precios_con_iva: { type: 'boolean', description: 'true si los precios unitarios de los renglones ya incluyen IVA' },
      items: {
        type: 'array',
        description: 'Cada renglón del comprobante, en el orden en que aparece',
        items: {
          type: 'object',
          properties: {
            codigo: { type: ['string', 'null'], description: 'Código del artículo si figura' },
            descripcion: { type: 'string' },
            cantidad: { type: ['number', 'null'] },
            unidad: { type: ['string', 'null'], description: 'u, m, kg, l, caja, rollo, bolsa… como figura' },
            precio_unitario: { type: ['number', 'null'], description: 'Precio por unidad, null si el remito no trae precios' },
            descuento_pct: { type: ['number', 'null'] },
            iva_pct: { type: ['number', 'null'], description: '22 (básica), 10 (mínima) o 0' },
            total: { type: ['number', 'null'], description: 'Importe del renglón' },
            es_material: { type: 'boolean', description: 'false para flete, envío, mano de obra, servicio o descuento' },
          },
          required: ['descripcion'],
        },
      },
      subtotal: { type: ['number', 'null'] },
      iva: { type: ['number', 'null'] },
      total: { type: ['number', 'null'], description: 'Total a pagar' },
      categoria_gasto: { type: ['string', 'null'], description: 'Una de las categorías de gastos de la lista' },
      descripcion_gasto: { type: ['string', 'null'], description: 'Descripción corta, ej. "Nafta Súper 30 L"' },
      litros: { type: ['number', 'null'], description: 'Solo combustible: litros cargados' },
      precio_litro: { type: ['number', 'null'], description: 'Solo combustible: precio por litro' },
      nota: { type: ['string', 'null'], description: 'Algo dudoso o que no se pudo leer bien, en una frase' },
    },
    required: ['legible', 'tipo', 'moneda', 'items', 'total'],
  },
};

const SISTEMA =
  'Leés comprobantes de Uruguay (e-Facturas y e-Tickets CFE, facturas, remitos, tickets de caja) para un profesional de oficios ' +
  '(electricistas, sanitarios, instaladores). Copiá los datos tal como figuran, sin inventar: si algo no se lee, dejalo en null. ' +
  'Los importes van como números (sin separador de miles, con punto decimal). El proveedor es quien emite el comprobante, no el cliente. ' +
  'Si hay varias páginas o fotos, son del mismo comprobante.';

const texto = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : null;
};

// Lo que devuelve la IA, ordenado y con límites (nunca se confía a ciegas)
function limpiar(d) {
  const p = d?.proveedor || {};
  return {
    legible: d?.legible !== false,
    tipo: d?.tipo === 'gasto' ? 'gasto' : 'compra',
    tipo_documento: texto(d?.tipo_documento, 40),
    numero: texto(d?.numero, 40),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(d?.fecha || '') ? d.fecha : null,
    moneda: d?.moneda === 'USD' ? 'USD' : 'UYU',
    proveedor: {
      nombre: texto(p.nombre, 120),
      rut: texto(p.rut, 20),
      telefono: texto(p.telefono, 40),
      direccion: texto(p.direccion, 200),
      email: texto(p.email, 120),
    },
    precios_con_iva: d?.precios_con_iva === true,
    items: (Array.isArray(d?.items) ? d.items : [])
      .slice(0, 200)
      .map((it) => ({
        codigo: texto(it?.codigo, 80),
        descripcion: texto(it?.descripcion, 300) || '',
        cantidad: num(it?.cantidad),
        unidad: texto(it?.unidad, 20),
        precio_unitario: num(it?.precio_unitario),
        descuento_pct: num(it?.descuento_pct),
        iva_pct: num(it?.iva_pct),
        total: num(it?.total),
        es_material: it?.es_material !== false,
      }))
      .filter((it) => it.descripcion),
    subtotal: num(d?.subtotal),
    iva: num(d?.iva),
    total: num(d?.total),
    categoria_gasto: texto(d?.categoria_gasto, 40),
    descripcion_gasto: texto(d?.descripcion_gasto, 200),
    litros: num(d?.litros),
    precio_litro: num(d?.precio_litro),
    nota: texto(d?.nota, 300),
  };
}

const pedidoTexto = (categorias) => {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
  return (
    `Leé este comprobante. Hoy es ${hoy}. ` +
    `Categorías de gastos para elegir: ${categorias.length ? categorias.join(', ') : 'Movilidad, Insumos, Viáticos, Herramientas, Otros'}. ` +
    'Combustible va en Movilidad.'
  );
};

// JSON Schema sin tipos combinados (["string","null"] → "string"): lo que no se lea se deja afuera
function esquemaSimple(e) {
  if (Array.isArray(e)) return e.map(esquemaSimple);
  if (!e || typeof e !== 'object') return e;
  const o = {};
  for (const [k, v] of Object.entries(e)) {
    o[k] = k === 'type' && Array.isArray(v) ? v.find((t) => t !== 'null') || 'string' : esquemaSimple(v);
  }
  return o;
}

// Google Gemini (tiene uso gratis con tope diario; en el gratis Google puede usar los datos para mejorar sus productos)
async function leerConGemini(archivos, categorias) {
  const partes = [
    ...archivos.map((a) => ({ inlineData: { mimeType: a.tipo, data: a.datos } })),
    {
      text:
        `${pedidoTexto(categorias)} Respondé solo con un JSON que cumpla este esquema ` +
        `(omití los datos que no se lean): ${JSON.stringify(esquemaSimple(HERRAMIENTA.input_schema))}`,
    },
  ];
  const pedir = (conEsquema) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODELO_GEMINI)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SISTEMA }] },
        contents: [{ role: 'user', parts: partes }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 16000,
          ...(conEsquema ? { responseJsonSchema: esquemaSimple(HERRAMIENTA.input_schema), thinkingConfig: { thinkingLevel: 'low' } } : {}),
        },
      }),
      signal: AbortSignal.timeout(55000),
      cache: 'no-store',
    });

  let r;
  try {
    r = await pedir(true);
    // si el modelo no acepta el esquema o el nivel de razonamiento, va con el esquema en el texto
    if (r.status === 400) {
      const t = await r.clone().text();
      if (!/api key|API_KEY/i.test(t)) r = await pedir(false);
    }
  } catch {
    throw new Error('La IA tardó demasiado en responder. Probá de nuevo.');
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = String(datos?.error?.message || '');
    if (/api key/i.test(msg) || r.status === 401 || r.status === 403) throw new Error('La clave de la IA no es válida: revisá GEMINI_API_KEY en Vercel.');
    if (r.status === 404) throw new Error('El modelo de IA configurado no existe: revisá GEMINI_MODEL en Vercel.');
    if (r.status === 429) throw new Error('Se terminó por hoy el cupo gratis de la IA de Google. Probá más tarde o activá la facturación en Google AI Studio.');
    if (r.status >= 500) throw new Error('La IA está con mucha demanda. Probá de nuevo en un minuto.');
    throw new Error('No pudimos leer este archivo. Probá con otra foto, bien de frente y con luz.');
  }
  if (datos?.promptFeedback?.blockReason) throw new Error('La IA no quiso procesar este archivo. Probá con otra foto.');
  const texto = (datos?.candidates?.[0]?.content?.parts || [])
    .filter((x) => typeof x.text === 'string' && !x.thought)
    .map((x) => x.text)
    .join('')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  let json;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new Error('La IA no devolvió los datos completos. Probá de nuevo.');
  }
  return limpiar(json);
}

async function leerConIA(archivos, categorias) {
  if (process.env.GEMINI_API_KEY) return leerConGemini(archivos, categorias);
  const bloques = archivos.map((a) =>
    a.tipo === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.datos } }
      : { type: 'image', source: { type: 'base64', media_type: a.tipo, data: a.datos } }
  );
  bloques.push({ type: 'text', text: pedidoTexto(categorias) });

  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 8000,
        system: SISTEMA,
        tools: [HERRAMIENTA],
        tool_choice: { type: 'tool', name: 'comprobante' },
        messages: [{ role: 'user', content: bloques }],
      }),
      signal: AbortSignal.timeout(55000),
      cache: 'no-store',
    });
  } catch {
    throw new Error('La IA tardó demasiado en responder. Probá de nuevo.');
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new Error('La clave de la IA no es válida: revisá ANTHROPIC_API_KEY en Vercel.');
    if (r.status === 404) throw new Error('El modelo de IA configurado no existe: revisá ANTHROPIC_MODEL en Vercel.');
    if (r.status === 429 || r.status === 529 || r.status >= 500) throw new Error('La IA está con mucha demanda. Probá de nuevo en un minuto.');
    if (r.status === 413) throw new Error('El archivo es muy grande. Probá con una foto.');
    throw new Error('No pudimos leer este archivo. Probá con otra foto, bien de frente y con luz.');
  }
  const uso = (datos.content || []).find((b) => b.type === 'tool_use');
  if (!uso?.input) throw new Error('La IA no devolvió los datos. Probá de nuevo.');
  return limpiar(uso.input);
}

export async function POST(request) {
  const { usuario, db } = await clienteUsuario(request);
  if (!usuario) return responder({ error: 'Tenés que iniciar sesión.' }, 401);
  if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return responder({ error: 'La lectura con IA todavía no está activada: falta cargar GEMINI_API_KEY en Vercel.', codigo: 'sin_clave' }, 503);
  }

  const cuerpo = await request.json().catch(() => ({}));
  const { cuenta } = cuerpo;
  if (!esUuid(cuenta)) return responder({ error: 'Cuenta no válida.' }, 400);
  const archivos = (Array.isArray(cuerpo.archivos) ? cuerpo.archivos : []).filter(
    (a) => a && TIPOS.includes(a.tipo) && typeof a.datos === 'string' && /^[A-Za-z0-9+/=]+$/.test(a.datos.slice(0, 200))
  );
  if (!archivos.length) return responder({ error: 'Sacale una foto al comprobante o subí el PDF.' }, 400);
  if (archivos.length > 3) return responder({ error: 'Hasta 3 fotos o archivos por comprobante.' }, 400);
  if (archivos.reduce((s, a) => s + a.datos.length, 0) > MAX_BASE64) {
    return responder({ error: 'Los archivos son muy grandes (máximo 3 MB entre todos).' }, 413);
  }
  const rutas = (Array.isArray(cuerpo.rutas) ? cuerpo.rutas : []).filter((r) => typeof r === 'string').slice(0, 3);
  const categorias = (Array.isArray(cuerpo.categorias) ? cuerpo.categorias : [])
    .filter((c) => typeof c === 'string')
    .map((c) => c.slice(0, 40))
    .slice(0, 30);

  const { data: inicio, error } = await db.rpc('iniciar_lectura_comprobante', { p_cuenta: cuenta, p_archivos: rutas });
  if (error) {
    const sinSql = error.code === 'PGRST202' || error.code === '42883';
    return responder(
      { error: sinSql ? 'Falta activar la lectura de comprobantes: corré el SQL 14 en Supabase.' : error.message, codigo: error.code, pista: error.hint },
      error.code === 'TL002' ? 429 : sinSql ? 503 : 403
    );
  }

  let datos;
  try {
    datos = await leerConIA(archivos, categorias);
  } catch (e) {
    await db.rpc('guardar_lectura_comprobante', { p_id: inicio.id, p_datos: null, p_error: e.message });
    return responder({ error: e.message }, 502);
  }
  if (!datos.legible) {
    await db.rpc('guardar_lectura_comprobante', { p_id: inicio.id, p_datos: null, p_error: 'No se pudo leer' });
    return responder({ error: 'No pudimos leer un comprobante en la foto. Probá con otra, bien de frente y con luz (no cuenta para el tope).' }, 422);
  }
  await db.rpc('guardar_lectura_comprobante', { p_id: inicio.id, p_datos: datos, p_error: null });
  return responder({ id: inicio.id, datos, usadas: inicio.usadas, limite: inicio.limite });
}
