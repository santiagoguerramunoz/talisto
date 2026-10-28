'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import Mapa from '@/components/Mapa';
import { usePanel } from '@/components/PanelContext';
import { useDatosAgenda } from '@/lib/useDatosAgenda';
import { useUbicacion } from '@/lib/useUbicacion';
import { useBrujula } from '@/lib/useBrujula';
import { useRuta, textoDistancia, textoDuracion } from '@/lib/ruta';
import { MODOS_ORDEN, metrosEntre, ordenar, useMatriz } from '@/lib/orden';
import { eventosDelDia, indexarClientes } from '@/lib/agenda';
import { esMismoDia, fechaISO, fechaLarga, horaHHMM, inicioDia, minutosDeFecha, sumarDias, textoHora } from '@/lib/fechas';
import { linkGoogleMaps, linkRutaDelDia, linkWaze } from '@/lib/util';

const CLAVE_MODO = 'talisto-modo-orden';
const claveManual = (iso) => `talisto-orden-${iso}`;
const leer = (clave, def) => {
  try {
    const v = window.localStorage.getItem(clave);
    return v ? JSON.parse(v) : def;
  } catch {
    return def;
  }
};
const guardar = (clave, valor) => {
  try {
    window.localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // sin almacenamiento disponible: no pasa nada
  }
};

const AYUDA_ORDEN = {
  horario: 'En el orden de tu agenda.',
  mixto: 'Primero la más cercana, sin pasarte del horario de nadie.',
  cerca: 'El camino más corto, sin mirar los horarios.',
  manual: 'Ordená las paradas con las flechas.',
};

const tieneUbicacion = (d) => d && d.lat !== null && d.lng !== null;

export default function MapaDelDia() {
  const { profesional } = usePanel();
  const [fecha, setFecha] = useState(() => inicioDia(new Date()));
  const [modo, setModo] = useState('dia');
  const [desdeMi, setDesdeMi] = useState(true);
  const [modoOrden, setModoOrden] = useState('horario');
  const [keysManual, setKeysManual] = useState([]);
  const iso = fechaISO(fecha);

  useEffect(() => {
    setModoOrden(leer(CLAVE_MODO, 'horario'));
  }, []);
  useEffect(() => {
    setKeysManual(leer(claveManual(iso), []));
  }, [iso]);

  const { datos } = useDatosAgenda(profesional.id, fecha.getTime(), sumarDias(fecha, 1).getTime());
  const { ubicacion, error: errorUbicacion } = useUbicacion(true);
  const { rumbo: rumboBrujula, necesitaPermiso, activar: activarBrujula } = useBrujula();
  const rumbo = rumboBrujula ?? ubicacion?.rumboGps ?? null;
  const indice = useMemo(() => indexarClientes(datos.clientes), [datos.clientes]);

  const eventos = useMemo(
    () => eventosDelDia({ fecha, turnos: datos.turnos, bloques: datos.bloques, indice }),
    [fecha, datos.turnos, datos.bloques, indice]
  );
  const conUbicacion = eventos.filter((e) => tieneUbicacion(e.direccion));
  const sinUbicacion = eventos.filter((e) => !tieneUbicacion(e.direccion));

  // Tiempos reales entre vos y cada parada, y entre paradas
  const hayYo = !!ubicacion;
  const puntosMatriz = [...(hayYo ? [ubicacion] : []), ...conUbicacion.map((e) => e.direccion)];
  const matriz = useMatriz(puntosMatriz, hayYo);
  const desplazamiento = hayYo ? 1 : 0;
  const inicio = desdeMi && hayYo ? 0 : null;

  const claveParadas = conUbicacion.map((e) => `${e.key}:${e.ini}:${e.fin}`).join('|');
  const ordenIdx = useMemo(
    () =>
      ordenar({
        modo: modoOrden,
        paradas: conUbicacion.map((e) => ({ key: e.key, ini: e.ini, fin: e.fin })),
        matriz,
        inicio,
        desplazamiento,
        keysManual,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [claveParadas, matriz, inicio, desplazamiento, modoOrden, keysManual.join('|')]
  );
  const ordenadas = ordenIdx.map((i) => ({ ...conUbicacion[i], idxMatriz: i + desplazamiento }));

  const origen = desdeMi && hayYo ? ubicacion : null;
  const rutaCalles = useRuta(
    ordenadas.map((p) => ({ lat: p.direccion.lat, lng: p.direccion.lng })),
    origen
  );
  const tramoDe = (pos) => rutaCalles.tramos[origen ? pos : pos - 1];

  function elegirModo(m) {
    if (m === 'manual') {
      const keys = ordenadas.map((p) => p.key);
      setKeysManual(keys);
      guardar(claveManual(iso), keys);
    }
    setModoOrden(m);
    guardar(CLAVE_MODO, m);
  }

  function mover(pos, delta) {
    const keys = ordenadas.map((p) => p.key);
    const destino = pos + delta;
    if (destino < 0 || destino >= keys.length) return;
    [keys[pos], keys[destino]] = [keys[destino], keys[pos]];
    setKeysManual(keys);
    guardar(claveManual(iso), keys);
    if (modoOrden !== 'manual') {
      setModoOrden('manual');
      guardar(CLAVE_MODO, 'manual');
    }
  }

  const puntosDia = ordenadas.map((p, pos) => ({
    lat: p.direccion.lat,
    lng: p.direccion.lng,
    color: p.color,
    etiqueta: String(pos + 1),
    popup: `${pos + 1}. ${p.titulo}\n${textoHora(p.ini)}–${textoHora(Math.min(p.fin, 1439))}\n${p.direccion.direccion}`,
  }));

  // Llegada estimada a la primera parada (si es hoy y salís desde donde estás)
  const esHoy = esMismoDia(fecha, new Date());
  let llegadaPrimera = null;
  if (esHoy && origen && ordenadas[0] && rutaCalles.tramos[0]) {
    const llega = new Date(Date.now() + rutaCalles.tramos[0].duracion * 1000);
    llegadaPrimera = { hora: horaHHMM(llega), tarde: minutosDeFecha(llega) > ordenadas[0].fin };
  }

  const linkGoogle = linkRutaDelDia(ordenadas.map((p) => p.direccion));

  // Pestaña Clientes: todas las direcciones y las más cercanas a vos
  const direccionesClientes = datos.clientes.flatMap((c) =>
    (c.direcciones || []).filter(tieneUbicacion).map((d) => ({ cliente: c, direccion: d }))
  );
  const puntosTodos = direccionesClientes.map(({ cliente, direccion }) => ({
    lat: direccion.lat,
    lng: direccion.lng,
    color: cliente.color,
    etiqueta: cliente.nombre.trim().slice(0, 1).toUpperCase(),
    popup: `${cliente.nombre}\n${direccion.etiqueta}: ${direccion.direccion}`,
  }));
  const masCercanos = hayYo
    ? direccionesClientes
        .map((x) => ({ ...x, metros: metrosEntre(ubicacion, { lat: Number(x.direccion.lat), lng: Number(x.direccion.lng) }) }))
        .sort((a, b) => a.metros - b.metros)
        .slice(0, 15)
    : [];

  const propsMapaYo = {
    ubicacion,
    rumbo,
    botonUbicacion: true,
    onActivarBrujula: necesitaPermiso ? activarBrujula : undefined,
  };

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold">Mapa</h1>
          <div className="grid grid-cols-2 rounded-xl bg-navy-900 p-1 text-sm font-bold">
            {[
              ['dia', 'Del día'],
              ['todos', 'Clientes'],
            ].map(([v, t]) => (
              <button key={v} onClick={() => setModo(v)} className={`rounded-lg px-3 py-1.5 ${modo === v ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        {modo === 'dia' && (
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => setFecha((f) => sumarDias(f, -1))} className="btn btn-sec px-2.5 py-2" aria-label="Día anterior"><Icon name="izq" /></button>
            <button onClick={() => setFecha((f) => sumarDias(f, 1))} className="btn btn-sec px-2.5 py-2" aria-label="Día siguiente"><Icon name="der" /></button>
            <p className="flex-1 truncate px-1 font-bold">{fechaLarga(fecha)}</p>
            {!esHoy && (
              <button onClick={() => setFecha(inicioDia(new Date()))} className="chip chip-activo">Hoy</button>
            )}
          </div>
        )}
      </header>

      <div className="px-4 pt-4">
        {errorUbicacion && (
          <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">
            <Icon name="ubicacion" className="mt-0.5 h-4 w-4 shrink-0" /> {errorUbicacion}
          </p>
        )}
        {necesitaPermiso && hayYo && (
          <p className="mb-3 text-xs text-tinta-400">
            Tocá el botón azul del mapa para ver hacia dónde estás mirando.
          </p>
        )}

        {modo === 'dia' ? (
          <>
            <Mapa key="dia" alto={380} puntos={puntosDia} trazado={rutaCalles.trazado} ruta {...propsMapaYo} />

            {conUbicacion.length > 0 && (
              <div className="tarjeta mt-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-menta-500/15 text-menta-400">
                      <Icon name="ruta" />
                    </span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-tinta-400">Ruta del día</p>
                      {rutaCalles.cargando ? (
                        <p className="font-bold text-tinta-300">Calculando…</p>
                      ) : rutaCalles.trazado ? (
                        <p className="text-lg font-extrabold">
                          {textoDistancia(rutaCalles.distancia)} <span className="text-tinta-400">·</span> {textoDuracion(rutaCalles.duracion)}
                        </p>
                      ) : rutaCalles.error ? (
                        <p className="text-sm text-amber-200">{rutaCalles.error}</p>
                      ) : (
                        <p className="text-sm text-tinta-300">Una sola parada: tocá Ir para llegar.</p>
                      )}
                      {llegadaPrimera && (
                        <p className={`text-xs font-semibold ${llegadaPrimera.tarde ? 'text-amber-300' : 'text-menta-300'}`}>
                          Si salís ahora llegás a la 1ª parada ~{llegadaPrimera.hora}{llegadaPrimera.tarde ? ' (después de su horario)' : ''}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDesdeMi((v) => !v)}
                    className={`chip shrink-0 ${desdeMi && hayYo ? 'chip-activo' : ''}`}
                    disabled={!hayYo}
                    title={hayYo ? '' : 'Buscando tu ubicación…'}
                  >
                    <Icon name="ubicacion" className="h-3.5 w-3.5" /> Desde mí
                  </button>
                </div>

                {conUbicacion.length > 1 && (
                  <div className="mt-4">
                    <p className="etiqueta">Orden del recorrido</p>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                      {Object.entries(MODOS_ORDEN).map(([valor, texto]) => (
                        <button key={valor} type="button" onClick={() => elegirModo(valor)} className={`chip ${modoOrden === valor ? 'chip-activo' : ''}`}>
                          {texto}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-tinta-400">
                      {AYUDA_ORDEN[modoOrden]}
                      {(modoOrden === 'cerca' || modoOrden === 'mixto') && !origen ? ' Prendé "Desde mí" para que arranque desde donde estás.' : ''}
                      {matriz?.aproximada && modoOrden !== 'horario' && modoOrden !== 'manual' ? ' (calculando tiempos reales…)' : ''}
                    </p>
                  </div>
                )}

                {linkGoogle && (
                  <a href={linkGoogle} target="_blank" rel="noreferrer" className="btn btn-menta mt-4 w-full">
                    <Icon name="ir" /> Navegar la ruta en Google Maps
                  </a>
                )}
              </div>
            )}

            <h2 className="titulo-seccion mt-6 mb-2">Recorrido</h2>
            {eventos.length === 0 ? (
              <p className="tarjeta p-4 text-sm text-tinta-400">No hay trabajos agendados este día.</p>
            ) : (
              <ol className="space-y-2">
                {ordenadas.map((p, pos) => {
                  const tramo = tramoDe(pos);
                  const desdeVos = hayYo && matriz ? matriz.dur[0]?.[p.idxMatriz] : null;
                  return (
                    <li key={p.key} className="tarjeta p-3">
                      {tramo && (
                        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-tinta-400">
                          <Icon name="auto" className="h-3.5 w-3.5" /> {pos === 0 && origen ? 'Desde vos: ' : ''}
                          {textoDistancia(tramo.distancia)} · {textoDuracion(tramo.duracion)}
                        </p>
                      )}
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-extrabold text-navy-950" style={{ background: p.color }}>
                          {pos + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 truncate font-bold">
                            {p.tipo === 'relevamiento' && <Icon name="relevamiento" className="h-4 w-4 shrink-0 text-marca-naranja" />}
                            <span className="truncate">{p.titulo}</span>
                          </p>
                          <p className="truncate text-xs text-tinta-400">
                            {textoHora(p.ini)}–{textoHora(Math.min(p.fin, 1439))} · {p.direccion.etiqueta}: {p.direccion.direccion}
                          </p>
                          {Number.isFinite(desdeVos) && (
                            <p className="text-xs font-semibold text-[#5aa9e6]">a {textoDuracion(desdeVos)} de vos</p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {conUbicacion.length > 1 && (
                            <div className="flex flex-col">
                              <button type="button" onClick={() => mover(pos, -1)} disabled={pos === 0} className="rounded-md px-1.5 text-tinta-400 hover:text-tinta-100 disabled:opacity-25" aria-label="Subir">
                                <Icon name="arriba" className="h-4 w-4" />
                              </button>
                              <button type="button" onClick={() => mover(pos, 1)} disabled={pos === ordenadas.length - 1} className="rounded-md px-1.5 text-tinta-400 hover:text-tinta-100 disabled:opacity-25" aria-label="Bajar">
                                <Icon name="abajo" className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                          <a href={linkGoogleMaps(p.direccion)} target="_blank" rel="noreferrer" className="btn btn-sec px-2.5 py-2" aria-label="Ir con Google Maps">
                            <Icon name="ir" className="h-4 w-4" />
                          </a>
                          <a href={linkWaze(p.direccion)} target="_blank" rel="noreferrer" className="btn btn-sec px-2.5 py-2 text-xs">Waze</a>
                        </div>
                      </div>
                    </li>
                  );
                })}
                {sinUbicacion.map((p) => (
                  <li key={p.key} className="tarjeta flex items-center gap-3 p-3 opacity-70">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-dashed border-navy-500 text-sm text-tinta-400">–</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate font-bold">
                            {p.tipo === 'relevamiento' && <Icon name="relevamiento" className="h-4 w-4 shrink-0 text-marca-naranja" />}
                            <span className="truncate">{p.titulo}</span>
                          </p>
                      <p className="truncate text-xs text-tinta-400">
                        {textoHora(p.ini)}–{textoHora(Math.min(p.fin, 1439))} · {p.direccion ? `${p.direccion.etiqueta}: sin ubicación en el mapa` : 'Sin dirección'}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {sinUbicacion.length > 0 && (
              <p className="mt-3 text-xs text-tinta-400">
                {sinUbicacion.length} sin ubicación en el mapa: no entran en la ruta. Marcalas desde la ficha del cliente.
              </p>
            )}
          </>
        ) : (
          <>
            <Mapa key="todos" alto={420} puntos={puntosTodos} {...propsMapaYo} />
            <p className="mt-3 text-sm text-tinta-400">
              {puntosTodos.length} {puntosTodos.length === 1 ? 'dirección' : 'direcciones'} de {datos.clientes.length} clientes.{' '}
              <Link href="/panel/clientes" className="font-semibold text-menta-400">Ver clientes</Link>
            </p>

            {masCercanos.length > 0 && (
              <>
                <h2 className="titulo-seccion mt-6 mb-2">Más cerca de vos</h2>
                <ul className="tarjeta divide-y divide-navy-800 overflow-hidden">
                  {masCercanos.map(({ cliente, direccion, metros }) => (
                    <li key={direccion.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-extrabold text-navy-950" style={{ background: cliente.color }}>
                        {cliente.nombre.trim().slice(0, 1).toUpperCase()}
                      </span>
                      <Link href={`/panel/clientes/${cliente.id}`} className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{cliente.nombre}</span>
                        <span className="block truncate text-xs text-tinta-400">
                          {direccion.etiqueta}: {direccion.direccion}
                        </span>
                      </Link>
                      <span className="shrink-0 text-right text-xs font-semibold text-[#5aa9e6]">{textoDistancia(metros)}</span>
                      <a href={linkGoogleMaps(direccion)} target="_blank" rel="noreferrer" className="btn btn-sec shrink-0 px-2.5 py-2" aria-label="Ir con Google Maps">
                        <Icon name="ir" className="h-4 w-4" />
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-tinta-500">Distancia en línea recta desde donde estás.</p>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
