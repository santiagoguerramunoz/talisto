// WhatsApp Business (API de Meta, "Cloud API"): mandar mensajes, bajar fotos y validar los avisos de Meta.
// Las claves las carga el dueño en Vercel; acá solo se leen:
//   WHATSAPP_TOKEN           token permanente (usuario del sistema) con permiso whatsapp_business_messaging
//   WHATSAPP_PHONE_ID        "Phone number ID" del número de TaListo!
//   WHATSAPP_APP_SECRET      "App secret" de la app de Meta (para validar la firma de los avisos)
//   WHATSAPP_VERIFY_TOKEN    texto inventado que se pone también al configurar el webhook en Meta
//   WHATSAPP_PLANTILLA       (opcional) plantilla para escribir fuera de las 24 horas; por defecto talisto_aviso
import crypto from 'node:crypto';

const VERSION = process.env.WHATSAPP_API_VERSION || 'v23.0';
const GRAPH = `https://graph.facebook.com/${VERSION}`;

export const whatsappConfigurado = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);

// Firma de Meta: X-Hub-Signature-256 = sha256=HMAC(cuerpo, app secret)
export function firmaMetaValida(cuerpo, firma) {
  const secreto = process.env.WHATSAPP_APP_SECRET;
  if (!secreto) return true; // sin secreto cargado no se puede validar (se recomienda cargarlo)
  if (!firma || !firma.startsWith('sha256=')) return false;
  const esperada = 'sha256=' + crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex');
  const a = Buffer.from(esperada);
  const b = Buffer.from(firma);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function graph(ruta, { method = 'GET', body } = {}) {
  const r = await fetch(`${GRAPH}${ruta}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(datos?.error?.message || `WhatsApp respondió ${r.status}`);
    e.codigo = datos?.error?.code;
    throw e;
  }
  return datos;
}

const corto = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

// Arma el mensaje para la API a partir de lo que devuelve el bot: { texto, opciones?: [{ id, titulo, detalle? }], boton? }
export function armarMensaje(tel, m) {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: tel };
  const ops = m.opciones || [];
  if (!ops.length) return { ...base, type: 'text', text: { body: corto(m.texto, 4096), preview_url: true } };
  if (ops.length <= 3 && ops.every((o) => o.titulo.length <= 20)) {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: corto(m.cuerpo || m.texto, 1024) },
        action: { buttons: ops.map((o) => ({ type: 'reply', reply: { id: o.id, title: o.titulo } })) },
      },
    };
  }
  return {
    ...base,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: corto(m.cuerpo || m.texto, 1024) },
      action: {
        button: corto(m.boton || 'Ver opciones', 20),
        sections: [{ title: 'Opciones', rows: ops.slice(0, 10).map((o) => ({ id: o.id, title: corto(o.titulo, 24), ...(o.detalle || o.titulo.length > 24 ? { description: corto(o.detalle || o.titulo, 72) } : {}) })) }],
      },
    },
  };
}

export async function enviar(tel, m) {
  return graph(`/${process.env.WHATSAPP_PHONE_ID}/messages`, { method: 'POST', body: armarMensaje(tel, m) });
}

// Fuera de las 24 horas desde el último mensaje del cliente, WhatsApp solo deja mandar plantillas aprobadas
export async function enviarPlantilla(tel, texto) {
  const plano = String(texto).replace(/\s*\n\s*/g, ' · ').replace(/\s{4,}/g, '   ').slice(0, 1000);
  return graph(`/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      to: tel,
      type: 'template',
      template: {
        name: process.env.WHATSAPP_PLANTILLA || 'talisto_aviso',
        language: { code: process.env.WHATSAPP_PLANTILLA_IDIOMA || 'es' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: plano }] }],
      },
    },
  });
}

export async function marcarLeido(idMensaje) {
  return graph(`/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', status: 'read', message_id: idMensaje },
  }).catch(() => null);
}

// Baja una foto que mandó el cliente (máximo 8 MB)
export async function bajarMedia(idMedia) {
  const info = await graph(`/${idMedia}`);
  if (Number(info.file_size || 0) > 8 * 1024 * 1024) throw new Error('La foto es muy grande');
  const r = await fetch(info.url, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('No se pudo bajar la foto');
  return { datos: Buffer.from(await r.arrayBuffer()), tipo: info.mime_type || 'image/jpeg' };
}

// Lo que mandó el cliente, en un formato simple para el bot
export function leerEntrante(m) {
  const e = { id: m.id, tel: m.from, tipo: m.type, texto: '', opcion: null, ubicacion: null, imagen: null };
  if (m.type === 'text') e.texto = m.text?.body || '';
  else if (m.type === 'interactive') {
    const r = m.interactive?.button_reply || m.interactive?.list_reply;
    e.opcion = r?.id || null;
    e.texto = r?.title || '';
  } else if (m.type === 'button') {
    e.texto = m.button?.text || '';
  } else if (m.type === 'location') {
    e.ubicacion = { lat: m.location?.latitude, lng: m.location?.longitude, nombre: m.location?.name || '', direccion: m.location?.address || '' };
  } else if (m.type === 'image' || (m.type === 'document' && /^image\//.test(m.document?.mime_type || ''))) {
    e.imagen = { id: (m.image || m.document)?.id, tipo: (m.image || m.document)?.mime_type };
    e.texto = (m.image || m.document)?.caption || '';
  }
  return e;
}
