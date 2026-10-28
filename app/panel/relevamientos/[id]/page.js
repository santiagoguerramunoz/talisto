'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import FormTurno from '@/components/FormTurno';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { indexarClientes } from '@/lib/agenda';
import { fechaISO } from '@/lib/fechas';
import { comprimirImagen } from '@/lib/imagenes';
import { CAMPOS_RELEVAMIENTO, CARPETA_FOTOS, ESTADOS_RELEVAMIENTO, textoCuando } from '@/lib/relevamientos';
import { linkGoogleMaps, linkWaze, linkWhatsapp, mensajeError, monto } from '@/lib/util';

const CAMPOS_CLIENTE = 'id, nombre, color, telefono, direcciones(id, etiqueta, direccion, referencia, lat, lng)';
const MATERIAL_VACIO = { item: '', cantidad: '', unidad: 'u' };

export default function FichaRelevamiento() {
  const { id } = useParams();
  const router = useRouter();
  const { profesional } = usePanel();

  const [rel, setRel] = useState(null);
  const [form, setForm] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [urls, setUrls] = useState({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [subiendo, setSubiendo] = useState(0);
  const [aviso, setAviso] = useState({});
  const [fotoGrande, setFotoGrande] = useState(null);
  const [modalTurno, setModalTurno] = useState(null);
  const inputFotos = useRef(null);

  const cargar = useCallback(async () => {
    const [{ data, error }, cl] = await Promise.all([
      supabase.from('relevamientos').select(CAMPOS_RELEVAMIENTO).eq('id', id).maybeSingle(),
      supabase.from('clientes').select(CAMPOS_CLIENTE).eq('profesional_id', profesional.id).order('nombre'),
    ]);
    setCargando(false);
    if (error) {
      setAviso({ error: mensajeError(error) });
      return;
    }
    setClientes(cl.data || []);
    setRel(data);
    if (data) {
      setForm({
        pedido: data.pedido || '',
        notas: data.notas || '',
        medidas: data.medidas || '',
        materiales: (Array.isArray(data.materiales) ? data.materiales : []).map((m) => ({
          item: m.item || '',
          cantidad: m.cantidad ?? '',
          unidad: m.unidad || 'u',
        })),
        horas: data.horas_estimadas ?? '',
        costo: data.costo_estimado ?? '',
        estado: data.estado,
      });
    }
  }, [id, profesional.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Links temporales para ver las fotos (el almacenamiento es privado)
  const clavesFotos = (rel?.fotos || []).join('|');
  useEffect(() => {
    const rutas = rel?.fotos || [];
    if (!rutas.length) {
      setUrls({});
      return;
    }
    supabase.storage
      .from(CARPETA_FOTOS)
      .createSignedUrls(rutas, 60 * 60)
      .then(({ data }) => {
        const mapa = {};
        (data || []).forEach((x) => {
          if (x.signedUrl) mapa[x.path] = x.signedUrl;
        });
        setUrls(mapa);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clavesFotos]);

  const indice = useMemo(() => indexarClientes(clientes), [clientes]);

  if (cargando) return <p className="p-4 text-tinta-400">Cargando…</p>;
  if (!rel || !form) {
    return (
      <div className="p-4">
        <p className="text-tinta-300">{aviso.error || 'No encontramos este relevamiento.'}</p>
        <Link href="/panel/relevamientos" className="btn btn-sec mt-4">Volver a relevamientos</Link>
      </div>
    );
  }

  const cliente = rel.clientes;
  const dir = rel.direcciones;
  const estado = ESTADOS_RELEVAMIENTO[form.estado] || ESTADOS_RELEVAMIENTO.pendiente;
  const cambiar = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const cambiarMaterial = (i, campo, valor) =>
    setForm((f) => ({ ...f, materiales: f.materiales.map((m, k) => (k === i ? { ...m, [campo]: valor } : m)) }));

  async function guardar(nuevoEstado) {
    setAviso({});
    setGuardando(true);
    const materiales = form.materiales
      .filter((m) => m.item.trim())
      .map((m) => ({
        item: m.item.trim(),
        cantidad: m.cantidad === '' || Number.isNaN(Number(m.cantidad)) ? null : Number(m.cantidad),
        unidad: m.unidad.trim() || 'u',
      }));
    const estadoFinal = nuevoEstado || form.estado;
    const { error } = await supabase
      .from('relevamientos')
      .update({
        pedido: form.pedido.trim() || null,
        notas: form.notas.trim() || null,
        medidas: form.medidas.trim() || null,
        materiales,
        horas_estimadas: form.horas === '' ? null : Number(form.horas),
        costo_estimado: form.costo === '' ? null : Number(form.costo),
        estado: estadoFinal,
      })
      .eq('id', rel.id);
    // Al marcarlo relevado, el turno de la agenda queda como realizado
    if (!error && nuevoEstado === 'relevado' && rel.turno_id && rel.turnos?.estado !== 'realizado') {
      await supabase.from('turnos').update({ estado: 'realizado' }).eq('id', rel.turno_id);
    }
    setGuardando(false);
    if (error) {
      setAviso({ error: mensajeError(error) });
      return;
    }
    setAviso({ ok: nuevoEstado === 'relevado' ? 'Relevamiento terminado y guardado.' : 'Guardado.' });
    cargar();
  }

  async function subirFotos(archivos) {
    const lista = Array.from(archivos || []);
    if (!lista.length) return;
    setAviso({});
    setSubiendo(lista.length);
    const nuevas = [];
    for (const archivo of lista) {
      const imagen = await comprimirImagen(archivo);
      const ruta = `${profesional.id}/${rel.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
      const { error } = await supabase.storage.from(CARPETA_FOTOS).upload(ruta, imagen, { contentType: 'image/jpeg', upsert: false });
      if (error) {
        setAviso({ error: `No se pudo subir una foto: ${mensajeError(error)}` });
      } else {
        nuevas.push(ruta);
      }
      setSubiendo((n) => n - 1);
    }
    if (nuevas.length) {
      const fotos = [...(rel.fotos || []), ...nuevas];
      const { error } = await supabase.from('relevamientos').update({ fotos }).eq('id', rel.id);
      if (error) setAviso({ error: mensajeError(error) });
      else setRel((r) => ({ ...r, fotos }));
    }
    setSubiendo(0);
    if (inputFotos.current) inputFotos.current.value = '';
  }

  async function borrarFoto(ruta) {
    if (!window.confirm('¿Borrar esta foto?')) return;
    const fotos = (rel.fotos || []).filter((f) => f !== ruta);
    const { error } = await supabase.from('relevamientos').update({ fotos }).eq('id', rel.id);
    if (error) return setAviso({ error: mensajeError(error) });
    await supabase.storage.from(CARPETA_FOTOS).remove([ruta]);
    setRel((r) => ({ ...r, fotos }));
    setFotoGrande(null);
  }

  async function borrarRelevamiento() {
    if (!window.confirm('¿Eliminar este relevamiento con sus fotos? También se quita de la agenda.')) return;
    if (rel.fotos?.length) await supabase.storage.from(CARPETA_FOTOS).remove(rel.fotos);
    if (rel.turno_id) await supabase.from('turnos').delete().eq('id', rel.turno_id);
    const { error } = await supabase.from('relevamientos').delete().eq('id', rel.id);
    if (error) return setAviso({ error: mensajeError(error) });
    router.replace('/panel/relevamientos');
  }

  const totalMateriales = form.materiales.filter((m) => m.item.trim()).length;

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/panel/relevamientos" className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver">
            <Icon name="izq" />
          </Link>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-marca-naranja/15 text-marca-naranja">
            <Icon name="relevamiento" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-extrabold">{cliente?.nombre || rel.turnos?.titulo || 'Relevamiento'}</h1>
            <p className="truncate text-xs text-tinta-400">{textoCuando(rel.turnos)}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${estado.clase}`}>{estado.texto}</span>
        </div>
      </header>

      <div className="space-y-6 px-4 pt-4">
        {/* Dónde y contacto */}
        <section className="tarjeta p-4">
          {dir ? (
            <div className="flex items-start gap-3">
              <Icon name="pin" className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <p className="font-bold">{dir.etiqueta}</p>
                <p className="text-sm text-tinta-300">{dir.direccion}</p>
                {dir.referencia && <p className="text-xs text-tinta-400">{dir.referencia}</p>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-tinta-400">Sin dirección cargada.</p>
          )}
          <div className="mt-3 grid grid-cols-4 gap-2">
            {dir && (
              <a href={linkGoogleMaps(dir)} target="_blank" rel="noreferrer" className="btn btn-sec px-2 py-2 text-xs"><Icon name="ir" className="h-4 w-4" /> Ir</a>
            )}
            {dir && <a href={linkWaze(dir)} target="_blank" rel="noreferrer" className="btn btn-sec px-2 py-2 text-xs">Waze</a>}
            {cliente?.telefono && (
              <a href={`tel:${cliente.telefono}`} className="btn btn-sec px-2 py-2 text-xs"><Icon name="telefono" className="h-4 w-4" /></a>
            )}
            {cliente?.telefono && (
              <a href={linkWhatsapp(cliente.telefono)} target="_blank" rel="noreferrer" className="btn btn-sec px-2 py-2 text-xs"><Icon name="whatsapp" className="h-4 w-4" /></a>
            )}
          </div>
          {rel.turnos && (
            <button type="button" onClick={() => setModalTurno({ turno: rel.turnos })} className="mt-3 text-sm font-semibold text-menta-400">
              Cambiar fecha u horario
            </button>
          )}
        </section>

        {/* Pedido */}
        <section>
          <h2 className="titulo-seccion mb-2">Qué pide el cliente</h2>
          <textarea rows={3} className="campo" value={form.pedido} onChange={(e) => cambiar('pedido', e.target.value)} placeholder="Lo que el cliente quiere que se haga" />
        </section>

        {/* Fotos */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="titulo-seccion">Fotos</h2>
            <span className="text-xs text-tinta-500">{rel.fotos?.length || 0}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(rel.fotos || []).map((ruta) => (
              <button key={ruta} type="button" onClick={() => setFotoGrande(ruta)} className="aspect-square overflow-hidden rounded-xl border border-navy-700 bg-navy-850">
                {urls[ruta] ? (
                  <img src={urls[ruta]} alt="Foto del relevamiento" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <span className="grid h-full place-items-center text-xs text-tinta-500">…</span>
                )}
              </button>
            ))}
            <label className="grid aspect-square cursor-pointer place-items-center rounded-xl border-2 border-dashed border-navy-600 text-center text-xs font-semibold text-tinta-300 hover:border-menta-500">
              <span className="flex flex-col items-center gap-1">
                <Icon name="camara" className="h-6 w-6 text-menta-400" />
                {subiendo ? `Subiendo ${subiendo}…` : 'Sacar o subir'}
              </span>
              <input
                ref={inputFotos}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={subiendo > 0}
                onChange={(e) => subirFotos(e.target.files)}
              />
            </label>
          </div>
        </section>

        {/* Lo relevado */}
        <section className="space-y-3">
          <h2 className="titulo-seccion">Lo relevado</h2>
          <div>
            <label className="etiqueta" htmlFor="r-notas">Qué viste / qué hay que hacer</label>
            <textarea id="r-notas" rows={4} className="campo" value={form.notas} onChange={(e) => cambiar('notas', e.target.value)} placeholder="Estado actual, problemas encontrados, trabajo necesario…" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="r-medidas">Medidas</label>
            <textarea id="r-medidas" rows={2} className="campo" value={form.medidas} onChange={(e) => cambiar('medidas', e.target.value)} placeholder="Ej. Pared 3,20 x 2,60 m · 12 m de cable desde el tablero" />
          </div>
        </section>

        {/* Materiales */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="titulo-seccion">Materiales {totalMateriales > 0 && <span className="text-tinta-500">({totalMateriales})</span>}</h2>
            <button type="button" className="chip chip-activo" onClick={() => cambiar('materiales', [...form.materiales, { ...MATERIAL_VACIO }])}>
              <Icon name="mas" className="h-3.5 w-3.5" /> Agregar
            </button>
          </div>
          {form.materiales.length === 0 ? (
            <p className="tarjeta p-4 text-sm text-tinta-400">Sin materiales. Agregá lo que vas a necesitar para el trabajo.</p>
          ) : (
            <ul className="space-y-2">
              {form.materiales.map((m, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input className="campo min-w-0 flex-1 px-3 py-2 text-sm" value={m.item} onChange={(e) => cambiarMaterial(i, 'item', e.target.value)} placeholder="Material" />
                  <input className="campo w-16 px-2 py-2 text-sm" type="number" inputMode="decimal" min="0" value={m.cantidad} onChange={(e) => cambiarMaterial(i, 'cantidad', e.target.value)} placeholder="Cant." aria-label="Cantidad" />
                  <input className="campo w-14 px-2 py-2 text-sm" value={m.unidad} onChange={(e) => cambiarMaterial(i, 'unidad', e.target.value)} placeholder="u" aria-label="Unidad" />
                  <button type="button" className="shrink-0 rounded-lg p-2 text-tinta-400 hover:text-red-300" onClick={() => cambiar('materiales', form.materiales.filter((_, k) => k !== i))} aria-label="Quitar material">
                    <Icon name="cerrar" className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Estimación */}
        <section>
          <h2 className="titulo-seccion mb-2">Estimación</h2>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="etiqueta" htmlFor="r-horas">Horas de trabajo</label>
              <input id="r-horas" type="number" inputMode="decimal" min="0" step="0.5" className="campo" value={form.horas} onChange={(e) => cambiar('horas', e.target.value)} placeholder="Ej. 6" />
            </div>
            <div>
              <label className="etiqueta" htmlFor="r-costo">Costo estimado (UYU)</label>
              <input id="r-costo" type="number" inputMode="decimal" min="0" className="campo" value={form.costo} onChange={(e) => cambiar('costo', e.target.value)} placeholder="Ej. 8500" />
            </div>
          </div>
          {form.costo !== '' && <p className="mt-2 text-xs text-tinta-400">Base para el presupuesto: {monto(form.costo)}</p>}
        </section>

        {/* Estado */}
        <section>
          <h2 className="titulo-seccion mb-2">Estado</h2>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {Object.entries(ESTADOS_RELEVAMIENTO).map(([valor, e]) => (
              <button key={valor} type="button" onClick={() => cambiar('estado', valor)} className={`chip ${form.estado === valor ? 'chip-activo' : ''}`}>
                {e.texto}
              </button>
            ))}
          </div>
        </section>

        {aviso.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{aviso.error}</p>}
        {aviso.ok && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{aviso.ok}</p>}

        <div className="space-y-2">
          {form.estado === 'pendiente' && (
            <button type="button" className="btn btn-menta w-full py-3.5" onClick={() => guardar('relevado')} disabled={guardando}>
              <Icon name="check" /> {guardando ? 'Guardando…' : 'Guardar y marcar como relevado'}
            </button>
          )}
          <button type="button" className={`btn w-full ${form.estado === 'pendiente' ? 'btn-sec' : 'btn-menta py-3.5'}`} onClick={() => guardar()} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
          {cliente && (
            <button
              type="button"
              className="btn btn-sec w-full"
              onClick={() => setModalTurno({ inicial: { cliente_id: cliente.id, fecha: fechaISO(new Date()), hora: '09:00' } })}
            >
              <Icon name="agenda" /> Agendar el trabajo
            </button>
          )}
          <button type="button" className="btn btn-peligro w-full" onClick={borrarRelevamiento}>
            <Icon name="borrar" /> Eliminar relevamiento
          </button>
        </div>
      </div>

      <Modal abierto={!!fotoGrande} onCerrar={() => setFotoGrande(null)} titulo="Foto">
        {fotoGrande && (
          <div className="space-y-3">
            {urls[fotoGrande] && <img src={urls[fotoGrande]} alt="Foto del relevamiento" className="w-full rounded-xl" />}
            <div className="grid grid-cols-2 gap-2">
              {urls[fotoGrande] && (
                <a href={urls[fotoGrande]} target="_blank" rel="noreferrer" className="btn btn-sec">Abrir</a>
              )}
              <button type="button" className="btn btn-peligro" onClick={() => borrarFoto(fotoGrande)}>
                <Icon name="borrar" /> Borrar
              </button>
            </div>
          </div>
        )}
      </Modal>

      <FormTurno
        abierto={!!modalTurno}
        onCerrar={() => setModalTurno(null)}
        onGuardado={cargar}
        profesionalId={profesional.id}
        nombreProfesional={profesional.nombre_publico}
        clientes={clientes}
        bloques={[]}
        indice={indice}
        turno={modalTurno?.turno}
        inicial={modalTurno?.inicial}
      />
    </>
  );
}
