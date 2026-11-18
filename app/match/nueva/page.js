'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import MarcoCliente, { useSesionCliente } from '@/components/MarcoCliente';
import SelectorUbicacion from '@/components/SelectorUbicacion';
import { supabase } from '@/lib/supabase';
import { DEPARTAMENTOS, mensajeError } from '@/lib/util';
import { FRANJAS, MENSAJE_FALTA_SQL, PREFERENCIAS, irAPagar, pesos, sinMatch, subirArchivos } from '@/lib/match';

const hoyISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Montevideo' });
const masDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const esTardeHoy = () => Number(new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Montevideo', hour: '2-digit', hour12: false })) >= 19;

export default function NuevaSolicitudPagina() {
  return (
    <Suspense fallback={<div className="grid min-h-dvh place-items-center text-tinta-400">Cargando…</div>}>
      <NuevaSolicitud />
    </Suspense>
  );
}

// El cliente cuenta qué necesita; TaListo! busca profesionales del rubro en su zona
function NuevaSolicitud() {
  const router = useRouter();
  const params = useSearchParams();
  const { cargando } = useSesionCliente();
  const [rubros, setRubros] = useState([]);
  const [precio, setPrecio] = useState(null);
  const [urgencia, setUrgencia] = useState(null); // { precio, activa } (SQL 21)
  const [cotiz, setCotiz] = useState(null); // precio de "el primero disponible" para lo elegido
  const [primeroActivo, setPrimeroActivo] = useState(true);
  const [adelantado, setAdelantado] = useState(false); // true = "el primero disponible" se paga al publicar (como antes)
  const [modo, setModo] = useState(params.get('modo') === 'primero' ? 'primero' : 'invitar');
  const [cuando, setCuando] = useState({ tipo: esTardeHoy() ? 'dia' : 'hoy', fecha: masDias(hoyISO(), 1), franja: 'cualquiera' });
  const [ubic, setUbic] = useState({ direccion: '', lat: null, lng: null });
  const [dirigida, setDirigida] = useState(null);
  const [f, setF] = useState({
    categoria_id: params.get('rubro') || '',
    titulo: '',
    descripcion: '',
    departamento: 'Montevideo',
    localidad: '',
    direccion: '',
    referencia: '',
    preferencia: 'cualquiera',
    urgente: false,
  });
  const [archivos, setArchivos] = useState([]);
  const [enviando, setEnviando] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const [{ data: r }, { data: c }] = await Promise.all([
        supabase.from('categorias').select('id, nombre').eq('activa', true).order('orden'),
        supabase.from('configuracion').select('*').eq('id', 1).maybeSingle(),
      ]);
      setRubros(r || []);
      setPrecio(c?.precio_visita ?? null);
      if (c?.precio_urgencia !== undefined && c.urgencia_activa) setUrgencia({ precio: c.precio_urgencia });
      setAdelantado(!!c?.primero_cobro_adelantado);
      if (c && c.primero_activo === false) {
        setPrimeroActivo(false);
        setModo('invitar');
      }
      const pro = params.get('profesional');
      if (pro) {
        const { data } = await supabase.rpc('perfil_match', { p_id: pro });
        if (data?.profesional) setDirigida(data.profesional);
      }
    })();
  }, [params]);

  // Precio de "el primero disponible": depende de cuándo (fuera del horario normal es urgencia) y de si es urgente
  const esPrimero = modo === 'primero' && !dirigida;
  useEffect(() => {
    if (!esPrimero || !urgencia) return undefined;
    let vivo = true;
    supabase
      .rpc('cotizar_primero', {
        p_cuando: cuando.tipo,
        p_fecha: cuando.tipo === 'dia' ? cuando.fecha : null,
        p_franja: cuando.tipo === 'dia' ? cuando.franja : null,
        p_urgente: f.urgente,
      })
      .then(({ data }) => vivo && setCotiz(data || null));
    return () => {
      vivo = false;
    };
  }, [esPrimero, urgencia, cuando.tipo, cuando.fecha, cuando.franja, f.urgente]);
  const precioPrimero = cotiz?.importe ?? (f.urgente && urgencia ? urgencia.precio : precio);

  const cambiar = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  function elegirArchivos(e) {
    const nuevos = [...e.target.files].filter((x) => x.type.startsWith('image/') || x.type.startsWith('video/'));
    setArchivos((a) => [...a, ...nuevos].slice(0, 8));
    e.target.value = '';
  }

  async function enviar(e) {
    e.preventDefault();
    setError('');
    if (!f.categoria_id) return setError('Elegí el rubro.');
    if (f.titulo.trim().length < 3) return setError('Poné un título corto (por ejemplo: "Salta la llave general").');
    if (f.descripcion.trim().length < 10) return setError('Contá un poco más del problema para que el profesional sepa qué llevar.');
    const primero = modo === 'primero' && !dirigida;
    if (primero && (!ubic.direccion.trim() || ubic.lat === null)) {
      return setError('Poné la dirección y marcala en el mapa (buscala, tocá el mapa o "Estoy acá"): así los técnicos ven la zona.');
    }
    try {
      let rutas = [];
      if (archivos.length) {
        setEnviando('Subiendo fotos y videos…');
        rutas = await subirArchivos(archivos, crypto.randomUUID());
      }
      setEnviando(primero ? (adelantado ? 'Preparando el pago…' : 'Publicando tu pedido…') : 'Buscando profesionales…');
      const extra = primero
        ? { modo: 'primero', direccion: ubic.direccion, lat: ubic.lat, lng: ubic.lng, cuando: cuando.tipo, fecha: cuando.tipo === 'dia' ? cuando.fecha : null, franja: cuando.tipo === 'dia' ? cuando.franja : null }
        : { lat: ubic.lat, lng: ubic.lng, direccion: ubic.direccion || f.direccion };
      const { data, error: err } = await supabase.rpc('crear_solicitud', {
        p: { ...f, ...extra, categoria_id: Number(f.categoria_id), archivos: rutas, dirigida_a: dirigida?.id || null },
      });
      if (err) throw err;
      if (data.operacion) {
        setEnviando('Abriendo Mercado Pago…');
        try {
          await irAPagar(data.operacion);
        } catch (e2) {
          router.replace(`/match/solicitud/${data.id}`);
        }
        return;
      }
      router.replace(`/match/solicitud/${data.id}?nueva=${data.invitados}`);
    } catch (err) {
      setEnviando('');
      setError(sinMatch(err) ? MENSAJE_FALTA_SQL : mensajeError(err));
    }
  }

  if (cargando) return <div className="grid min-h-dvh place-items-center text-tinta-400">Cargando…</div>;

  return (
    <MarcoCliente titulo="Pedir una visita técnica" volver="/inicio">
      <form onSubmit={enviar} className="space-y-4 pt-4 md:grid md:grid-cols-2 md:gap-5 md:space-y-0">
        <div className="space-y-4">
          {dirigida && (
            <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-200">
              Le pedís la visita a <b>{dirigida.nombre}</b>. Si no puede, podés publicarla para todos.
            </p>
          )}
          {!dirigida && primeroActivo && (
            <div>
              <span className="etiqueta">¿Cómo elegís el técnico?</span>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['invitar', 'Recibir propuestas', 'Los técnicos de tu zona responden y elegís uno con su horario. Pagás al elegir.'],
                  ['primero', 'El primero disponible', adelantado
                    ? 'Pagás ahora y te atiende el primer técnico del rubro que lo toma. Si nadie lo toma a tiempo, te devolvemos todo.'
                    : 'Te atiende el primer técnico del rubro que lo toma. Si la visita sale más cara, te cotiza y elegís. Pagás recién ahí.'],
                ].map(([v, t, d]) => (
                  <button key={v} type="button" onClick={() => setModo(v)} className={`rounded-2xl border p-3 text-left ${modo === v ? 'border-menta-400 bg-menta-500/10' : 'border-navy-700 bg-navy-850'}`}>
                    <b className="flex items-center gap-1.5 text-sm">{v === 'primero' && <Icon name="match" className="h-4 w-4 text-menta-300" />}{t}</b>
                    <span className="mt-1 block text-[11px] leading-snug text-tinta-400">{d}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="block">
            <span className="etiqueta">Rubro</span>
            <select className="campo" value={f.categoria_id} onChange={cambiar('categoria_id')} required>
              <option value="">Elegí…</option>
              {rubros.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="etiqueta">¿Qué pasa? (título)</span>
            <input className="campo" value={f.titulo} onChange={cambiar('titulo')} maxLength={120} placeholder="Ej.: Salta la llave general" />
          </label>
          <label className="block">
            <span className="etiqueta">Contalo con detalle</span>
            <textarea
              className="campo min-h-32"
              value={f.descripcion}
              onChange={cambiar('descripcion')}
              maxLength={2000}
              placeholder="Desde cuándo pasa, qué equipo o instalación es, si ya lo revisó alguien…"
            />
          </label>
          <div>
            <span className="etiqueta">Fotos o videos (hasta 8)</span>
            <div className="grid grid-cols-4 gap-2">
              {archivos.map((a, i) => (
                <div key={`${a.name}-${i}`} className="relative aspect-square overflow-hidden rounded-xl border border-navy-700 bg-navy-850">
                  {a.type.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={URL.createObjectURL(a)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="grid h-full place-items-center text-tinta-300"><Icon name="video" /></span>
                  )}
                  <button type="button" onClick={() => setArchivos(archivos.filter((_, k) => k !== i))} className="absolute top-1 right-1 rounded-full bg-navy-950/80 p-1" aria-label="Quitar">
                    <Icon name="cerrar" className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {archivos.length < 8 && (
                <label className="grid aspect-square cursor-pointer place-items-center rounded-xl border border-dashed border-navy-600 text-tinta-400 hover:text-tinta-100">
                  <span className="grid place-items-center gap-1 text-[11px]"><Icon name="camara" /> Agregar</span>
                  <input type="file" accept="image/*,video/*" multiple className="sr-only" onChange={elegirArchivos} />
                </label>
              )}
            </div>
            <p className="mt-1 text-xs text-tinta-500">
              {modo === 'primero' && !dirigida ? 'Las ven solo los técnicos que pueden tomar tu pedido.' : 'Las ven solo los profesionales que invitamos a tu solicitud.'}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="etiqueta">Departamento</span>
              <select className="campo" value={f.departamento} onChange={cambiar('departamento')}>
                {DEPARTAMENTOS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="etiqueta">Barrio o localidad</span>
              <input className="campo" value={f.localidad} onChange={cambiar('localidad')} maxLength={80} placeholder="Ej.: Pocitos" />
            </label>
          </div>
          <div>
            <span className="etiqueta">Dirección{modo === 'primero' && !dirigida ? ' (marcala en el mapa)' : ''}</span>
            <SelectorUbicacion valor={ubic} onChange={setUbic} alto={180} placeholder="Calle, número y apartamento" />
          </div>
          <label className="block">
            <span className="etiqueta">Referencia (opcional)</span>
            <input className="campo" value={f.referencia} onChange={cambiar('referencia')} maxLength={200} placeholder="Timbre, portería, entre calles…" />
          </label>
          <p className="flex gap-2 rounded-xl bg-navy-850 p-3 text-xs text-tinta-300">
            <Icon name="candado" className="h-4 w-4 shrink-0 text-menta-300" />
            {modo === 'primero' && !dirigida
              ? 'Antes de tomar tu pedido, los técnicos ven solo el barrio. La dirección exacta y tu teléfono los ve recién el que lo toma.'
              : 'La dirección exacta la ve solo el profesional que elijas, después de pagar la visita.'}
          </p>
          {modo === 'primero' && !dirigida ? (
            <div className="space-y-2">
              <span className="etiqueta">¿Para cuándo?</span>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={esTardeHoy()} onClick={() => setCuando({ ...cuando, tipo: 'hoy' })} className={`chip ${cuando.tipo === 'hoy' ? 'chip-activo' : ''}`}>
                  Hoy, lo antes posible
                </button>
                <button type="button" onClick={() => setCuando({ ...cuando, tipo: 'dia' })} className={`chip ${cuando.tipo === 'dia' ? 'chip-activo' : ''}`}>
                  Otro día
                </button>
              </div>
              {esTardeHoy() && <p className="text-xs text-tinta-400">Para hoy se puede pedir hasta las 19 h.</p>}
              {cuando.tipo === 'dia' && (
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" className="campo" min={hoyISO()} max={masDias(hoyISO(), 30)} value={cuando.fecha} onChange={(e) => setCuando({ ...cuando, fecha: e.target.value })} />
                  <select className="campo" value={cuando.franja} onChange={(e) => setCuando({ ...cuando, franja: e.target.value })}>
                    {FRANJAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <div>
              <span className="etiqueta">¿Cuándo te queda mejor?</span>
              <div className="flex flex-wrap gap-2">
                {PREFERENCIAS.map(([v, t]) => (
                  <button key={v} type="button" onClick={() => setF({ ...f, preferencia: v })} className={`chip ${f.preferencia === v ? 'chip-activo' : ''}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="flex items-center gap-3 rounded-xl bg-navy-850 p-3 text-sm">
            <input type="checkbox" checked={f.urgente} onChange={cambiar('urgente')} className="h-5 w-5 accent-[#2dd4bf]" />
            <span>
              <b>Es urgente{urgencia ? ` · ${pesos(urgencia.precio)}` : ''}</b>
              <span className="block text-xs text-tinta-400">
                {urgencia
                  ? 'Se cobra la tarifa de urgencia y le damos prioridad a los profesionales que atienden urgencias, también fuera de horario.'
                  : 'Le damos prioridad a los profesionales que atienden urgencias.'}
              </span>
            </span>
          </label>
          {esPrimero && cotiz?.urgencia && !f.urgente && (
            <p className="rounded-xl bg-[#ff8a5c]/10 p-3 text-xs text-[#ffc2a8]">
              Lo que elegiste es fuera del horario normal: se cobra como urgencia ({pesos(cotiz.importe)}) y lo toman técnicos que atienden urgencias.
            </p>
          )}
          {esPrimero && cotiz?.pasada && <p className="rounded-xl bg-amber-400/10 p-3 text-xs text-amber-100">Esa franja ya pasó: elegí otra.</p>}
          {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
          <button className="btn btn-menta w-full py-3.5 text-base" disabled={!!enviando}>
            {enviando ||
              (esPrimero
                ? adelantado
                  ? `Pagar ${precioPrimero !== null && precioPrimero !== undefined ? pesos(precioPrimero) : 'la visita'} y publicar`
                  : 'Publicar pedido'
                : 'Publicar solicitud')}
          </button>
          <p className="text-center text-xs text-tinta-400">
            {modo === 'primero' && !dirigida
              ? adelantado
                ? 'Pagás con Mercado Pago (tarjeta o saldo). TaListo! retiene el pago hasta que confirmás la visita; si nadie toma tu pedido a tiempo o lo cancelás antes, te lo devolvemos.'
                : `Publicar es gratis. Si un técnico lo toma pagás ${precioPrimero !== null && precioPrimero !== undefined ? pesos(precioPrimero) : 'la visita'}; si la visita sale más cara, te manda su cotización y vos decidís. Pagás con Mercado Pago y TaListo! retiene el pago hasta que confirmás la visita.`
              : `Publicar es gratis. Pagás la visita ${
                  f.urgente && urgencia
                    ? `(${pesos(urgencia.precio)}, urgencia) `
                    : precio !== null
                      ? `(${pesos(precio)}${urgencia ? `; fuera de horario, ${pesos(urgencia.precio)}` : ''}) `
                      : ''
                }recién cuando elegís un profesional y un horario.`}
          </p>
        </div>
      </form>
    </MarcoCliente>
  );
}
