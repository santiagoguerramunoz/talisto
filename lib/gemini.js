// Lectura de documentos con Google Gemini. Solo para el servidor (rutas /api): usa GEMINI_API_KEY.
// Tiene uso gratis con tope diario; en el gratis Google puede usar los datos para mejorar sus productos.
//
// Arranca con Gemini 3.8 Flash. Si no contestó en ESPERA_MODELO, suma el modelo siguiente SIN cortar al anterior,
// y gana el primero que responda bien. Si uno falla enseguida (saturado, sin cupo), el siguiente entra al momento.

const MODELO_GEMINI = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
// Flash-Lite va segundo: es el más rápido y el que tiene más cupo gratis
const MODELOS_GEMINI = [...new Set([MODELO_GEMINI, 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.1-flash-lite'])];
const ESPERA_MODELO = Number(process.env.GEMINI_ESPERA_MS) || 25000;
const TOPE_LECTURA = Number(process.env.GEMINI_TOPE_MS) || 170000; // las rutas tienen maxDuration = 180 s

// Un error que otro modelo no va a arreglar (clave mala, archivo rechazado): corta todo
function errorFinal(mensaje) {
  const e = new Error(mensaje);
  e.final = true;
  return e;
}

// Error para la persona, con el motivo para quien llama: tiempo, cupo, saturada, incompleto
function errorCon(motivo, mensaje) {
  const e = new Error(mensaje);
  e.motivo = motivo;
  return e;
}

// El primero que responda: el siguiente entra si el anterior falla o tarda más de ESPERA_MODELO
function primeroQueResponda(modelos, intentar, espera = ESPERA_MODELO) {
  return new Promise((ok, mal) => {
    let i = 0;
    let pendientes = 0;
    let listo = false;
    let turno = null;
    const terminar = (fin, valor) => {
      if (listo) return;
      listo = true;
      clearTimeout(tope);
      clearTimeout(turno);
      fin(valor);
    };
    const tope = setTimeout(() => terminar(mal, new Error('tope')), TOPE_LECTURA);
    function siguiente() {
      clearTimeout(turno);
      if (listo) return;
      if (i >= modelos.length) {
        if (!pendientes) terminar(mal, new Error('sin respuesta'));
        return;
      }
      pendientes += 1;
      turno = setTimeout(siguiente, espera);
      intentar(modelos[i++]).then(
        (datos) => terminar(ok, datos),
        (e) => {
          pendientes -= 1;
          if (e.final) terminar(mal, e);
          else siguiente();
        }
      );
    }
    siguiente();
  });
}

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
 * maxTokens: largo máximo de la respuesta   espera: cuánto se le da a cada modelo antes de sumar el siguiente
 * Los errores que tira ya vienen en palabras para mostrarle a la persona.
 */
export async function pedirJsonGemini({ archivos = [], pedido, sistema, esquema, etiqueta = 'ia', maxTokens = 16000, espera = ESPERA_MODELO }) {
  const partes = [
    ...archivos.map((a) => ({ inlineData: { mimeType: a.tipo, data: a.datos } })),
    {
      text:
        `${pedido} Respondé solo con un JSON que cumpla este esquema ` +
        `(omití los datos que no se lean): ${JSON.stringify(esquemaSimple(esquema))}`,
    },
  ];
  const control = new AbortController(); // corta los pedidos que siguen abiertos cuando alguno responde
  const pedir = (modelo, conEsquema) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema }] },
        contents: [{ role: 'user', parts: partes }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: maxTokens,
          ...(conEsquema ? { responseJsonSchema: esquemaSimple(esquema), thinkingConfig: { thinkingLevel: 'low' } } : {}),
        },
      }),
      signal: control.signal,
      cache: 'no-store',
    });
  // Qué respondió Google cuando falla (queda en los registros de Vercel; nunca incluye la clave)
  const registrar = (modelo, paso, status, j) => {
    const msg = String(j?.error?.message || '').slice(0, 600);
    console.error(`[${etiqueta}] Gemini ${modelo} ${paso}: HTTP ${status} ${j?.error?.status || ''} ${msg}`);
    return msg;
  };

  const vistos = new Set(); // códigos de error que devolvió cada intento

  async function intentar(modelo) {
    const inicio = Date.now();
    let r;
    try {
      r = await pedir(modelo, true);
      if (r.status === 400) {
        // si no acepta el esquema o el nivel de razonamiento, va con el esquema en el texto
        const t = registrar(modelo, 'con esquema', 400, await r.clone().json().catch(() => ({})));
        if (!/api key|API_KEY/i.test(t)) r = await pedir(modelo, false);
      }
    } catch (e) {
      if (!control.signal.aborted) {
        console.error(`[${etiqueta}] Gemini ${modelo} sin respuesta: ${e?.name || ''} ${e?.message || ''}`);
        vistos.add(504);
      }
      throw e;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = registrar(modelo, 'respuesta', r.status, j);
      vistos.add(r.status >= 500 ? 503 : r.status);
      if (/prepay|billing|credits/i.test(msg)) {
        throw errorFinal('La clave de Google es de un proyecto con facturación y sin saldo. Para el uso gratis, creá la clave en un proyecto nuevo de AI Studio sin facturación y reemplazá GEMINI_API_KEY en Vercel.');
      }
      if (/api key/i.test(msg) || r.status === 401 || r.status === 403) throw errorFinal('La clave de la IA no es válida: revisá GEMINI_API_KEY en Vercel.');
      if (r.status === 400) throw errorFinal(`No pudimos leer este archivo (Google: ${msg.slice(0, 180) || 'error 400'}).`);
      throw new Error(`HTTP ${r.status}`); // saturado, sin cupo o modelo que no está: el siguiente
    }
    if (j?.promptFeedback?.blockReason) throw errorFinal('La IA no quiso procesar este archivo. Probá con otra foto.');
    const texto = (j?.candidates?.[0]?.content?.parts || [])
      .filter((x) => typeof x.text === 'string' && !x.thought)
      .map((x) => x.text)
      .join('')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/, '')
      .trim();
    try {
      const datos = JSON.parse(texto);
      console.log(`[${etiqueta}] Gemini ${modelo} respondió en ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
      return datos;
    } catch {
      // Sin el contenido: puede traer datos de clientes y esto queda en los registros
      console.error(`[${etiqueta}] Gemini ${modelo} devolvió algo que no es JSON (${j?.candidates?.[0]?.finishReason || 'sin motivo'}, ${texto.length} caracteres)`);
      vistos.add('incompleto');
      throw new Error('respuesta incompleta');
    }
  }

  try {
    return await primeroQueResponda(MODELOS_GEMINI, intentar, espera);
  } catch (e) {
    if (e.final) throw e;
    if (e.message === 'tope') {
      console.error(`[${etiqueta}] Gemini: ningún modelo respondió en ${TOPE_LECTURA / 1000} s`);
      vistos.add(504);
    }
    if (vistos.has(504)) throw errorCon('tiempo', 'Google tardó demasiado en responder con todos los modelos. Probá de nuevo más tarde (no cuenta para el tope).');
    if (vistos.has(429) && !vistos.has(503)) throw errorCon('cupo', 'Se terminó por hoy el cupo gratis de la IA de Google (se renueva todos los días). Mientras tanto cargalo a mano.');
    if (vistos.size === 1 && vistos.has(404)) throw errorCon('modelo', 'El modelo de IA configurado no existe: revisá GEMINI_MODEL en Vercel.');
    if (vistos.has('incompleto') && !vistos.has(503)) throw errorCon('incompleto', 'La IA no devolvió los datos completos. Probá de nuevo.');
    throw errorCon('saturada', 'La IA de Google está saturada en este momento. Probá de nuevo en unos minutos (no cuenta para el tope).');
  } finally {
    control.abort();
  }
}
