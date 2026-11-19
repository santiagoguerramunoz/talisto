// Solo para el servidor: atiende los mensajes de WhatsApp con el bot y manda los avisos pendientes.
import crypto from 'node:crypto';
import { mp, mpConfigurado, supabaseAdmin } from './servidor';
import { bajarMedia, enviar, enviarPlantilla, leerEntrante, marcarLeido, whatsappConfigurado } from './whatsapp';
import { departamentoDe, responder } from './bot';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const AGENTE = { 'User-Agent': 'TaListo/1.0 (talisto-ashen.vercel.app)', Accept: 'application/json', 'Accept-Language': 'es' };

// Dirección escrita → punto en el mapa y departamento (OpenStreetMap, solo Uruguay)
export async function geocodificar(texto) {
  const r = await fetch(`${NOMINATIM}/search?format=jsonv2&addressdetails=1&countrycodes=uy&limit=1&q=${encodeURIComponent(texto)}`, {
    headers: AGENTE, signal: AbortSignal.timeout(6000),
  });
  const x = (await r.json().catch(() => []))?.[0];
  if (!x) return null;
  const a = x.address || {};
  return {
    lat: x.address?.house_number ? Number(x.lat) : null, // sin número de puerta el punto puede quedar lejos: solo la zona
    lng: x.address?.house_number ? Number(x.lon) : null,
    departamento: departamentoDe(a.state),
    localidad: a.suburb || a.neighbourhood || a.city_district || a.city || a.town || a.village || null,
  };
}

export async function inverso(lat, lng) {
  const r = await fetch(`${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lng}`, { headers: AGENTE, signal: AbortSignal.timeout(6000) });
  const x = await r.json().catch(() => null);
  if (!x?.address) return null;
  const a = x.address;
  return {
    departamento: departamentoDe(a.state),
    localidad: a.suburb || a.neighbourhood || a.city_district || a.city || a.town || a.village || null,
    direccion: [a.road, a.house_number].filter(Boolean).join(' ') || null,
  };
}

async function configuracion(db) {
  const { data } = await db.from('configuracion').select('*').eq('id', 1).maybeSingle();
  return data || {};
}

// Rubros para el bot: todos los activos; primero los que tienen preguntas
async function rubrosBot(db) {
  const [{ data: cats }, { data: bots }] = await Promise.all([
    db.from('categorias').select('id, nombre, orden').eq('activa', true).order('orden'),
    db.from('bot_rubros').select('*'),
  ]);
  const porId = Object.fromEntries((bots || []).map((b) => [b.categoria_id, b]));
  return (cats || [])
    .filter((k) => porId[k.id]?.activo !== false)
    .map((k) => ({ id: k.id, nombre: k.nombre, palabras: porId[k.id]?.palabras || [], preguntas: porId[k.id]?.preguntas || [], pide_fotos: porId[k.id]?.pide_fotos !== false, conBot: !!porId[k.id] }))
    .sort((a, b) => Number(b.conBot) - Number(a.conBot));
}

// Link de pago de Mercado Pago para una operación (si ya existe, el mismo)
export async function linkPago(db, opId, origen) {
  const { data: op } = await db.rpc('wa_operacion_a_pagar', { p_op: opId });
  if (!op) return null;
  if (op.preferencia) return `https://www.mercadopago.com.uy/checkout/v1/redirect?pref_id=${op.preferencia}`;
  if (!mpConfigurado()) return null;
  const volver = (estado) => `${origen}/match/pago-whatsapp?estado=${estado}`;
  const pref = await mp('/checkout/preferences', {
    method: 'POST',
    idempotencia: `wa-${op.id}`,
    body: {
      items: [{ id: op.id, title: op.titulo, description: `TaListo! Match · ${op.profesional || 'técnico'}`, quantity: 1, unit_price: Number(op.importe), currency_id: 'UYU' }],
      external_reference: `match:${op.id}`,
      back_urls: { success: volver('ok'), failure: volver('error'), pending: volver('pendiente') },
      auto_return: 'approved',
      notification_url: `${origen}/api/mercadopago/webhook?source_news=webhooks`,
      binary_mode: true,
      expires: true,
      expiration_date_to: op.vence,
      statement_descriptor: 'TALISTO',
    },
  });
  await db.rpc('match_guardar_preferencia', { p_op: op.id, p_pref: pref.id });
  return pref.init_point;
}

async function registrar(db, conversacion, direccion, m, extra = {}) {
  const { error } = await db.from('wa_mensajes').insert({ conversacion_id: conversacion, direccion, texto: (m.texto || '').slice(0, 4096), tipo: m.tipo || 'texto', ...extra });
  return error;
}

// La cuenta del cliente: se crea la primera vez que hace falta (foto o pedido), con su teléfono
async function asegurarUsuario(db, conv, nombre) {
  if (conv.usuario_id) return conv.usuario_id;
  const meta = { rol: 'cliente', nombre: nombre || conv.nombre || '', telefono: conv.telefono };
  let uid = null;
  const a = await db.auth.admin.createUser({ phone: conv.telefono, phone_confirm: true, user_metadata: meta });
  uid = a.data?.user?.id || null;
  if (!uid) {
    const { data: p } = await db.from('perfiles').select('id').eq('telefono', conv.telefono).limit(1).maybeSingle();
    uid = p?.id || null;
  }
  if (!uid) {
    const b = await db.auth.admin.createUser({ email: `wa${conv.telefono}@whatsapp.talisto.uy`, email_confirm: true, user_metadata: meta });
    uid = b.data?.user?.id || null;
    if (!uid) throw new Error('No pudimos crear tu cuenta');
  }
  await db.from('wa_conversaciones').update({ usuario_id: uid }).eq('id', conv.id);
  conv.usuario_id = uid;
  return uid;
}

function accionesReales(db, conv, origen) {
  const rpc = async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(error.message.replace(/^.*?: /, ''));
    return data;
  };
  return {
    estado: async () => (conv.usuario_id ? rpc('wa_estado', { p_usuario: conv.usuario_id }) : null),
    subirFoto: async (imagen) => {
      const uid = await asegurarUsuario(db, conv);
      const { datos, tipo } = await bajarMedia(imagen.id);
      const ext = tipo.includes('png') ? 'png' : tipo.includes('webp') ? 'webp' : 'jpg';
      const ruta = `${uid}/wa-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
      const { error } = await db.storage.from('match').upload(ruta, datos, { contentType: tipo, upsert: false });
      if (error) throw error;
      return ruta;
    },
    geocodificar,
    inverso,
    publicar: async (pedido, nombre) => {
      const uid = await asegurarUsuario(db, conv, nombre);
      if (nombre) await db.from('perfiles').update({ nombre }).eq('id', uid).eq('nombre', '');
      return rpc('wa_crear_pedido', { p_usuario: uid, p: pedido });
    },
    cancelar: (sol) => rpc('wa_cancelar', { p_usuario: conv.usuario_id, p_solicitud: sol }),
    aceptarCotizacion: (cot) => rpc('wa_aceptar_cotizacion', { p_usuario: conv.usuario_id, p_cotizacion: cot }),
    confirmar: (op) => rpc('wa_confirmar', { p_usuario: conv.usuario_id, p_op: op }),
    reclamar: (op, texto) => rpc('wa_reclamar', { p_usuario: conv.usuario_id, p_op: op, p_texto: texto }),
    calificar: (op, p) => rpc('wa_calificar', { p_usuario: conv.usuario_id, p_op: op, p_puntualidad: p.puntualidad, p_velocidad: p.velocidad, p_desempeno: p.desempeno }),
    linkPago: (op) => linkPago(db, op, origen).catch(() => null),
    pedirAyuda: async () => {
      await db.from('wa_conversaciones').update({ humano: true }).eq('id', conv.id);
      const { data: admins } = await db.from('perfiles').select('id').eq('es_admin', true);
      if (admins?.length) {
        await db.from('notificaciones').insert(admins.map((a) => ({
          usuario_id: a.id, tipo: 'whatsapp', titulo: 'Piden hablar con una persona por WhatsApp',
          cuerpo: `${conv.nombre || 'Cliente'} (+${conv.telefono})`, url: '/admin/whatsapp',
        })));
      }
    },
  };
}

// Un mensaje que llegó de WhatsApp
export async function atenderMensaje(m, perfilNombre, origen) {
  const db = supabaseAdmin();
  const entrada = leerEntrante(m);
  const tel = String(entrada.tel || '').replace(/\D/g, '');
  if (!/^[0-9]{8,15}$/.test(tel)) return;

  let { data: conv } = await db.from('wa_conversaciones').select('*').eq('telefono', tel).maybeSingle();
  if (!conv) {
    const r = await db.from('wa_conversaciones').insert({ telefono: tel, nombre: perfilNombre ? String(perfilNombre).slice(0, 80) : null }).select().single();
    conv = r.data || (await db.from('wa_conversaciones').select('*').eq('telefono', tel).maybeSingle()).data;
  }
  if (!conv) return;
  // el mismo mensaje no se atiende dos veces (WhatsApp reintenta)
  const dup = await registrar(db, conv.id, 'entrante', { texto: entrada.texto, tipo: entrada.tipo }, {
    wa_id: entrada.id, datos: { opcion: entrada.opcion, ubicacion: entrada.ubicacion, imagen: entrada.imagen },
  });
  if (dup) return;
  await db.from('wa_conversaciones').update({ ultimo_entrante: new Date().toISOString() }).eq('id', conv.id);
  marcarLeido(entrada.id);
  if (conv.humano) return; // la atiende una persona desde el admin

  const cfg = await configuracion(db);
  let respuesta;
  if (cfg.whatsapp_activo === false) {
    respuesta = { mensajes: [{ texto: 'Por ahora no estamos tomando pedidos por WhatsApp. Podés pedir un técnico en la app de TaListo!.' }], paso: conv.paso, datos: conv.datos, nombre: conv.nombre };
  } else {
    respuesta = await responder({
      conv, entrada, acc: accionesReales(db, conv, origen), rubros: await rubrosBot(db),
      cfg: { bienvenida: cfg.whatsapp_bienvenida, precio_visita: cfg.precio_visita, precio_urgencia: cfg.urgencia_activa ? cfg.precio_urgencia : null },
    });
  }
  // fotos que llegaron juntas: no se pierde ninguna
  let datos = respuesta.datos || {};
  if (Array.isArray(datos.fotos)) {
    const { data: ahora } = await db.from('wa_conversaciones').select('datos').eq('id', conv.id).maybeSingle();
    const previas = Array.isArray(ahora?.datos?.fotos) && ahora.datos.rubro === datos.rubro ? ahora.datos.fotos : [];
    datos = { ...datos, fotos: [...new Set([...previas, ...datos.fotos])].slice(0, 5) };
  }
  await db.from('wa_conversaciones').update({
    paso: respuesta.paso, datos, nombre: respuesta.nombre, actualizado_en: new Date().toISOString(),
    ...(datos.solicitud ? { solicitud_id: datos.solicitud } : {}),
  }).eq('id', conv.id);
  for (const msg of respuesta.mensajes) {
    try {
      const r = await enviar(tel, msg);
      await registrar(db, conv.id, 'saliente', msg, { wa_id: r?.messages?.[0]?.id || null, tipo: msg.opciones?.length ? 'opciones' : 'texto' });
    } catch (e) {
      await registrar(db, conv.id, 'saliente', msg, { error: e.message.slice(0, 300) });
    }
  }
}

// Avisos pendientes (técnico tomó, cotización, pago confirmado, visita a confirmar…)
export async function enviarPendientes(origen) {
  if (!whatsappConfigurado()) return 0;
  const db = supabaseAdmin();
  await db.rpc('match_procesar_vencidos');
  const { data: filas } = await db.rpc('wa_tomar_salida', { p_limite: 30 });
  let n = 0;
  for (const f of filas || []) {
    let texto = f.texto;
    let error = null;
    try {
      if (!f.telefono) throw new Error('sin teléfono');
      if (f.operacion_pago) {
        const link = await linkPago(db, f.operacion_pago, origen);
        if (!link) {
          await db.from('wa_salida').update({ enviado_en: new Date().toISOString(), error: 'el pago ya no estaba pendiente' }).eq('id', f.id);
          continue;
        }
        texto = `${texto}\n${link}`;
      }
      const dentro24 = f.ultimo_entrante && Date.now() - new Date(f.ultimo_entrante).getTime() < 23.5 * 3600e3;
      const r = dentro24 ? await enviar(f.telefono, { texto }) : await enviarPlantilla(f.telefono, texto);
      const { data: conv } = await db.from('wa_conversaciones').select('id').eq('telefono', f.telefono).maybeSingle();
      if (conv) await registrar(db, conv.id, 'saliente', { texto }, { wa_id: r?.messages?.[0]?.id || null, tipo: dentro24 ? 'aviso' : 'plantilla' });
      n += 1;
    } catch (e) {
      error = e.message.slice(0, 300);
    }
    await db.from('wa_salida').update(error ? { error } : { enviado_en: new Date().toISOString(), error: null }).eq('id', f.id);
  }
  return n;
}
