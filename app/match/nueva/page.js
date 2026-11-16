'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import MarcoCliente, { useSesionCliente } from '@/components/MarcoCliente';
import { supabase } from '@/lib/supabase';
import { DEPARTAMENTOS, mensajeError } from '@/lib/util';
import { MENSAJE_FALTA_SQL, PREFERENCIAS, pesos, sinMatch, subirArchivos } from '@/lib/match';

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
        supabase.from('configuracion').select('precio_visita').eq('id', 1).maybeSingle(),
      ]);
      setRubros(r || []);
      setPrecio(c?.precio_visita ?? null);
      const pro = params.get('profesional');
      if (pro) {
        const { data } = await supabase.rpc('perfil_match', { p_id: pro });
        if (data?.profesional) setDirigida(data.profesional);
      }
    })();
  }, [params]);

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
    try {
      let rutas = [];
      if (archivos.length) {
        setEnviando('Subiendo fotos y videos…');
        rutas = await subirArchivos(archivos, crypto.randomUUID());
      }
      setEnviando('Buscando profesionales…');
      const { data, error: err } = await supabase.rpc('crear_solicitud', {
        p: { ...f, categoria_id: Number(f.categoria_id), archivos: rutas, dirigida_a: dirigida?.id || null },
      });
      if (err) throw err;
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
            <p className="mt-1 text-xs text-tinta-500">Las ven solo los profesionales que invitamos a tu solicitud.</p>
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
          <label className="block">
            <span className="etiqueta">Dirección</span>
            <input className="campo" value={f.direccion} onChange={cambiar('direccion')} maxLength={200} placeholder="Calle, número y apartamento" />
          </label>
          <label className="block">
            <span className="etiqueta">Referencia (opcional)</span>
            <input className="campo" value={f.referencia} onChange={cambiar('referencia')} maxLength={200} placeholder="Timbre, portería, entre calles…" />
          </label>
          <p className="flex gap-2 rounded-xl bg-navy-850 p-3 text-xs text-tinta-300">
            <Icon name="candado" className="h-4 w-4 shrink-0 text-menta-300" />
            La dirección exacta la ve solo el profesional que elijas, después de pagar la visita.
          </p>
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
          <label className="flex items-center gap-3 rounded-xl bg-navy-850 p-3 text-sm">
            <input type="checkbox" checked={f.urgente} onChange={cambiar('urgente')} className="h-5 w-5 accent-[#2dd4bf]" />
            <span>
              <b>Es urgente</b>
              <span className="block text-xs text-tinta-400">Le damos prioridad a los profesionales que atienden urgencias.</span>
            </span>
          </label>
          {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
          <button className="btn btn-menta w-full py-3.5 text-base" disabled={!!enviando}>
            {enviando || 'Publicar solicitud'}
          </button>
          <p className="text-center text-xs text-tinta-400">
            Publicar es gratis. Pagás la visita {precio !== null ? `(${pesos(precio)}) ` : ''}recién cuando elegís un profesional y un horario.
          </p>
        </div>
      </form>
    </MarcoCliente>
  );
}
