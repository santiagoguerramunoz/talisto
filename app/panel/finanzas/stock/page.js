'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import BloqueoPlan from '@/components/BloqueoPlan';
import FinanzasEncabezado from '@/components/FinanzasEncabezado';
import DetalleMovimiento from '@/components/DetalleMovimiento';
import EditorMaterial from '@/components/EditorMaterial';
import MovimientoStock, { ACCIONES } from '@/components/MovimientoStock';
import FilaMovimiento from '@/components/FilaMovimiento';
import { usePanel } from '@/components/PanelContext';
import { esBusiness, errorDePlan } from '@/lib/planes';
import { pesos } from '@/lib/precios';
import { TIPO_XLSX } from '@/lib/xlsx';
import {
  TIPOS_MOV, bajarArchivo, estadoTrabajo, bajoMinimo, cant, conUnidad, desglose, fechaHora, numeroMov, planillaExistencias, resumenItems,
  rpcStock, rutaMov, textoError, tituloMov, totalMaterial,
} from '@/lib/stock';

const norm = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export default function StockPagina() {
  return (
    <Suspense fallback={<p className="p-4 text-tinta-400">Cargando…</p>}>
      <Contenido />
    </Suspense>
  );
}

function Contenido() {
  const { plan } = usePanel();
  return (
    <>
      <FinanzasEncabezado />
      <div className="space-y-4 px-4 pt-4">
        {!esBusiness(plan?.plan) ? (
          <BloqueoPlan
            plan="business"
            titulo="Stock de la empresa y del equipo"
            texto="Depósitos, lo que tiene cada operario y lo que va a cada ticket, con comprobantes que no se pueden borrar ni modificar."
            puntos={[
              'Entregas al operario que se confirman al recibir',
              'Materiales a cada ticket y devolución de lo que sobra',
              'Por caja, rollo o bolsa, y por unidad o metro',
              'Conteos, bajas y recepción de órdenes de compra',
            ]}
          />
        ) : (
          <Stock />
        )}
      </div>
    </>
  );
}

const TABS = [
  ['existencias', 'Existencias'],
  ['movimientos', 'Movimientos'],
  ['materiales', 'Materiales'],
  ['lugares', 'Lugares'],
];

function Stock() {
  const panel = usePanel();
  const { profesional, yo, user, empresa, permisos } = panel;
  const cuenta = profesional.id;
  const miId = yo?.id || user?.id;
  const params = useSearchParams();
  const router = useRouter();
  const [datos, setDatos] = useState({ cargando: true, error: '', plan: false, ex: null, lugares: null });
  const [verif, setVerif] = useState(null);
  const [tab, setTab] = useState('existencias');
  const [accion, setAccion] = useState('');
  const [preset, setPreset] = useState({});
  const [aviso, setAviso] = useState('');
  const [ultimoMov, setUltimoMov] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [editando, setEditando] = useState(null);
  const [deposito, setDeposito] = useState(null);
  const [lugarFiltro, setLugarFiltro] = useState('');
  const [q, setQ] = useState('');
  const [archivados, setArchivados] = useState(false);
  const [movs, setMovs] = useState({ lista: [], cargando: false, fin: false, tipo: '', error: '' });

  const cargar = useCallback(async () => {
    try {
      const [l, ex] = await Promise.all([rpcStock('stock_lugares', { p_cuenta: cuenta }), rpcStock('stock_existencias', { p_cuenta: cuenta })]);
      setDatos({ cargando: false, error: '', plan: false, ex, lugares: l });
      rpcStock('verificar_stock', { p_cuenta: cuenta })
        .then(setVerif)
        .catch(() => setVerif(null));
    } catch (e) {
      setDatos({ cargando: false, error: textoError(e), plan: errorDePlan(e), ex: null, lugares: null });
    }
  }, [cuenta]);

  const cargarMovs = useCallback(
    async (tipo = '', antes = null) => {
      setMovs((m) => ({ ...m, cargando: true, tipo, error: '', ...(antes ? {} : { lista: [] }) }));
      try {
        const lista = await rpcStock('stock_movimientos', { p_cuenta: cuenta, p_ubicacion: null, p_material: null, p_tipo: tipo || null, p_antes: antes, p_limite: 40 });
        setMovs((m) => ({ lista: antes ? [...m.lista, ...lista] : lista, cargando: false, fin: lista.length < 40, tipo, error: '' }));
      } catch (e) {
        setMovs((m) => ({ ...m, cargando: false, error: textoError(e) }));
      }
    },
    [cuenta]
  );

  useEffect(() => {
    cargar();
  }, [cargar]);
  useEffect(() => {
    if (tab === 'movimientos') cargarMovs(movs.tipo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ?mov=<id> abre ese comprobante (por ejemplo desde una orden de compra)
  const movParam = params.get('mov');
  useEffect(() => {
    if (!movParam) return;
    rpcStock('stock_comprobante', { p_id: movParam })
      .then(setDetalle)
      .catch((e) => setAviso(textoError(e)));
  }, [movParam]);

  const ex = datos.ex;
  const lugares = datos.lugares;
  const gestiona = !!ex?.gestiona;
  const puedeEditarMateriales = gestiona || yo?.id === profesional.id || (permisos || []).includes('compras');

  const ctx = useMemo(
    () =>
      ex && lugares
        ? {
            depositos: lugares.depositos || [],
            equipo: lugares.equipo || [],
            mio: lugares.mio,
            gestiona,
            veCostos: !!ex.ve_costos,
            materiales: (ex.materiales || []).filter((m) => m.activo !== false),
            trabajos: (ex.lugares || []).filter((l) => l.tipo === 'trabajo'),
          }
        : null,
    [ex, lugares, gestiona]
  );

  const nombreLugar = useMemo(() => Object.fromEntries((ex?.lugares || []).map((l) => [l.id, l])), [ex]);

  if (datos.cargando) return <p className="py-6 text-center text-tinta-400">Cargando stock…</p>;
  if (datos.error) {
    return datos.plan ? (
      <BloqueoPlan plan="business" titulo="Stock de la empresa y del equipo" texto={datos.error} />
    ) : (
      <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{datos.error}</p>
    );
  }

  const materiales = ex.materiales || [];
  const activos = materiales.filter((m) => m.activo !== false);
  const bajos = activos.filter(bajoMinimo);
  const pendientes = ex.pendientes || [];
  const lugaresStock = (ex.lugares || []).filter((l) => l.tipo !== 'trabajo');
  const trabajos = (ex.lugares || []).filter((l) => l.tipo === 'trabajo');
  const raros = trabajos.filter((t) => t.trabajo_estado === 'cancelado' || t.trabajo_estado === 'borrado');
  const fuera = lugaresStock.filter((l) => l.tipo === 'operario' && !l.activo && l.materiales > 0);
  const valor = ex.ve_costos
    ? activos.reduce((s, m) => s + (m.moneda === 'USD' ? 0 : totalMaterial(m) * Number(m.costo || 0)), 0)
    : null;

  function abrirAccion(a, p = {}) {
    setAviso('');
    setPreset(p);
    setAccion(a);
  }

  const listaExistencias = activos
    .map((m) => {
      const enLugar = lugarFiltro ? Number((m.lugares || []).find((l) => l.ubicacion_id === lugarFiltro)?.cantidad || 0) : totalMaterial(m);
      return { ...m, enLugar };
    })
    .filter((m) => (lugarFiltro ? m.enLugar > 0 : true))
    .filter((m) => !q.trim() || q.trim().split(/\s+/).every((p) => norm(`${m.nombre} ${m.codigo || ''} ${m.marca || ''} ${m.categoria || ''}`).includes(norm(p))));

  return (
    <>
      {/* Acciones */}
      {gestiona && (
        <section className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {['ingreso', 'entrega', 'a_trabajo'].map((a) => (
              <button key={a} type="button" onClick={() => abrirAccion(a)} className="tarjeta flex flex-col items-center gap-1.5 p-3 text-center text-xs font-bold hover:bg-navy-850">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-menta-500/15 text-menta-300">
                  <Icon name={ACCIONES[a].icono} className="h-5 w-5" />
                </span>
                {a === 'ingreso' ? 'Ingresar' : a === 'entrega' ? 'Entregar' : 'A un trabajo'}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              ['devolucion_trabajo', 'Devolución de obra'],
              ['conteo', 'Conteo'],
              ['baja', 'Baja'],
              ['devolucion_proveedor', 'Devolver al proveedor'],
            ].map(([a, t]) => (
              <button key={a} type="button" className="chip" onClick={() => abrirAccion(a)}>
                <Icon name={ACCIONES[a].icono} className="h-3.5 w-3.5" /> {t}
              </button>
            ))}
          </div>
        </section>
      )}
      {!gestiona && (
        <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-300">Ves el stock de la empresa. Para moverlo hace falta el permiso Stock.</p>
      )}

      {aviso && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">
            <span className="min-w-0 flex-1">{aviso}</span>
            {ultimoMov && (
              <button
                type="button"
                className="font-bold text-menta-200 underline"
                onClick={async () => {
                  try {
                    setDetalle(await rpcStock('stock_comprobante', { p_id: ultimoMov }));
                  } catch (e) {
                    setAviso(textoError(e));
                  }
                }}
              >
                Ver comprobante y remito
              </button>
            )}
          </p>
        )}

      {/* Verificación */}
      {verif && (
        <div className={`flex items-start gap-2.5 rounded-xl p-3 text-sm ${verif.ok ? 'bg-menta-500/10 text-menta-200' : 'bg-red-500/10 text-red-200'}`}>
          <Icon name="escudo" className={`mt-0.5 h-5 w-5 shrink-0 ${verif.ok ? 'text-menta-300' : 'text-red-300'}`} />
          <div className="min-w-0">
            <b className="block">{verif.ok ? 'Stock en orden' : 'Hay movimientos alterados'}</b>
            <span className="text-xs">
              {verif.ok
                ? `${verif.comprobantes} comprobantes y ${verif.asientos} asientos sellados, sin cambios por fuera de la app.`
                : (verif.errores || []).slice(0, 4).map((e) => e.texto).join(' · ')}
            </span>
          </div>
        </div>
      )}

      {/* Pendientes */}
      {pendientes.length > 0 && (
        <section>
          <h2 className="titulo-seccion mb-2">Por confirmar ({pendientes.length})</h2>
          <ul className="space-y-2">
            {pendientes.map((m) => {
              const meToca = m.destino_tipo === 'deposito' ? gestiona : m.destino_usuario === miId;
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => setDetalle(m)} className={`tarjeta w-full p-3 text-left hover:bg-navy-850 ${meToca ? 'border-amber-400/50' : ''}`}>
                    <span className="flex items-center justify-between gap-2">
                      <b className="text-sm">{tituloMov(m)} · {rutaMov(m)}</b>
                      <span className="shrink-0 text-[11px] text-tinta-400">{numeroMov(m.numero)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-tinta-300">{resumenItems(m.items)}</span>
                    <span className={`mt-1 block text-xs font-semibold ${meToca ? 'text-amber-300' : 'text-tinta-400'}`}>
                      {meToca ? 'Te toca confirmar que llegó' : `Esperando a ${m.destino_tipo === 'operario' ? m.destino : 'el depósito'}`} · {fechaHora(m.creado_en)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Alertas */}
      {(bajos.length > 0 || raros.length > 0 || fuera.length > 0) && (
        <section className="space-y-2">
          {bajos.length > 0 && (
            <details className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm">
              <summary className="cursor-pointer font-bold text-amber-200">
                {bajos.length} {bajos.length === 1 ? 'material está' : 'materiales están'} por debajo del mínimo
              </summary>
              <ul className="mt-2 space-y-1 text-amber-100">
                {bajos.map((m) => (
                  <li key={m.id} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{m.nombre}</span>
                    <span className="shrink-0">
                      {conUnidad(totalMaterial(m), m)} de {conUnidad(m.stock_minimo, m)}
                    </span>
                  </li>
                ))}
              </ul>
              <Link href="/panel/finanzas/compras" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-amber-200">
                Hacer una orden de compra <Icon name="der" className="h-3.5 w-3.5" />
              </Link>
            </details>
          )}
          {fuera.map((l) => (
            <p key={l.id} className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200">
              {l.nombre} ya no está en el equipo y tiene {l.materiales} {l.materiales === 1 ? 'material' : 'materiales'} a su cargo.{' '}
              {gestiona && (
                <button type="button" className="font-bold underline" onClick={() => abrirAccion('entrega', { origen: l.id, destino: lugares?.depositos?.[0]?.id })}>
                  Pasarlos al depósito
                </button>
              )}
            </p>
          ))}
          {raros.map((t) => (
            <p key={t.id} className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200">
              {t.nombre}: el trabajo está {t.trabajo_estado === 'borrado' ? 'borrado' : 'cancelado'} y tiene materiales.{' '}
              {gestiona && t.trabajo_estado !== 'borrado' && (
                <button
                  type="button"
                  className="font-bold underline"
                  onClick={() => abrirAccion('devolucion_trabajo', { trabajo: { tipo: t.orden_id ? 'ticket' : 'turno', id: t.orden_id || t.turno_id, nombre: t.nombre } })}
                >
                  Devolverlos
                </button>
              )}
            </p>
          ))}
        </section>
      )}

      {/* Pestañas */}
      <div className="grid grid-cols-4 rounded-xl bg-navy-900 p-1 text-[13px] font-bold">
        {TABS.map(([v, t]) => (
          <button key={v} type="button" onClick={() => setTab(v)} className={`rounded-lg py-2 ${tab === v ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'existencias' && (
        <section className="space-y-3">
          <div className="flex gap-2">
            <input className="campo" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar material" aria-label="Buscar material" />
            <button
              type="button"
              className="btn btn-sec shrink-0 px-3"
              onClick={() => bajarArchivo(planillaExistencias({ materiales, lugares: ex.lugares || [], veCostos: ex.ve_costos }), `Stock-${new Date().toISOString().slice(0, 10)}.xlsx`, TIPO_XLSX)}
              aria-label="Bajar planilla"
              title="Bajar planilla"
            >
              <Icon name="descargar" />
            </button>
          </div>
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
            <button type="button" className={`chip shrink-0 ${!lugarFiltro ? 'chip-activo' : ''}`} onClick={() => setLugarFiltro('')}>Toda la empresa</button>
            {lugaresStock
              .filter((l) => l.activo || l.materiales > 0)
              .map((l) => (
                <button key={l.id} type="button" className={`chip shrink-0 ${lugarFiltro === l.id ? 'chip-activo' : ''}`} onClick={() => setLugarFiltro(l.id)}>
                  <Icon name={l.tipo === 'deposito' ? 'empresa' : 'perfil'} className="h-3.5 w-3.5" /> {l.nombre}
                </button>
              ))}
          </div>
          {valor !== null && valor > 0 && !lugarFiltro && (
            <p className="text-xs text-tinta-400">
              Valor aproximado del stock (último costo): <b className="text-tinta-200">{pesos(valor)}</b>
            </p>
          )}
          {listaExistencias.length === 0 ? (
            <div className="tarjeta p-5 text-center">
              <p className="font-bold">{activos.length ? 'Nada por acá' : 'Todavía no hay materiales'}</p>
              <p className="mt-1 text-sm text-tinta-400">
                {activos.length
                  ? 'No hay materiales con stock con ese filtro.'
                  : 'Creá tus materiales en la pestaña Materiales, o cargá el stock inicial con Ingresar o Conteo. También entran solos al recibir una orden de compra.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {listaExistencias.map((m) => {
                const desg = desglose(m.enLugar, m);
                const bajo = bajoMinimo(m);
                return (
                  <li key={m.id}>
                    <Link href={`/panel/finanzas/stock/${m.id}`} className="tarjeta block p-3 hover:bg-navy-850">
                      <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <b className="block leading-snug">{m.nombre}</b>
                          <span className="text-[11px] text-tinta-400">{[m.codigo, m.marca, m.categoria].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <b className={`block text-lg leading-tight ${m.enLugar <= 0 ? 'text-tinta-500' : bajo && !lugarFiltro ? 'text-amber-300' : ''}`}>{cant(m.enLugar, m.decimales)}</b>
                          <span className="text-[11px] text-tinta-400">{m.unidad}</span>
                        </span>
                      </div>
                      {desg && <p className="mt-1 text-xs text-tinta-300">{desg}</p>}
                      {!lugarFiltro && (
                        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-tinta-400">
                          {(m.lugares || []).map((l) => (
                            <span key={l.ubicacion_id}>
                              {nombreLugar[l.ubicacion_id]?.nombre || 'Lugar'}: <b className="text-tinta-200">{cant(l.cantidad, m.decimales)}</b>
                            </span>
                          ))}
                          {Number(m.transito) > 0 && <span className="text-amber-300">En camino: {cant(m.transito, m.decimales)}</span>}
                          {Number(m.en_obra) > 0 && <span>En obra: {cant(m.en_obra, m.decimales)}</span>}
                          {bajo && <span className="font-semibold text-amber-300">Bajo el mínimo ({cant(m.stock_minimo, m.decimales)})</span>}
                        </p>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === 'movimientos' && (
        <section className="space-y-3">
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
            {[['', 'Todos'], ...Object.entries(TIPOS_MOV).map(([k, v]) => [k, v.texto])].map(([k, t]) => (
              <button key={k || 'todos'} type="button" className={`chip shrink-0 ${movs.tipo === k ? 'chip-activo' : ''}`} onClick={() => cargarMovs(k)}>
                {t}
              </button>
            ))}
          </div>
          {movs.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{movs.error}</p>}
          {movs.lista.length === 0 && !movs.cargando ? (
            <p className="py-6 text-center text-sm text-tinta-400">Sin movimientos.</p>
          ) : (
            <ul className="space-y-2">
              {movs.lista.map((m) => (
                <FilaMovimiento key={m.id} m={m} onAbrir={() => setDetalle(m)} />
              ))}
            </ul>
          )}
          {movs.cargando && <p className="text-center text-sm text-tinta-400">Cargando…</p>}
          {!movs.cargando && !movs.fin && movs.lista.length > 0 && (
            <button type="button" className="btn btn-sec w-full" onClick={() => cargarMovs(movs.tipo, movs.lista[movs.lista.length - 1].numero)}>
              Ver más
            </button>
          )}
        </section>
      )}

      {tab === 'materiales' && (
        <section className="space-y-3">
          <div className="flex gap-2">
            <input className="campo" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar material" aria-label="Buscar material" />
            {puedeEditarMateriales && (
              <button type="button" className="btn btn-menta shrink-0 px-3" onClick={() => setEditando({ nuevo: true })}>
                <Icon name="mas" /> Material
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-tinta-300">
            <input type="checkbox" className="h-4 w-4 accent-[#2cc79b]" checked={archivados} onChange={(e) => setArchivados(e.target.checked)} /> Ver archivados
          </label>
          <ul className="space-y-2">
            {materiales
              .filter((m) => archivados || m.activo !== false)
              .filter((m) => !q.trim() || norm(`${m.nombre} ${m.codigo || ''} ${m.marca || ''} ${m.categoria || ''}`).includes(norm(q.trim())))
              .map((m) => (
                <li key={m.id} className={`tarjeta flex items-center gap-2 p-3 ${m.activo === false ? 'opacity-60' : ''}`}>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => puedeEditarMateriales && setEditando(m)}>
                    <b className="block leading-snug">
                      {m.nombre} {m.activo === false && <span className="text-xs text-tinta-400">(archivado)</span>}
                    </b>
                    <span className="block text-[11px] text-tinta-400">
                      En {m.unidad}
                      {Number(m.decimales) > 0 ? ` (hasta ${m.decimales} ${Number(m.decimales) === 1 ? 'decimal' : 'decimales'})` : ''}
                      {(m.presentaciones || []).length ? ` · ${m.presentaciones.map((p) => `${p.nombre}`).join(', ')}` : ''}
                      {m.codigo ? ` · ${m.codigo}` : ''}
                      {ex.ve_costos && m.costo !== null && m.costo !== undefined ? ` · ${m.moneda === 'USD' ? 'US$' : '$'} ${Number(m.costo).toLocaleString('es-UY', { maximumFractionDigits: 2 })}/${m.unidad}` : ''}
                    </span>
                  </button>
                  <Link href={`/panel/finanzas/stock/${m.id}`} className="shrink-0 rounded-lg p-2 text-tinta-400 hover:text-tinta-100" aria-label={`Ficha de ${m.nombre}`}>
                    <Icon name="der" className="h-4 w-4" />
                  </Link>
                </li>
              ))}
          </ul>
          {!materiales.length && <p className="py-4 text-center text-sm text-tinta-400">Todavía no hay materiales. Creá el primero.</p>}
        </section>
      )}

      {tab === 'lugares' && (
        <section className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="titulo-seccion">Depósitos</h2>
              {gestiona && (
                <button type="button" className="chip chip-activo" onClick={() => setDeposito({ nombre: '' })}>
                  <Icon name="mas" className="h-3.5 w-3.5" /> Depósito
                </button>
              )}
            </div>
            <ul className="space-y-2">
              {lugaresStock
                .filter((l) => l.tipo === 'deposito')
                .map((l) => (
                  <LugarFila
                    key={l.id}
                    l={l}
                    icono="empresa"
                    extra={l.principal ? 'Principal' : !l.activo ? 'Archivado' : ''}
                    onVer={() => (setLugarFiltro(l.id), setTab('existencias'))}
                    onEditar={gestiona ? () => setDeposito(l) : null}
                  />
                ))}
            </ul>
          </div>
          <div>
            <h2 className="titulo-seccion mb-2">Equipo</h2>
            {lugaresStock.some((l) => l.tipo === 'operario') ? (
              <ul className="space-y-2">
                {lugaresStock
                  .filter((l) => l.tipo === 'operario')
                  .map((l) => (
                    <LugarFila
                      key={l.id}
                      l={l}
                      icono="perfil"
                      extra={!l.activo ? 'Ya no está en el equipo' : ''}
                      onVer={() => (setLugarFiltro(l.id), setTab('existencias'))}
                      onEntregar={gestiona && l.activo ? () => abrirAccion('entrega', { origen: lugares?.depositos?.[0]?.id, destino: l.id }) : null}
                    />
                  ))}
              </ul>
            ) : (
              <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">
                Cuando sumes cuentas a tu empresa (Perfil → Empresa), cada persona tiene su stock para llevar materiales a los trabajos.
              </p>
            )}
          </div>
          <div>
            <h2 className="titulo-seccion mb-2">Trabajos abiertos con materiales</h2>
            {trabajos.length ? (
              <ul className="space-y-2">
                {trabajos.map((t) => (
                  <li key={t.id} className="tarjeta flex items-center gap-2 p-3">
                    <Icon name={t.orden_id ? 'maletin' : 'herramienta'} className="h-5 w-5 shrink-0 text-tinta-400" />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-sm">{t.nombre}</b>
                      <span className="text-[11px] text-tinta-400">
                        {t.materiales} {t.materiales === 1 ? 'material' : 'materiales'} · {estadoTrabajo(t.trabajo_estado)}
                      </span>
                    </span>
                    {gestiona && t.trabajo_estado !== 'borrado' && (
                      <button
                        type="button"
                        className="chip shrink-0"
                        onClick={() => abrirAccion('devolucion_trabajo', { trabajo: { tipo: t.orden_id ? 'ticket' : 'turno', id: t.orden_id || t.turno_id, nombre: t.nombre } })}
                      >
                        Devolver
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">Ningún trabajo abierto tiene materiales sin usar.</p>
            )}
            <p className="mt-2 text-xs text-tinta-500">Lo que queda en un trabajo terminado cuenta como usado en ese trabajo.</p>
          </div>
        </section>
      )}
      <div className="h-2" />

      {ctx && (
        <MovimientoStock
          abierto={!!accion}
          onCerrar={() => setAccion('')}
          onListo={(r) => {
            setAviso(r.mensaje);
            setUltimoMov(r.id || null);
            cargar();
            if (tab === 'movimientos') cargarMovs(movs.tipo);
          }}
          cuenta={cuenta}
          accion={accion || 'entrega'}
          ctx={ctx}
          preset={preset}
        />
      )}

      <DetalleMovimiento
        mov={detalle}
        onCerrar={() => {
          setDetalle(null);
          if (movParam) router.replace('/panel/finanzas/stock');
        }}
        onCambio={() => {
          cargar();
          if (tab === 'movimientos') cargarMovs(movs.tipo);
        }}
        yo={miId}
        gestiona={gestiona}
        empresa={empresa?.nombre || profesional.nombre_publico || ''}
        onVerOtro={async (id) => {
          try {
            setDetalle(await rpcStock('stock_comprobante', { p_id: id }));
          } catch (e) {
            setAviso(textoError(e));
          }
        }}
      />

      <EditorMaterial
        abierto={!!editando}
        onCerrar={() => setEditando(null)}
        cuenta={cuenta}
        material={editando?.nuevo ? null : editando}
        veCostos={!!ex.ve_costos}
        onGuardado={() => cargar()}
      />

      <EditorDeposito deposito={deposito} cuenta={cuenta} onCerrar={() => setDeposito(null)} onGuardado={() => cargar()} />
    </>
  );
}

function LugarFila({ l, icono, extra, onVer, onEditar, onEntregar }) {
  return (
    <li className={`tarjeta flex items-center gap-2 p-3 ${!l.activo && !l.materiales ? 'opacity-60' : ''}`}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onVer}>
        <Icon name={icono} className="h-5 w-5 shrink-0 text-tinta-400" />
        <span className="min-w-0">
          <b className="block truncate text-sm">{l.nombre}</b>
          <span className={`text-[11px] ${!l.activo && l.materiales ? 'text-red-300' : 'text-tinta-400'}`}>
            {l.materiales ? `${l.materiales} ${l.materiales === 1 ? 'material' : 'materiales'}` : 'Sin stock'}
            {extra ? ` · ${extra}` : ''}
          </span>
        </span>
      </button>
      {onEntregar && (
        <button type="button" className="chip shrink-0" onClick={onEntregar}>Entregar</button>
      )}
      {onEditar && (
        <button type="button" className="shrink-0 rounded-lg p-2 text-tinta-400 hover:text-tinta-100" onClick={onEditar} aria-label={`Editar ${l.nombre}`}>
          <Icon name="editar" className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

function EditorDeposito({ deposito, cuenta, onCerrar, onGuardado }) {
  const [nombre, setNombre] = useState('');
  const [estado, setEstado] = useState({ guardando: false, error: '' });
  useEffect(() => {
    setNombre(deposito?.nombre || '');
    setEstado({ guardando: false, error: '' });
  }, [deposito]);
  if (!deposito) return null;
  async function guardar(activo = deposito.activo !== false) {
    setEstado({ guardando: true, error: '' });
    try {
      await rpcStock('stock_deposito', { p_cuenta: cuenta, p_id: deposito.id || null, p_nombre: nombre, p_activo: activo });
      onGuardado();
      onCerrar();
    } catch (e) {
      setEstado({ guardando: false, error: textoError(e) });
    }
  }
  return (
    <Modal
      abierto={!!deposito}
      onCerrar={onCerrar}
      titulo={deposito.id ? 'Depósito' : 'Nuevo depósito'}
      pie={
        <button type="button" className="btn btn-menta w-full" onClick={() => guardar()} disabled={estado.guardando}>
          {estado.guardando ? 'Guardando…' : 'Guardar'}
        </button>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="etiqueta" htmlFor="dep-nom">Nombre</label>
          <input id="dep-nom" className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} placeholder="Ej. Depósito central, Camioneta 1" />
        </div>
        <p className="text-xs text-tinta-400">Un depósito puede ser un local, un galpón o una camioneta que no es de una sola persona.</p>
        {deposito.id && !deposito.principal && (
          <button type="button" className="btn btn-sec w-full" onClick={() => guardar(deposito.activo === false)} disabled={estado.guardando}>
            {deposito.activo === false ? 'Volver a activar' : 'Archivar (tiene que estar vacío)'}
          </button>
        )}
        {estado.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>}
      </div>
    </Modal>
  );
}
