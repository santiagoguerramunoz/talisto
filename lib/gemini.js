// Lectura de documentos con Google Gemini. Solo para el servidor (rutas /api): usa GEMINI_API_KEY.
// Tiene uso gratis con tope diario; en el gratis Google puede usar los datos para mejorar sus productos.
// Si un modelo está saturado o sin cupo, prueba con los otros modelos gratis.

const MODELO_GEMINI = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const MODELOS_GEMINI = [...new Set([MODELO_GEMINI, 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'])];
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

// JSON Schema sin tipos combinados (["string","null"] → "string"): lo que no se lea se deja afuera
export function esquemaSimple(e) {
  if (Array.isArray(e)) return e.map(esquemaSimple);
  if (!e || typeof e !== 'object') return e;
  const o = {};
  for (const [k, v] of Object.entries(e)) {
    o[k] = k === 'type' && Array.isArray(v) ? v.find((t) => t !== 'null') || 'string' : esquemaSimple(v);
  }
  return o;
}

/**
 * Le manda los archivos y el pedido a Gemini y devuelve el JSON que respondió.
 * archivos: [{ tipo, datos (base64) }]   pedido: texto   sistema: instrucciones   esquema: JSON Schema
 * Los errores que tira ya vienen en palabras para mostrarle a la persona.
 */
export async function pedirJsonGemini({ archivos = [], pedido, sistema, esquema, etiqueta = 'ia' }) {
  const partes = [
    ...archivos.map((a) => ({ inlineData: { mimeType: a.tipo, data: a.datos } })),
    {
      text:
        `${pedido} Respondé solo con un JSON que cumpla este esquema ` +
        `(omití los datos que no se lean): ${JSON.stringify(esquemaSimple(esquema))}`,
    },
  ];
  const limite = Date.now() + 55000; // la función tiene 60 s
  const pedir = (modelo, conEsquema) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema }] },
        contents: [{ role: 'user', parts: partes }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 16000,
          ...(conEsquema ? { responseJsonSchema: esquemaSimple(esquema), thinkingConfig: { thinkingLevel: 'low' } } : {}),
        },
      }),
      signal: AbortSignal.timeout(Math.max(5000, limite - Date.now())),
      cache: 'no-store',
    });
  // Qué respondió Google cuando falla (queda en los registros de Vercel; nunca incluye la clave)
  const registrar = (modelo, paso, status, j) => {
    const msg = String(j?.error?.message || '').slice(0, 600);
    console.error(`[${etiqueta}] Gemini ${modelo} ${paso}: HTTP ${status} ${j?.error?.status || ''} ${msg}`);
    return msg;
  };

  const vistos = new Set(); // códigos de error que devolvió cada intento
  let datos = null;
  for (const modelo of MODELOS_GEMINI) {
    for (let vez = 0; vez < (modelo === MODELOS_GEMINI[0] ? 2 : 1) && !datos; vez++) {
      if (Date.now() > limite - 8000) break;
      if (vez > 0) await espera(1500); // un reintento corto: los picos de demanda suelen durar poco
      let r;
      try {
        r = await pedir(modelo, true);
        if (r.status === 400) {
          // si no acepta el esquema o el nivel de razonamiento, va con el esquema en el texto
          const t = registrar(modelo, 'con esquema', 400, await r.clone().json().catch(() => ({})));
          if (!/api key|API_KEY/i.test(t)) r = await pedir(modelo, false);
        }
      } catch (e) {
        console.error(`[${etiqueta}] Gemini ${modelo} sin respuesta: ${e?.name || ''} ${e?.message || ''}`);
        vistos.add(504);
        break;
      }
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        datos = j;
        break;
      }
      const msg = registrar(modelo, 'respuesta', r.status, j);
      vistos.add(r.status >= 500 ? 503 : r.status);
      if (/prepay|billing|credits/i.test(msg)) {
        throw new Error('La clave de Google es de un proyecto con facturación y sin saldo. Para el uso gratis, creá la clave en un proyecto nuevo de AI Studio sin facturación y reemplazá GEMINI_API_KEY en Vercel.');
      }
      if (/api key/i.test(msg) || r.status === 401 || r.status === 403) throw new Error('La clave de la IA no es válida: revisá GEMINI_API_KEY en Vercel.');
      if (r.status === 400) throw new Error(`No pudimos leer este archivo (Google: ${msg.slice(0, 180) || 'error 400'}).`);
      if (r.status === 429 || r.status === 404) break; // sin cupo o modelo que no está: el siguiente
      // 5xx (saturado): reintenta una vez el primero y después pasa al siguiente
    }
    if (datos) break;
  }

  if (!datos) {
    if (vistos.has(429) && !vistos.has(503)) throw new Error('Se terminó por hoy el cupo gratis de la IA de Google (se renueva todos los días). Mientras tanto cargalo a mano.');
    if (vistos.has(504) && !vistos.has(503)) throw new Error('La IA tardó demasiado en responder. Probá de nuevo.');
    if (vistos.size === 1 && vistos.has(404)) throw new Error('El modelo de IA configurado no existe: revisá GEMINI_MODEL en Vercel.');
    throw new Error('La IA de Google está saturada en este momento. Probá de nuevo en unos minutos (no cuenta para el tope).');
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
  try {
    return JSON.parse(texto);
  } catch {
    // Sin el contenido: puede traer datos de clientes y esto queda en los registros
    console.error(`[${etiqueta}] Gemini devolvió algo que no es JSON (${datos?.candidates?.[0]?.finishReason || 'sin motivo'}, ${texto.length} caracteres)`);
    throw new Error('La IA no devolvió los datos completos. Probá de nuevo.');
  }
}
