'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '@/components/Icon';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { combinar, desdeISO, fechaCorta, fechaISO, sumarDias } from '@/lib/fechas';
import { useEquipoAsignable, useVeImportes } from '@/lib/equipo';
import { monto, mensajeError } from '@/lib/util';
import { METRICAS, desdeOrden, desdeTurno, planillaProduccion, promedioEquipo, resumenProduccion, textoCorto } from '@/lib/produccion';

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function periodo(tipo) {
  const hoy = new Date();
  if (tipo === 'mes') return { desde: fechaISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: fechaISO(hoy) };
  if (tipo === 'anterior')
    return { desde: fechaISO(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)), hasta: fechaISO(new Date(hoy.getFullYear(), hoy.getMonth(), 0)) };
  if (tipo === 'semana') return { desde: fechaISO(sumarDias(hoy, -6)), hasta: fechaISO(hoy) };
  return null;
}

// Trae todas las filas (de a 1000, el máximo por consulta)
async function todas(armar) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await armar().range(desde, desde + 999);
    if (error) return { error };
    filas.push(...(data || []));
    if (!data || data.length < 1000) return { data: filas };
  }
}

const CAMPOS_ORDEN =
  'id, empresa_id, numero_ticket, cliente_final, direccion, pedido, realizado, fecha, estado, tiempos, minutos_manual, asignado_a, cerrado_por, acondicionamientos, moes, factor_moe, precio_acondicionamiento, mano_obra, materiales';
const CAMPOS_TURNO =
  'id, tipo, titulo, numero, inicio, estado, tiempos, asignado_a, cerrado_por, resolucion, monto_acordado, clientes(nombre, es_empresa), direcciones(direccion)';

export default function ProduccionEquipo() {
  const { profesional, empresa, vistaPc } = usePanel();
  const equipo = useEquipoAsignable();
  const cuenta = profesional.id;
  const conImportes = useVeImportes();
  const [elegido, setElegido] = useState('mes');
  const [rango, setRango] = useState(() => periodo('mes'));
  const [datos, setDatos] = useState({ cargando: true, trabajos: [], error: '' });
  const [metricaId, setMetricaId] = useState('trabajos');
  const [abierto, setAbierto] = useState('');
  const pedido = useRef(0);

  const cargar = useCallback(async () => {
    if (!rango.desde || !rango.hasta || rango.desde > rango.hasta) return;
    const n = ++pedido.current;
    setDatos((d) => ({ ...d, cargando: true, error: '' }));
    const desdeTs = combinar(rango.desde, '00:00').toISOString();
    const hastaTs = combinar(fechaISO(sumarDias(desdeISO(rango.hasta), 1)), '00:00').toISOString();
    const [of, os, tf, ts, cl] = await Promise.all([
      todas(() =>
        supabase.from('ordenes').select(CAMPOS_ORDEN).eq('profesional_id', cuenta).in('estado', ['finalizado', 'realizado'])
          .gte('fecha', rango.desde).lte('fecha', rango.hasta).order('fecha').order('id')
      ),
      todas(() =>
        supabase.from('ordenes').select(CAMPOS_ORDEN).eq('profesional_id', cuenta).eq('estado', 'suspendido')
          .gte('fecha', rango.desde).lte('fecha', rango.hasta).order('fecha').order('id')
      ),
      todas(() =>
        supabase.from('turnos').select(CAMPOS_TURNO).eq('profesional_id', cuenta).eq('estado', 'realizado')
          .gte('inicio', desdeTs).lt('inicio', hastaTs).order('inicio').order('id')
      ),
      todas(() =>
        supabase.from('turnos').select(CAMPOS_TURNO).eq('profesional_id', cuenta).eq('estado', 'suspendido')
          .gte('inicio', desdeTs).lt('inicio', hastaTs).order('inicio').order('id')
      ),
      supabase.from('clientes').select('id, nombre').eq('profesional_id', cuenta).eq('es_empresa', true),
    ]);
    if (n !== pedido.current) return;
    const error = of.error || os.error || tf.error || ts.error;
    if (error) return setDatos({ cargando: false, trabajos: [], error: mensajeError(error) });
    const nombres = Object.fromEntries((cl.data || []).map((c) => [c.id, c.nombre]));
    setDatos({
      cargando: false,
      error: '',
      trabajos: [
        ...of.data.map((o) => desdeOrden(o, cuenta, nombres[o.empresa_id])),
        ...os.data.map((o) => desdeOrden(o, cuenta, nombres[o.empresa_id], true)),
        ...tf.data.map((t) => desdeTurno(t, cuenta)),
        ...ts.data.map((t) => desdeTurno(t, cuenta, true)),
      ],
    });
  }, [cuenta, rango.desde, rango.hasta]);

  useEffect(() => {
    if (equipo.puedeMonitorear) cargar();
  }, [cargar, equipo.puedeMonitorear]);

  const resumen = useMemo(() => resumenProduccion(datos.trabajos), [datos.trabajos]);
  const nombreDe = useCallback(
    (id) => equipo.nombreDe(id) || (id === cuenta ? profesional.nombre_publico || 'Cuenta principal' : 'Ex integrante'),
    [equipo, cuenta, profesional.nombre_publico]
  );
  const metricas = METRICAS.filter((m) => (!m.puestas || resumen.hayPuestas) && (!m.importe || conImportes));
  const metrica = metricas.find((m) => m.id === metricaId) || metricas[0];
  const promedio = promedioEquipo(resumen.personas, metrica);
  const rangoTexto = `Del ${ddmm(rango.desde)} al ${ddmm(rango.hasta)}`;
  const formato = (m, v) => {
    if (v === null || v === undefined) return '—';
    if (m.tiempo) return textoCorto(v);
    if (m.importe) return monto(Math.round(v));
    if (m.id === 'equivalente' || m.id === 'puestasHora') return Number(v).toLocaleString('es-UY', { maximumFractionDigits: 2 });
    return String(Math.round(v));
  };

  const ordenados = [...resumen.personas]
    .filter((x) => metrica.valor(x) !== null && metrica.valor(x) !== undefined)
    .sort((a, b) => (metrica.mejor === 'menos' ? metrica.valor(a) - metrica.valor(b) : metrica.valor(b) - metrica.valor(a)));
  const sinDato = resumen.personas.filter((x) => metrica.valor(x) === null || metrica.valor(x) === undefined);
  const maximo = Math.max(1e-9, ...ordenados.map(metrica.valor), promedio || 0);
  const mejor = metrica.mejor && ordenados.length > 1 && metrica.valor(ordenados[0]) !== metrica.valor(ordenados[1]) ? ordenados[0].id : null;
  const gente = [...resumen.personas].filter((x) => x.trabajos || x.minutos || x.suspendidos).sort((a, b) => b.trabajos - a.trabajos);

  function descargar() {
    const bytes = planillaProduccion({ empresa: empresa?.nombre || equipo.empresa?.nombre || profesional.nombre_publico || 'Equipo', rangoTexto, resumen, nombreDe, conImportes });
    const archivo = new File([bytes], `Produccion-equipo-${rango.desde}-al-${rango.hasta}.xlsx`, { type: TIPO_XLSX });
    const url = URL.createObjectURL(archivo);
    const a = document.createElement('a');
    a.href = url;
    a.download = archivo.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  if (!equipo.puedeMonitorear) {
    return (
      <div className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <p className="tarjeta p-5 text-center text-tinta-300">Esta pantalla es para quienes organizan el trabajo del equipo.</p>
      </div>
    );
  }

  const tarjetas = [
    ['Trabajos', String(resumen.total)],
    ['Horas trabajadas', textoCorto(resumen.minutos)],
    ['Promedio por trabajo', resumen.total - resumen.sinMedir ? textoCorto(resumen.personas.reduce((a, x) => a + x.minutosTrabajos, 0) / (resumen.total - resumen.sinMedir)) : '—'],
    ...(resumen.hayPuestas ? [['Puestas equivalentes', resumen.equivalente.toLocaleString('es-UY', { maximumFractionDigits: 1 })]] : []),
    ...(conImportes ? [['Importe producido', monto(Math.round(resumen.importe))]] : []),
  ];

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/panel/equipo" className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver a Equipo en ruta">
            <Icon name="izq" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold">Producción del equipo</h1>
            <p className="truncate text-xs text-tinta-400">{empresa?.nombre || equipo.empresa?.nombre} · {rangoTexto}</p>
          </div>
          <button type="button" onClick={descargar} disabled={datos.cargando || !resumen.total} className="btn btn-sec px-2.5 py-2" aria-label="Descargar planilla">
            <Icon name="descargar" className="h-4 w-4" />
          </button>
          <button type="button" onClick={cargar} className="btn btn-sec px-2.5 py-2" aria-label="Actualizar">
            <Icon name="repetir" className={`h-4 w-4 ${datos.cargando ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[
            ['mes', 'Este mes'],
            ['anterior', 'Mes pasado'],
            ['semana', 'Últimos 7 días'],
          ].map(([id, texto]) => (
            <button
              key={id}
              type="button"
              className={`chip ${elegido === id ? 'chip-activo' : ''}`}
              onClick={() => {
                setElegido(id);
                setRango(periodo(id));
              }}
            >
              {texto}
            </button>
          ))}
          <div className="flex items-center gap-1.5 text-sm">
            <input type="date" className="campo w-auto py-1.5" value={rango.desde} max={rango.hasta} onChange={(e) => { setElegido(''); setRango((r) => ({ ...r, desde: e.target.value })); }} aria-label="Desde" />
            <span className="text-tinta-400">al</span>
            <input type="date" className="campo w-auto py-1.5" value={rango.hasta} min={rango.desde} onChange={(e) => { setElegido(''); setRango((r) => ({ ...r, hasta: e.target.value })); }} aria-label="Hasta" />
          </div>
        </div>
      </header>

      <div className={`space-y-4 px-4 pt-4 pb-10 ${vistaPc ? 'mx-auto max-w-5xl' : ''}`}>
        {datos.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{datos.error}</p>}

        <div className={`grid gap-2 ${vistaPc ? 'grid-cols-5' : 'grid-cols-2'}`}>
          {tarjetas.map(([t, v]) => (
            <div key={t} className="tarjeta p-3">
              <p className="text-xs text-tinta-400">{t}</p>
              <p className="mt-0.5 text-lg font-extrabold">{datos.cargando ? '…' : v}</p>
            </div>
          ))}
        </div>

        {!datos.cargando && resumen.sinMedir > 0 && (
          <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">
            {resumen.sinMedir} {resumen.sinMedir === 1 ? 'trabajo no tiene' : 'trabajos no tienen'} tiempo: no se usó el cronómetro (Iniciar / Finalizar) ni se cargó el tiempo a mano. Cuentan como trabajos, pero no para los promedios.
          </p>
        )}

        {!datos.cargando && !resumen.personas.length && !datos.error && (
          <p className="tarjeta p-5 text-center text-tinta-300">No hay trabajos finalizados en estas fechas.</p>
        )}

        {resumen.personas.length > 0 && (
          <section className="tarjeta p-4">
            <h2 className="text-lg font-bold">Comparativa</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {metricas.map((m) => (
                <button key={m.id} type="button" className={`chip px-3 py-1 text-xs ${metrica.id === m.id ? 'chip-activo' : ''}`} onClick={() => setMetricaId(m.id)}>
                  {m.corto}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-tinta-300">
              {metrica.texto}
              {metrica.mejor === 'menos' ? ' (menos es mejor)' : ''}
              {promedio !== null ? ` · promedio del equipo: ${formato(metrica, promedio)}` : ''}
            </p>
            <ul className="mt-3 space-y-2.5">
              {ordenados.map((x) => {
                const v = metrica.valor(x);
                const dif = promedio ? (v - promedio) / promedio : 0;
                const bueno = metrica.mejor === 'mas' ? dif > 0.05 : metrica.mejor === 'menos' ? dif < -0.05 : false;
                const malo = metrica.mejor === 'mas' ? dif < -0.05 : metrica.mejor === 'menos' ? dif > 0.05 : false;
                return (
                  <li key={x.id}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5 truncate font-semibold">
                        {mejor === x.id && <Icon name="estrella" className="h-3.5 w-3.5 shrink-0 text-amber-300" />}
                        <span className="truncate">{nombreDe(x.id)}</span>
                      </span>
                      <span className="shrink-0 font-bold">
                        {formato(metrica, v)}
                        {promedio && metrica.mejor && Math.abs(dif) >= 0.05 ? (
                          <span className={`ml-1.5 text-xs font-semibold ${bueno ? 'text-menta-300' : malo ? 'text-amber-300' : 'text-tinta-400'}`}>
                            {dif > 0 ? '+' : ''}
                            {Math.round(dif * 100)}%
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="relative mt-1 h-2.5 rounded-full bg-navy-800">
                      <div className={`h-2.5 rounded-full ${bueno ? 'bg-menta-400' : malo ? 'bg-amber-400' : 'bg-[#5aa9e6]'}`} style={{ width: `${Math.max(2, (v / maximo) * 100)}%` }} />
                      {promedio !== null && (
                        <div className="absolute -top-1 h-4.5 w-0.5 bg-tinta-100/70" style={{ left: `${(promedio / maximo) * 100}%` }} title="Promedio del equipo" />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {sinDato.length > 0 && <p className="mt-3 text-xs text-tinta-500">Sin datos para esta medida: {sinDato.map((x) => nombreDe(x.id)).join(', ')}.</p>}
            <p className="mt-3 text-xs text-tinta-500">
              La línea blanca es el promedio del equipo. Cuentan los trabajos finalizados en las fechas elegidas, con todo su tiempo. Si trabajaron dos en el mismo trabajo, el trabajo es del responsable y cada uno suma sus horas.
            </p>
          </section>
        )}

        {resumen.servicios.length > 0 && gente.length > 0 && (
          <section className="tarjeta p-4">
            <h2 className="text-lg font-bold">Tiempo promedio por servicio</h2>
            <p className="text-xs text-tinta-400">Cuánto tarda cada uno en promedio en cada tipo de trabajo (entre paréntesis, cuántos tienen tiempo).</p>
            <div className="mt-3 space-y-4">
              {resumen.servicios.map((s) => {
                const filas = gente
                  .map((x) => ({ x, sv: x.servicios[s] }))
                  .filter((f) => f.sv)
                  .map((f) => ({ ...f, prom: f.sv.medidos ? f.sv.minutos / f.sv.medidos : null }));
                const conTiempo = filas.filter((f) => f.prom !== null);
                const tope = Math.max(1, ...conTiempo.map((f) => f.prom));
                const rapido = conTiempo.length > 1 ? conTiempo.reduce((a, b) => (b.prom < a.prom ? b : a)).x.id : null;
                return (
                  <div key={s}>
                    <p className="text-sm font-bold text-tinta-100">{s}</p>
                    <ul className="mt-1.5 space-y-1.5">
                      {filas
                        .sort((a, b) => (a.prom ?? Infinity) - (b.prom ?? Infinity))
                        .map(({ x, sv, prom }) => (
                          <li key={x.id} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-sm">
                            <span className="truncate text-tinta-300">{nombreDe(x.id)}</span>
                            <div className="h-2 rounded-full bg-navy-800">
                              {prom !== null && <div className={`h-2 rounded-full ${rapido === x.id ? 'bg-menta-400' : 'bg-[#5aa9e6]'}`} style={{ width: `${Math.max(3, (prom / tope) * 100)}%` }} />}
                            </div>
                            <span className="text-right font-semibold">
                              {prom === null ? <span className="text-xs text-tinta-500">sin tiempo</span> : textoCorto(prom)}
                              <span className="ml-1 text-xs text-tinta-500">({sv.medidos}/{sv.trabajos})</span>
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {gente.length > 0 && (
          <section className="space-y-2">
            <h2 className="px-1 text-lg font-bold">Tiempos de cada servicio</h2>
            {gente.map((x) => (
              <div key={x.id} className="tarjeta">
                <button type="button" className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setAbierto((a) => (a === x.id ? '' : x.id))}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{nombreDe(x.id)}</p>
                    <p className="text-xs text-tinta-400">
                      {x.trabajos} {x.trabajos === 1 ? 'trabajo' : 'trabajos'} · {textoCorto(x.minutos)} trabajadas
                      {x.promedio !== null ? ` · ${textoCorto(x.promedio)} por trabajo` : ''}
                      {x.puestasHora !== null ? ` · ${x.puestasHora.toLocaleString('es-UY', { maximumFractionDigits: 2 })} puestas/h` : ''}
                      {x.suspendidos ? ` · ${x.suspendidos} suspendido${x.suspendidos === 1 ? '' : 's'}` : ''}
                      {x.ayudas ? ` · ayudó en ${x.ayudas}` : ''}
                    </p>
                  </div>
                  <Icon name={abierto === x.id ? 'arriba' : 'abajo'} className="h-4 w-4 shrink-0 text-tinta-400" />
                </button>
                {abierto === x.id && (
                  <ul className="divide-y divide-navy-800 border-t border-navy-800">
                    {!x.lista.length && <li className="p-3 text-sm text-tinta-400">No tiene trabajos finalizados a su nombre en estas fechas.</li>}
                    {x.lista.map((t) => (
                      <li key={t.key} className="flex items-start gap-3 p-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{t.titulo}</p>
                          <p className="truncate text-xs text-tinta-400">
                            {fechaCorta(desdeISO(t.fecha))} · {t.servicio}
                            {t.equivalente > 0 ? ` · ${t.equivalente.toLocaleString('es-UY', { maximumFractionDigits: 2 })} puestas` : ''}
                            {conImportes && t.importe ? ` · ${monto(t.importe)}` : ''}
                          </p>
                          {t.detalle && <p className="mt-0.5 line-clamp-2 text-xs text-tinta-500">{t.detalle}</p>}
                          {Object.keys(t.minutos).length > 1 && (
                            <p className="mt-0.5 text-xs text-tinta-500">
                              {Object.entries(t.minutos).map(([q, m]) => `${nombreDe(q)}: ${textoCorto(m)}`).join(' · ')}
                            </p>
                          )}
                        </div>
                        <span className={`shrink-0 font-bold ${t.total > 0 ? '' : 'text-xs font-semibold text-amber-300'}`}>
                          {t.total > 0 ? textoCorto(t.total) : 'sin tiempo'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>
        )}
      </div>
    </>
  );
}
