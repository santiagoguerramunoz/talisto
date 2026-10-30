'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import FinanzasEncabezado from '@/components/FinanzasEncabezado';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { cargarClientes } from '@/lib/clientes';
import { useAlVolver } from '@/lib/useAlVolver';
import { useAjustes } from '@/lib/ajustes';
import { MESES, nombreMes, rangoMes, sumarMeses } from '@/lib/fechas';
import { COLOR_GASTOS, COLOR_INGRESOS, claveMes, movimientos, resumenMes, serieMeses } from '@/lib/finanzas';
import { categoriasDe, infoCategoria } from '@/lib/gastos';
import { pesos } from '@/lib/precios';
import { faltaTabla } from '@/lib/sql';
import { esPro } from '@/lib/planes';
import BloqueoPlan from '@/components/BloqueoPlan';
import { useRouter } from 'next/navigation';

const MESES_GRAFICO = 6;
const corto = (mes) => MESES[mes - 1].slice(0, 3);

function Fila({ icono, color, titulo, detalle, valor, href }) {
  const contenido = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `${color}26`, color }}>
        <Icon name={icono} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{titulo}</span>
        {detalle && <span className="line-clamp-2 block text-xs text-tinta-400">{detalle}</span>}
      </span>
      <span className="shrink-0 font-bold">{valor}</span>
      {href && <Icon name="der" className="h-4 w-4 shrink-0 text-tinta-500" />}
    </>
  );
  return href ? (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-navy-850">{contenido}</Link>
  ) : (
    <div className="flex items-center gap-3 px-4 py-3">{contenido}</div>
  );
}

// Barras de ingresos y gastos de los últimos meses. Tocar un mes lo elige.
function BarrasMeses({ serie, seleccionado, onElegir }) {
  const [foco, setFoco] = useState(null);
  const max = Math.max(1, ...serie.flatMap((m) => [m.ingresos, m.costos]));
  const alto = 120;
  const activo = serie.find((m) => m.clave === (foco || seleccionado)) || serie[serie.length - 1];
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3 text-xs text-tinta-300">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_INGRESOS }} /> Ingresos</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_GASTOS }} /> Gastos</span>
        </div>
        {activo && (
          <span className="text-right text-tinta-400">
            <b className="text-tinta-100">{nombreMes(activo.mes)}</b> · {pesos(activo.ingresos, { decimales: false })} / {pesos(activo.costos, { decimales: false })}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-1 border-b border-navy-700" style={{ height: alto + 4 }} role="img" aria-label="Ingresos y gastos de los últimos meses">
        {serie.map((m) => {
          const elegido = m.clave === seleccionado;
          return (
            <button
              key={m.clave}
              type="button"
              onClick={() => onElegir({ anio: m.anio, mes: m.mes })}
              onMouseEnter={() => setFoco(m.clave)}
              onMouseLeave={() => setFoco(null)}
              onFocus={() => setFoco(m.clave)}
              onBlur={() => setFoco(null)}
              className={`flex h-full flex-1 items-end justify-center gap-[2px] rounded-t-lg pt-1 ${elegido ? 'bg-navy-800/70' : ''}`}
              title={`${nombreMes(m.mes)} ${m.anio}: ingresos ${pesos(m.ingresos)} · gastos ${pesos(m.costos)}`}
              aria-label={`${nombreMes(m.mes)} ${m.anio}: ingresos ${pesos(m.ingresos)}, gastos ${pesos(m.costos)}`}
            >
              <span className="w-3 rounded-t-[4px]" style={{ height: `${(m.ingresos / max) * alto}px`, background: COLOR_INGRESOS }} />
              <span className="w-3 rounded-t-[4px]" style={{ height: `${(m.costos / max) * alto}px`, background: COLOR_GASTOS }} />
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between gap-1">
        {serie.map((m) => (
          <span key={m.clave} className={`flex-1 text-center text-[11px] capitalize ${m.clave === seleccionado ? 'font-bold text-tinta-100' : 'text-tinta-500'}`}>
            {corto(m.mes)}
          </span>
        ))}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-tinta-400">Ver como tabla</summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-tinta-400">
              <th className="py-1 text-left font-semibold">Mes</th>
              <th className="py-1 text-right font-semibold">Ingresos</th>
              <th className="py-1 text-right font-semibold">Gastos</th>
              <th className="py-1 text-right font-semibold">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {serie.map((m) => (
              <tr key={m.clave} className="border-t border-navy-800">
                <td className="py-1.5 capitalize">{MESES[m.mes - 1]} {m.anio}</td>
                <td className="py-1.5 text-right">{pesos(m.ingresos, { decimales: false })}</td>
                <td className="py-1.5 text-right">{pesos(m.costos, { decimales: false })}</td>
                <td className="py-1.5 text-right font-semibold">{pesos(m.resultado, { decimales: false })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export default function Finanzas() {
  const { plan, empresa, permisos } = usePanel();
  if (empresa && !(permisos || []).includes('importes')) return <FinanzasSinImportes permisos={permisos || []} />;
  return esPro(plan?.plan) ? <FinanzasPro /> : <FinanzasFree />;
}

// En una empresa, sin el permiso de importes: va a lo que sí puede usar
function FinanzasSinImportes({ permisos }) {
  const router = useRouter();
  const destino = permisos.includes('presupuestos')
    ? '/panel/finanzas/presupuestos'
    : permisos.includes('gastos')
      ? '/panel/finanzas/gastos'
      : permisos.includes('compras')
        ? '/panel/finanzas/compras'
        : permisos.includes('stock')
          ? '/panel/finanzas/stock'
          : permisos.includes('tickets_asignar')
            ? '/panel/ordenes'
            : '/panel';
  useEffect(() => {
    router.replace(destino);
  }, [router, destino]);
  return <p className="p-4 text-tinta-400">Cargando…</p>;
}

// Plan Free: solo los trabajos B2B (hasta N empresas) y sus planillas
function FinanzasFree() {
  const { profesional, plan } = usePanel();
  const [empresas, setEmpresas] = useState(null);
  const [enUso, setEnUso] = useState(new Set());

  const cargar = useCallback(async () => {
    const [cl, or] = await Promise.all([
      cargarClientes(profesional.id),
      supabase.from('ordenes').select('empresa_id').eq('profesional_id', profesional.id),
    ]);
    setEmpresas((cl.data || []).filter((c) => c.es_empresa));
    setEnUso(new Set((or.data || []).map((o) => o.empresa_id)));
  }, [profesional.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);
  useAlVolver(cargar);

  const lim = plan?.limite_empresas_b2b ?? 2;
  const limExp = plan?.limite_exportaciones ?? 6;
  const lleno = enUso.size >= lim;

  return (
    <>
      <FinanzasEncabezado />
      <div className="space-y-6 px-4 pt-4">
        <section>
          <h2 className="titulo-seccion mb-2">Trabajos B2B</h2>
          {!empresas ? (
            <p className="text-tinta-400">Cargando…</p>
          ) : empresas.length === 0 ? (
            <p className="tarjeta p-4 text-sm text-tinta-400">
              Marcá un cliente como <b>Cliente B2B</b> (empresa) en Clientes para cargarle trabajos y liquidar el mes.
            </p>
          ) : (
            <div className="tarjeta divide-y divide-navy-800 overflow-hidden">
              {empresas.map((e) => {
                const habilitada = enUso.has(e.id) || !lleno;
                return habilitada ? (
                  <Fila key={e.id} icono="maletin" color={e.color || '#5aa9e6'} titulo={e.nombre} detalle={enUso.has(e.id) ? 'Trabajos y planilla del mes' : 'Todavía sin trabajos'} href={`/panel/ordenes?empresa=${e.id}`} />
                ) : (
                  <Fila key={e.id} icono="candado" color="#ec8328" titulo={e.nombre} detalle={`En Free, hasta ${lim} empresas con trabajos`} href="/panel/planes" />
                );
              })}
            </div>
          )}
          <p className="mt-2 text-xs text-tinta-500">
            Plan Free: {enUso.size} de {lim} empresas B2B en uso · {plan?.exportaciones_mes ?? 0} de {limExp} planillas Excel este mes.
          </p>
        </section>

        <BloqueoPlan
          titulo="Tus finanzas, claras"
          texto="Con Pro ves cuánto ganás cada mes y manejás presupuestos y gastos."
          puntos={[
            'Ingresos, gastos y ganancia del mes, con gráfico de 6 meses',
            'Presupuestos en PDF con tu logo, margen e IVA',
            'Mis gastos: movilidad, combustible, insumos, viáticos y herramientas',
            'Trabajos B2B y planillas sin límite',
          ]}
        />
      </div>
    </>
  );
}

function FinanzasPro() {
  const { profesional } = usePanel();
  const { ajustes } = useAjustes(profesional.id);
  const [periodo, setPeriodo] = useState(() => {
    const h = new Date();
    return { anio: h.getFullYear(), mes: h.getMonth() + 1 };
  });
  const [datos, setDatos] = useState(null);
  const [porCobrar, setPorCobrar] = useState({ total: 0, cantidad: 0 });
  const [empresas, setEmpresas] = useState({});
  const [faltaSql, setFaltaSql] = useState(false);

  // El gráfico muestra siempre hasta el mes actual (o el elegido, si es posterior)
  const hoy = useMemo(() => {
    const h = new Date();
    return { anio: h.getFullYear(), mes: h.getMonth() + 1 };
  }, []);
  const finVentana = claveMes(periodo) > claveMes(hoy) ? periodo : hoy;
  const inicioVentana = sumarMeses(finVentana, -(MESES_GRAFICO - 1));
  const primero = claveMes(periodo) < claveMes(inicioVentana) ? periodo : inicioVentana;
  const desde = rangoMes(primero.anio, primero.mes).desde;
  const hasta = rangoMes(finVentana.anio, finVentana.mes).hasta;

  const cargar = useCallback(async () => {
    const id = profesional.id;
    const inicioLocal = new Date(primero.anio, primero.mes - 1, 1).toISOString();
    const finLocal = new Date(finVentana.anio, finVentana.mes, 1).toISOString();
    const [pr, or, tu, ga, deben, cl] = await Promise.all([
      supabase
        .from('presupuestos')
        .select('id, estado, subtotal, iva, total, costo_total, aceptado_en, cobrado_en')
        .eq('profesional_id', id)
        .eq('estado', 'aceptado')
        .gte('aceptado_en', desde)
        .lt('aceptado_en', hasta),
      supabase.from('ordenes').select('*').eq('profesional_id', id).in('estado', ['finalizado', 'realizado']).gte('fecha', desde).lt('fecha', hasta),
      supabase
        .from('turnos')
        .select('tipo, estado, monto_acordado, precio_visita, comision, inicio')
        .eq('profesional_id', id)
        .eq('estado', 'realizado')
        .gte('inicio', inicioLocal)
        .lt('inicio', finLocal),
      supabase.from('gastos').select('fecha, categoria, monto').eq('profesional_id', id).gte('fecha', desde).lt('fecha', hasta),
      supabase.from('presupuestos').select('total').eq('profesional_id', id).eq('estado', 'aceptado').is('cobrado_en', null),
      cargarClientes(id),
    ]);
    const vacio = (r) => (r.error ? [] : r.data || []);
    setFaltaSql([pr, ga].some((r) => faltaTabla(r.error)));
    setDatos({ presupuestos: vacio(pr), ordenes: vacio(or), turnos: vacio(tu), gastos: vacio(ga) });
    const lista = vacio(deben);
    setPorCobrar({ total: lista.reduce((s, p) => s + Number(p.total || 0), 0), cantidad: lista.length });
    setEmpresas(Object.fromEntries((cl.data || []).map((c) => [c.id, c])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profesional.id, desde, hasta]);

  useEffect(() => {
    cargar();
  }, [cargar]);
  useAlVolver(cargar);

  const movs = useMemo(() => (datos ? movimientos(datos) : { ingresos: [], costos: [] }), [datos]);
  const r = resumenMes(movs, claveMes(periodo));
  const serie = serieMeses(
    movs,
    Array.from({ length: MESES_GRAFICO }, (_, i) => sumarMeses(inicioVentana, i))
  );
  const categorias = categoriasDe(ajustes);
  const gano = r.resultado >= 0;

  return (
    <>
      <FinanzasEncabezado periodo={periodo} onMover={(n) => setPeriodo((p) => sumarMeses(p, n))} />

      <div className="space-y-6 px-4 pt-4">
        {faltaSql && (
          <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">
            Falta correr en Supabase el archivo <b>04_trabajos_finanzas.sql</b> para ver presupuestos y gastos acá.
          </p>
        )}

        {!datos ? (
          <p className="text-tinta-400">Cargando…</p>
        ) : (
          <>
            {/* Resultado */}
            <section className="tarjeta p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-tinta-400">Resultado de {MESES[periodo.mes - 1]}</p>
              <p className={`mt-1 text-4xl font-extrabold ${gano ? 'text-menta-300' : 'text-red-300'}`}>
                {gano ? '' : '− '}
                {pesos(Math.abs(r.resultado), { decimales: false })}
              </p>
              <p className="text-sm text-tinta-300">
                {gano ? 'Ganancia' : 'Pérdida'}
                {r.margen !== null ? ` · margen ${r.margen.toLocaleString('es-UY')}%` : ''}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-navy-850 p-3">
                  <p className="flex items-center gap-1.5 text-xs text-tinta-400"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_INGRESOS }} /> Ingresos</p>
                  <p className="text-xl font-extrabold">{pesos(r.ingresos, { decimales: false })}</p>
                </div>
                <div className="rounded-xl bg-navy-850 p-3">
                  <p className="flex items-center gap-1.5 text-xs text-tinta-400"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_GASTOS }} /> Gastos y costos</p>
                  <p className="text-xl font-extrabold">{pesos(r.costos, { decimales: false })}</p>
                </div>
              </div>
            </section>

            {porCobrar.total > 0 && (
              <Link href="/panel/finanzas/presupuestos" className="tarjeta flex items-center gap-3 border-amber-400/40 p-4 hover:bg-navy-850">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-400/15 text-amber-300">
                  <Icon name="billetera" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">Te deben {pesos(porCobrar.total, { decimales: false })}</span>
                  <span className="block text-xs text-tinta-400">
                    {porCobrar.cantidad} {porCobrar.cantidad === 1 ? 'presupuesto aceptado' : 'presupuestos aceptados'} sin cobrar (IVA incluido)
                  </span>
                </span>
                <Icon name="der" className="h-4 w-4 text-tinta-500" />
              </Link>
            )}

            {/* Ingresos */}
            <section>
              <h2 className="titulo-seccion mb-2">Ingresos (sin IVA)</h2>
              <div className="tarjeta divide-y divide-navy-800 overflow-hidden">
                <Fila
                  icono="documento"
                  color="#ec8328"
                  titulo="Presupuestos aceptados"
                  detalle={
                    r.presupuestos.cantidad
                      ? `${r.presupuestos.cantidad} · cobrado ${pesos(r.presupuestos.cobrado, { decimales: false })} · por cobrar ${pesos(r.presupuestos.porCobrar, { decimales: false })}`
                      : 'Ninguno este mes'
                  }
                  valor={pesos(r.presupuestos.total, { decimales: false })}
                  href="/panel/finanzas/presupuestos"
                />
                {Object.entries(r.b2b.porEmpresa).map(([empresaId, e]) => (
                  <Fila
                    key={empresaId}
                    icono="maletin"
                    color={empresas[empresaId]?.color || '#5aa9e6'}
                    titulo={`B2B · ${empresas[empresaId]?.nombre || 'Cliente B2B'}`}
                    detalle={`${e.cantidad} ${e.cantidad === 1 ? 'trabajo finalizado' : 'trabajos finalizados'}`}
                    valor={pesos(e.total, { decimales: false })}
                    href={`/panel/ordenes?empresa=${empresaId}`}
                  />
                ))}
                {r.b2b.cantidad === 0 && Object.values(empresas).some((c) => c.es_empresa) && (
                  <Fila icono="maletin" color="#5aa9e6" titulo="Trabajos B2B" detalle="Ninguno finalizado este mes" valor={pesos(0, { decimales: false })} href="/panel/ordenes" />
                )}
                <Fila
                  icono="agenda"
                  color="#60a5fa"
                  titulo="Trabajos con tus clientes"
                  detalle={r.turnos.cantidad ? `${r.turnos.cantidad} turnos realizados con precio de mano de obra` : 'Turnos realizados con precio de mano de obra'}
                  valor={pesos(r.turnos.total, { decimales: false })}
                />
                {r.visitas.cantidad > 0 && (
                  <Fila icono="escudo" color="#4fe0b6" titulo="Visitas por TaListo!" detalle={`${r.visitas.cantidad} · lo que te queda después de la comisión`} valor={pesos(r.visitas.total, { decimales: false })} />
                )}
              </div>
              {r.presupuestos.iva > 0 && (
                <p className="mt-2 text-xs text-tinta-500">Además, {pesos(r.presupuestos.iva, { decimales: false })} de IVA en los presupuestos aceptados (no es ingreso tuyo).</p>
              )}
            </section>

            {/* Gastos */}
            <section>
              <h2 className="titulo-seccion mb-2">Gastos y costos</h2>
              <div className="tarjeta divide-y divide-navy-800 overflow-hidden">
                <Fila icono="caja" color="#f6c344" titulo="Materiales" detalle="Precio de costo de los presupuestos aceptados y trabajos B2B" valor={pesos(r.materiales, { decimales: false })} />
                {Object.entries(r.gastos.porCategoria)
                  .sort((a, b) => b[1] - a[1])
                  .map(([nombre, total]) => {
                    const c = infoCategoria(nombre, categorias);
                    return <Fila key={nombre} icono={c.icono} color={c.color} titulo={nombre} valor={pesos(total, { decimales: false })} href="/panel/finanzas/gastos" />;
                  })}
                {r.gastos.cantidad === 0 && (
                  <Fila icono="billetera" color="#94a3b8" titulo="Mis gastos" detalle="Movilidad, insumos, viáticos, herramientas…" valor={pesos(0, { decimales: false })} href="/panel/finanzas/gastos" />
                )}
              </div>
            </section>

            {/* Últimos meses */}
            <section className="tarjeta p-4">
              <h2 className="titulo-seccion mb-3">Últimos {MESES_GRAFICO} meses</h2>
              <BarrasMeses serie={serie} seleccionado={claveMes(periodo)} onElegir={setPeriodo} />
            </section>

            <p className="text-xs text-tinta-500">
              Cuenta los presupuestos en el mes en que se aceptan, los trabajos B2B finalizados, los turnos que marcaste como realizados y tus gastos. Si un
              trabajo ya está en un presupuesto aceptado, no le pongas precio al turno para no contarlo dos veces.
            </p>
          </>
        )}
      </div>
    </>
  );
}
