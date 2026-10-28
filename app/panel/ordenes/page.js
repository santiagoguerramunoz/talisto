'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import FormTrabajoB2B from '@/components/FormTrabajoB2B';
import { Reloj } from '@/components/ControlTiempo';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { cargarClientes } from '@/lib/clientes';
import { useAlVolver } from '@/lib/useAlVolver';
import { useAjustes } from '@/lib/ajustes';
import { MESES, fechaCorta, fechaISO } from '@/lib/fechas';
import { equivalenteOrden, importeOrden, nombreArchivoLiquidacion, planillaLiquidacion, textoHorario, totalesOrdenes } from '@/lib/liquidacion';
import { pesos } from '@/lib/precios';
import { horasMinutos, minutosTrabajo, sesionAbierta, textoMinutos } from '@/lib/tiempos';
import { ESTADOS_ABIERTOS, ESTADOS_TRABAJO, esFinalizado, estadoTrabajo } from '@/lib/trabajos';
import { TIPO_XLSX } from '@/lib/xlsx';
import { mensajeError, monto } from '@/lib/util';

const num = (n) => Number(n || 0).toLocaleString('es-UY', { maximumFractionDigits: 2 });

function TarjetaTrabajo({ o, onAbrir }) {
  const estado = estadoTrabajo(o.estado);
  const info = ESTADOS_TRABAJO[estado] || ESTADOS_TRABAJO.pendiente;
  const imp = importeOrden(o);
  const min = minutosTrabajo(o);
  return (
    <button onClick={() => onAbrir(o)} className={`tarjeta w-full p-3 text-left hover:bg-navy-850 ${estado === 'cancelado' ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-bold">
            {o.numero_ticket ? `Ticket ${o.numero_ticket}` : 'Sin ticket'}
            {o.numero_cliente && <span className="font-normal text-tinta-400"> · Cliente {o.numero_cliente}</span>}
          </p>
          <p className="truncate text-xs text-tinta-400">
            {o.fecha_inicio && o.fecha_inicio !== o.fecha ? `${fechaCorta(`${o.fecha_inicio}T00:00`)} al ` : ''}
            {fechaCorta(`${o.fecha}T00:00`)}
            {textoHorario(o) ? ` · ${textoHorario(o)}` : ''}
            {o.direccion ? ` · ${o.direccion}` : ''}
          </p>
          {(o.realizado || o.pedido) && <p className="mt-0.5 line-clamp-1 text-sm text-tinta-300">{o.realizado || o.pedido}</p>}
          {estado === 'suspendido' && o.nota_estado && <p className="mt-0.5 text-xs text-red-300">Motivo: {o.nota_estado}</p>}
        </div>
        <div className="shrink-0 text-right">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${info.clase}`}>
            {estado === 'en_curso' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0a84ff]" />}
            {info.texto}
          </span>
          <p className="mt-1 text-xs font-semibold text-tinta-300">
            {Number(o.acondicionamientos) ? `${num(o.acondicionamientos)} P` : ''}
            {Number(o.acondicionamientos) && Number(o.moes) ? ' + ' : ''}
            {Number(o.moes) ? `${num(o.moes)} MOE` : ''}
          </p>
          {sesionAbierta(o.tiempos) ? (
            <Reloj tiempos={o.tiempos} className="text-[11px] font-bold text-[#8cc8ff]" />
          ) : min > 0 ? (
            <p className="text-[11px] text-tinta-500">{textoMinutos(min)}</p>
          ) : null}
          {imp !== null && <p className="text-[11px] font-semibold text-menta-300">{pesos(imp, { decimales: false })}</p>}
        </div>
      </div>
    </button>
  );
}

function Trabajos() {
  const params = useSearchParams();
  const { profesional } = usePanel();
  const { ajustes } = useAjustes(profesional.id);
  const [empresas, setEmpresas] = useState(null);
  const [empresaId, setEmpresaId] = useState(params.get('empresa') || '');
  const [periodo, setPeriodo] = useState(() => {
    const h = new Date();
    return { anio: h.getFullYear(), mes: h.getMonth() + 1 };
  });
  const [ordenes, setOrdenes] = useState([]);
  const [abiertos, setAbiertos] = useState([]);
  const [modal, setModal] = useState(null);
  const [precioMes, setPrecioMes] = useState('');
  const [aviso, setAviso] = useState({});
  const [faltaSql, setFaltaSql] = useState(false);

  // Clientes B2B
  useEffect(() => {
    cargarClientes(profesional.id).then(({ data }) => {
      const lista = (data || []).filter((c) => c.es_empresa);
      if ((data || []).length && !('es_empresa' in (data[0] || {}))) setFaltaSql(true);
      setEmpresas(lista);
      setEmpresaId((id) => (lista.some((e) => e.id === id) ? id : lista[0]?.id || ''));
    });
  }, [profesional.id]);

  const empresa = (empresas || []).find((e) => e.id === empresaId);
  const desde = `${periodo.anio}-${String(periodo.mes).padStart(2, '0')}-01`;
  const hasta = periodo.mes === 12 ? `${periodo.anio + 1}-01-01` : `${periodo.anio}-${String(periodo.mes + 1).padStart(2, '0')}-01`;

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    const [mes, abiertosR] = await Promise.all([
      supabase
        .from('ordenes')
        .select('*')
        .eq('profesional_id', profesional.id)
        .eq('empresa_id', empresaId)
        .gte('fecha', desde)
        .lt('fecha', hasta)
        .order('fecha')
        .order('hora_inicio', { nullsFirst: false }),
      supabase
        .from('ordenes')
        .select('*')
        .eq('profesional_id', profesional.id)
        .eq('empresa_id', empresaId)
        .in('estado', ESTADOS_ABIERTOS)
        .order('fecha'),
    ]);
    if (mes.error) {
      if (/does not exist|could not find/i.test(mes.error.message || '')) setFaltaSql(true);
      else setAviso({ error: mensajeError(mes.error) });
      return;
    }
    setOrdenes(mes.data || []);
    setAbiertos(abiertosR.data || []);
  }, [profesional.id, empresaId, desde, hasta]);

  useEffect(() => {
    cargar();
  }, [cargar]);
  useAlVolver(cargar, 60000);

  useEffect(() => {
    setPrecioMes(empresa?.precio_acondicionamiento ?? '');
  }, [empresa?.id, empresa?.precio_acondicionamiento]);

  const finalizados = useMemo(() => ordenes.filter(esFinalizado), [ordenes]);
  const sinTerminar = ordenes.filter((o) => !esFinalizado(o) && estadoTrabajo(o.estado) !== 'cancelado');
  const totales = totalesOrdenes(finalizados);

  function moverMes(delta) {
    setPeriodo(({ anio, mes }) => {
      const d = new Date(anio, mes - 1 + delta, 1);
      return { anio: d.getFullYear(), mes: d.getMonth() + 1 };
    });
  }

  async function aplicarPrecio() {
    setAviso({});
    if (precioMes === '' || Number(precioMes) < 0) return setAviso({ error: 'Poné un precio válido.' });
    const precio = Number(precioMes);
    const [r1, r2] = await Promise.all([
      supabase
        .from('ordenes')
        .update({ precio_acondicionamiento: precio })
        .eq('profesional_id', profesional.id)
        .eq('empresa_id', empresaId)
        .gte('fecha', desde)
        .lt('fecha', hasta),
      supabase.from('clientes').update({ precio_acondicionamiento: precio }).eq('id', empresaId),
    ]);
    if (r1.error || r2.error) return setAviso({ error: mensajeError(r1.error || r2.error) });
    setEmpresas((lista) => lista.map((e) => (e.id === empresaId ? { ...e, precio_acondicionamiento: precio } : e)));
    setAviso({ ok: `Precio de ${monto(precio)} por puesta aplicado a los trabajos de ${MESES[periodo.mes - 1]} y guardado para los próximos.` });
    cargar();
  }

  function armarPlanilla() {
    const bytes = planillaLiquidacion({
      empresa,
      ordenes: finalizados,
      anio: periodo.anio,
      mes: periodo.mes,
      profesional: profesional.nombre_publico,
    });
    return new File([bytes], nombreArchivoLiquidacion(empresa, periodo.anio, periodo.mes), { type: TIPO_XLSX });
  }

  function descargar() {
    const archivo = armarPlanilla();
    const url = URL.createObjectURL(archivo);
    const a = document.createElement('a');
    a.href = url;
    a.download = archivo.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const puedeCompartir = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';
  async function compartir() {
    const archivo = armarPlanilla();
    try {
      if (navigator.canShare({ files: [archivo] })) {
        await navigator.share({ files: [archivo], title: archivo.name });
        return;
      }
    } catch {
      return; // el usuario cerró el menú
    }
    descargar();
  }

  if (empresas === null) return <p className="p-4 text-tinta-400">Cargando…</p>;

  const abiertosFuera = abiertos.filter((a) => !ordenes.some((o) => o.id === a.id));

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href={empresa ? `/panel/clientes/${empresa.id}` : '/panel/finanzas'} className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver">
            <Icon name="izq" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-tinta-400">Trabajos B2B</p>
            <h1 className="truncate text-xl font-extrabold">{empresa ? empresa.nombre : 'Clientes B2B'}</h1>
          </div>
          {empresa && (
            <button className="btn btn-menta py-2" onClick={() => setModal({ inicial: { empresa_id: empresa.id, fecha: fechaISO(new Date()) } })}>
              <Icon name="mas" /> Nuevo
            </button>
          )}
        </div>
        {empresas.length > 1 && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto">
            {empresas.map((e) => (
              <button key={e.id} onClick={() => setEmpresaId(e.id)} className={`chip shrink-0 ${e.id === empresaId ? 'chip-activo' : ''}`}>
                {e.nombre}
              </button>
            ))}
          </div>
        )}
        {empresa && (
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => moverMes(-1)} className="btn btn-sec px-2.5 py-2" aria-label="Mes anterior"><Icon name="izq" /></button>
            <button onClick={() => moverMes(1)} className="btn btn-sec px-2.5 py-2" aria-label="Mes siguiente"><Icon name="der" /></button>
            <p className="flex-1 px-1 font-bold capitalize">{MESES[periodo.mes - 1]} {periodo.anio}</p>
          </div>
        )}
      </header>

      <div className="space-y-5 px-4 pt-4">
        {faltaSql && (
          <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">
            Falta correr en Supabase el archivo <b>03_ordenes_empresa.sql</b> (y después el <b>04_trabajos_finanzas.sql</b>).
          </p>
        )}

        {!empresa ? (
          <div className="tarjeta p-6 text-center">
            <Icon name="maletin" className="mx-auto h-8 w-8 text-marca-naranja" />
            <p className="mt-2 font-bold">Todavía no tenés clientes B2B</p>
            <p className="mt-1 text-sm text-tinta-400">
              Entrá a la ficha del cliente, activá <b>“Cliente B2B”</b> y poné el precio por puesta.
            </p>
            <Link href="/panel/clientes" className="btn btn-sec mt-4">Ir a clientes</Link>
          </div>
        ) : (
          <>
            {/* Abiertos de otros meses: en curso, suspendidos o multi día */}
            {abiertosFuera.length > 0 && (
              <section>
                <h2 className="titulo-seccion mb-2">Sin terminar de otros meses</h2>
                <ul className="space-y-2">
                  {abiertosFuera.map((o) => (
                    <li key={o.id}><TarjetaTrabajo o={o} onAbrir={(x) => setModal({ orden: x })} /></li>
                  ))}
                </ul>
              </section>
            )}

            {/* Liquidación del mes */}
            <section className="tarjeta p-4">
              <p className="titulo-seccion">Liquidación del mes</p>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                {[
                  [num(totales.acondicionamientos), 'Puestas'],
                  [num(totales.moes), 'MOE'],
                  [num(totales.equivalente), 'Equiv.'],
                  [`${horasMinutos(totales.minutos)} h`, 'Tiempo'],
                ].map(([valor, texto]) => (
                  <div key={texto} className="rounded-xl bg-navy-850 p-2">
                    <p className="text-base font-extrabold">{valor}</p>
                    <p className="text-[11px] text-tinta-400">{texto}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1 text-sm text-tinta-300">
                <div className="flex justify-between"><span>Puestas y MOE</span><span>{pesos(totales.puestas)}</span></div>
                {totales.manoObra > 0 && <div className="flex justify-between"><span>Mano de obra</span><span>{pesos(totales.manoObra)}</span></div>}
                {totales.materiales > 0 && (
                  <div className="flex justify-between">
                    <span>Materiales <span className="text-xs text-tinta-500">(costo {pesos(totales.costoMateriales)})</span></span>
                    <span>{pesos(totales.materiales)}</span>
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-end justify-between border-t border-navy-800 pt-3">
                <div>
                  <p className="text-xs text-tinta-400">{totales.cantidad} {totales.cantidad === 1 ? 'trabajo finalizado' : 'trabajos finalizados'}</p>
                  <p className="text-2xl font-extrabold text-menta-300">{pesos(totales.importe, { decimales: false })}</p>
                </div>
                {sinTerminar.length > 0 && (
                  <p className="max-w-[45%] text-right text-xs text-amber-300">{sinTerminar.length} sin finalizar: entran cuando los finalizás</p>
                )}
              </div>
              {totales.sinPrecio > 0 && <p className="mt-2 text-xs text-amber-300">{totales.sinPrecio} sin precio por puesta: definilo abajo.</p>}

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button className="btn btn-menta" onClick={descargar} disabled={!finalizados.length}>
                  <Icon name="descargar" /> Descargar planilla (.xlsx)
                </button>
                {puedeCompartir && (
                  <button className="btn btn-sec" onClick={compartir} disabled={!finalizados.length}>
                    <Icon name="whatsapp" /> Enviar planilla
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-tinta-500">Abre en Excel, Google Sheets y LibreOffice. Lleva solo precios finales: sin costos ni proveedores.</p>
            </section>

            {/* Precio por puesta */}
            <section className="tarjeta p-4">
              <p className="titulo-seccion">Precio por puesta</p>
              <div className="mt-3 flex gap-2">
                <input type="number" inputMode="decimal" min="0" className="campo" value={precioMes} onChange={(e) => setPrecioMes(e.target.value)} placeholder="UYU" aria-label="Precio por puesta" />
                <button className="btn btn-sec shrink-0" onClick={aplicarPrecio}>Aplicar al mes</button>
              </div>
              <p className="mt-2 text-xs text-tinta-400">
                Cambia el precio de todos los trabajos de {MESES[periodo.mes - 1]} y queda para los nuevos. 1 MOE = {num(empresa.factor_moe ?? 1.75)} puestas.
              </p>
            </section>

            {aviso.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{aviso.error}</p>}
            {aviso.ok && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{aviso.ok}</p>}

            {/* Lista del mes */}
            <section>
              <h2 className="titulo-seccion mb-2">Trabajos de {MESES[periodo.mes - 1]}</h2>
              {ordenes.length === 0 ? (
                <p className="tarjeta p-4 text-sm text-tinta-400">No hay trabajos cargados este mes.</p>
              ) : (
                <ul className="space-y-2">
                  {ordenes.map((o) => (
                    <li key={o.id}><TarjetaTrabajo o={o} onAbrir={(x) => setModal({ orden: x })} /></li>
                  ))}
                </ul>
              )}
              {ordenes.length > 0 && (
                <p className="mt-2 text-xs text-tinta-500">
                  {num(ordenes.reduce((s, o) => s + (esFinalizado(o) ? equivalenteOrden(o) : 0), 0))} puestas equivalentes finalizadas en el mes.
                </p>
              )}
            </section>
          </>
        )}
      </div>

      <FormTrabajoB2B
        abierto={!!modal}
        onCerrar={() => setModal(null)}
        onGuardado={cargar}
        profesionalId={profesional.id}
        empresas={empresas}
        orden={modal?.orden}
        inicial={modal?.inicial}
        margenDefecto={ajustes.margen_materiales}
      />
    </>
  );
}

export default function PaginaTrabajosB2B() {
  return (
    <Suspense fallback={<p className="p-4 text-tinta-400">Cargando…</p>}>
      <Trabajos />
    </Suspense>
  );
}
