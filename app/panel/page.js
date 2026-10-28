'use client';

import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import FormTurno from '@/components/FormTurno';
import FormBloque from '@/components/FormBloque';
import FormTrabajoB2B from '@/components/FormTrabajoB2B';
import TrabajosEnCurso from '@/components/TrabajosEnCurso';
import { usePanel } from '@/components/PanelContext';
import { useDatosAgenda } from '@/lib/useDatosAgenda';
import { distribuirColumnas, eventosDelDia, indexarClientes } from '@/lib/agenda';
import {
  DIAS, esMismoDia, fechaCorta, fechaISO, fechaLarga, inicioDia, inicioSemana, minutos, minutosDeFecha, sumarDias, textoHora,
} from '@/lib/fechas';
import { ESTADOS, monto } from '@/lib/util';
import { ESTADOS_TRABAJO, esFinalizado, estadoTrabajo } from '@/lib/trabajos';
import { useAjustes } from '@/lib/ajustes';

const HORA_PX = 64;
const GUTTER = '3.25rem';

export default function Agenda() {
  const { profesional } = usePanel();
  const [vista, setVista] = useState('dia');
  const [fecha, setFecha] = useState(() => inicioDia(new Date()));
  const [modalTurno, setModalTurno] = useState(null);
  const [modalBloque, setModalBloque] = useState(null);
  const [menuNuevo, setMenuNuevo] = useState(false);
  const [modalOrden, setModalOrden] = useState(null);

  const [desde, hasta] = useMemo(() => {
    if (vista === 'dia') return [fecha, sumarDias(fecha, 1)];
    const lunes = inicioSemana(fecha);
    return [lunes, sumarDias(lunes, 7)];
  }, [vista, fecha]);

  const { datos, recargar } = useDatosAgenda(profesional.id, desde.getTime(), hasta.getTime());
  const indice = useMemo(() => indexarClientes(datos.clientes), [datos.clientes]);
  const empresas = useMemo(() => datos.clientes.filter((c) => c.es_empresa), [datos.clientes]);
  const { ajustes } = useAjustes(profesional.id);

  const mover = (n) => setFecha((f) => sumarDias(f, vista === 'dia' ? n : n * 7));

  function abrirEvento(ev) {
    if (ev.clase === 'turno') setModalTurno({ turno: ev.turno });
    else if (ev.clase === 'orden') setModalOrden({ orden: ev.orden });
    else setModalBloque({ bloque: ev.bloque, fechaContexto: ev.fecha });
  }

  const titulo =
    vista === 'dia'
      ? fechaLarga(fecha)
      : `${fechaCorta(desde)} al ${fechaCorta(sumarDias(desde, 6))}`;

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold">Agenda</h1>
          <div className="grid grid-cols-2 rounded-xl bg-navy-900 p-1 text-sm font-bold">
            {[
              ['dia', 'Día'],
              ['semana', 'Semana'],
            ].map(([v, t]) => (
              <button key={v} onClick={() => setVista(v)} className={`rounded-lg px-3.5 py-1.5 ${vista === v ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => mover(-1)} className="btn btn-sec px-2.5 py-2" aria-label="Anterior"><Icon name="izq" /></button>
          <button onClick={() => mover(1)} className="btn btn-sec px-2.5 py-2" aria-label="Siguiente"><Icon name="der" /></button>
          <p className="flex-1 truncate px-1 font-bold">{titulo}</p>
          {!esMismoDia(fecha, new Date()) && (
            <button onClick={() => setFecha(inicioDia(new Date()))} className="chip chip-activo">Hoy</button>
          )}
        </div>
      </header>

      <div className="px-4 pt-4">
        {datos.error && <p className="mb-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{datos.error.message}</p>}
        <TrabajosEnCurso trabajos={datos.enCurso} porId={indice.porId} onAbrir={(t) => setModalOrden({ orden: t })} />
        {vista === 'dia' ? (
          <VistaDia
            fecha={fecha}
            datos={datos}
            indice={indice}
            onEvento={abrirEvento}
            onHora={(h) => setModalTurno({ inicial: { fecha: fechaISO(fecha), hora: textoHora(h * 60) } })}
          />
        ) : (
          <VistaSemana
            lunes={desde}
            datos={datos}
            indice={indice}
            onEvento={abrirEvento}
            onDia={(d) => {
              setFecha(d);
              setVista('dia');
            }}
          />
        )}
      </div>

      {/* Botón + */}
      <div className="fixed right-4 bottom-[calc(5.75rem_+_env(safe-area-inset-bottom))] z-[1050] flex flex-col items-end gap-2 sm:right-[max(1rem,calc(50%_-_20rem))]">
        {menuNuevo && (
          <>
            <button
              className="btn btn-sec shadow-xl"
              onClick={() => {
                setMenuNuevo(false);
                setModalBloque({ inicial: { fecha: fechaISO(fecha) } });
              }}
            >
              <Icon name="repetir" /> Horario fijo
            </button>
            <button
              className="btn btn-sec shadow-xl"
              onClick={() => {
                setMenuNuevo(false);
                setModalTurno({ inicial: { fecha: fechaISO(fecha), hora: '09:00', tipo: 'relevamiento' } });
              }}
            >
              <Icon name="relevamiento" className="h-5 w-5 text-marca-naranja" /> Relevamiento
            </button>
            {empresas.map((e) => (
              <button
                key={e.id}
                className="btn btn-sec shadow-xl"
                onClick={() => {
                  setMenuNuevo(false);
                  setModalOrden({ inicial: { empresa_id: e.id, fecha: fechaISO(fecha) } });
                }}
              >
                <span className="h-3 w-3 rounded-full" style={{ background: e.color }} /> Trabajo B2B · {e.nombre}
              </button>
            ))}
            <button
              className="btn btn-sec shadow-xl"
              onClick={() => {
                setMenuNuevo(false);
                setModalTurno({ inicial: { fecha: fechaISO(fecha), hora: '09:00' } });
              }}
            >
              <Icon name="reloj" /> Turno
            </button>
          </>
        )}
        <button
          onClick={() => setMenuNuevo((m) => !m)}
          className={`grid h-14 w-14 place-items-center rounded-2xl bg-menta-500 text-navy-950 shadow-[0_10px_30px_rgb(44_199_155/0.35)] transition ${menuNuevo ? 'rotate-45' : ''}`}
          aria-label="Agregar"
        >
          <Icon name="mas" className="h-7 w-7" strokeWidth={2.6} />
        </button>
      </div>

      <FormTurno
        abierto={!!modalTurno}
        onCerrar={() => setModalTurno(null)}
        onGuardado={recargar}
        profesionalId={profesional.id}
        nombreProfesional={profesional.nombre_publico}
        clientes={datos.clientes}
        bloques={datos.bloques}
        indice={indice}
        turno={modalTurno?.turno}
        inicial={modalTurno?.inicial}
      />
      <FormTrabajoB2B
        abierto={!!modalOrden}
        onCerrar={() => setModalOrden(null)}
        onGuardado={recargar}
        profesionalId={profesional.id}
        empresas={empresas}
        orden={modalOrden?.orden}
        inicial={modalOrden?.inicial}
        margenDefecto={ajustes.margen_materiales}
      />
      <FormBloque
        abierto={!!modalBloque}
        onCerrar={() => setModalBloque(null)}
        onGuardado={recargar}
        profesionalId={profesional.id}
        clientes={datos.clientes}
        bloque={modalBloque?.bloque}
        inicial={modalBloque?.inicial}
        fechaContexto={modalBloque?.fechaContexto}
      />
    </>
  );
}

function VistaDia({ fecha, datos, indice, onEvento, onHora }) {
  const eventos = useMemo(
    () => eventosDelDia({ fecha, turnos: datos.turnos, bloques: datos.bloques, ordenes: datos.ordenes, relevamientos: datos.relevamientos, indice }),
    [fecha, datos.turnos, datos.bloques, datos.ordenes, datos.relevamientos, indice]
  );
  const conHora = eventos.filter((e) => !e.sinHora);
  const sinHora = eventos.filter((e) => e.sinHora);
  const franjas = datos.horarios.filter((h) => Number(h.dia) === fecha.getDay());
  const [ahora, setAhora] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const inicioH = Math.max(0, Math.min(7, ...franjas.map((f) => Math.floor(minutos(f.hora_inicio) / 60)), ...conHora.map((e) => Math.floor(e.ini / 60))));
  const finH = Math.min(24, Math.max(20, ...franjas.map((f) => Math.ceil(minutos(f.hora_fin) / 60)), ...conHora.map((e) => Math.ceil(e.fin / 60))));
  const horas = Array.from({ length: finH - inicioH }, (_, i) => inicioH + i);
  const y = (min) => ((min - inicioH * 60) / 60) * HORA_PX;

  const total = eventos.reduce((s, e) => s + (Number(e.monto) || 0), 0);
  const columnas = distribuirColumnas(conHora);
  const esHoy = esMismoDia(fecha, ahora);
  const minAhora = minutosDeFecha(ahora);

  return (
    <>
      <div className="mb-3 flex items-center gap-2 text-sm text-tinta-300">
        {eventos.length === 0 ? (
          <span>Día libre. Tocá una hora para agendar.</span>
        ) : (
          <>
            <span className="font-semibold text-tinta-100">{eventos.length} {eventos.length === 1 ? 'compromiso' : 'compromisos'}</span>
            {total > 0 && <span>· {monto(total)} acordados</span>}
          </>
        )}
        {franjas.length === 0 && <span className="ml-auto text-xs text-tinta-500">Sin horario de trabajo</span>}
      </div>

      {sinHora.length > 0 && (
        <div className="mb-3 rounded-xl border border-navy-700 bg-navy-900 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-tinta-400">Trabajos B2B sin horario</p>
          <div className="flex flex-wrap gap-1.5">
            {sinHora.map((ev) => (
              <button
                key={ev.key}
                type="button"
                onClick={() => onEvento(ev)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${esFinalizado(ev) ? 'opacity-55' : ''}`}
                style={{ borderColor: ev.color, background: `${ev.color}1f` }}
              >
                {esFinalizado(ev) ? (
                  <Icon name="check" className="h-3 w-3" />
                ) : estadoTrabajo(ev.estado) !== 'pendiente' ? (
                  <span className={`h-2 w-2 rounded-full ${ESTADOS_TRABAJO[estadoTrabajo(ev.estado)]?.punto} ${ev.estado === 'en_curso' ? 'animate-pulse' : ''}`} />
                ) : null}
                {ev.titulo.replace(/^.*? · /, '')}
                {ev.direccion?.direccion ? <span className="font-normal text-tinta-400">· {ev.direccion.direccion}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="relative" style={{ height: horas.length * HORA_PX }}>
        {/* Horario de trabajo */}
        {franjas.map((f) => (
          <div
            key={f.id}
            className="absolute right-0 rounded-lg bg-navy-900"
            style={{ left: GUTTER, top: y(minutos(f.hora_inicio)), height: y(minutos(f.hora_fin)) - y(minutos(f.hora_inicio)) }}
          />
        ))}

        {/* Líneas de hora */}
        {horas.map((h) => (
          <div key={h} className="absolute inset-x-0 flex" style={{ top: (h - inicioH) * HORA_PX, height: HORA_PX }}>
            <span className="-mt-2 w-[3.25rem] shrink-0 pr-2 text-right text-xs font-semibold text-tinta-500">{textoHora(h * 60)}</span>
            <button
              type="button"
              onClick={() => onHora(h)}
              className="relative flex-1 border-t border-navy-800 hover:bg-navy-800/40"
              aria-label={`Agendar a las ${textoHora(h * 60)}`}
            />
          </div>
        ))}

        {/* Línea de ahora */}
        {esHoy && minAhora >= inicioH * 60 && minAhora <= finH * 60 && (
          <div className="pointer-events-none absolute right-0 z-20 flex items-center" style={{ left: `calc(${GUTTER} - 5px)`, top: y(minAhora) - 5 }}>
            <span className="h-2.5 w-2.5 rounded-full bg-marca-naranja" />
            <span className="h-0.5 flex-1 bg-marca-naranja" />
          </div>
        )}

        {/* Eventos */}
        {columnas.map((ev) => {
          const alto = Math.max(y(ev.fin) - y(ev.ini) - 3, 26);
          const ancho = `(100% - ${GUTTER} - 0.25rem) / ${ev.ncols}`;
          const compacto = alto < 52;
          return (
            <button
              key={ev.key}
              type="button"
              onClick={() => onEvento(ev)}
              className={`absolute z-10 overflow-hidden rounded-xl px-2.5 text-left shadow-lg ${compacto ? 'py-1' : 'py-1.5'} ${ev.estado === 'realizado' || (ev.clase === 'orden' && esFinalizado(ev)) ? 'opacity-55' : ''}`}
              style={{
                top: y(ev.ini) + 1,
                height: alto,
                left: `calc(${GUTTER} + 0.25rem + ${ancho} * ${ev.col})`,
                width: `calc(${ancho} - 4px)`,
                background: ev.flexible
                  ? `repeating-linear-gradient(135deg, ${ev.color}26 0 8px, ${ev.color}10 8px 16px)`
                  : `${ev.color}2e`,
                borderLeft: `4px ${ev.clase === 'bloque' || ev.flexible ? 'dashed' : 'solid'} ${ev.color}`,
              }}
            >
              <p className="flex items-center gap-1 truncate text-sm font-bold leading-tight text-tinta-100">
                {ev.clase === 'bloque' && <Icon name="repetir" className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                {ev.tipo === 'relevamiento' && <Icon name="relevamiento" className="h-3.5 w-3.5 shrink-0 text-marca-naranja" />}
                {ev.clase === 'orden' && estadoTrabajo(ev.estado) !== 'pendiente' && !esFinalizado(ev) ? (
                  <span className={`h-2 w-2 shrink-0 rounded-full ${ESTADOS_TRABAJO[estadoTrabajo(ev.estado)]?.punto} ${ev.estado === 'en_curso' ? 'animate-pulse' : ''}`} />
                ) : ev.estado === 'pendiente' ? (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                ) : null}
                <span className="truncate">{ev.titulo}</span>
              </p>
              <p className="truncate text-xs text-tinta-300">
                {ev.tipo === 'relevamiento' ? (ev.flexible ? 'Relevar entre ' : 'Relevar ') : ''}
                {textoHora(ev.ini)}–{textoHora(Math.min(ev.fin, 1439))}
                {ev.clase === 'orden' && estadoTrabajo(ev.estado) !== 'pendiente' ? ` · ${ESTADOS_TRABAJO[estadoTrabajo(ev.estado)]?.texto}` : ''}
                {ev.direccion ? ` · ${ev.direccion.etiqueta}` : ''}
                {!compacto && ev.monto ? ` · ${monto(ev.monto)}` : ''}
              </p>
            </button>
          );
        })}
      </div>
    </>
  );
}

function VistaSemana({ lunes, datos, indice, onEvento, onDia }) {
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
  const hoy = new Date();

  return (
    <div className="space-y-3">
      {dias.map((d) => {
        const eventos = eventosDelDia({ fecha: d, turnos: datos.turnos, bloques: datos.bloques, ordenes: datos.ordenes, relevamientos: datos.relevamientos, indice });
        const esHoy = esMismoDia(d, hoy);
        return (
          <section key={fechaISO(d)} className={`tarjeta overflow-hidden ${esHoy ? 'border-menta-500/60' : ''}`}>
            <button onClick={() => onDia(d)} className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-navy-850">
              <span className="font-bold">
                {DIAS[d.getDay()]} <span className="text-tinta-400">{d.getDate()}/{d.getMonth() + 1}</span>
                {esHoy && <span className="ml-2 rounded-full bg-menta-500/15 px-2 py-0.5 text-xs text-menta-300">Hoy</span>}
              </span>
              <Icon name="der" className="h-4 w-4 text-tinta-500" />
            </button>
            {eventos.length === 0 ? (
              <p className="border-t border-navy-800 px-4 py-3 text-sm text-tinta-500">Libre</p>
            ) : (
              <ul className="border-t border-navy-800">
                {eventos.map((ev) => (
                  <li key={ev.key}>
                    <button onClick={() => onEvento(ev)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-navy-850">
                      <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: ev.color }} />
                      <span className="w-[5.5rem] shrink-0 text-sm font-semibold text-tinta-300">
                        {ev.sinHora ? 'Sin hora' : `${textoHora(ev.ini)}–${textoHora(Math.min(ev.fin, 1439))}`}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 truncate font-semibold">
                          {ev.clase === 'bloque' && <Icon name="repetir" className="h-3.5 w-3.5 shrink-0 text-tinta-400" />}
                          {ev.tipo === 'relevamiento' && <Icon name="relevamiento" className="h-3.5 w-3.5 shrink-0 text-marca-naranja" />}
                          <span className="truncate">{ev.titulo}</span>
                        </span>
                        <span className="block truncate text-xs text-tinta-400">
                          {ev.tipo === 'relevamiento' ? `Relevamiento${ev.flexible ? ' · horario flexible' : ''} · ` : ''}
                          {ev.clase === 'orden' ? `${ESTADOS_TRABAJO[estadoTrabajo(ev.estado)]?.texto || ''}${ev.direccion?.direccion ? ` · ${ev.direccion.direccion}` : ''}` : ev.direccion ? `${ev.direccion.etiqueta} · ${ev.direccion.direccion}` : ev.clase === 'bloque' ? 'Horario fijo' : ESTADOS[ev.estado]}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
