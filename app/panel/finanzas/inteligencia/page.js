'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import BloqueoPlan from '@/components/BloqueoPlan';
import FinanzasEncabezado from '@/components/FinanzasEncabezado';
import FichaArticulo, { verComprobante } from '@/components/FichaArticulo';
import { useAncho } from '@/components/GraficoPrecios';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { avisar } from '@/lib/avisos';
import { esBusiness } from '@/lib/planes';
import { fechaUY } from '@/lib/presupuestos';
import { mensajeError } from '@/lib/util';
import { dinero } from '@/lib/precios';
import { MENSAJE_FALTA_SQL, TIPOS_ALERTA, haceDias, pct, pesos, sinInteligencia, unidadTexto } from '@/lib/compras';

const PERIODOS = [
  [30, '30 días'],
  [90, '3 meses'],
  [180, '6 meses'],
  [365, '1 año'],
];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];

export default function InteligenciaPagina() {
  return (
    <Suspense fallback={<p className="p-4 text-tinta-400">Cargando…</p>}>
      <Contenido />
    </Suspense>
  );
}

function Contenido() {
  const { plan, profesional, yo, empresa, permisos } = usePanel();
  const business = esBusiness(plan?.plan);
  const mios = permisos || [];
  const ve = !empresa || yo?.id === profesional?.id || mios.some((p) => ['compras', 'importes', 'stock', 'seguimiento'].includes(p));
  return (
    <>
      <FinanzasEncabezado />
      <div className="space-y-4 px-4 pt-4 pb-6">
        {!business ? (
          <BloqueoPlan
            plan="business"
            titulo="Inteligencia de compras"
            texto="TaListo! aprende de cada factura y remito que cargás: compara proveedores, detecta aumentos y te dice dónde conviene comprar."
            puntos={[
              'Historial de precios por artículo y proveedor, con su comprobante',
              'Comparador de proveedores y alertas de aumentos',
              'Ahorro potencial y proveedores más competitivos',
              'Último costo y mejor precio al armar presupuestos',
            ]}
          />
        ) : !ve ? (
          <p className="tarjeta p-5 text-center text-sm text-tinta-300">La inteligencia de compras es para quienes manejan compras, stock o importes.</p>
        ) : (
          <Panel cuenta={profesional.id} puedeAjustar={!empresa || yo?.id === profesional.id || mios.includes('compras')} />
        )}
      </div>
    </>
  );
}

function Panel({ cuenta, puedeAjustar }) {
  const router = useRouter();
  const params = useSearchParams();
  const [dias, setDias] = useState(90);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [texto, setTexto] = useState('');
  const [articulos, setArticulos] = useState(null);
  const [abierto, setAbierto] = useState(params.get('articulo') || null);
  const [ajustes, setAjustes] = useState(null);
  const [ok, setOk] = useState('');

  const cargar = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('inteligencia_compras', { p_cuenta: cuenta, p_dias: dias });
    if (err) {
      setError(sinInteligencia(err) ? MENSAJE_FALTA_SQL : mensajeError(err));
      setDatos(null);
      return;
    }
    setError('');
    setDatos(data);
    setAjustes((a) => a || { pct: String(data.umbral), dias: String(data.dias_precio_viejo) });
  }, [cuenta, dias]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Precios viejos: avisa al equipo como mucho una vez por semana
  useEffect(() => {
    supabase.rpc('revisar_precios_viejos', { p_cuenta: cuenta }).then(({ data }) => {
      if (Number(data) > 0) avisar();
    });
  }, [cuenta]);

  useEffect(() => {
    const t = setTimeout(async () => {
      const { data, error: err } = await supabase.rpc('buscar_articulos', { p_cuenta: cuenta, p_texto: texto, p_limite: texto ? 40 : 12 });
      setArticulos(err ? [] : data || []);
    }, texto ? 300 : 0);
    return () => clearTimeout(t);
  }, [cuenta, texto, datos]);

  function abrir(id) {
    setAbierto(id);
    const q = new URLSearchParams(params.toString());
    if (id) q.set('articulo', id);
    else q.delete('articulo');
    router.replace(`/panel/finanzas/inteligencia${q.toString() ? `?${q}` : ''}`, { scroll: false });
  }

  async function guardarAjustes() {
    const { error: err } = await supabase.rpc('guardar_ajustes_compras', {
      p_cuenta: cuenta,
      p_pct: Number(String(ajustes.pct).replace(',', '.')),
      p_dias: parseInt(ajustes.dias, 10),
    });
    if (err) return setOk(mensajeError(err));
    setOk('Alertas guardadas.');
    cargar();
  }

  if (error) return <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>;
  if (!datos) return <p className="py-10 text-center text-sm text-tinta-400">Analizando tus compras…</p>;
  const ind = datos.indicadores || {};
  const vacio = !ind.articulos;

  return (
    <>
      <section className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-extrabold">Inteligencia de compras</h2>
          <p className="text-sm text-tinta-300">Lo que aprendió TaListo! de tus facturas, remitos y órdenes de compra.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-navy-900 p-1 text-xs font-bold">
          {PERIODOS.map(([v, t]) => (
            <button key={v} type="button" onClick={() => setDias(v)} className={`rounded-lg px-2.5 py-1.5 ${dias === v ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}>
              {t}
            </button>
          ))}
        </div>
      </section>

      {vacio && (
        <section className="tarjeta flex items-start gap-3 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-menta-500/15 text-menta-300"><Icon name="camara" /></span>
          <div className="min-w-0 text-sm">
            <p className="font-bold">Todavía no hay compras registradas</p>
            <p className="text-tinta-300">Sacale una foto a una factura o remito de compra (en Compras o Stock, “Factura con IA”) o recibí una orden de compra: cada precio queda en el historial y empieza la comparación.</p>
            <Link href="/panel/finanzas/compras" className="chip chip-activo mt-2 inline-flex text-xs">Ir a Compras</Link>
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-2 pc:grid-cols-3">
        <Indicador icono="empresa" titulo="Proveedores" valor={ind.proveedores} />
        <Indicador icono="caja" titulo="Artículos con historial" valor={ind.articulos} />
        <Indicador icono="documento" titulo="Compras procesadas por IA" valor={ind.documentos_ia} pie={`${ind.compras_periodo} precios en el período`} />
        <Indicador icono="arriba" titulo="Aumentos recientes" valor={ind.aumentos} pie={`${pct(datos.umbral, { signo: false })} o más`} alerta={ind.aumentos > 0} />
        <Indicador icono="dinero" titulo="Ahorro potencial" valor={pesos(ind.ahorro_potencial)} pie="pagando el mejor precio registrado" bueno={ind.ahorro_potencial > 0} />
        <Indicador icono="reloj" titulo="Precios viejos" valor={ind.sin_actualizar} pie={`sin compras en ${datos.dias_precio_viejo} días`} alerta={ind.sin_actualizar > 0} />
      </section>

      <div className="space-y-4 pc:columns-2 pc:gap-4 pc:space-y-0 pc:[&>*]:mb-4 pc:[&>*]:break-inside-avoid">
        {datos.evolucion?.length > 0 && (
          <Tarjeta titulo="Evolución de costos" nota="Índice de precios de lo que comprás (primera compra del año = 100)">
            <Indice serie={datos.evolucion} />
          </Tarjeta>
        )}

        {datos.alertas?.length > 0 && (
          <Tarjeta titulo="Alertas">
            <ul className="divide-y divide-navy-800">
              {datos.alertas.map((a) => {
                const t = TIPOS_ALERTA[a.tipo] || TIPOS_ALERTA.aumento;
                return (
                  <li key={a.id} className="py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${t.clase}`}><Icon name={t.icono} className="h-3 w-3" /> {t.texto}</span>
                      <span className="text-[11px] text-tinta-500">{haceDias(a.creado_en)}</span>
                    </div>
                    <p className="mt-1 text-tinta-200">{a.mensaje}</p>
                    <div className="mt-1 flex gap-3 text-xs">
                      {a.articulo_id && <button type="button" className="font-semibold text-menta-300" onClick={() => abrir(a.articulo_id)}>Ver precios</button>}
                      {a.comprobante_id && <button type="button" className="font-semibold text-[#8cc8ff]" onClick={() => verComprobante(a.comprobante_id)}>Ver documento</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Tarjeta>
        )}

        {datos.aumentos?.length > 0 && (
          <Tarjeta titulo="Aumentos recientes">
            <ul className="divide-y divide-navy-800">
              {datos.aumentos.map((x) => (
                <FilaArticulo key={x.articulo_id} onClick={() => abrir(x.articulo_id)} nombre={x.nombre}
                  detalle={`${x.proveedor} · ${pesos(x.anterior)} → ${pesos(x.ultimo)} · ${fechaUY(x.fecha)}${x.mejor_otro ? ` · ${x.mejor_otro.proveedor} lo tiene a ${pesos(x.mejor_otro.precio)}` : ''}`}
                  valor={pct(x.pct)} clase="text-red-300" />
              ))}
            </ul>
          </Tarjeta>
        )}

        {datos.ahorros?.length > 0 && (
          <Tarjeta titulo="Dónde se puede ahorrar" nota={`Lo pagado de más en ${PERIODOS.find((p) => p[0] === dias)?.[1] || `${dias} días`} contra el mejor precio registrado`}>
            <ul className="divide-y divide-navy-800">
              {datos.ahorros.map((x) => (
                <FilaArticulo key={x.articulo_id} onClick={() => abrir(x.articulo_id)} nombre={x.nombre} valor={pesos(x.monto)} clase="text-menta-300" />
              ))}
            </ul>
          </Tarjeta>
        )}

        {datos.competitivos?.length > 0 && (
          <Tarjeta titulo="Proveedores más competitivos" nota="Entre los artículos que le compraste a más de un proveedor">
            <ul className="divide-y divide-navy-800">
              {datos.competitivos.map((p) => (
                <li key={p.proveedor_id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/panel/finanzas/proveedores/${p.proveedor_id}`} className="min-w-0 hover:underline">
                    <b className="block truncate">{p.nombre}</b>
                    <span className="text-xs text-tinta-400">
                      Más barato en {p.mas_baratos} de {p.articulos} {p.articulos === 1 ? 'artículo' : 'artículos'}
                    </span>
                  </Link>
                  <span className={`shrink-0 text-xs font-bold ${Number(p.sobre_mejor_pct) <= 0 ? 'text-menta-300' : 'text-tinta-300'}`}>
                    {Number(p.sobre_mejor_pct) <= 0 ? 'Siempre el mejor' : `${pct(p.sobre_mejor_pct)} sobre el mejor`}
                  </span>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}

        {datos.recurrentes?.length > 0 && (
          <Tarjeta titulo="Proveedores que aumentan seguido" nota="Último año, aumentos iguales o mayores al umbral">
            <ul className="divide-y divide-navy-800">
              {datos.recurrentes.map((p) => (
                <li key={p.proveedor_id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/panel/finanzas/proveedores/${p.proveedor_id}`} className="min-w-0 truncate font-bold hover:underline">{p.nombre}</Link>
                  <span className="shrink-0 text-xs text-red-300">
                    {p.aumentos} aumentos de {p.comparaciones} compras · promedio {pct(p.promedio_pct)}
                  </span>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}

        {datos.inflacion?.length > 0 && (
          <Tarjeta titulo="Mayor inflación de costos" nota="Primer y último precio del último año">
            <ul className="divide-y divide-navy-800">
              {datos.inflacion.map((x) => (
                <FilaArticulo key={x.articulo_id} onClick={() => abrir(x.articulo_id)} nombre={x.nombre}
                  detalle={`${pesos(x.primero)} → ${pesos(x.ultimo)} por ${unidadTexto(x.unidad)}`} valor={pct(x.pct)} clase="text-amber-300" />
              ))}
            </ul>
          </Tarjeta>
        )}

        {datos.sin_actualizar?.length > 0 && (
          <Tarjeta titulo="Sin precio actualizado" nota={`Sin compras en los últimos ${datos.dias_precio_viejo} días: pedí precio antes de presupuestar`}>
            <ul className="divide-y divide-navy-800">
              {datos.sin_actualizar.map((x) => (
                <FilaArticulo key={x.articulo_id} onClick={() => abrir(x.articulo_id)} nombre={x.nombre} detalle={`Última compra ${fechaUY(x.fecha)}`} valor={haceDias(x.fecha)} clase="text-tinta-400" />
              ))}
            </ul>
          </Tarjeta>
        )}

        {datos.ultimas?.length > 0 && (
          <Tarjeta titulo="Últimas compras procesadas por IA">
            <ul className="divide-y divide-navy-800">
              {datos.ultimas.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <b className="block truncate">{c.proveedor_nombre || 'Sin proveedor'}</b>
                    <span className="text-xs text-tinta-400">
                      {[c.documento, c.numero].filter(Boolean).join(' ')} · {fechaUY(c.fecha)} · {c.precios} {c.precios === 1 ? 'precio' : 'precios'}
                      {c.registrado_por_nombre ? ` · ${c.registrado_por_nombre}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {c.total !== null && <b className="tabular-nums">{dinero(c.total, c.moneda)}</b>}
                    {c.archivos?.length > 0 && (
                      <button type="button" className="rounded-lg p-1.5 text-tinta-400 hover:bg-navy-800" onClick={() => verComprobante(c.id)} aria-label="Ver documento">
                        <Icon name="ojo" className="h-4 w-4" />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}
      </div>

      <Tarjeta titulo="Buscar un artículo" nota="Comparador, historial y recomendación de cada producto que compraste">
        <div className="relative">
          <Icon name="buscar" className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-tinta-500" />
          <input className="campo py-2.5 pr-3 pl-9 text-sm" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Cable, llave térmica, caño…" />
        </div>
        {articulos && articulos.length === 0 && <p className="mt-2 text-sm text-tinta-400">{texto ? 'No hay artículos con ese nombre.' : 'Todavía no hay artículos con historial.'}</p>}
        {articulos?.length > 0 && (
          <ul className="mt-2 divide-y divide-navy-800">
            {articulos.map((x) => (
              <FilaArticulo key={x.id} onClick={() => abrir(x.id)} nombre={x.nombre}
                detalle={`${x.proveedores} ${x.proveedores === 1 ? 'proveedor' : 'proveedores'} · ${x.compras} ${x.compras === 1 ? 'compra' : 'compras'}${x.ultima_fecha ? ` · última ${fechaUY(x.ultima_fecha)}` : ''}`}
                valor={x.mejor_precio !== null ? `${pesos(x.mejor_precio)} / ${x.unidad === 'u' ? 'u' : x.unidad}` : ''} clase="text-menta-300" />
            ))}
          </ul>
        )}
      </Tarjeta>

      {puedeAjustar && ajustes && (
        <Tarjeta titulo="Alertas de precios" nota="Las alertas llegan a quienes manejan Compras o Stock, con los avisos de siempre">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs text-tinta-300">Avisar desde una variación de</span>
              <span className="flex items-center gap-1.5">
                <input className="campo px-3 py-2 text-sm" inputMode="decimal" value={ajustes.pct} onChange={(e) => setAjustes({ ...ajustes, pct: e.target.value })} />
                <b className="text-tinta-300">%</b>
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-tinta-300">Precio viejo después de</span>
              <span className="flex items-center gap-1.5">
                <input className="campo px-3 py-2 text-sm" inputMode="numeric" value={ajustes.dias} onChange={(e) => setAjustes({ ...ajustes, dias: e.target.value })} />
                <b className="text-tinta-300">días</b>
              </span>
            </label>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" className="btn btn-menta px-4 py-2 text-sm" onClick={guardarAjustes}>Guardar</button>
            {ok && <span className="text-xs text-menta-300">{ok}</span>}
          </div>
        </Tarjeta>
      )}

      <FichaArticulo articuloId={abierto} cuenta={cuenta} onCerrar={() => abrir(null)} onCambio={cargar} />
    </>
  );
}

function Indicador({ icono, titulo, valor, pie, alerta, bueno }) {
  return (
    <div className="tarjeta p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-tinta-400">
        <Icon name={icono} className="h-3.5 w-3.5" /> {titulo}
      </p>
      <p className={`mt-1 text-2xl font-extrabold tabular-nums ${alerta ? 'text-amber-300' : bueno ? 'text-menta-300' : ''}`}>{valor ?? 0}</p>
      {pie && <p className="text-[11px] text-tinta-500">{pie}</p>}
    </div>
  );
}

function Tarjeta({ titulo, nota, children }) {
  return (
    <section className="tarjeta p-3.5">
      <h3 className="titulo-seccion">{titulo}</h3>
      {nota && <p className="mb-2 text-xs text-tinta-400">{nota}</p>}
      <div className={nota ? '' : 'mt-2'}>{children}</div>
    </section>
  );
}

function FilaArticulo({ nombre, detalle, valor, clase, onClick }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:bg-navy-850">
        <span className="min-w-0">
          <b className="block truncate">{nombre}</b>
          {detalle && <span className="block text-xs text-tinta-400">{detalle}</span>}
        </span>
        {valor && <span className={`shrink-0 text-sm font-bold tabular-nums ${clase || ''}`}>{valor}</span>}
      </button>
    </li>
  );
}

// Índice mensual de costos (100 = primer precio del año de cada artículo)
function Indice({ serie }) {
  const [ref, W] = useAncho();
  const H = 160;
  const m = { l: 40, r: 12, t: 14, b: 24 };
  const vals = serie.map((s) => Number(s.indice));
  const lo = Math.min(95, ...vals);
  const hi = Math.max(105, ...vals);
  const x = (i) => m.l + (serie.length === 1 ? (W - m.l - m.r) / 2 : (i / (serie.length - 1)) * (W - m.l - m.r));
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const ultimo = serie[serie.length - 1];
  return (
    <figure ref={ref}>
      <p className="mb-1 text-sm">
        <b className={Number(ultimo.indice) > 100 ? 'text-amber-300' : 'text-menta-300'}>{pct(Number(ultimo.indice) - 100)}</b>{' '}
        <span className="text-tinta-400">en {mesTexto(ultimo.mes)} contra la primera compra del año</span>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Evolución mensual del índice de costos">
        <line x1={m.l} x2={W - m.r} y1={y(100)} y2={y(100)} stroke="#284472" strokeDasharray="4 4" />
        <text x={m.l - 6} y={y(100) + 4} fontSize="11" textAnchor="end" fill="#7d8fae">100</text>
        <polyline points={serie.map((s, i) => `${x(i)},${y(Number(s.indice))}`).join(' ')} fill="none" stroke="#4fe0b6" strokeWidth="2.5" strokeLinejoin="round" />
        {serie.map((s, i) => (
          <g key={s.mes}>
            <circle cx={x(i)} cy={y(Number(s.indice))} r="4" fill="#4fe0b6" stroke="#0a1428" strokeWidth="2">
              <title>{`${mesTexto(s.mes)}: ${Number(s.indice).toLocaleString('es-UY')} (${s.compras} precios)`}</title>
            </circle>
            <text x={x(i)} y={H - 6} fontSize="11" textAnchor="middle" fill="#7d8fae">{MESES_CORTOS[Number(s.mes.slice(5, 7)) - 1]}</text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

const mesTexto = (ym) => `${MESES_CORTOS[Number(String(ym).slice(5, 7)) - 1]} ${String(ym).slice(0, 4)}`;
