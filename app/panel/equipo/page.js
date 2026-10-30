'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '@/components/Icon';
import Mapa from '@/components/Mapa';
import { Reloj } from '@/components/ControlTiempo';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { combinar, esMismoDia, fechaISO, fechaLarga, inicioDia, sumarDias } from '@/lib/fechas';
import { ESTADOS_TRABAJO, estadoTrabajo, identificadorTrabajo } from '@/lib/trabajos';
import { minutosTrabajo, sesionAbierta, textoMinutos } from '@/lib/tiempos';
import { mensajeError } from '@/lib/util';
import { haceCuanto, hhmm, iniciales, useEquipoAsignable } from '@/lib/equipo';

const COLORES = ['#4fe0b6', '#ffb547', '#8cc8ff', '#f58bd0', '#c4f06a', '#ff8a70', '#b9a6ff', '#5ee0f0'];
const SIN = '__sin__';
const hora = (t) => (t ? String(t).slice(0, 5) : '');
const aMinutos = (hhmmTexto) => Number(hhmmTexto.slice(0, 2)) * 60 + Number(hhmmTexto.slice(3, 5));

function armar(ordenes, turnos, relevamientos, empresas) {
  const porEmpresa = Object.fromEntries(empresas.map((e) => [e.id, e]));
  const relevPorTurno = Object.fromEntries(relevamientos.map((r) => [r.turno_id, r]));
  const a = ordenes.map((o) => {
    const e = porEmpresa[o.empresa_id];
    const corriendo = !!sesionAbierta(o.tiempos);
    return {
      key: `o-${o.id}`,
      tabla: 'ordenes',
      id: o.id,
      tipo: 'ticket',
      titulo: `${e?.nombre || 'B2B'} · ${identificadorTrabajo(o)}`,
      color: e?.color || '#94a3b8',
      cuando: o.hora_inicio ? `${hora(o.hora_inicio)}${o.hora_fin ? `–${hora(o.hora_fin)}` : ''}` : 'Sin horario',
      minuto: o.hora_inicio ? aMinutos(hora(o.hora_inicio)) : 24 * 60,
      lugar: o.lat != null ? { lat: o.lat, lng: o.lng, direccion: o.direccion } : o.direccion ? { direccion: o.direccion } : null,
      estado: corriendo ? 'en_curso' : estadoTrabajo(o.estado) === 'en_curso' ? 'pendiente' : estadoTrabajo(o.estado),
      tiempos: o.tiempos || [],
      minutos_manual: o.minutos_manual,
      asignado: o.asignado_a || null,
      orden: o.orden_ruta,
      resolucion: o.realizado,
      nota: o.nota_estado,
      pedido: o.pedido,
    };
  });
  const b = turnos.map((t) => {
    const r = relevPorTurno[t.id];
    const d = t.direcciones;
    const corriendo = !!sesionAbierta(t.tiempos);
    const lugar = d?.lat != null ? d : r?.lat != null ? r : d?.direccion ? d : r?.direccion ? r : null;
    return {
      key: `t-${t.id}`,
      tabla: 'turnos',
      id: t.id,
      tipo: t.tipo || 'trabajo',
      titulo: t.clientes?.nombre || t.titulo || 'Turno',
      color: t.clientes?.color || '#2dd4bf',
      cuando: `${hhmm(t.inicio)}–${hhmm(t.fin)}`,
      minuto: new Date(t.inicio).getHours() * 60 + new Date(t.inicio).getMinutes(),
      lugar: lugar ? { lat: lugar.lat, lng: lugar.lng, direccion: lugar.direccion } : null,
      estado: t.estado === 'realizado' ? 'finalizado' : corriendo ? 'en_curso' : t.resolucion && (t.tiempos || []).length ? 'suspendido' : 'pendiente',
      tiempos: t.tiempos || [],
      asignado: t.asignado_a || null,
      orden: t.orden_ruta,
      resolucion: t.estado === 'realizado' ? t.resolucion : null,
      nota: t.estado !== 'realizado' ? t.resolucion : null,
      pedido: r?.pedido || t.notas,
    };
  });
  return [...a, ...b].sort((x, y) => (x.orden ?? 9999) - (y.orden ?? 9999) || x.minuto - y.minuto);
}

export default function EquipoEnRuta() {
  const { profesional, empresa, permisos } = usePanel();
  const equipo = useEquipoAsignable();
  const cuenta = profesional.id;
  const lista = permisos || [];
  const editaTickets = equipo.esDueno || lista.includes('tickets_asignar');
  const editaTurnos = equipo.esDueno || lista.includes('agenda');
  const [fecha, setFecha] = useState(() => inicioDia(new Date()));
  const [datos, setDatos] = useState({ cargando: true, items: [], posiciones: [], error: '', cuando: null });
  const [filtro, setFiltro] = useState('');
  const [abierto, setAbierto] = useState('');
  const [aviso, setAviso] = useState('');
  const pedido = useRef(0);
  const dia = fechaISO(fecha);

  const cargar = useCallback(async () => {
    const n = ++pedido.current;
    const desde = combinar(dia, '00:00').toISOString();
    const hasta = combinar(fechaISO(sumarDias(combinar(dia, '00:00'), 1)), '00:00').toISOString();
    const camposOrden =
      'id, empresa_id, numero_ticket, numero_cliente, cliente_final, direccion, lat, lng, pedido, realizado, estado, nota_estado, tiempos, minutos_manual, asignado_a, orden_ruta, hora_inicio, hora_fin, fecha';
    const [od, oc, tu, em, po] = await Promise.all([
      supabase.from('ordenes').select(camposOrden).eq('profesional_id', cuenta).eq('fecha', dia).neq('estado', 'cancelado'),
      supabase.from('ordenes').select(camposOrden).eq('profesional_id', cuenta).eq('estado', 'en_curso').lt('fecha', dia),
      supabase
        .from('turnos')
        .select('id, tipo, titulo, inicio, fin, estado, asignado_a, orden_ruta, tiempos, resolucion, notas, clientes(nombre, color), direcciones(direccion, lat, lng)')
        .eq('profesional_id', cuenta)
        .gte('inicio', desde)
        .lt('inicio', hasta)
        .neq('estado', 'cancelado'),
      supabase.from('clientes').select('id, nombre, color').eq('profesional_id', cuenta).eq('es_empresa', true),
      supabase.from('posiciones_equipo').select('usuario_id, lat, lng, precision_m, actualizado_en').eq('cuenta_id', cuenta),
    ]);
    const turnos = tu.data || [];
    const idsRelev = turnos.filter((t) => t.tipo === 'relevamiento').map((t) => t.id);
    const re = idsRelev.length
      ? await supabase.from('relevamientos').select('turno_id, direccion, lat, lng, pedido').in('turno_id', idsRelev)
      : { data: [] };
    if (n !== pedido.current) return;
    const error = od.error || po.error;
    if (error) {
      setDatos((d) => ({ ...d, cargando: false, error: po.error?.code === '42P01' ? 'Falta correr el SQL 08 (tickets del equipo).' : mensajeError(error) }));
      return;
    }
    const ordenes = [...(od.data || []), ...(oc.data || []).filter((o) => !(od.data || []).some((x) => x.id === o.id))];
    setDatos({
      cargando: false,
      items: armar(ordenes, turnos, re.data || [], em.data || []),
      posiciones: po.data || [],
      error: '',
      cuando: new Date(),
    });
  }, [cuenta, dia]);

  useEffect(() => {
    setDatos((d) => ({ ...d, cargando: true }));
    cargar();
    const t = setInterval(() => document.visibilityState === 'visible' && cargar(), 20000);
    const alVolver = () => document.visibilityState === 'visible' && cargar();
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [cargar]);

  // Personas: el equipo que trabaja en tickets + quien tenga algo asignado
  const personas = useMemo(() => {
    const base = equipo.equipo.filter((p) => p.trabaja || datos.items.some((i) => i.asignado === p.usuario_id));
    const extra = [...new Set(datos.items.map((i) => i.asignado).filter((id) => id && !base.some((p) => p.usuario_id === id)))].map((id) => ({
      usuario_id: id,
      nombre: 'Ex integrante',
    }));
    return [...base, ...extra].map((p, i) => ({ ...p, color: COLORES[i % COLORES.length], corto: p.nombre.replace(' (cuenta principal)', '') }));
  }, [equipo.equipo, datos.items]);
  const colorDe = (id) => personas.find((p) => p.usuario_id === id)?.color || '#94a3b8';

  const grupos = useMemo(() => {
    const g = personas.map((p) => ({ ...p, items: datos.items.filter((i) => i.asignado === p.usuario_id) }));
    const sin = datos.items.filter((i) => !i.asignado);
    return { personas: g.filter((p) => p.items.length || (p.trabaja && !p.principal)), sin };
  }, [personas, datos.items]);

  const ahora = Date.now();
  const visibles = filtro ? datos.items.filter((i) => (filtro === SIN ? !i.asignado : i.asignado === filtro)) : datos.items;
  const puntos = [
    ...visibles
      .filter((i) => i.lugar?.lat != null)
      .map((i) => {
        const grupo = i.asignado ? grupos.personas.find((p) => p.usuario_id === i.asignado) : null;
        const n = grupo ? grupo.items.indexOf(i) + 1 : '';
        return {
          lat: i.lugar.lat,
          lng: i.lugar.lng,
          color: i.asignado ? colorDe(i.asignado) : '#94a3b8',
          etiqueta: i.estado === 'finalizado' ? '✓' : n,
          forma: i.tipo === 'relevamiento' && i.estado !== 'finalizado' ? 'relevamiento' : undefined,
          popup: `${i.titulo}\n${i.cuando} · ${ESTADOS_TRABAJO[i.estado]?.texto || ''}${grupo ? `\n${grupo.corto}` : '\nSin asignar'}`,
        };
      }),
    ...(filtro === SIN ? [] : datos.posiciones)
      .filter((p) => !filtro || p.usuario_id === filtro)
      .filter((p) => esMismoDia(fecha, new Date()) && ahora - new Date(p.actualizado_en).getTime() < 12 * 3600000)
      .map((p) => {
        const persona = personas.find((x) => x.usuario_id === p.usuario_id);
        return {
          lat: p.lat,
          lng: p.lng,
          forma: 'persona',
          fueraDeRuta: true,
          color: colorDe(p.usuario_id),
          etiqueta: iniciales(persona?.corto || ''),
          viejo: ahora - new Date(p.actualizado_en).getTime() > 15 * 60000,
          popup: `${persona?.corto || 'Equipo'}\nUbicación ${haceCuanto(p.actualizado_en, ahora)}`,
        };
      }),
  ];

  async function asignar(item, usuarioId) {
    setAviso('');
    const { error } = await supabase.from(item.tabla).update({ asignado_a: usuarioId || null }).eq('id', item.id);
    if (error) setAviso(mensajeError(error));
    cargar();
  }

  async function mover(grupo, item, delta) {
    const orden = [...grupo.items];
    const i = orden.indexOf(item);
    const j = i + delta;
    if (j < 0 || j >= orden.length) return;
    [orden[i], orden[j]] = [orden[j], orden[i]];
    setDatos((d) => ({ ...d, items: d.items.map((x) => ({ ...x, orden: orden.includes(x) ? orden.indexOf(x) + 1 : x.orden })) }));
    const cambios = orden.map((x, k) => ({ x, k: k + 1 })).filter(({ x, k }) => x.orden !== k);
    const res = await Promise.all(cambios.map(({ x, k }) => supabase.from(x.tabla).update({ orden_ruta: k }).eq('id', x.id)));
    const err = res.find((r) => r.error)?.error;
    if (err) setAviso(mensajeError(err));
    cargar();
  }

  const puede = (item) => (item.tabla === 'ordenes' ? editaTickets : editaTurnos);
  const total = datos.items.length;
  const terminados = datos.items.filter((i) => i.estado === 'finalizado').length;
  const enCurso = datos.items.filter((i) => i.estado === 'en_curso').length;

  if (!equipo.puedeMonitorear) {
    return (
      <div className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <p className="tarjeta p-5 text-center text-tinta-300">Esta pantalla es para quienes organizan el trabajo del equipo.</p>
      </div>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/panel" className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver a la agenda">
            <Icon name="izq" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold">Equipo en ruta</h1>
            <p className="truncate text-xs text-tinta-400">
              {empresa?.nombre || equipo.empresa?.nombre}
              {datos.cuando ? ` · actualizado ${hhmm(datos.cuando.toISOString())}` : ''}
            </p>
          </div>
          <button type="button" onClick={cargar} className="btn btn-sec px-2.5 py-2" aria-label="Actualizar">
            <Icon name="repetir" className={`h-4 w-4 ${datos.cargando ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => setFecha((f) => sumarDias(f, -1))} className="btn btn-sec px-2.5 py-2" aria-label="Día anterior"><Icon name="izq" /></button>
          <button onClick={() => setFecha((f) => sumarDias(f, 1))} className="btn btn-sec px-2.5 py-2" aria-label="Día siguiente"><Icon name="der" /></button>
          <p className="flex-1 truncate px-1 font-bold">{fechaLarga(fecha)}</p>
          {!esMismoDia(fecha, new Date()) && <button onClick={() => setFecha(inicioDia(new Date()))} className="chip chip-activo">Hoy</button>}
        </div>
      </header>

      <div className="space-y-3 px-4 pt-4">
        {datos.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{datos.error}</p>}
        {aviso && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{aviso}</p>}

        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            ['Trabajos', total, 'text-tinta-100'],
            ['En curso', enCurso, 'text-[#8cc8ff]'],
            ['Terminados', terminados, 'text-menta-300'],
            ['Sin asignar', grupos.sin.length, grupos.sin.length ? 'text-amber-300' : 'text-tinta-400'],
          ].map(([t, v, c]) => (
            <div key={t} className="rounded-xl bg-navy-900 px-1 py-2">
              <p className={`text-xl font-extrabold tabular-nums ${c}`}>{v}</p>
              <p className="text-[10.5px] font-semibold text-tinta-400">{t}</p>
            </div>
          ))}
        </div>

        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
          <button type="button" onClick={() => setFiltro('')} className={`chip shrink-0 ${!filtro ? 'chip-activo' : ''}`}>Todos</button>
          {grupos.personas.map((p) => (
            <button key={p.usuario_id} type="button" onClick={() => setFiltro(p.usuario_id)} className={`chip shrink-0 ${filtro === p.usuario_id ? 'chip-activo' : ''}`}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} /> {p.corto}
            </button>
          ))}
          {grupos.sin.length > 0 && (
            <button type="button" onClick={() => setFiltro(SIN)} className={`chip shrink-0 ${filtro === SIN ? 'chip-activo' : ''}`}>Sin asignar</button>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-navy-800">
          <Mapa puntos={puntos} alto={280} encuadrarSiempre={false} />
        </div>
        <p className="text-xs text-tinta-500">
          Los círculos con iniciales son la última ubicación de cada uno (si la comparte). Se actualiza solo cada 20 segundos.
        </p>

        {grupos.sin.length > 0 && (!filtro || filtro === SIN) && (
          <section className="tarjeta overflow-hidden border-amber-400/40">
            <h2 className="border-b border-navy-800 px-4 py-3 font-bold text-amber-300">Sin asignar · {grupos.sin.length}</h2>
            <ul>
              {grupos.sin.map((i) => (
                <li key={i.key} className="flex items-center gap-3 border-b border-navy-800 px-4 py-3 last:border-0">
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: i.color }} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-sm">{i.titulo}</b>
                    <span className="block truncate text-xs text-tinta-400">{i.cuando}{i.lugar?.direccion ? ` · ${i.lugar.direccion}` : ''}</span>
                  </span>
                  {puede(i) && (
                    <select className="campo w-auto max-w-[9.5rem] py-1.5 text-sm" value="" onChange={(e) => e.target.value && asignar(i, e.target.value)} aria-label={`Asignar ${i.titulo}`}>
                      <option value="">Asignar…</option>
                      {equipo.equipo.filter((p) => p.trabaja).map((p) => (
                        <option key={p.usuario_id} value={p.usuario_id}>{p.nombre.replace(' (cuenta principal)', '')}</option>
                      ))}
                    </select>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {grupos.personas
          .filter((p) => !filtro || filtro === p.usuario_id)
          .map((p) => {
            const actual = p.items.find((i) => i.estado === 'en_curso');
            const proximo = p.items.find((i) => i.estado === 'pendiente' || i.estado === 'multidia');
            const hechos = p.items.filter((i) => i.estado === 'finalizado').length;
            const pos = datos.posiciones.find((x) => x.usuario_id === p.usuario_id);
            const sesion = actual ? sesionAbierta(actual.tiempos) : null;
            return (
              <section key={p.usuario_id} className={`tarjeta overflow-hidden ${actual ? 'border-[#0a84ff]/50' : ''}`}>
                <div className="flex items-center gap-3 p-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-extrabold text-navy-950" style={{ background: p.color }}>
                    {iniciales(p.corto)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{p.corto}</p>
                    <p className="truncate text-xs text-tinta-300">
                      {actual ? (
                        <>
                          <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#0a84ff] align-middle" />
                          En {actual.titulo} desde {hhmm(sesion?.inicio)} · <Reloj tiempos={actual.tiempos} className="font-bold text-[#8cc8ff]" />
                        </>
                      ) : p.items.length === 0 ? (
                        'Sin trabajos este día'
                      ) : hechos === p.items.length ? (
                        'Terminó la ruta'
                      ) : proximo ? (
                        `Próximo: ${proximo.titulo} · ${proximo.cuando}`
                      ) : (
                        'Con trabajos pendientes'
                      )}
                    </p>
                    {pos && <p className="text-[11px] text-tinta-500">Ubicación {haceCuanto(pos.actualizado_en, ahora)}</p>}
                  </div>
                  {p.items.length > 0 && (
                    <span className="shrink-0 text-right text-xs font-bold text-tinta-300">
                      {hechos}/{p.items.length}
                      <span className="mt-1 block h-1.5 w-12 overflow-hidden rounded-full bg-navy-700">
                        <span className="block h-full bg-menta-400" style={{ width: `${(hechos / p.items.length) * 100}%` }} />
                      </span>
                    </span>
                  )}
                </div>
                {p.items.length > 0 && (
                  <ol className="border-t border-navy-800">
                    {p.items.map((i, k) => {
                      const info = ESTADOS_TRABAJO[i.estado] || ESTADOS_TRABAJO.pendiente;
                      const sesiones = i.tiempos.filter((t) => t?.inicio);
                      const ultima = sesiones[sesiones.length - 1];
                      const ver = abierto === i.key;
                      return (
                        <li key={i.key} className="border-b border-navy-800 last:border-0">
                          <div className="flex items-center gap-2 px-3 py-2.5">
                            <span className={`grid h-7 w-7 shrink-0 place-items-center text-xs font-extrabold text-navy-950 ${i.tipo === 'relevamiento' ? 'rounded-md bg-marca-naranja' : 'rounded-full'}`} style={i.tipo === 'relevamiento' ? undefined : { background: i.color }}>
                              {i.estado === 'finalizado' ? <Icon name="check" className="h-3.5 w-3.5" /> : k + 1}
                            </span>
                            <button type="button" onClick={() => setAbierto(ver ? '' : i.key)} className="min-w-0 flex-1 text-left">
                              <b className="block truncate text-sm">{i.titulo}</b>
                              <span className="block truncate text-xs text-tinta-400">
                                {i.cuando}
                                {sesiones.length ? ` · ${hhmm(sesiones[0].inicio)}${ultima?.fin ? `–${hhmm(ultima.fin)}` : ' →'} · ${textoMinutos(minutosTrabajo(i))}` : ''}
                              </span>
                            </button>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${info.clase}`}>{info.texto}</span>
                            {puede(i) && p.items.length > 1 && (
                              <span className="flex shrink-0 flex-col">
                                <button type="button" onClick={() => mover(p, i, -1)} disabled={k === 0} className="px-1 text-tinta-400 disabled:opacity-20" aria-label="Subir en la ruta">
                                  <Icon name="arriba" className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" onClick={() => mover(p, i, 1)} disabled={k === p.items.length - 1} className="px-1 text-tinta-400 disabled:opacity-20" aria-label="Bajar en la ruta">
                                  <Icon name="abajo" className="h-3.5 w-3.5" />
                                </button>
                              </span>
                            )}
                          </div>
                          {ver && (
                            <div className="space-y-2 bg-navy-850/60 px-4 pb-3 pt-1 text-sm">
                              {i.lugar?.direccion && <p className="text-tinta-300"><Icon name="pin" className="mr-1 inline h-3.5 w-3.5" />{i.lugar.direccion}</p>}
                              {i.pedido && <p className="whitespace-pre-line text-tinta-300"><b className="text-tinta-200">Pedido:</b> {i.pedido}</p>}
                              {sesiones.map((t, n) => (
                                <p key={n} className="text-xs text-tinta-400">
                                  Tramo {n + 1}: {hhmm(t.inicio)} a {t.fin ? hhmm(t.fin) : 'ahora'}
                                  {t.lat_i != null ? ' · inicio con ubicación' : ''}
                                  {t.lat_f != null ? ' · fin con ubicación' : ''}
                                </p>
                              ))}
                              {i.resolucion && (
                                <p className="whitespace-pre-line rounded-xl bg-menta-500/10 p-2.5 text-menta-200">
                                  <b className="block text-xs uppercase tracking-wide text-menta-300">Cómo quedó</b>
                                  {i.resolucion}
                                </p>
                              )}
                              {i.nota && i.estado !== 'finalizado' && <p className="text-xs text-red-300">Motivo: {i.nota}</p>}
                              {puede(i) && i.estado !== 'finalizado' && (
                                <label className="flex items-center gap-2 text-xs text-tinta-300">
                                  Pasar a
                                  <select className="campo w-auto py-1 text-sm" value={i.asignado || ''} onChange={(e) => asignar(i, e.target.value)}>
                                    <option value="">Sin asignar</option>
                                    {equipo.equipo.filter((x) => x.trabaja || x.usuario_id === i.asignado).map((x) => (
                                      <option key={x.usuario_id} value={x.usuario_id}>{x.nombre.replace(' (cuenta principal)', '')}</option>
                                    ))}
                                  </select>
                                </label>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            );
          })}

        {!datos.cargando && total === 0 && !datos.error && (
          <p className="tarjeta p-5 text-center text-sm text-tinta-400">No hay trabajos agendados este día. Creá tickets o turnos desde la Agenda y asignalos a alguien del equipo.</p>
        )}
        <div className="h-4" />
      </div>
    </>
  );
}
