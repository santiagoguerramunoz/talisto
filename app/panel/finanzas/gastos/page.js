'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import FormGasto from '@/components/FormGasto';
import FinanzasEncabezado from '@/components/FinanzasEncabezado';
import { usePanel } from '@/components/PanelContext';
import BloqueoPlan from '@/components/BloqueoPlan';
import { esPro } from '@/lib/planes';
import { supabase } from '@/lib/supabase';
import { useAlVolver } from '@/lib/useAlVolver';
import { useAjustes } from '@/lib/ajustes';
import { fechaCorta, fechaISO, rangoMes, sumarMeses } from '@/lib/fechas';
import { categoriasDe, detalleGasto, infoCategoria, totalesPorCategoria } from '@/lib/gastos';
import { numero, pesos } from '@/lib/precios';
import { AVISO_SQL_04, faltaSql04, faltaTabla } from '@/lib/sql';
import { mensajeError } from '@/lib/util';

export default function MisGastos() {
  const { plan } = usePanel();
  if (esPro(plan?.plan)) return <MisGastosPro />;
  return (
    <>
      <FinanzasEncabezado />
      <div className="px-4 pt-4">
        <BloqueoPlan
          titulo="Mis gastos"
          texto="Anotá lo que gastás para saber cuánto te queda de verdad."
          puntos={[
            'Movilidad: boletos de bus o tu vehículo, con el consumo de combustible',
            'Insumos, viáticos, herramientas y categorías propias',
            'Todo suma en Finanzas para ver tu ganancia del mes',
          ]}
        />
      </div>
    </>
  );
}

function MisGastosPro() {
  const { profesional } = usePanel();
  const { ajustes, guardar: guardarAjustes, faltaSql: faltaAjustes } = useAjustes(profesional.id);
  const [periodo, setPeriodo] = useState(() => {
    const h = new Date();
    return { anio: h.getFullYear(), mes: h.getMonth() + 1 };
  });
  const [gastos, setGastos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [faltaSql, setFaltaSql] = useState(false);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState('');
  const [modal, setModal] = useState(null);
  const [editarCategorias, setEditarCategorias] = useState(false);
  const [movilidad, setMovilidad] = useState(null);
  const [avisoMovilidad, setAvisoMovilidad] = useState('');

  const { desde, hasta } = rangoMes(periodo.anio, periodo.mes);
  const categorias = useMemo(() => categoriasDe(ajustes), [ajustes]);

  const cargar = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('gastos')
      .select('*')
      .eq('profesional_id', profesional.id)
      .gte('fecha', desde)
      .lt('fecha', hasta)
      .order('fecha', { ascending: false })
      .order('creado_en', { ascending: false });
    setCargando(false);
    if (err) {
      if (faltaTabla(err)) setFaltaSql(true);
      else setError(mensajeError(err));
      return;
    }
    setError('');
    setGastos(data || []);
  }, [profesional.id, desde, hasta]);

  useEffect(() => {
    cargar();
  }, [cargar]);
  useAlVolver(cargar);

  useEffect(() => {
    setMovilidad({
      precio_boleto: ajustes.precio_boleto ?? '',
      precio_combustible: ajustes.precio_combustible ?? '',
      consumo_km_litro: ajustes.consumo_km_litro ?? '',
    });
  }, [ajustes.precio_boleto, ajustes.precio_combustible, ajustes.consumo_km_litro]);

  const porCategoria = totalesPorCategoria(gastos);
  const total = gastos.reduce((s, g) => s + Number(g.monto || 0), 0);
  const visibles = filtro ? gastos.filter((g) => g.categoria === filtro) : gastos;
  // Categorías con gastos que ya no están en la lista (por ej. una propia que se borró)
  const sueltas = Object.keys(porCategoria).filter((c) => !categorias.some((x) => x.nombre === c));
  const grilla = [...categorias, ...sueltas.map((nombre) => infoCategoria(nombre, categorias))];

  async function guardarMovilidad() {
    setAvisoMovilidad('');
    const { error: err } = await guardarAjustes({
      precio_boleto: numero(movilidad.precio_boleto),
      precio_combustible: numero(movilidad.precio_combustible),
      consumo_km_litro: numero(movilidad.consumo_km_litro) || null,
    });
    setAvisoMovilidad(err ? (faltaSql04(err) ? AVISO_SQL_04 : mensajeError(err)) : 'Guardado. Se usan al cargar un gasto de movilidad.');
  }

  async function quitarCategoria(nombre) {
    if (!window.confirm(`¿Quitar la categoría "${nombre}"? Los gastos que ya tiene se mantienen.`)) return;
    await guardarAjustes({ categorias_gastos: (ajustes.categorias_gastos || []).filter((c) => c !== nombre) });
  }

  return (
    <>
      <FinanzasEncabezado periodo={periodo} onMover={(n) => setPeriodo((p) => sumarMeses(p, n))} />

      <div className="space-y-5 px-4 pt-4">
        {(faltaSql || faltaAjustes) && (
          <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">
            Falta correr en Supabase el archivo <b>04_trabajos_finanzas.sql</b> para activar Mis gastos.
          </p>
        )}
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

        <section className="tarjeta flex items-center justify-between p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-tinta-400">Gastos del mes</p>
            <p className="text-3xl font-extrabold">{pesos(total, { decimales: false })}</p>
            <p className="text-xs text-tinta-400">{gastos.length} {gastos.length === 1 ? 'gasto' : 'gastos'}</p>
          </div>
          <button className="btn btn-menta" onClick={() => setModal({ inicial: { fecha: fechaISO(new Date()), categoria: filtro || 'Movilidad' } })}>
            <Icon name="mas" /> Gasto
          </button>
        </section>

        {/* Grilla por categoría */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="titulo-seccion">Por categoría</h2>
            <button className="text-sm font-semibold text-menta-400" onClick={() => setEditarCategorias(true)}>Categorías</button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {grilla.map((c) => {
              const t = porCategoria[c.nombre];
              const activo = filtro === c.nombre;
              return (
                <button
                  key={c.nombre}
                  type="button"
                  onClick={() => setFiltro(activo ? '' : c.nombre)}
                  className={`tarjeta flex items-center gap-3 p-3 text-left ${activo ? 'border-menta-500/70 bg-menta-500/5' : ''} ${t ? '' : 'opacity-60'}`}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `${c.color}26`, color: c.color }}>
                    <Icon name={c.icono} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{c.nombre}</span>
                    <span className="block text-sm font-extrabold">{pesos(t?.total || 0, { decimales: false })}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {filtro && (
            <button className="mt-2 text-xs font-semibold text-tinta-400" onClick={() => setFiltro('')}>
              Mostrando {filtro} · ver todos
            </button>
          )}
        </section>

        {/* Lista */}
        <section>
          <h2 className="titulo-seccion mb-2">{filtro || 'Todos los gastos'}</h2>
          {cargando ? (
            <p className="text-tinta-400">Cargando…</p>
          ) : visibles.length === 0 ? (
            <p className="tarjeta p-4 text-sm text-tinta-400">Sin gastos {filtro ? `de ${filtro.toLowerCase()} ` : ''}este mes.</p>
          ) : (
            <ul className="tarjeta divide-y divide-navy-800 overflow-hidden">
              {visibles.map((g) => {
                const c = infoCategoria(g.categoria, categorias);
                const detalle = detalleGasto(g);
                return (
                  <li key={g.id}>
                    <button onClick={() => setModal({ gasto: g })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-navy-850">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `${c.color}26`, color: c.color }}>
                        <Icon name={g.tipo === 'bus' ? 'bus' : c.icono} className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{g.descripcion || g.categoria}</span>
                        <span className="block truncate text-xs text-tinta-400">
                          {fechaCorta(`${g.fecha}T00:00`)} · {g.categoria}
                          {detalle ? ` · ${detalle}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 font-bold">{pesos(g.monto)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Valores de movilidad */}
        {movilidad && (
          <section className="tarjeta space-y-3 p-4">
            <div className="flex items-center gap-2">
              <Icon name="auto" className="h-5 w-5 text-[#5aa9e6]" />
              <h2 className="font-bold">Valores de movilidad</h2>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="etiqueta" htmlFor="m-boleto">Boleto ($)</label>
                <input id="m-boleto" type="number" inputMode="decimal" min="0" className="campo" value={movilidad.precio_boleto} onChange={(e) => setMovilidad({ ...movilidad, precio_boleto: e.target.value })} />
              </div>
              <div>
                <label className="etiqueta" htmlFor="m-litro">Litro ($)</label>
                <input id="m-litro" type="number" inputMode="decimal" min="0" className="campo" value={movilidad.precio_combustible} onChange={(e) => setMovilidad({ ...movilidad, precio_combustible: e.target.value })} />
              </div>
              <div>
                <label className="etiqueta" htmlFor="m-consumo">Km por litro</label>
                <input id="m-consumo" type="number" inputMode="decimal" min="0" className="campo" value={movilidad.consumo_km_litro} onChange={(e) => setMovilidad({ ...movilidad, consumo_km_litro: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-tinta-400">El consumo es el promedio de tu vehículo. Con los km de cada viaje se calcula el combustible gastado.</p>
            <button className="btn btn-sec w-full" onClick={guardarMovilidad}>Guardar valores</button>
            {avisoMovilidad && <p className="text-sm text-menta-300">{avisoMovilidad}</p>}
          </section>
        )}
      </div>

      <FormGasto
        abierto={!!modal}
        onCerrar={() => setModal(null)}
        onGuardado={cargar}
        profesionalId={profesional.id}
        gasto={modal?.gasto}
        inicial={modal?.inicial}
        ajustes={ajustes}
        categorias={categorias}
        onGuardarAjustes={guardarAjustes}
      />

      <Modal abierto={editarCategorias} onCerrar={() => setEditarCategorias(false)} titulo="Categorías de gastos">
        <ul className="space-y-2">
          {categorias.map((c) => (
            <li key={c.nombre} className="flex items-center gap-3 rounded-xl bg-navy-850 px-3 py-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${c.color}26`, color: c.color }}>
                <Icon name={c.icono} className="h-4 w-4" />
              </span>
              <span className="flex-1 font-semibold">{c.nombre}</span>
              {c.propia ? (
                <button className="rounded-lg p-2 text-tinta-400 hover:text-red-300" onClick={() => quitarCategoria(c.nombre)} aria-label={`Quitar ${c.nombre}`}>
                  <Icon name="borrar" className="h-4 w-4" />
                </button>
              ) : (
                <span className="text-xs text-tinta-500">Fija</span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-tinta-400">Para agregar una categoría tocá <b>Nueva</b> al cargar un gasto.</p>
      </Modal>
    </>
  );
}
