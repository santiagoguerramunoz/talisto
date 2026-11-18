// Bot de WhatsApp de TaListo!: hace las preguntas del rubro, pide dirección, fotos y cuándo, y publica el pedido.
// No sabe nada de WhatsApp ni de la base: recibe lo que escribió la persona y "acciones" (reales o de prueba)
// y devuelve los mensajes a mandar y el paso en que queda la charla.
import { DEPARTAMENTOS } from './util';

const TZ = 'America/Montevideo';
const MAX_FOTOS = 5;

export const norm = (t) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const pesos = (n) => '$ ' + Math.round(Number(n || 0)).toLocaleString('es-UY');
const fechaCorta = (iso) => new Date(iso).toLocaleDateString('es-UY', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const horaCorta = (iso) => new Date(iso).toLocaleTimeString('es-UY', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const diaNombre = (ymd) => {
  const t = new Date(`${ymd}T12:00:00-03:00`).toLocaleDateString('es-UY', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// Fecha de hoy en Montevideo (AAAA-MM-DD) y la hora actual
function hoyUY(ahora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    .formatToParts(ahora).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) % 24 };
}
function sumarDias(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const FRANJAS = { manana: 'de mañana (8 a 13)', tarde: 'de tarde (13 a 19)', cualquiera: 'en cualquier horario (8 a 19)' };
const DEPTOS_RAPIDOS = ['Montevideo', 'Canelones', 'Maldonado', 'Colonia', 'San José'];

export function departamentoDe(texto) {
  const t = norm(String(texto || '').replace(/departamento de/i, ''));
  if (!t) return null;
  return DEPARTAMENTOS.find((d) => norm(d) === t) || DEPARTAMENTOS.find((d) => t.includes(norm(d))) || null;
}

const op = (id, titulo, detalle) => ({ id, titulo, ...(detalle ? { detalle } : {}) });
// Mensaje con opciones: también van numeradas en el texto, así se puede responder escribiendo el número
function conOpciones(texto, opciones, boton) {
  const lineas = opciones.map((o, i) => `${i + 1}. ${o.detalle || o.titulo}`);
  return { texto: `${texto}\n\n${lineas.join('\n')}`, cuerpo: texto, opciones, boton };
}

// ¿Qué opción eligió? Por botón, por número o por el texto
export function elegir(entrada, opciones) {
  if (entrada.opcion) {
    const o = opciones.find((x) => x.id === entrada.opcion);
    if (o) return o;
  }
  const t = norm(entrada.texto);
  if (!t) return null;
  const num = t.match(/^(?:opcion |la |el )?(\d{1,2})$/);
  if (num) return opciones[Number(num[1]) - 1] || null;
  return (
    opciones.find((o) => norm(o.titulo) === t || norm(o.detalle) === t) ||
    opciones.find((o) => t.length >= 3 && (norm(o.titulo).startsWith(t) || norm(o.detalle || '').startsWith(t))) ||
    null
  );
}

// Reconoce el rubro en lo que escribió (por las palabras clave que carga el admin o por el nombre)
export function detectarRubro(texto, rubros) {
  const t = ` ${norm(texto)} `;
  if (t.trim().length < 3) return null;
  let mejor = null;
  for (const r of rubros) {
    let puntos = 0;
    for (const p of r.palabras || []) {
      const w = norm(p);
      if (w && t.includes(w.length <= 4 ? ` ${w} ` : w)) puntos += w.length;
    }
    if (t.includes(norm(r.nombre))) puntos += 50;
    if (puntos > 0 && (!mejor || puntos > mejor.puntos)) mejor = { r, puntos };
  }
  return mejor?.r || null;
}

const GLOBAL = {
  menu: ['menu', 'menú', 'inicio', 'empezar', 'reiniciar', 'volver a empezar'],
  ayuda: ['ayuda', 'persona', 'humano', 'hablar con alguien', 'hablar con una persona', 'operador'],
  cancelar: ['cancelar', 'cancela', 'cancelo', 'no quiero', 'basta'],
  cotizaciones: ['cotizaciones', 'cotizacion', 'presupuestos', 'ver cotizaciones'],
  saludo: ['hola', 'buenas', 'buen dia', 'buenos dias', 'buenas tardes', 'buenas noches', 'hi', 'hello', 'que tal'],
};
const es = (entrada, clave) => {
  const t = norm(entrada.texto);
  return GLOBAL[clave].some((w) => t === norm(w));
};

/**
 * conv: { paso, datos, nombre, actualizado_en }
 * entrada: { texto, opcion, ubicacion, imagen }
 * acc: acciones (ver /api/whatsapp y /api/whatsapp/probar)
 * cfg: { bienvenida, precio_visita, precio_urgencia, ahora? }
 * rubros: [{ id, nombre, palabras, preguntas, pide_fotos }]
 */
export async function responder({ conv, entrada, acc, cfg, rubros }) {
  const salida = [];
  const decir = (m) => salida.push(typeof m === 'string' ? { texto: m } : m);
  let paso = conv.paso || 'inicio';
  let datos = { ...(conv.datos || {}) };
  let nombre = conv.nombre || null;
  const ahora = cfg.ahora ? new Date(cfg.ahora) : new Date();

  // Una charla a medio armar de hace más de un día vuelve a empezar
  const viejo = conv.actualizado_en && ahora - new Date(conv.actualizado_en) > 24 * 3600e3;
  if (viejo && !['inicio', 'esperando'].includes(paso)) {
    paso = 'inicio';
    datos = {};
  }

  const fin = () => ({ mensajes: salida, paso, datos, nombre });
  const rubroActual = () => rubros.find((r) => r.id === datos.rubro);

  // ---------- comandos que valen siempre
  if (es(entrada, 'ayuda')) {
    await acc.pedirAyuda();
    decir('Listo 🙋 Le avisamos a una persona de TaListo!: te va a escribir por acá en cuanto pueda.');
    return fin();
  }
  if (es(entrada, 'menu')) {
    paso = 'inicio';
    datos = {};
  }

  // ---------- pasos
  const ir = async (nuevo) => {
    paso = nuevo;
    await preguntar();
  };

  async function preguntar() {
    const r = rubroActual();
    if (paso === 'rubro') {
      const lista = rubros.slice(0, 9).map((x) => op(`r:${x.id}`, x.nombre));
      decir(conOpciones('¿Qué tipo de servicio necesitás?', [...lista, op('r:otro', 'Otro rubro')], 'Elegir rubro'));
    } else if (paso === 'rubro_texto') {
      decir('Escribí qué tipo de servicio buscás (por ejemplo: herrería, vidrios, mudanza).');
    } else if (paso === 'rubro_ok') {
      decir(conOpciones(`¿Es por *${r.nombre}*?`, [op('si', 'Sí'), op('no', 'No, es otra cosa')]));
    } else if (paso === 'pregunta') {
      const q = (r.preguntas || [])[datos.i || 0];
      const ops = (q.opciones || []).map((t, k) => op(`p:${k}`, t));
      if (ops.length) decir(conOpciones(q.texto, ops, 'Elegir'));
      else decir(q.texto);
    } else if (paso === 'detalle') {
      decir(conOpciones('Si querés, contanos con tus palabras qué pasa (marca del equipo, desde cuándo, etc.).', [op('seguir', 'Seguir')]));
    } else if (paso === 'fotos') {
      decir(conOpciones(`Si podés, mandá fotos (hasta ${MAX_FOTOS}) 📷 Así el técnico lo evalúa antes de ir.`, [op('listo', 'Listo'), op('sin', 'No tengo fotos')]));
    } else if (paso === 'direccion') {
      decir('¿Dónde es? 📍 Mandá tu ubicación (tocá el clip 📎 > Ubicación) o escribí la dirección: calle, número y barrio o ciudad.');
    } else if (paso === 'depto') {
      decir(conOpciones('¿En qué departamento?', [...DEPTOS_RAPIDOS.map((d) => op(`d:${d}`, d)), op('d:otro', 'Otro')], 'Elegir'));
    } else if (paso === 'depto_texto') {
      decir('Escribí el departamento (por ejemplo: Paysandú).');
    } else if (paso === 'referencia') {
      decir(conOpciones('¿Algún dato para encontrarte? (apartamento, timbre, entre qué calles)', [op('seguir', 'Seguir')]));
    } else if (paso === 'cuando') {
      const { hora } = hoyUY(ahora);
      const ops = [...(hora < 19 ? [op('hoy', 'Hoy, lo antes posible')] : []), op('manana', 'Mañana'), op('otro', 'Otro día')];
      decir(conOpciones('¿Para cuándo lo necesitás?', ops));
    } else if (paso === 'fecha') {
      const { ymd } = hoyUY(ahora);
      const dias = Array.from({ length: 8 }, (_, k) => sumarDias(ymd, k + 2));
      decir(conOpciones('¿Qué día?', dias.map((d) => op(`f:${d}`, diaNombre(d))), 'Elegir día'));
    } else if (paso === 'franja') {
      decir(conOpciones('¿En qué horario?', [op('manana', 'De mañana', 'De mañana (8 a 13)'), op('tarde', 'De tarde', 'De tarde (13 a 19)'), op('cualquiera', 'Cualquier horario', 'Cualquier horario (8 a 19)')]));
    } else if (paso === 'nombre') {
      decir('¿A nombre de quién hacemos el pedido?');
    } else if (paso === 'confirmar') {
      const cuando = datos.cuando === 'hoy' ? 'Hoy, lo antes posible' : `${diaNombre(datos.fecha)}, ${FRANJAS[datos.franja]}`;
      const lineas = [
        '*Tu pedido*',
        `• Servicio: ${r.nombre}`,
        ...(datos.respuestas || []).map((x) => `• ${x.r}`),
        ...(datos.detalle ? [`• "${datos.detalle}"`] : []),
        `• Dónde: ${[datos.dir?.direccion, datos.dir?.localidad, datos.dir?.departamento].filter((x, k, a) => x && (k === 0 || !norm(a[0]).includes(norm(x)))).join(', ')}`,
        `• Cuándo: ${cuando}`,
        ...(datos.fotos?.length ? [`• Fotos: ${datos.fotos.length}`] : []),
        '',
        `La visita técnica cuesta ${pesos(cfg.precio_visita)}${cfg.precio_urgencia ? ` (${pesos(cfg.precio_urgencia)} si es urgencia o fuera de horario)` : ''}. Si un técnico te cotiza otro precio, te lo mostramos antes.`,
        'Pagás recién cuando un técnico lo toma.',
      ];
      decir(conOpciones(lineas.join('\n'), [op('publicar', 'Publicar pedido'), op('corregir', 'Empezar de nuevo'), op('cancelar', 'Cancelar')]));
    }
  }

  // Después de cada respuesta del rubro, sigue la próxima pregunta o el detalle
  const siguientePregunta = async () => {
    const r = rubroActual();
    const i = (datos.i || 0) + 1;
    if (r.preguntas?.[i]) {
      datos.i = i;
      return ir('pregunta');
    }
    return ir('detalle');
  };
  const empezarRubro = async (r) => {
    datos = { rubro: r.id, respuestas: [], fotos: [], i: 0 };
    if (r.preguntas?.length) return ir('pregunta');
    return ir('detalle');
  };
  const despuesDeFotos = async () => ir('direccion');
  const despuesDeDireccion = async () => (datos.dir?.departamento ? ir('referencia') : ir('depto'));
  const despuesDeCuando = async () => (nombre ? ir('confirmar') : ir('nombre'));

  // ---------- el estado del cliente manda: pago pendiente, visita a confirmar, pedido esperando técnico
  if (paso === 'inicio' || paso === 'esperando') {
    const est = await acc.estado();
    const o = est?.operacion;
    if (o?.estado === 'pendiente_pago') {
      const link = await acc.linkPago(o.id);
      if (es(entrada, 'cancelar') && est.solicitud?.estado === 'abierta') {
        paso = 'cancelar_ok';
        decir(conOpciones(`¿Cancelamos el pedido Nº ${est.solicitud.numero}?`, [op('si', 'Sí, cancelar'), op('no', 'No')]));
        return fin();
      }
      decir(link
        ? `Te falta pagar ${pesos(o.importe)} para confirmar la visita con ${o.profesional} 👉 ${link}\nSi no lo pagás a tiempo, el pedido vuelve a quedar disponible. Escribí *CANCELAR* para cancelarlo.`
        : 'Se venció el tiempo para pagar. Seguimos buscando técnico y te avisamos por acá.');
      paso = 'esperando';
      return fin();
    }
    if (o?.estado === 'pendiente_confirmacion' && paso !== 'confirmar_visita') {
      paso = 'confirmar_visita';
      datos = { op: o.id, profesional: o.profesional };
      decir(conOpciones(`¿Cómo salió la visita con ${o.profesional}?`, [op('bien', 'Todo bien'), op('problema', 'Tuve un problema')]));
      return fin();
    }
    if (est?.solicitud?.estado === 'abierta' && !es(entrada, 'menu')) {
      paso = 'esperando';
      datos = { solicitud: est.solicitud.id };
      const cots = est.cotizaciones || [];
      if (es(entrada, 'cancelar')) {
        paso = 'cancelar_ok';
        decir(conOpciones(`¿Cancelamos el pedido Nº ${est.solicitud.numero}?`, [op('si', 'Sí, cancelar'), op('no', 'No')]));
        return fin();
      }
      const elegida = cots.length ? elegir(entrada, cots.map((k) => op(`c:${k.id}`, `${pesos(k.importe)} · ${fechaCorta(k.inicio)} ${horaCorta(k.inicio)}`))) : null;
      if (elegida && (entrada.opcion?.startsWith('c:') || /^\d{1,2}$/.test(norm(entrada.texto)))) {
        try {
          await acc.aceptarCotizacion(elegida.id.slice(2));
          decir('¡Buenísimo! Te reservo ese técnico y te mando el link para pagar 👇');
          paso = 'inicio';
        } catch (e) {
          decir(`No se pudo: ${e.message}`);
        }
        return fin();
      }
      if (cots.length) {
        decir(conOpciones(
          `Tu pedido Nº ${est.solicitud.numero} (${est.solicitud.rubro}) tiene ${cots.length === 1 ? 'una cotización' : `${cots.length} cotizaciones`}. Elegí una para reservarla (después pagás por Mercado Pago):`,
          cots.slice(0, 9).map((k) => op(`c:${k.id}`, `${pesos(k.importe)} · ${horaCorta(k.inicio)}`,
            `${k.profesional}${k.calificacion ? ` ★${k.calificacion}` : ''} · ${fechaCorta(k.inicio)} ${horaCorta(k.inicio)} · ${pesos(k.importe)}`)),
          'Ver cotizaciones'));
      } else {
        decir(`Tu pedido Nº ${est.solicitud.numero} (${est.solicitud.rubro}) está publicado 🔎 Todavía ningún técnico lo tomó. Te escribimos por acá apenas alguien lo tome o te cotice.\nEscribí *CANCELAR* para cancelarlo o *AYUDA* para hablar con una persona.`);
      }
      return fin();
    }
    if (o?.estado === 'reserva_confirmada' && o.inicio && new Date(o.inicio) > ahora && !es(entrada, 'menu') && paso === 'esperando') {
      decir(`Tu visita con ${o.profesional} es el ${fechaCorta(o.inicio)} a las ${horaCorta(o.inicio)} ✅\nEscribí *MENU* para pedir otro servicio o *AYUDA* para hablar con una persona.`);
      return fin();
    }
    // Pedido nuevo
    if (paso === 'esperando') paso = 'inicio';
    const r = detectarRubro(entrada.texto, rubros);
    decir(cfg.bienvenida || '¡Hola! Soy el asistente de TaListo! 👋');
    if (r) {
      datos = { rubro: r.id };
      await ir('rubro_ok');
    } else {
      datos = {};
      await ir('rubro');
    }
    return fin();
  }

  if (es(entrada, 'cancelar') && !['confirmar_visita', 'reclamo', 'cancelar_ok'].includes(paso)) {
    paso = 'inicio';
    datos = {};
    decir('Listo, dejé de armar el pedido. Escribime cuando quieras empezar de nuevo.');
    return fin();
  }

  switch (paso) {
    case 'rubro_ok': {
      const o = elegir(entrada, [op('si', 'Sí'), op('no', 'No, es otra cosa')]);
      if (o?.id === 'si') await empezarRubro(rubroActual());
      else if (o?.id === 'no') await ir('rubro');
      else await preguntar();
      break;
    }
    case 'rubro': {
      const lista = [...rubros.slice(0, 9).map((x) => op(`r:${x.id}`, x.nombre)), op('r:otro', 'Otro rubro')];
      const o = elegir(entrada, lista);
      if (o?.id === 'r:otro') await ir('rubro_texto');
      else if (o) await empezarRubro(rubros.find((x) => `r:${x.id}` === o.id));
      else {
        const r = detectarRubro(entrada.texto, rubros);
        if (r) await empezarRubro(r);
        else await preguntar();
      }
      break;
    }
    case 'rubro_texto': {
      const r = detectarRubro(entrada.texto, rubros);
      if (r) await empezarRubro(r);
      else {
        decir('No encontré ese servicio 🤔');
        await ir('rubro');
      }
      break;
    }
    case 'pregunta': {
      const q = rubroActual().preguntas[datos.i || 0];
      const ops = (q.opciones || []).map((t, k) => op(`p:${k}`, t));
      const o = ops.length ? elegir(entrada, ops) : null;
      const texto = (entrada.texto || '').trim();
      if (o || (texto && (!ops.length || q.libre))) {
        datos.respuestas = [...(datos.respuestas || []), { p: q.texto, r: o ? o.titulo : texto.slice(0, 200) }];
        await siguientePregunta();
      } else {
        decir('Elegí una de las opciones (podés escribir el número).');
        await preguntar();
      }
      break;
    }
    case 'detalle': {
      const o = elegir(entrada, [op('seguir', 'Seguir')]);
      if (!o && (entrada.texto || '').trim()) datos.detalle = entrada.texto.trim().slice(0, 600);
      if (entrada.imagen) {
        paso = 'fotos';
        return manejarFoto();
      }
      if (rubroActual().pide_fotos !== false) await ir('fotos');
      else await despuesDeFotos();
      break;
    }
    case 'fotos': {
      if (entrada.imagen) return manejarFoto();
      const o = elegir(entrada, [op('listo', 'Listo'), op('sin', 'No tengo fotos')]);
      if (o || (entrada.texto || '').trim()) await despuesDeFotos();
      else await preguntar();
      break;
    }
    case 'direccion': {
      if (entrada.ubicacion?.lat) {
        const inv = await acc.inverso(entrada.ubicacion.lat, entrada.ubicacion.lng).catch(() => null);
        datos.dir = {
          lat: entrada.ubicacion.lat,
          lng: entrada.ubicacion.lng,
          direccion: entrada.ubicacion.direccion || entrada.ubicacion.nombre || inv?.direccion || 'Ubicación enviada por WhatsApp',
          localidad: inv?.localidad || null,
          departamento: inv?.departamento || null,
        };
        await despuesDeDireccion();
      } else if ((entrada.texto || '').trim().length >= 5) {
        const texto = entrada.texto.trim().slice(0, 200);
        const geo = await acc.geocodificar(texto).catch(() => null);
        datos.dir = { direccion: texto, lat: geo?.lat ?? null, lng: geo?.lng ?? null, localidad: geo?.localidad || null, departamento: geo?.departamento || departamentoDe(texto) };
        await despuesDeDireccion();
      } else {
        await preguntar();
      }
      break;
    }
    case 'depto': {
      const ops = [...DEPTOS_RAPIDOS.map((d) => op(`d:${d}`, d)), op('d:otro', 'Otro')];
      const o = elegir(entrada, ops);
      const d = o && o.id !== 'd:otro' ? o.titulo : departamentoDe(entrada.texto);
      if (d) {
        datos.dir = { ...(datos.dir || {}), departamento: d };
        await ir('referencia');
      } else if (o?.id === 'd:otro') await ir('depto_texto');
      else await preguntar();
      break;
    }
    case 'depto_texto': {
      const d = departamentoDe(entrada.texto);
      if (d) {
        datos.dir = { ...(datos.dir || {}), departamento: d };
        await ir('referencia');
      } else {
        decir('No reconocí el departamento.');
        await ir('depto');
      }
      break;
    }
    case 'referencia': {
      const o = elegir(entrada, [op('seguir', 'Seguir')]);
      if (!o && (entrada.texto || '').trim()) datos.dir = { ...datos.dir, referencia: entrada.texto.trim().slice(0, 200) };
      await ir('cuando');
      break;
    }
    case 'cuando': {
      const { ymd, hora } = hoyUY(ahora);
      const o = elegir(entrada, [...(hora < 19 ? [op('hoy', 'Hoy, lo antes posible')] : []), op('manana', 'Mañana'), op('otro', 'Otro día')]);
      if (o?.id === 'hoy') {
        Object.assign(datos, { cuando: 'hoy', fecha: null, franja: null });
        await despuesDeCuando();
      } else if (o?.id === 'manana') {
        Object.assign(datos, { cuando: 'dia', fecha: sumarDias(ymd, 1) });
        await ir('franja');
      } else if (o?.id === 'otro') await ir('fecha');
      else await preguntar();
      break;
    }
    case 'fecha': {
      const { ymd } = hoyUY(ahora);
      const dias = Array.from({ length: 8 }, (_, k) => sumarDias(ymd, k + 2));
      const o = elegir(entrada, dias.map((d) => op(`f:${d}`, diaNombre(d))));
      if (o) {
        Object.assign(datos, { cuando: 'dia', fecha: o.id.slice(2) });
        await ir('franja');
      } else await preguntar();
      break;
    }
    case 'franja': {
      const o = elegir(entrada, [op('manana', 'De mañana'), op('tarde', 'De tarde'), op('cualquiera', 'Cualquier horario')]);
      if (o) {
        datos.franja = o.id;
        await despuesDeCuando();
      } else await preguntar();
      break;
    }
    case 'nombre': {
      const t = (entrada.texto || '').trim();
      if (t.length >= 2) {
        nombre = t.slice(0, 80);
        await ir('confirmar');
      } else await preguntar();
      break;
    }
    case 'confirmar': {
      const o = elegir(entrada, [op('publicar', 'Publicar pedido'), op('corregir', 'Empezar de nuevo'), op('cancelar', 'Cancelar')]);
      if (o?.id === 'publicar') {
        const r = rubroActual();
        const resp = (datos.respuestas || []).map((x) => x.r);
        const pedido = {
          categoria_id: r.id,
          titulo: `${r.nombre}${resp[0] ? `: ${resp[0]}` : ''}`.slice(0, 120),
          descripcion: [`Pedido por WhatsApp · ${r.nombre}.`, ...(datos.respuestas || []).map((x) => `${x.p} ${x.r}`), datos.detalle ? `Cliente: "${datos.detalle}"` : '']
            .filter(Boolean).join('\n').slice(0, 2000),
          departamento: datos.dir.departamento,
          localidad: datos.dir.localidad || null,
          direccion: datos.dir.direccion,
          referencia: datos.dir.referencia || null,
          lat: datos.dir.lat ?? null,
          lng: datos.dir.lng ?? null,
          cuando: datos.cuando,
          fecha: datos.fecha || null,
          franja: datos.franja || null,
          archivos: datos.fotos || [],
        };
        try {
          const res = await acc.publicar(pedido, nombre);
          paso = 'esperando';
          datos = { solicitud: res.id };
          decir(`¡Listo! Tu pedido Nº ${res.numero} está publicado ✅\nEstamos buscando el primer técnico disponible para tu ubicación 🔎 Te escribimos por acá cuando alguien lo tome o te mande una cotización.`);
        } catch (e) {
          decir(`No pudimos publicarlo: ${e.message}`);
          decir(conOpciones('¿Qué hacemos?', [op('corregir', 'Empezar de nuevo'), op('ayuda', 'Hablar con una persona')]));
          paso = 'error';
        }
      } else if (o?.id === 'corregir') {
        datos = {};
        await ir('rubro');
      } else if (o?.id === 'cancelar') {
        paso = 'inicio';
        datos = {};
        decir('Listo, no publiqué nada. Escribime cuando quieras.');
      } else await preguntar();
      break;
    }
    case 'error': {
      const o = elegir(entrada, [op('corregir', 'Empezar de nuevo'), op('ayuda', 'Hablar con una persona')]);
      if (o?.id === 'ayuda') {
        await acc.pedirAyuda();
        decir('Listo 🙋 Una persona de TaListo! te va a escribir por acá.');
        paso = 'inicio';
      } else {
        datos = {};
        await ir('rubro');
      }
      break;
    }
    case 'cancelar_ok': {
      const o = elegir(entrada, [op('si', 'Sí, cancelar'), op('no', 'No')]);
      const est = await acc.estado();
      if (o?.id === 'si' && est?.solicitud?.estado === 'abierta') {
        try {
          await acc.cancelar(est.solicitud.id);
          decir(`Cancelé el pedido Nº ${est.solicitud.numero}. No se te cobró nada. Escribime cuando quieras pedir otro servicio.`);
        } catch (e) {
          decir(`No se pudo cancelar: ${e.message}`);
        }
        paso = 'inicio';
        datos = {};
      } else {
        paso = 'esperando';
        decir('Perfecto, sigue publicado. Te avisamos por acá.');
      }
      break;
    }
    case 'confirmar_visita': {
      const o = elegir(entrada, [op('bien', 'Todo bien'), op('problema', 'Tuve un problema')]);
      if (o?.id === 'bien') {
        try {
          await acc.confirmar(datos.op);
          paso = 'calificar';
          decir(conOpciones(`¡Gracias! Le liberamos el pago a ${datos.profesional}. ¿Cómo lo calificás?`,
            [1, 2, 3, 4, 5].map((n) => op(`e:${n}`, '★'.repeat(n), `${n} ${n === 1 ? 'estrella' : 'estrellas'}`)), 'Calificar'));
        } catch (e) {
          decir(`No se pudo confirmar: ${e.message}`);
          paso = 'inicio';
        }
      } else if (o?.id === 'problema') {
        paso = 'reclamo';
        decir('Contanos qué pasó. Mientras lo revisamos, el técnico no cobra.');
      } else {
        decir(conOpciones(`¿Cómo salió la visita con ${datos.profesional}?`, [op('bien', 'Todo bien'), op('problema', 'Tuve un problema')]));
      }
      break;
    }
    case 'calificar': {
      const o = elegir(entrada, [1, 2, 3, 4, 5].map((n) => op(`e:${n}`, '★'.repeat(n), `${n} ${n === 1 ? 'estrella' : 'estrellas'}`)));
      const n = o ? Number(o.id.slice(2)) : Number(norm(entrada.texto)) || 0;
      if (n >= 1 && n <= 5) {
        await acc.calificar(datos.op, n).catch(() => null);
        decir('¡Gracias por calificar! 🙌 Cuando necesites otro servicio, escribinos por acá.');
      }
      paso = 'inicio';
      datos = {};
      break;
    }
    case 'reclamo': {
      const t = (entrada.texto || '').trim();
      if (t.length >= 10) {
        try {
          await acc.reclamar(datos.op, t.slice(0, 2000));
          decir('Recibimos tu reclamo. Lo revisa el equipo de TaListo! y te escribimos por acá. El técnico no cobra hasta que se resuelva.');
        } catch (e) {
          decir(`No se pudo registrar: ${e.message}`);
        }
        paso = 'inicio';
        datos = {};
      } else decir('Contanos un poco más qué pasó (al menos una frase).');
      break;
    }
    default: {
      paso = 'inicio';
      datos = {};
      return responder({ conv: { paso, datos, nombre }, entrada, acc, cfg, rubros });
    }
  }
  return fin();

  async function manejarFoto() {
    datos.fotos = datos.fotos || [];
    if (datos.fotos.length >= MAX_FOTOS) {
      decir(conOpciones(`Ya tengo ${MAX_FOTOS} fotos, alcanza 👌`, [op('listo', 'Listo')]));
      return fin();
    }
    try {
      const ruta = await acc.subirFoto(entrada.imagen);
      datos.fotos = [...datos.fotos, ruta];
      decir(conOpciones(`Foto recibida (${datos.fotos.length}). Mandá otra o tocá Listo.`, [op('listo', 'Listo')]));
    } catch {
      decir(conOpciones('No pude guardar esa foto. Probá de nuevo o seguí sin fotos.', [op('listo', 'Listo')]));
    }
    paso = 'fotos';
    return fin();
  }
}
