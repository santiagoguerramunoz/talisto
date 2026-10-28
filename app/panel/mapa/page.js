'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import Mapa from '@/components/Mapa';
import { usePanel } from '@/components/PanelContext';
import { useDatosAgenda } from '@/lib/useDatosAgenda';
import { useUbicacion } from '@/lib/useUbicacion';
import { useRuta, textoDistancia, textoDuracion } from '@/lib/ruta';
import { eventosDelDia, indexarClientes } from '@/lib/agenda';
import { esMismoDia, fechaLarga, inicioDia, sumarDias, textoHora } from '@/lib/fechas';
import { linkGoogleMaps, linkRutaDelDia, linkWaze } from '@/lib/util';

export default function MapaDelDia() {
  const { profesional } = usePanel();
  const [fecha, setFecha] = useState(() => inicioDia(new Date()));
  const [modo, setModo] = useState('dia');
  const [desdeMi, setDesdeMi] = useState(true);

  const { datos } = useDatosAgenda(profesional.id, fecha.getTime(), sumarDias(fecha, 1).getTime());
  const { ubicacion, error: errorUbicacion } = useUbicacion(true);
  const indice = useMemo(() => indexarClientes(datos.clientes), [datos.clientes]);

  const eventos = useMemo(
    () => eventosDelDia({ fecha, turnos: datos.turnos, bloques: datos.bloques, indice }),
    [fecha, datos.turnos, datos.bloques, indice]
  );

  const paradas = eventos.map((ev, i) => ({ ...ev, numero: i + 1 }));
  const conUbicacion = paradas.filter((p) => p.direccion && p.direccion.lat !== null && p.direccion.lng !== null);

  const origen = desdeMi && ubicacion ? ubicacion : null;
  const rutaCalles = useRuta(
    conUbicacion.map((p) => ({ lat: p.direccion.lat, lng: p.direccion.lng })),
    origen
  );

  // Tramo (distancia y tiempo) para llegar a cada parada
  const tramoDe = {};
  conUbicacion.forEach((p, j) => {
    const i = origen ? j : j - 1;
    if (i >= 0 && rutaCalles.tramos[i]) tramoDe[p.key] = rutaCalles.tramos[i];
  });

  const puntosDia = conUbicacion.map((p) => ({
    lat: p.direccion.lat,
    lng: p.direccion.lng,
    color: p.color,
    etiqueta: String(p.numero),
    popup: `${p.numero}. ${p.titulo}\n${textoHora(p.ini)}–${textoHora(p.fin)}\n${p.direccion.direccion}`,
  }));

  const puntosTodos = datos.clientes.flatMap((c) =>
    (c.direcciones || [])
      .filter((d) => d.lat !== null && d.lng !== null)
      .map((d) => ({
        lat: d.lat,
        lng: d.lng,
        color: c.color,
        etiqueta: c.nombre.trim().slice(0, 1).toUpperCase(),
        popup: `${c.nombre}\n${d.etiqueta}: ${d.direccion}`,
      }))
  );

  const linkGoogle = linkRutaDelDia(conUbicacion.map((p) => p.direccion));

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
            {!esMismoDia(fecha, new Date()) && (
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

        {modo === 'dia' ? (
          <>
            <Mapa
              key="dia"
              alto={360}
              puntos={puntosDia}
              trazado={rutaCalles.trazado}
              ruta
              ubicacion={ubicacion}
              botonUbicacion
              encuadrarUbicacion={!!origen}
            />

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
                      <p className="text-xs text-tinta-400">
                        {origen ? 'Saliendo desde tu ubicación, en el orden de la agenda' : 'Desde la primera parada, en el orden de la agenda'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDesdeMi((v) => !v)}
                    className={`chip shrink-0 ${desdeMi ? 'chip-activo' : ''}`}
                    disabled={!ubicacion}
                    title={ubicacion ? '' : 'Buscando tu ubicación…'}
                  >
                    <Icon name="ubicacion" className="h-3.5 w-3.5" /> Desde mí
                  </button>
                </div>
                {linkGoogle && (
                  <a href={linkGoogle} target="_blank" rel="noreferrer" className="btn btn-menta mt-3 w-full">
                    <Icon name="ir" /> Navegar la ruta en Google Maps
                  </a>
                )}
              </div>
            )}

            <h2 className="titulo-seccion mt-6 mb-2">Recorrido</h2>
            {paradas.length === 0 ? (
              <p className="tarjeta p-4 text-sm text-tinta-400">No hay trabajos agendados este día.</p>
            ) : (
              <ol className="space-y-2">
                {paradas.map((p) => {
                  const tramo = tramoDe[p.key];
                  return (
                    <li key={p.key} className="tarjeta p-3">
                      {tramo && (
                        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-tinta-400">
                          <Icon name="auto" className="h-3.5 w-3.5" /> {textoDistancia(tramo.distancia)} · {textoDuracion(tramo.duracion)}
                        </p>
                      )}
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-extrabold text-navy-950" style={{ background: p.color }}>
                          {p.numero}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold">{p.titulo}</p>
                          <p className="truncate text-xs text-tinta-400">
                            {textoHora(p.ini)}–{textoHora(Math.min(p.fin, 1439))} · {p.direccion ? `${p.direccion.etiqueta}: ${p.direccion.direccion}` : 'Sin dirección'}
                          </p>
                        </div>
                        {p.direccion && (
                          <div className="flex shrink-0 gap-1.5">
                            <a href={linkGoogleMaps(p.direccion)} target="_blank" rel="noreferrer" className="btn btn-sec px-2.5 py-2" aria-label="Ir con Google Maps">
                              <Icon name="ir" className="h-4 w-4" />
                            </a>
                            <a href={linkWaze(p.direccion)} target="_blank" rel="noreferrer" className="btn btn-sec px-2.5 py-2 text-xs">Waze</a>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {paradas.length > conUbicacion.length && (
              <p className="mt-3 text-xs text-tinta-400">
                {paradas.length - conUbicacion.length} sin ubicación en el mapa. Marcalas desde la ficha del cliente.
              </p>
            )}
          </>
        ) : (
          <>
            <Mapa key="todos" alto={440} puntos={puntosTodos} ubicacion={ubicacion} botonUbicacion />
            <p className="mt-3 text-sm text-tinta-400">
              {puntosTodos.length} {puntosTodos.length === 1 ? 'dirección' : 'direcciones'} de {datos.clientes.length} clientes.{' '}
              <Link href="/panel/clientes" className="font-semibold text-menta-400">Ver clientes</Link>
            </p>
          </>
        )}
      </div>
    </>
  );
}
