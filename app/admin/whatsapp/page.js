'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '@/components/Icon';
import Logo from '@/components/Logo';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/util';
import { fechaHora } from '@/lib/match';

const PESTANAS = [
  ['probar', 'Probar el bot'],
  ['preguntas', 'Preguntas por rubro'],
  ['charlas', 'Conversaciones'],
  ['config', 'Configuración'],
];

export default function AdminWhatsapp() {
  const router = useRouter();
  const [listo, setListo] = useState(false);
  const [ver, setVer] = useState('probar');
  const [estado, setEstado] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return router.replace('/login?volver=/admin/whatsapp');
      const { data: p } = await supabase.from('perfiles').select('es_admin, rol').eq('id', data.session.user.id).maybeSingle();
      if (!p?.es_admin) return router.replace(p?.rol === 'profesional' ? '/panel' : '/inicio');
      setListo(true);
      fetch('/api/whatsapp').then((r) => r.json()).then(setEstado).catch(() => setEstado({ configurado: false }));
    })();
  }, [router]);

  if (!listo) return <div className="grid min-h-dvh place-items-center text-tinta-400">Cargando…</div>;
  return (
    <main className="mx-auto min-h-dvh max-w-5xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-12">
      <header className="flex items-center gap-3 py-2">
        <Link href="/admin" className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver a Administración"><Icon name="izq" /></Link>
        <Logo />
      </header>
      <h1 className="mt-4 flex items-center gap-2 text-2xl font-extrabold"><Icon name="whatsapp" className="h-6 w-6 text-menta-400" /> WhatsApp</h1>
      <p className={`mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${estado?.configurado ? 'bg-menta-500/15 text-menta-300' : 'bg-amber-400/15 text-amber-200'}`}>
        <span className={`h-2 w-2 rounded-full ${estado?.configurado ? 'bg-menta-400' : 'bg-amber-300'}`} />
        {estado === null ? 'Revisando…' : estado.configurado ? 'Conectado a WhatsApp' : 'Falta conectar WhatsApp (claves en Vercel)'}
      </p>
      <nav className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
        {PESTANAS.map(([v, t]) => (
          <button key={v} type="button" onClick={() => setVer(v)} className={`chip shrink-0 ${ver === v ? 'chip-activo' : ''}`}>{t}</button>
        ))}
      </nav>
      <div className="mt-4">
        {ver === 'probar' && <Probar />}
        {ver === 'preguntas' && <Preguntas />}
        {ver === 'charlas' && <Charlas />}
        {ver === 'config' && <Config configurado={estado?.configurado} />}
      </div>
    </main>
  );
}

async function token() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

// ---------------------------------------------------------------- simulador
function Probar() {
  const [conv, setConv] = useState({ paso: 'inicio', datos: {} });
  const [mensajes, setMensajes] = useState([]);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const fin = useRef(null);

  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' });
  }, [mensajes]);

  async function mandar(entrada, mostrar) {
    setMensajes((m) => [...m, { yo: true, texto: mostrar }]);
    setTexto('');
    setOcupado(true);
    const r = await fetch('/api/whatsapp/probar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ conv, entrada }),
    });
    const j = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) return setMensajes((m) => [...m, { texto: `⚠️ ${j.error || 'No se pudo probar'}` }]);
    setConv(j.conv);
    setMensajes((m) => [...m, ...j.mensajes]);
  }

  return (
    <section className="tarjeta overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-navy-800 px-4 py-3">
        <p className="text-sm text-tinta-300">Escribí como si fueras un cliente. No se crea nada ni se manda a WhatsApp.</p>
        <button type="button" className="chip shrink-0 text-xs" onClick={() => { setConv({ paso: 'inicio', datos: {} }); setMensajes([]); }}>
          <Icon name="repetir" className="h-4 w-4" /> Empezar de nuevo
        </button>
      </div>
      <div className="max-h-[60vh] min-h-[18rem] space-y-2 overflow-y-auto bg-[#0b141a] p-3">
        {mensajes.length === 0 && <p className="py-10 text-center text-sm text-tinta-500">Probá con: &ldquo;Hola, el aire acondicionado no enfría&rdquo;</p>}
        {mensajes.map((m, k) => (
          <div key={k} className={`flex ${m.yo ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-line ${m.yo ? 'bg-[#005c4b] text-white' : 'bg-[#202c33] text-[#e9edef]'}`}>
              {m.opciones?.length ? m.cuerpo || m.texto : m.texto}
              {m.opciones?.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {m.opciones.map((o) => (
                    <button key={o.id} type="button" disabled={ocupado || k !== mensajes.length - 1} onClick={() => mandar({ opcion: o.id, texto: o.titulo }, o.titulo)}
                      className="rounded-lg border border-white/15 px-2 py-1.5 text-left text-xs text-[#53bdeb] disabled:opacity-50">
                      {o.titulo}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {ocupado && <p className="text-xs text-tinta-500">escribiendo…</p>}
        <div ref={fin} />
      </div>
      <form className="flex gap-2 border-t border-navy-800 p-3" onSubmit={(e) => { e.preventDefault(); if (texto.trim()) mandar({ texto }, texto); }}>
        <input className="campo flex-1" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Mensaje" />
        <button type="button" className="btn btn-sec px-3" title="Mandar una foto de prueba" disabled={ocupado} onClick={() => mandar({ imagen: true }, '📷 (foto)')}><Icon name="camara" className="h-5 w-5" /></button>
        <button type="button" className="btn btn-sec px-3" title="Mandar una ubicación de prueba" disabled={ocupado}
          onClick={() => mandar({ ubicacion: { lat: -34.9077, lng: -56.1601, direccion: 'Av. Brasil 2500' } }, '📍 Ubicación')}><Icon name="pin" className="h-5 w-5" /></button>
        <button className="btn btn-menta px-4" disabled={ocupado || !texto.trim()}>Enviar</button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- preguntas por rubro
function Preguntas() {
  const [rubros, setRubros] = useState(null);
  const [abierto, setAbierto] = useState(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    const [{ data: cats, error: e1 }, { data: bots, error: e2 }] = await Promise.all([
      supabase.from('categorias').select('id, nombre, orden').eq('activa', true).order('orden'),
      supabase.from('bot_rubros').select('*'),
    ]);
    if (e1 || e2) return setError(mensajeError(e1 || e2) + ' (¿corriste el SQL 23?)');
    const porId = Object.fromEntries((bots || []).map((b) => [b.categoria_id, b]));
    setRubros((cats || []).map((k) => ({ ...k, bot: porId[k.id] || null })));
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error) return <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>;
  if (!rubros) return <p className="py-8 text-center text-sm text-tinta-400">Cargando…</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-tinta-300">
        El bot reconoce el rubro por las palabras clave, hace estas preguntas con opciones y después pide detalle, fotos, dirección y cuándo. Un rubro sin preguntas pasa directo a &ldquo;contanos qué pasa&rdquo;.
      </p>
      {rubros.map((r) => (
        <div key={r.id} className="tarjeta">
          <button type="button" className="flex w-full items-center justify-between gap-2 p-3 text-left" onClick={() => setAbierto(abierto === r.id ? null : r.id)}>
            <span className="min-w-0">
              <b className="block">{r.nombre}</b>
              <span className="text-xs text-tinta-400">
                {r.bot?.activo === false ? 'No aparece en el bot' : `${r.bot?.preguntas?.length || 0} preguntas · ${r.bot?.palabras?.length || 0} palabras clave`}
              </span>
            </span>
            <Icon name={abierto === r.id ? 'arriba' : 'abajo'} className="h-4 w-4 shrink-0 text-tinta-400" />
          </button>
          {abierto === r.id && <EditarRubro r={r} onGuardado={() => { setAbierto(null); cargar(); }} />}
        </div>
      ))}
    </div>
  );
}

function EditarRubro({ r, onGuardado }) {
  const b = r.bot || {};
  const [f, setF] = useState({
    activo: b.activo !== false,
    pide_fotos: b.pide_fotos !== false,
    palabras: (b.palabras || []).join(', '),
    preguntas: (b.preguntas || []).map((q) => ({ texto: q.texto || '', opciones: (q.opciones || []).join('\n'), libre: !!q.libre })),
  });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const poner = (i, cambio) => setF({ ...f, preguntas: f.preguntas.map((q, k) => (k === i ? { ...q, ...cambio } : q)) });

  async function guardar() {
    setOcupado(true);
    setError('');
    const fila = {
      categoria_id: r.id,
      activo: f.activo,
      pide_fotos: f.pide_fotos,
      palabras: f.palabras.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 40),
      preguntas: f.preguntas
        .map((q) => ({ texto: q.texto.trim(), opciones: q.opciones.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 10), libre: q.libre }))
        .filter((q) => q.texto),
      actualizado_en: new Date().toISOString(),
    };
    const { error: err } = await supabase.from('bot_rubros').upsert(fila);
    setOcupado(false);
    if (err) return setError(mensajeError(err));
    onGuardado();
  }

  return (
    <div className="space-y-3 border-t border-navy-800 p-3">
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} /> Aparece en el bot</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={f.pide_fotos} onChange={(e) => setF({ ...f, pide_fotos: e.target.checked })} /> Pide fotos</label>
      </div>
      <label className="block">
        <span className="etiqueta">Palabras clave (separadas por coma)</span>
        <input className="campo" value={f.palabras} onChange={(e) => setF({ ...f, palabras: e.target.value })} placeholder="aire, split, no enfría" />
      </label>
      {f.preguntas.map((q, i) => (
        <div key={i} className="space-y-2 rounded-xl bg-navy-850 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="etiqueta">Pregunta {i + 1}</span>
            <button type="button" className="text-xs text-red-300" onClick={() => setF({ ...f, preguntas: f.preguntas.filter((_, k) => k !== i) })}>Quitar</button>
          </div>
          <input className="campo" value={q.texto} onChange={(e) => poner(i, { texto: e.target.value })} placeholder="¿Cuál es el problema?" />
          <textarea className="campo min-h-[6rem] text-sm" value={q.opciones} onChange={(e) => poner(i, { opciones: e.target.value })} placeholder={'Una opción por línea (hasta 10)\nNo prende\nPrende pero no enfría'} />
          <label className="flex items-center gap-2 text-xs text-tinta-300"><input type="checkbox" className="h-4 w-4" checked={q.libre} onChange={(e) => poner(i, { libre: e.target.checked })} /> También puede responder con sus palabras</label>
        </div>
      ))}
      <button type="button" className="chip text-xs" onClick={() => setF({ ...f, preguntas: [...f.preguntas, { texto: '', opciones: '', libre: false }] })}>
        <Icon name="mas" className="h-4 w-4" /> Agregar pregunta
      </button>
      {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      <button type="button" className="btn btn-menta w-full py-2.5" disabled={ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
    </div>
  );
}

// ---------------------------------------------------------------- conversaciones
function Charlas() {
  const [lista, setLista] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    const { data, error: err } = await supabase.from('wa_conversaciones').select('*').order('actualizado_en', { ascending: false }).limit(50);
    if (err) return setError(mensajeError(err) + ' (¿corriste el SQL 23?)');
    setLista(data || []);
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error) return <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>;
  if (!lista) return <p className="py-8 text-center text-sm text-tinta-400">Cargando…</p>;
  if (!lista.length) return <p className="tarjeta p-5 text-center text-sm text-tinta-300">Todavía no escribió nadie por WhatsApp.</p>;
  return (
    <div className="space-y-2">
      {lista.map((c) => (
        <div key={c.id} className="tarjeta">
          <button type="button" className="flex w-full items-center justify-between gap-2 p-3 text-left" onClick={() => setAbierta(abierta === c.id ? null : c.id)}>
            <span className="min-w-0">
              <b className="block">{c.nombre || 'Sin nombre'} <span className="font-normal text-tinta-400">+{c.telefono}</span></b>
              <span className="text-xs text-tinta-400">{fechaHora(c.actualizado_en)} · {c.humano ? 'La atiende una persona' : `Bot: ${c.paso}`}</span>
            </span>
            {c.humano && <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-200">Persona</span>}
          </button>
          {abierta === c.id && <Charla c={c} onCambio={cargar} />}
        </div>
      ))}
    </div>
  );
}

function Charla({ c, onCambio }) {
  const [msgs, setMsgs] = useState(null);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('wa_mensajes').select('*').eq('conversacion_id', c.id).order('creado_en', { ascending: false }).limit(60);
    setMsgs((data || []).reverse());
  }, [c.id]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  async function enviar(cuerpo) {
    setOcupado(true);
    setError('');
    const r = await fetch('/api/whatsapp/responder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ conversacion: c.id, ...cuerpo }),
    });
    const j = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) return setError(j.error || 'No se pudo');
    setTexto('');
    cargar();
    onCambio();
  }

  return (
    <div className="border-t border-navy-800">
      <div className="max-h-80 space-y-1.5 overflow-y-auto bg-[#0b141a] p-3">
        {(msgs || []).map((m) => (
          <div key={m.id} className={`flex ${m.direccion === 'saliente' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-2.5 py-1.5 text-xs whitespace-pre-line ${m.direccion === 'saliente' ? 'bg-[#005c4b] text-white' : 'bg-[#202c33] text-[#e9edef]'}`}>
              {m.texto || (m.tipo === 'location' ? '📍 Ubicación' : m.tipo === 'image' ? '📷 Foto' : `(${m.tipo})`)}
              <span className="mt-0.5 block text-[10px] opacity-60">{fechaHora(m.creado_en)}{m.error ? ` · ⚠️ ${m.error}` : ''}{m.tipo === 'persona' ? ' · admin' : ''}</span>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="m-3 rounded-xl bg-red-500/10 p-2 text-xs text-red-300">{error}</p>}
      <form className="flex gap-2 p-3" onSubmit={(e) => { e.preventDefault(); if (texto.trim()) enviar({ texto }); }}>
        <input className="campo flex-1" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Responder como TaListo! (el bot se pausa)" />
        <button className="btn btn-menta px-4" disabled={ocupado || !texto.trim()}>Enviar</button>
      </form>
      {c.humano && (
        <div className="px-3 pb-3">
          <button type="button" className="chip text-xs" disabled={ocupado} onClick={() => enviar({ bot: true })}>Devolverle la charla al bot</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- configuración
function Config({ configurado }) {
  const [f, setF] = useState(null);
  const [ok, setOk] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const url = typeof window !== 'undefined' ? `${window.location.origin}/api/whatsapp` : '/api/whatsapp';

  useEffect(() => {
    supabase.from('configuracion').select('whatsapp_activo, whatsapp_numero, whatsapp_bienvenida, cotizacion_min, cotizacion_max').eq('id', 1).maybeSingle()
      .then(({ data, error: err }) => (err ? setError(mensajeError(err) + ' (¿corriste el SQL 23?)') : setF(data)));
  }, []);

  async function guardar() {
    setOcupado(true);
    setError('');
    setOk('');
    const { error: err } = await supabase.from('configuracion').update({
      whatsapp_activo: !!f.whatsapp_activo,
      whatsapp_numero: (f.whatsapp_numero || '').trim() || null,
      whatsapp_bienvenida: (f.whatsapp_bienvenida || '').trim().slice(0, 500) || '¡Hola! Soy el asistente de TaListo! 👋',
      cotizacion_min: Math.max(1, Math.round(Number(f.cotizacion_min) || 300)),
      cotizacion_max: Math.max(1, Math.round(Number(f.cotizacion_max) || 30000)),
    }).eq('id', 1);
    setOcupado(false);
    if (err) return setError(mensajeError(err));
    setOk('Guardado.');
  }

  if (error && !f) return <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>;
  if (!f) return <p className="py-8 text-center text-sm text-tinta-400">Cargando…</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <section className="tarjeta space-y-3 p-4">
        <h2 className="font-bold">El bot</h2>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Tomar pedidos por WhatsApp</span>
          <input type="checkbox" className="h-5 w-5" checked={!!f.whatsapp_activo} onChange={(e) => setF({ ...f, whatsapp_activo: e.target.checked })} />
        </label>
        <label className="block">
          <span className="etiqueta">Número de WhatsApp de TaListo! (para mostrar)</span>
          <input className="campo" value={f.whatsapp_numero || ''} onChange={(e) => setF({ ...f, whatsapp_numero: e.target.value })} placeholder="+598 99 123 456" />
        </label>
        <label className="block">
          <span className="etiqueta">Saludo</span>
          <textarea className="campo min-h-[4rem] text-sm" maxLength={500} value={f.whatsapp_bienvenida || ''} onChange={(e) => setF({ ...f, whatsapp_bienvenida: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="etiqueta">Cotización mínima ($)</span>
            <input type="number" className="campo" value={f.cotizacion_min ?? ''} onChange={(e) => setF({ ...f, cotizacion_min: e.target.value })} />
          </label>
          <label className="block">
            <span className="etiqueta">Cotización máxima ($)</span>
            <input type="number" className="campo" value={f.cotizacion_max ?? ''} onChange={(e) => setF({ ...f, cotizacion_max: e.target.value })} />
          </label>
        </div>
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        {ok && <p className="text-sm text-menta-300">{ok}</p>}
        <button type="button" className="btn btn-menta w-full py-2.5" disabled={ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
      </section>
      <section className="tarjeta space-y-2 p-4 text-sm">
        <h2 className="font-bold">Conectar con WhatsApp (Meta)</h2>
        <p className={configurado ? 'text-menta-300' : 'text-amber-200'}>{configurado ? 'Las claves están cargadas en Vercel.' : 'Todavía faltan las claves en Vercel.'}</p>
        <ol className="list-decimal space-y-1.5 pl-5 text-tinta-300">
          <li>En developers.facebook.com creá una app de tipo <b>Business</b> y agregale <b>WhatsApp</b>. Sumá el número de TaListo! (que no esté usado en la app de WhatsApp).</li>
          <li>En Vercel → Settings → Environment Variables cargá: <code>WHATSAPP_TOKEN</code> (token permanente de un usuario del sistema), <code>WHATSAPP_PHONE_ID</code>, <code>WHATSAPP_APP_SECRET</code> y <code>WHATSAPP_VERIFY_TOKEN</code> (un texto que inventás vos). Después, Redeploy.</li>
          <li>En WhatsApp → Configuración → Webhook poné la URL <code className="break-all">{url}</code> y el mismo <code>WHATSAPP_VERIFY_TOKEN</code>. Suscribite al campo <b>messages</b>.</li>
          <li>Creá la plantilla <code>talisto_aviso</code> (categoría Utilidad, idioma español) con el texto: <i>Novedades de tu pedido en TaListo!: {'{{1}}'}</i>. Se usa para avisar después de 24 horas sin mensajes del cliente.</li>
          <li>Cargá una forma de pago en Meta: cada mensaje del bot cuesta unos US$ 0,01.</li>
        </ol>
      </section>
    </div>
  );
}
