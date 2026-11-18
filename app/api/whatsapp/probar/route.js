// Admin: probar el bot sin WhatsApp (no crea cuentas ni publica pedidos).
import { clienteUsuario } from '@/lib/servidor';
import { responder } from '@/lib/bot';
import { geocodificar, inverso } from '@/lib/whatsappServidor';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { usuario, db } = await clienteUsuario(request);
  if (!usuario) return Response.json({ error: 'Tenés que iniciar sesión.' }, { status: 401 });
  const { data: yo } = await db.from('perfiles').select('es_admin').eq('id', usuario.id).maybeSingle();
  if (!yo?.es_admin) return Response.json({ error: 'Solo para administradores.' }, { status: 403 });

  const { conv = {}, entrada = {} } = await request.json().catch(() => ({}));
  const [{ data: cfg }, { data: cats }, { data: bots }] = await Promise.all([
    db.from('configuracion').select('*').eq('id', 1).maybeSingle(),
    db.from('categorias').select('id, nombre, orden').eq('activa', true).order('orden'),
    db.from('bot_rubros').select('*'),
  ]);
  const porId = Object.fromEntries((bots || []).map((b) => [b.categoria_id, b]));
  const rubros = (cats || [])
    .filter((k) => porId[k.id]?.activo !== false)
    .map((k) => ({ id: k.id, nombre: k.nombre, palabras: porId[k.id]?.palabras || [], preguntas: porId[k.id]?.preguntas || [], pide_fotos: porId[k.id]?.pide_fotos !== false, conBot: !!porId[k.id] }))
    .sort((a, b) => Number(b.conBot) - Number(a.conBot));

  const prueba = {
    estado: async () => conv.simulado || null,
    subirFoto: async () => `prueba/foto-${Date.now()}.jpg`,
    geocodificar: (t) => geocodificar(t).catch(() => null),
    inverso: (a, b) => inverso(a, b).catch(() => null),
    publicar: async () => ({ id: 'prueba', numero: 'de prueba' }),
    cancelar: async () => null,
    aceptarCotizacion: async () => null,
    confirmar: async () => null,
    reclamar: async () => null,
    calificar: async () => null,
    linkPago: async () => 'https://www.mercadopago.com.uy/ (link de prueba)',
    pedirAyuda: async () => null,
  };
  try {
    const r = await responder({
      conv: { paso: conv.paso || 'inicio', datos: conv.datos || {}, nombre: conv.nombre || 'Prueba' },
      entrada: { texto: String(entrada.texto || '').slice(0, 500), opcion: entrada.opcion || null, ubicacion: entrada.ubicacion || null, imagen: entrada.imagen ? { id: 'prueba' } : null },
      acc: prueba,
      rubros,
      cfg: { bienvenida: cfg?.whatsapp_bienvenida, precio_visita: cfg?.precio_visita, precio_urgencia: cfg?.urgencia_activa ? cfg?.precio_urgencia : null },
    });
    // después de "publicar", la prueba vuelve a empezar
    const fin = r.paso === 'esperando';
    return Response.json({ mensajes: r.mensajes, conv: fin ? { paso: 'inicio', datos: {}, nombre: r.nombre } : { paso: r.paso, datos: r.datos, nombre: r.nombre } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
