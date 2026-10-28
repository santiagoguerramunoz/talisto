'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import FormOrden from '@/components/FormOrden';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { cargarClientes } from '@/lib/clientes';
import { useAlVolver } from '@/lib/useAlVolver';
import { MESES, fechaCorta, fechaISO } from '@/lib/fechas';
import { equivalenteOrden, nombreArchivoLiquidacion, planillaLiquidacion, textoHorario, totalesOrdenes } from '@/lib/liquidacion';
import { TIPO_XLSX } from '@/lib/xlsx';
import { mensajeError, monto } from '@/lib/util';

const ESTADO_CHIP = {
  pendiente: 'bg-amber-400/15 text-amber-300',
  realizado: 'bg-menta-500/15 text-menta-300',
  cancelado: 'bg-navy-700 text-tinta-400',
};
const ESTADO_TEXTO = { pendiente: 'Pendiente', realizado: 'Realizada', cancelado: 'Cancelada' };
const num = (n) => Number(n || 0).toLocaleString('es-UY', { maximumFractionDigits: 2 });

function Ordenes() {
  const params = useSearchParams();
  const { profesional } = usePanel();
  const [empresas, setEmpresas] = useState(null);
  const [empresaId, setEmpresaId] = useState(params.get('empresa') || '');
  const [periodo, setPeriodo] = useState(() => {
    const h = new Date();
    return { anio: h.getFullYear(), mes: h.getMonth() + 1 };
  });
  const [ordenes, setOrdenes] = useState([]);
  const [modal, setModal] = useState(null);
  const [precioMes, setPrecioMes] = useState('');
  const [aviso, setAviso] = useState({});
  const [faltaSql, setFaltaSql] = useState(false);

  // Empresas (clientes marcados como empresa)
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
    const { data, error } = await supabase
      .from('ordenes')
      .select('*')
      .eq('profesional_id', profesional.id)
      .eq('empresa_id', empresaId)
      .gte('fecha', desde)
      .lt('fecha', hasta)
      .order('fecha')
      .order('hora_inicio', { nullsFirst: false });
    if (error) {
      if (/does not exist|could not find/i.test(error.message || '')) setFaltaSql(true);
      else setAviso({ error: mensajeError(error) });
      return;
    }
    setOrdenes(data || []);
  }, [profesional.id, empresaId, desde, hasta]);

  useEffect(() => {
    cargar();
  }, [cargar]);
  useAlVolver(cargar);

  useEffect(() => {
    setPrecioMes(empresa?.precio_acondicionamiento ?? '');
  }, [empresa?.id, empresa?.precio_acondicionamiento]);

  const realizadas = useMemo(() => ordenes.filter((o) => o.estado === 'realizado'), [ordenes]);
  const pendientes = ordenes.filter((o) => o.estado === 'pendiente');
  const totales = totalesOrdenes(realizadas);

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
    setAviso({ ok: `Precio de ${monto(precio)} aplicado a las órdenes de ${MESES[periodo.mes - 1]} y guardado para las próximas.` });
    cargar();
  }

  function armarPlanilla() {
    const bytes = planillaLiquidacion({
      empresa,
      ordenes: realizadas,
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

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          {empresa && (
            <Link href={`/panel/clientes/${empresa.id}`} className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver">
              <Icon name="izq" />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-extrabold">Órdenes{empresa ? ` · ${empresa.nombre}` : ''}</h1>
          </div>
          {empresa && (
            <button className="btn btn-menta py-2" onClick={() => setModal({ inicial: { empresa_id: empresa.id, fecha: fechaISO(new Date()) } })}>
              <Icon name="mas" /> Nueva
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
            Falta correr en Supabase el archivo <b>03_ordenes_empresa.sql</b> para activar las órdenes de empresa.
          </p>
        )}

        {!empresa ? (
          <div className="tarjeta p-6 text-center">
            <Icon name="maletin" className="mx-auto h-8 w-8 text-marca-naranja" />
            <p className="mt-2 font-bold">Todavía no tenés empresas</p>
            <p className="mt-1 text-sm text-tinta-400">
              Entrá a la ficha del cliente (por ejemplo Grupo Gamma), activá <b>“Trabaja con sus propios clientes”</b> y poné el precio del acondicionamiento.
            </p>
            <Link href="/panel/clientes" className="btn btn-sec mt-4">Ir a clientes</Link>
          </div>
        ) : (
          <>
            {/* Resumen de liquidación */}
            <section className="tarjeta p-4">
              <p className="titulo-seccion">Liquidación del mes</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-navy-850 p-2.5">
                  <p className="text-xl font-extrabold">{num(totales.acondicionamientos)}</p>
                  <p className="text-[11px] text-tinta-400">Acondic.</p>
                </div>
                <div className="rounded-xl bg-navy-850 p-2.5">
                  <p className="text-xl font-extrabold">{num(totales.moes)}</p>
                  <p className="text-[11px] text-tinta-400">MOE</p>
                </div>
                <div className="rounded-xl bg-navy-850 p-2.5">
                  <p className="text-xl font-extrabold">{num(totales.equivalente)}</p>
                  <p className="text-[11px] text-tinta-400">Equivalente</p>
                </div>
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <p className="text-xs text-tinta-400">{totales.cantidad} {totales.cantidad === 1 ? 'orden realizada' : 'órdenes realizadas'}</p>
                  <p className="text-2xl font-extrabold text-menta-300">{monto(Math.round(totales.importe))}</p>
                </div>
                {pendientes.length > 0 && (
                  <p className="max-w-[45%] text-right text-xs text-amber-300">{pendientes.length} pendiente{pendientes.length > 1 ? 's' : ''}: no entran hasta marcarlas realizadas</p>
                )}
              </div>
              {totales.sinPrecio > 0 && <p className="mt-2 text-xs text-amber-300">{totales.sinPrecio} sin precio: definí el precio del mes abajo.</p>}

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button className="btn btn-menta" onClick={descargar} disabled={!realizadas.length}>
                  <Icon name="descargar" /> Descargar planilla (.xlsx)
                </button>
                {puedeCompartir && (
                  <button className="btn btn-sec" onClick={compartir} disabled={!realizadas.length}>
                    <Icon name="whatsapp" /> Enviar planilla
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-tinta-500">Abre en Excel, Google Sheets y LibreOffice.</p>
            </section>

            {/* Precio del mes */}
            <section className="tarjeta p-4">
              <p className="titulo-seccion">Precio del acondicionamiento</p>
              <div className="mt-3 flex gap-2">
                <input type="number" inputMode="decimal" min="0" className="campo" value={precioMes} onChange={(e) => setPrecioMes(e.target.value)} placeholder="UYU" aria-label="Precio por acondicionamiento" />
                <button className="btn btn-sec shrink-0" onClick={aplicarPrecio}>Aplicar al mes</button>
              </div>
              <p className="mt-2 text-xs text-tinta-400">
                Cambia el precio de todas las órdenes de {MESES[periodo.mes - 1]} y queda como precio para las nuevas. 1 MOE = {num(empresa.factor_moe ?? 1.75)} acondicionamientos.
              </p>
            </section>

            {aviso.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{aviso.error}</p>}
            {aviso.ok && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{aviso.ok}</p>}

            {/* Lista */}
            <section>
              <h2 className="titulo-seccion mb-2">Órdenes de {MESES[periodo.mes - 1]}</h2>
              {ordenes.length === 0 ? (
                <p className="tarjeta p-4 text-sm text-tinta-400">No hay órdenes cargadas este mes.</p>
              ) : (
                <ul className="space-y-2">
                  {ordenes.map((o) => (
                    <li key={o.id}>
                      <button onClick={() => setModal({ orden: o })} className={`tarjeta w-full p-3 text-left hover:bg-navy-850 ${o.estado === 'cancelado' ? 'opacity-50' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-bold">
                              {o.numero_ticket ? `Ticket ${o.numero_ticket}` : 'Sin ticket'}
                              {o.numero_cliente && <span className="font-normal text-tinta-400"> · Cliente {o.numero_cliente}</span>}
                            </p>
                            <p className="truncate text-xs text-tinta-400">
                              {fechaCorta(`${o.fecha}T00:00`)}
                              {textoHorario(o) ? ` · ${textoHorario(o)}` : ''}
                              {o.direccion ? ` · ${o.direccion}` : ''}
                            </p>
                            {(o.realizado || o.pedido) && <p className="mt-0.5 line-clamp-1 text-sm text-tinta-300">{o.realizado || o.pedido}</p>}
                          </div>
                          <div className="shrink-0 text-right">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ESTADO_CHIP[o.estado]}`}>{ESTADO_TEXTO[o.estado]}</span>
                            <p className="mt-1 text-xs font-semibold text-tinta-300">
                              {Number(o.acondicionamientos) ? `${num(o.acondicionamientos)} A` : ''}
                              {Number(o.acondicionamientos) && Number(o.moes) ? ' + ' : ''}
                              {Number(o.moes) ? `${num(o.moes)} MOE` : ''}
                            </p>
                            <p className="text-[11px] text-tinta-500">= {num(equivalenteOrden(o))} acond.</p>
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      <FormOrden
        abierto={!!modal}
        onCerrar={() => setModal(null)}
        onGuardado={cargar}
        profesionalId={profesional.id}
        empresas={empresas}
        orden={modal?.orden}
        inicial={modal?.inicial}
      />
    </>
  );
}

export default function PaginaOrdenes() {
  return (
    <Suspense fallback={<p className="p-4 text-tinta-400">Cargando…</p>}>
      <Ordenes />
    </Suspense>
  );
}
