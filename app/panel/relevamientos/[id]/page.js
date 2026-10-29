'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import Mapa from '@/components/Mapa';
import FormTurno from '@/components/FormTurno';
import DireccionRelevamiento, { UBICACION_VACIA, filaUbicacion } from '@/components/DireccionRelevamiento';
import EditorMateriales from '@/components/EditorMateriales';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { indexarClientes } from '@/lib/agenda';
import { fechaISO } from '@/lib/fechas';
import { comprimirImagen } from '@/lib/imagenes';
import { useAjustes } from '@/lib/ajustes';
import { limpiarMateriales, materialesParaEditar, numero, pesos, totalesPresupuesto } from '@/lib/precios';
import { ESTADOS_PRESUPUESTO, numeroPresupuesto, presupuestoNuevo } from '@/lib/presupuestos';
import { esPro } from '@/lib/planes';
import { AVISO_SQL_04, faltaColumna as faltaCol, faltaSql04 } from '@/lib/sql';
import {
  AVISO_SQL_UBICACION,
  CARPETA_FOTOS,
  COLOR_RELEVAMIENTO,
  ESTADOS_RELEVAMIENTO,
  consultarRelevamientos,
  enElMapa,
  guardarRelevamiento,
  textoCuando,
  ubicacionRelevamiento,
} from '@/lib/relevamientos';
import { linkGoogleMaps, linkWaze, linkWhatsapp, mensajeError } from '@/lib/util';

const CAMPOS_CLIENTE = 'id, nombre, color, telefono, direcciones(id, etiqueta, direccion, referencia, lat, lng)';

export default function FichaRelevamiento() {
  const { id } = useParams();
  const router = useRouter();
  const { profesional, plan } = usePanel();
  const { ajustes } = useAjustes(profesional.id);

  const [rel, setRel] = useState(null);
  const [presupuestos, setPresupuestos] = useState([]);
  const [form, setForm] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [urls, setUrls] = useState({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [subiendo, setSubiendo] = useState(0);
  const [aviso, setAviso] = useState({});
  const [fotoGrande, setFotoGrande] = useState(null);
  const [modalTurno, setModalTurno] = useState(null);
  const [ubic, setUbic] = useState(null); // editando la dirección
  const [guardandoLugar, setGuardandoLugar] = useState(false);
  const inputFotos = useRef(null);

  const cargar = useCallback(async () => {
    const [{ data, error }, cl, pr] = await Promise.all([
      consultarRelevamientos((campos) => supabase.from('relevamientos').select(campos).eq('id', id).maybeSingle()),
      supabase.from('clientes').select(CAMPOS_CLIENTE).eq('profesional_id', profesional.id).order('nombre'),
      supabase.from('presupuestos').select('id, numero, estado, total').eq('relevamiento_id', id).order('numero'),
    ]);
    setPresupuestos(pr.error ? [] : pr.data || []);
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
        materiales: materialesParaEditar(data.materiales),
        horas: data.horas_estimadas ?? '',
        // antes se llamaba "costo estimado"
        manoObra: data.mano_obra ?? data.costo_estimado ?? '',
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
  const lugar = ubicacionRelevamiento(rel);
  const direccionesCliente = clientes.find((c) => c.id === rel.cliente_id)?.direcciones || [];
  const estado = ESTADOS_RELEVAMIENTO[form.estado] || ESTADOS_RELEVAMIENTO.pendiente;
  const cambiar = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const totales = totalesPresupuesto({ items: form.materiales, mano_obra: form.manoObra, iva_porcentaje: ajustes.iva_porcentaje });

  async function guardar(nuevoEstado, { silencioso = false } = {}) {
    setAviso({});
    setGuardando(true);
    const estadoFinal = nuevoEstado || form.estado;
    const fila = {
      pedido: form.pedido.trim() || null,
      notas: form.notas.trim() || null,
      medidas: form.medidas.trim() || null,
      materiales: limpiarMateriales(form.materiales),
      horas_estimadas: form.horas === '' ? null : Number(form.horas),
      mano_obra: numero(form.manoObra),
      estado: estadoFinal,
    };
    let { error } = await supabase.from('relevamientos').update(fila).eq('id', rel.id);
    if (faltaCol(error)) {
      // Todavía no se corrió el SQL 04: la mano de obra va en la columna anterior
      // eslint-disable-next-line no-unused-vars
      const { mano_obra, ...resto } = fila;
      ({ error } = await supabase.from('relevamientos').update({ ...resto, costo_estimado: mano_obra }).eq('id', rel.id));
    }
    // Al marcarlo relevado, el turno de la agenda queda como realizado
    if (!error && nuevoEstado === 'relevado' && rel.turno_id && rel.turnos?.estado !== 'realizado') {
      await supabase.from('turnos').update({ estado: 'realizado' }).eq('id', rel.turno_id);
    }
    setGuardando(false);
    if (error) {
      setAviso({ error: mensajeError(error) });
      return false;
    }
    if (!silencioso) setAviso({ ok: nuevoEstado === 'relevado' ? 'Relevamiento terminado y guardado.' : 'Guardado.' });
    cargar();
    return true;
  }

  // Arma el presupuesto con los materiales (precio final) y la mano de obra del relevamiento
  async function crearPresupuesto() {
    const ok = await guardar(undefined, { silencioso: true });
    if (!ok) return;
    setGuardando(true);
    const primeraLinea = (form.pedido || '').split('\n')[0].trim().slice(0, 120);
    const { data, error } = await supabase
      .from('presupuestos')
      .insert(
        presupuestoNuevo({
          profesionalId: profesional.id,
          ajustes,
          cliente: rel.clientes ? { id: rel.cliente_id, nombre: rel.clientes.nombre } : null,
          relevamiento: rel,
          lugar,
          items: form.materiales,
          manoObra: form.manoObra,
          titulo: primeraLinea || rel.turnos?.titulo || '',
        })
      )
      .select('id')
      .single();
    if (error) {
      setGuardando(false);
      setAviso({ error: faltaSql04(error) ? AVISO_SQL_04 : mensajeError(error) });
      return;
    }
    await supabase.from('relevamientos').update({ estado: 'presupuestado' }).eq('id', rel.id);
    router.push(`/panel/finanzas/presupuestos/${data.id}`);
  }

  function editarLugar() {
    setAviso({});
    setUbic(
      lugar?.propia
        ? { otra: true, direccion_id: '', direccion: lugar.direccion, referencia: lugar.referencia, lat: lugar.lat, lng: lugar.lng }
        : { ...UBICACION_VACIA, direccion_id: rel.direccion_id || direccionesCliente[0]?.id || '' }
    );
  }

  async function guardarLugar() {
    const fila = filaUbicacion(ubic, direccionesCliente);
    if (!rel.cliente_id) fila.direccion_id = null;
    setGuardandoLugar(true);
    const { error, sinUbicacion } = await guardarRelevamiento(fila, { id: rel.id });
    // La agenda usa la misma dirección
    if (!error && rel.turno_id) await supabase.from('turnos').update({ direccion_id: fila.direccion_id }).eq('id', rel.turno_id);
    setGuardandoLugar(false);
    if (error) return setAviso({ error: mensajeError(error) });
    if (sinUbicacion) return setAviso({ error: AVISO_SQL_UBICACION });
    setUbic(null);
    setAviso({ ok: 'Dirección guardada.' });
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
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-tinta-400">Dirección del relevamiento</p>
            {!ubic && lugar && (
              <button type="button" onClick={editarLugar} className="text-sm font-semibold text-menta-400">Cambiar</button>
            )}
          </div>
          {ubic ? (
            <div className="space-y-3">
              <DireccionRelevamiento direcciones={direccionesCliente} valor={ubic} onChange={setUbic} nombreCliente={cliente?.nombre} />
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-sec" onClick={() => setUbic(null)}>Cancelar</button>
                <button type="button" className="btn btn-menta" onClick={guardarLugar} disabled={guardandoLugar}>
                  {guardandoLugar ? 'Guardando…' : 'Guardar dirección'}
                </button>
              </div>
            </div>
          ) : lugar ? (
            <>
              <div className="flex items-start gap-3">
                <Icon name="pin" className="mt-0.5 h-5 w-5 shrink-0 text-marca-naranja" />
                <div className="min-w-0">
                  {!lugar.propia && <p className="font-bold">{lugar.etiqueta}</p>}
                  <p className="text-sm text-tinta-300">{lugar.direccion || 'Punto marcado en el mapa'}</p>
                  {lugar.referencia && <p className="text-xs text-tinta-400">{lugar.referencia}</p>}
                </div>
              </div>
              {enElMapa(lugar) ? (
                <div className="mt-3">
                  <Mapa
                    alto={170}
                    puntos={[{ lat: lugar.lat, lng: lugar.lng, forma: 'relevamiento', color: COLOR_RELEVAMIENTO, etiqueta: '' }]}
                    encuadrarUbicacion={false}
                  />
                  <p className="mt-2 text-xs text-tinta-400">
                    {rel.estado === 'pendiente'
                      ? 'Se ve en el mapa hasta que lo marques como relevado.'
                      : `Ya no aparece en el mapa general: está ${(ESTADOS_RELEVAMIENTO[rel.estado]?.texto || '').toLowerCase()}.`}
                  </p>
                </div>
              ) : (
                <p className="mt-3 rounded-xl bg-amber-400/10 p-3 text-xs text-amber-200">
                  No está marcada en el mapa, así que no aparece ahí. Tocá Cambiar para marcarla.
                </p>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={editarLugar}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-marca-naranja/60 p-4 text-sm font-semibold text-marca-naranja"
            >
              <Icon name="pin" className="h-5 w-5" /> Agregar la dirección del relevamiento
            </button>
          )}
          <div className="mt-3 grid grid-cols-4 gap-2">
            {lugar && !ubic && (
              <a href={linkGoogleMaps(lugar)} target="_blank" rel="noreferrer" className="btn btn-sec px-2 py-2 text-xs"><Icon name="ir" className="h-4 w-4" /> Ir</a>
            )}
            {lugar && !ubic && <a href={linkWaze(lugar)} target="_blank" rel="noreferrer" className="btn btn-sec px-2 py-2 text-xs">Waze</a>}
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

        {/* Materiales con costo, margen y precio final */}
        <EditorMateriales
          materiales={form.materiales}
          onChange={(m) => cambiar('materiales', m)}
          margenDefecto={ajustes.margen_materiales}
          vacio="Agregá lo que vas a necesitar con su precio de costo: el margen calcula el precio final de cada ítem."
        />

        {/* Mano de obra y total */}
        <section>
          <h2 className="titulo-seccion mb-2">Mano de obra</h2>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="etiqueta" htmlFor="r-horas">Horas de trabajo</label>
              <input id="r-horas" type="number" inputMode="decimal" min="0" step="0.5" className="campo" value={form.horas} onChange={(e) => cambiar('horas', e.target.value)} placeholder="Ej. 6" />
            </div>
            <div>
              <label className="etiqueta" htmlFor="r-mo">Precio mano de obra (UYU)</label>
              <input id="r-mo" type="number" inputMode="decimal" min="0" className="campo" value={form.manoObra} onChange={(e) => cambiar('manoObra', e.target.value)} placeholder="Ej. 6000" />
            </div>
          </div>
          {(totales.venta > 0 || totales.manoObra > 0) && (
            <div className="tarjeta mt-3 space-y-1 p-3 text-sm">
              <div className="flex justify-between text-tinta-300"><span>Materiales</span><span>{pesos(totales.venta)}</span></div>
              <div className="flex justify-between text-tinta-300"><span>Mano de obra</span><span>{pesos(totales.manoObra)}</span></div>
              <div className="flex justify-between font-semibold"><span>Subtotal</span><span>{pesos(totales.subtotal)}</span></div>
              <div className="flex justify-between text-tinta-300"><span>IVA {Number(ajustes.iva_porcentaje)}%</span><span>{pesos(totales.iva)}</span></div>
              <div className="flex justify-between text-base font-extrabold"><span>Total IVA inc.</span><span className="text-menta-300">{pesos(totales.total)}</span></div>
            </div>
          )}
        </section>

        {/* Presupuesto */}
        <section className="tarjeta space-y-3 border-marca-naranja/40 p-4">
          <div className="flex items-center gap-2">
            <Icon name="documento" className="h-5 w-5 text-marca-naranja" />
            <h2 className="font-bold">Presupuesto para el cliente</h2>
          </div>
          {presupuestos.length > 0 && (
            <ul className="space-y-1.5">
              {presupuestos.map((p) => (
                <li key={p.id}>
                  <Link href={`/panel/finanzas/presupuestos/${p.id}`} className="flex items-center justify-between rounded-xl bg-navy-850 px-3 py-2.5 hover:bg-navy-800">
                    <span className="font-semibold">Nº {numeroPresupuesto(p.numero)}</span>
                    <span className="flex items-center gap-2 text-sm">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${(ESTADOS_PRESUPUESTO[p.estado] || ESTADOS_PRESUPUESTO.borrador).clase}`}>
                        {(ESTADOS_PRESUPUESTO[p.estado] || ESTADOS_PRESUPUESTO.borrador).texto}
                      </span>
                      <b>{pesos(p.total, { decimales: false })}</b>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-tinta-400">Le llega solo con los precios finales de cada ítem, el subtotal, el IVA y el total. Tus costos y márgenes no salen.</p>
          {esPro(plan?.plan) ? (
            <button type="button" className="btn btn-menta w-full" onClick={crearPresupuesto} disabled={guardando}>
              <Icon name="documento" /> {presupuestos.length ? 'Hacer otro presupuesto' : 'Crear presupuesto'}
            </button>
          ) : (
            <Link href="/panel/planes" className="btn btn-sec w-full">
              <Icon name="candado" className="h-[18px] w-[18px] text-marca-naranja" /> Crear presupuesto · Pro
            </Link>
          )}
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
