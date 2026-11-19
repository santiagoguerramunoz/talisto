'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import DetalleMovimiento from './DetalleMovimiento';
import StockRenglones, { nuevoRenglon } from './StockRenglones';
import { usePanel } from './PanelContext';
import {
  MOTIVOS_DEVOLUCION, conUnidad, desglose, esFaltaSql, fechaHora, normalizarMaterial, numeroMov, renglonesAItems, resumenItems, rpcStock,
  textoError, tituloMov,
} from '@/lib/stock';

const aNumero = (v) => Number(String(v ?? '').replace(',', '.'));

/**
 * Materiales del stock en un trabajo (ticket B2B o trabajo de la agenda). SQL 10 y 25.
 * Lo asignado queda reservado en el trabajo; quien lo hace lo procesa ítem por ítem y queda INSTALADO (sale del stock);
 * lo que no se procesa queda pendiente de devolución y, al devolverlo, el trabajo queda en 0.
 * modo 'operario': usa de su stock, procesa y devuelve a su stock.
 * modo 'gestion': asigna desde cualquier depósito o persona (con lo previsto ya cargado) y devuelve a donde elija.
 */
export default function MaterialesTrabajo({ cuenta, tipo, id, modo = 'operario', onCambio, ocultarSinSql = false, titulo = '' }) {
  const panel = usePanel();
  const yo = panel?.yo?.id || panel?.user?.id;
  const [d, setD] = useState({ cargando: true, error: '', datos: null });
  const [accion, setAccion] = useState(''); // '' | 'usar' | 'devolver' | 'devolver_todo'
  const [renglones, setRenglones] = useState([]);
  const [lugar, setLugar] = useState('');
  const [motivo, setMotivo] = useState('sobrante');
  const [ctx, setCtx] = useState(null);
  const [precargar, setPrecargar] = useState(false);
  const [procesando, setProcesando] = useState(null); // { id, valor }
  const [todo, setTodo] = useState(false); // confirmar "procesar todo"
  const [estado, setEstado] = useState({ guardando: false, error: '', ok: '' });
  const [detalle, setDetalle] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const datos = await rpcStock('stock_de_trabajo', { p_cuenta: cuenta, p_tipo: tipo, p_trabajo: id });
      setD({ cargando: false, error: '', datos, sinSql: false });
    } catch (e) {
      setD({ cargando: false, error: textoError(e), datos: null, sinSql: esFaltaSql(e) });
    }
  }, [cuenta, tipo, id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Quien maneja el stock: lugares y existencias para elegir de dónde sale o a dónde vuelve
  useEffect(() => {
    if (modo !== 'gestion' || !accion || ctx) return;
    Promise.all([rpcStock('stock_lugares', { p_cuenta: cuenta }), rpcStock('stock_existencias', { p_cuenta: cuenta })])
      .then(([l, e]) => {
        setCtx({ depositos: l.depositos || [], equipo: l.equipo || [], materiales: e.materiales || [] });
        setLugar((x) => x || l.depositos?.[0]?.id || '');
      })
      .catch((e) => setEstado({ guardando: false, error: textoError(e), ok: '' }));
  }, [modo, accion, ctx, cuenta]);

  const datos = d.datos;
  const enTrabajo = useMemo(() => (datos?.materiales || []).map(normalizarMaterial), [datos]);
  const procesados = useMemo(() => (datos?.procesados || []).map(normalizarMaterial), [datos]);
  const miStock = useMemo(() => (datos?.mi_stock || []).map(normalizarMaterial), [datos]);
  const todos = useMemo(() => (ctx?.materiales || []).map(normalizarMaterial), [ctx]);

  const { catalogo, disponible } = useMemo(() => {
    if (accion === 'devolver') return { catalogo: enTrabajo, disponible: Object.fromEntries(enTrabajo.map((m) => [m.id, Number(m.cantidad)])) };
    if (modo === 'operario') return { catalogo: miStock, disponible: Object.fromEntries(miStock.map((m) => [m.id, Number(m.cantidad)])) };
    return {
      catalogo: todos,
      disponible: Object.fromEntries(todos.map((m) => [m.id, Number((m.lugares || []).find((l) => l.ubicacion_id === lugar)?.cantidad || 0)])),
    };
  }, [accion, modo, enTrabajo, miStock, todos, lugar]);

  // Lo previsto en el ticket (o el presupuesto) que todavía falta asignar, hasta lo que hay en el lugar elegido
  const faltantes = useCallback(
    (fuente, hay) =>
      (datos?.previstos || [])
        .filter((p) => p.material_id)
        .map((p) => {
          const m = fuente.find((x) => x.id === p.material_id);
          if (!m) return null;
          const ya = Number(enTrabajo.find((x) => x.id === m.id)?.cantidad || 0) + Number(procesados.find((x) => x.id === m.id)?.cantidad || 0);
          const falta = Math.max(0, Number(p.cantidad || 0) - ya);
          const tengo = hay(m);
          return falta > 0 && tengo > 0 ? nuevoRenglon(m, Math.min(falta, tengo)) : null;
        })
        .filter(Boolean),
    [datos, enTrabajo, procesados]
  );

  useEffect(() => {
    if (!precargar || accion !== 'usar' || modo !== 'gestion' || !ctx || !lugar) return;
    setPrecargar(false);
    setRenglones(faltantes(todos, (m) => Number((m.lugares || []).find((l) => l.ubicacion_id === lugar)?.cantidad || 0)));
  }, [precargar, accion, modo, ctx, lugar, todos, faltantes]);

  function abrir(a) {
    setEstado({ guardando: false, error: '', ok: '' });
    setProcesando(null);
    setTodo(false);
    setAccion(a);
    setMotivo(a === 'devolver_todo' && datos?.estado === 'cancelado' ? 'cancelado' : 'sobrante');
    setRenglones([]);
    if (a === 'usar' && modo === 'operario') setRenglones(faltantes(miStock, (m) => Number(m.cantidad)));
    if (a === 'usar' && modo === 'gestion') setPrecargar(true);
    if (a === 'devolver' && modo === 'operario') setLugar(datos?.mio || '');
  }

  async function listo(r, texto) {
    setAccion('');
    setRenglones([]);
    setCtx(null);
    setProcesando(null);
    setTodo(false);
    setEstado({ guardando: false, error: '', ok: `${numeroMov(r.numero)}: ${texto}.`, id: r.id });
    await cargar();
    onCambio?.();
  }

  async function guardar() {
    setEstado({ guardando: true, error: '', ok: '' });
    try {
      if (accion === 'devolver_todo') {
        if (modo === 'gestion' && !lugar) return setEstado({ guardando: false, error: 'Elegí a dónde vuelven.', ok: '' });
        const r = await rpcStock('stock_devolver_todo', {
          p_cuenta: cuenta, p_tipo: tipo, p_trabajo: id, p_destino: modo === 'gestion' ? lugar : null, p_motivo: motivo, p_nota: null,
        });
        return listo(r, 'devolución registrada. El trabajo quedó en 0');
      }
      const { items, error } = renglonesAItems(renglones);
      if (error) return setEstado({ guardando: false, error, ok: '' });
      if (accion === 'usar') {
        const origen = modo === 'operario' ? datos?.mio : lugar;
        if (!origen) return setEstado({ guardando: false, error: 'Elegí de dónde salen.', ok: '' });
        const r = await rpcStock('stock_a_trabajo', { p_cuenta: cuenta, p_origen: origen, p_tipo: tipo, p_trabajo: id, p_items: items, p_nota: null });
        return listo(r, 'materiales asignados al trabajo (quedan reservados)');
      }
      const destino = modo === 'operario' ? datos?.mio : lugar;
      if (!destino) return setEstado({ guardando: false, error: 'Elegí a dónde vuelven.', ok: '' });
      const r = await rpcStock('stock_desde_trabajo', { p_cuenta: cuenta, p_tipo: tipo, p_trabajo: id, p_destino: destino, p_items: items, p_motivo: motivo, p_nota: null });
      return listo(r, 'devolución registrada');
    } catch (e) {
      setEstado({ guardando: false, error: textoError(e), ok: '' });
    }
  }

  async function procesar(items, texto) {
    setEstado({ guardando: true, error: '', ok: '' });
    try {
      const r = await rpcStock('stock_procesar', { p_cuenta: cuenta, p_tipo: tipo, p_trabajo: id, p_items: items, p_nota: null });
      await listo(r, texto);
    } catch (e) {
      setEstado({ guardando: false, error: textoError(e), ok: '' });
    }
  }

  function procesarUno(m) {
    const n = aNumero(procesando?.valor);
    if (!(n > 0)) return setEstado({ guardando: false, error: 'Poné cuánto se instaló.', ok: '' });
    if (n > Number(m.cantidad)) return setEstado({ guardando: false, error: `En el trabajo hay ${conUnidad(m.cantidad, m)}.`, ok: '' });
    procesar([{ material_id: m.id, cantidad: n }], `${conUnidad(n, m)} de ${m.nombre}: instalado`);
  }

  const envolver = (contenido) =>
    titulo ? (
      <section className="rounded-2xl border border-navy-700 p-3">
        <h3 className="titulo-seccion mb-2">{titulo}</h3>
        {contenido}
      </section>
    ) : (
      contenido
    );
  if (d.cargando) return envolver(<p className="text-sm text-tinta-400">Cargando materiales…</p>);
  if (d.error) return ocultarSinSql && d.sinSql ? null : envolver(<p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{d.error}</p>);

  const puede = datos.puede;
  const cerrado = !!datos.cerrado;
  const cancelado = datos.estado === 'cancelado';
  const previstos = datos.previstos || [];
  const movimientos = datos.movimientos || [];
  const lugares = [...(ctx?.depositos || []), ...(ctx?.equipo || [])].filter((l) => l.activo !== false);
  const puedeProcesar = puede && !cancelado;
  const puedeDevolver = modo === 'gestion' ? !!datos.gestiona : true;

  return envolver(
    <div className="space-y-3">
      {/* Pendiente de devolución */}
      {cerrado && enTrabajo.length > 0 && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100">
          <b className="block text-amber-200">Pendiente de devolución</b>
          {cancelado ? 'El trabajo se canceló' : 'El trabajo terminó'} con {enTrabajo.length}{' '}
          {enTrabajo.length === 1 ? 'material sin procesar' : 'materiales sin procesar'}.
          {puedeProcesar && !cancelado ? ' Procesá lo que se instaló y devolvé el resto: así el trabajo queda en 0.' : ' Devolvelo para que el trabajo quede en 0.'}
        </div>
      )}

      {/* Lo reservado (o pendiente de devolución) */}
      {enTrabajo.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-tinta-400">{cerrado ? 'Sin procesar' : 'Reservado para este trabajo'}</p>
            {puedeProcesar && enTrabajo.length > 1 && !todo && (
              <button type="button" className="text-xs font-bold text-menta-300 underline" onClick={() => (setTodo(true), setProcesando(null))}>
                Procesar todo
              </button>
            )}
          </div>
          {todo && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-menta-500/10 p-2.5 text-sm text-menta-100">
              <span className="min-w-0 flex-1">¿Se instalaron los {enTrabajo.length} materiales completos?</span>
              <button
                type="button"
                className="btn btn-menta px-3 py-1.5 text-sm"
                disabled={estado.guardando}
                onClick={() => procesar(enTrabajo.map((m) => ({ material_id: m.id, cantidad: Number(m.cantidad) })), 'todo instalado')}
              >
                Sí, procesar
              </button>
              <button type="button" className="text-xs text-tinta-300 underline" onClick={() => setTodo(false)}>
                No
              </button>
            </div>
          )}
          <ul className="divide-y divide-navy-800 rounded-xl border border-navy-700">
            {enTrabajo.map((m) => (
              <li key={m.id} className="p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <b className="block text-sm leading-snug">{m.nombre}</b>
                    {m.codigo && <span className="text-[11px] text-tinta-400">{m.codigo}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-right">
                      <b className="block text-sm">{conUnidad(m.cantidad, m)}</b>
                      {desglose(m.cantidad, m) && <span className="text-[11px] text-tinta-400">{desglose(m.cantidad, m)}</span>}
                    </span>
                    {puedeProcesar && procesando?.id !== m.id && (
                      <button
                        type="button"
                        className="chip"
                        onClick={() => (setProcesando({ id: m.id, valor: String(Number(m.cantidad)) }), setTodo(false), setEstado({ guardando: false, error: '', ok: '' }))}
                      >
                        <Icon name="check" className="h-3.5 w-3.5" /> Procesar
                      </button>
                    )}
                  </span>
                </div>
                {procesando?.id === m.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-navy-850 p-2">
                    <label className="text-xs text-tinta-300" htmlFor={`proc-${m.id}`}>
                      ¿Cuánto se instaló?
                    </label>
                    <input
                      id={`proc-${m.id}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max={Number(m.cantidad)}
                      step={m.decimales ? 10 ** -m.decimales : 1}
                      className="campo w-24 py-1.5"
                      value={procesando.valor}
                      onChange={(e) => setProcesando({ id: m.id, valor: e.target.value })}
                    />
                    <span className="text-xs text-tinta-400">{m.unidad}</span>
                    <button type="button" className="btn btn-menta ml-auto px-3 py-1.5 text-sm" disabled={estado.guardando} onClick={() => procesarUno(m)}>
                      {estado.guardando ? 'Guardando…' : 'Procesar'}
                    </button>
                    <button type="button" className="text-xs text-tinta-400 underline" onClick={() => setProcesando(null)}>
                      Cancelar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {!cerrado && puedeProcesar && (
            <p className="mt-1.5 text-[11px] text-tinta-400">Procesá cada material a medida que lo instalás: queda como INSTALADO. Lo que no se procese queda pendiente de devolución al terminar.</p>
          )}
        </div>
      )}

      {/* Lo procesado: INSTALADO */}
      {procesados.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-tinta-400">Instalado</p>
          <ul className="divide-y divide-navy-800 rounded-xl border border-menta-500/30 bg-menta-500/5">
            {procesados.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 p-2.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Icon name="check" className="h-4 w-4 shrink-0 text-menta-300" />
                  <span className="min-w-0 truncate">{m.nombre}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <b>{conUnidad(m.cantidad, m)}</b>
                  <span className="rounded-full bg-menta-500/15 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-menta-300">INSTALADO</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!enTrabajo.length && !procesados.length && (
        <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">Todavía no se asignaron materiales del stock a este trabajo.</p>
      )}
      {!enTrabajo.length && procesados.length > 0 && cerrado && (
        <p className="text-xs font-semibold text-menta-300">Trabajo en 0: todo quedó instalado o se devolvió.</p>
      )}

      {previstos.length > 0 && (
        <div className="rounded-xl bg-navy-850 p-2.5 text-xs text-tinta-300">
          <b className="mb-1 block text-tinta-200">Previsto en el ticket</b>
          {previstos.map((p, k) => {
            const ya = p.material_id
              ? Number(enTrabajo.find((m) => m.id === p.material_id)?.cantidad || 0) + Number(procesados.find((m) => m.id === p.material_id)?.cantidad || 0)
              : 0;
            const mio = p.material_id && modo === 'operario' ? miStock.find((m) => m.id === p.material_id) : null;
            return (
              <p key={k} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  {p.item} {p.cantidad ? `· ${Number(p.cantidad).toLocaleString('es-UY')} ${p.unidad || ''}` : ''}
                </span>
                <span className="shrink-0 text-tinta-400">
                  {!p.material_id ? 'no está en el stock' : ya > 0 ? `asignado ${Number(ya).toLocaleString('es-UY')}` : mio ? `tenés ${Number(mio.cantidad).toLocaleString('es-UY')}` : 'sin asignar'}
                </span>
              </p>
            );
          })}
        </div>
      )}

      {estado.ok && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">
          <span className="min-w-0 flex-1">{estado.ok}</span>
          {estado.id && (
            <button
              type="button"
              className="font-bold text-menta-200 underline"
              onClick={async () => {
                try {
                  setDetalle(await rpcStock('stock_comprobante', { p_id: estado.id }));
                } catch (e) {
                  setEstado((x) => ({ ...x, error: textoError(e) }));
                }
              }}
            >
              Ver comprobante
            </button>
          )}
        </p>
      )}
      {estado.error && !accion && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>}

      {!puede && modo === 'operario' && !cancelado && (
        <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">Este trabajo se cerró hace más de 2 días: para corregir materiales, avisale a quien maneja el stock.</p>
      )}

      {/* Acciones */}
      {accion ? (
        <section className="space-y-3 rounded-2xl border border-navy-700 p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold">
              {accion === 'usar' ? (modo === 'operario' ? 'Usar de mi stock' : 'Asignar materiales') : accion === 'devolver_todo' ? 'Devolver lo que no se procesó' : 'Devolver una parte'}
            </h3>
            <button type="button" className="rounded-lg p-1.5 text-tinta-400 hover:text-tinta-100" onClick={() => setAccion('')} aria-label="Cerrar">
              <Icon name="cerrar" className="h-4 w-4" />
            </button>
          </div>
          {modo === 'gestion' && (
            <div>
              <label className="etiqueta" htmlFor="mt-lugar">{accion === 'usar' ? 'Salen de' : 'Vuelven a'}</label>
              <select
                id="mt-lugar"
                className="campo"
                value={lugar}
                onChange={(e) => (setLugar(e.target.value), accion === 'usar' && (setRenglones([]), setPrecargar(true)))}
              >
                <option value="">Elegí…</option>
                {lugares.map((l) => (
                  <option key={l.id} value={l.id}>{l.nombre}</option>
                ))}
              </select>
            </div>
          )}
          {modo === 'gestion' && accion === 'usar' && previstos.some((p) => p.material_id) && (
            <p className="text-xs text-tinta-400">Ya cargamos lo previsto que falta asignar, según lo que hay en ese lugar. Quedan reservados para este trabajo.</p>
          )}
          {modo === 'operario' && accion !== 'usar' && <p className="text-xs text-tinta-400">Vuelve a tu stock. Después lo entregás en el depósito.</p>}
          {accion !== 'usar' && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(MOTIVOS_DEVOLUCION).map(([v, t]) => (
                <button key={v} type="button" className={`chip ${motivo === v ? 'chip-activo' : ''}`} onClick={() => setMotivo(v)}>{t}</button>
              ))}
            </div>
          )}
          {accion === 'devolver_todo' ? (
            <ul className="space-y-1 rounded-xl bg-navy-850 p-2.5 text-sm">
              {enTrabajo.map((m) => (
                <li key={m.id} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">{m.nombre}</span>
                  <b className="shrink-0">{conUnidad(m.cantidad, m)}</b>
                </li>
              ))}
            </ul>
          ) : modo === 'gestion' && accion === 'usar' && !ctx ? (
            <p className="text-sm text-tinta-400">Cargando…</p>
          ) : modo === 'gestion' && accion === 'usar' && !lugar ? (
            <p className="text-sm text-tinta-400">Elegí de dónde salen.</p>
          ) : (
            <StockRenglones
              key={`${accion}-${lugar}`}
              catalogo={catalogo}
              disponible={disponible}
              renglones={renglones}
              onChange={setRenglones}
              modo="salida"
              vacio={accion === 'devolver' ? 'No hay materiales en este trabajo.' : modo === 'operario' ? 'No tenés materiales en tu stock. Pedile al depósito que te entregue.' : ''}
            />
          )}
          {estado.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>}
          <button
            type="button"
            className="btn btn-menta w-full"
            onClick={guardar}
            disabled={estado.guardando || (accion !== 'devolver_todo' && !renglones.length) || (accion === 'devolver_todo' && modo === 'gestion' && !ctx)}
          >
            {estado.guardando ? 'Guardando…' : accion === 'usar' ? 'Asignar al trabajo' : accion === 'devolver_todo' ? 'Devolver todo y dejar el trabajo en 0' : 'Registrar devolución'}
          </button>
        </section>
      ) : (
        <div className="space-y-2">
          {enTrabajo.length > 0 && puedeDevolver && (
            <button type="button" className={`btn w-full py-2.5 text-sm ${cerrado ? 'btn-menta' : 'btn-sec'}`} onClick={() => abrir('devolver_todo')}>
              <Icon name="repetir" className="h-4 w-4" /> {cerrado ? 'Gestionar la devolución' : 'Devolver todo lo que no se procesó'}
            </button>
          )}
          {(puede || modo === 'gestion') && !cancelado && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-sec py-2.5 text-sm" onClick={() => abrir('usar')} disabled={modo === 'operario' && !miStock.length}>
                <Icon name="mas" className="h-4 w-4" /> {modo === 'operario' ? 'Usar de mi stock' : 'Asignar materiales'}
              </button>
              <button
                type="button"
                className="btn btn-sec py-2.5 text-sm"
                onClick={() => abrir('devolver')}
                disabled={!enTrabajo.length || (modo === 'operario' && !datos.mio) || !puedeDevolver}
              >
                <Icon name="repetir" className="h-4 w-4" /> Devolver una parte
              </button>
            </div>
          )}
        </div>
      )}
      {modo === 'operario' && !miStock.length && !accion && puede && !enTrabajo.length && (
        <p className="text-xs text-tinta-400">Stock te asigna los materiales del trabajo (o los pedís). Si te entregan a vos, los confirmás en Mi stock y los usás acá.</p>
      )}

      {/* Comprobantes del trabajo */}
      {movimientos.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-tinta-400">Comprobantes</p>
          <ul className="space-y-1.5">
            {movimientos.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => setDetalle(m)} className="w-full rounded-xl bg-navy-850 p-2.5 text-left hover:bg-navy-800">
                  <span className="flex items-center justify-between gap-2 text-sm">
                    <b className="min-w-0 truncate">
                      {tituloMov(m)} {m.anulado_por && <span className="text-red-300">(anulado)</span>}
                    </b>
                    <span className="shrink-0 text-[11px] text-tinta-400">{numeroMov(m.numero)}</span>
                  </span>
                  <span className="block truncate text-[11px] text-tinta-400">
                    {fechaHora(m.creado_en)}
                    {m.por ? ` · ${m.por}` : ''} · {resumenItems(m.items, 2)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DetalleMovimiento
        mov={detalle}
        onCerrar={() => setDetalle(null)}
        onCambio={() => {
          cargar();
          onCambio?.();
        }}
        yo={yo}
        gestiona={!!datos.gestiona}
        empresa={panel?.empresa?.nombre || panel?.profesional?.nombre_publico || ''}
        onVerOtro={async (otroId) => {
          try {
            setDetalle(await rpcStock('stock_comprobante', { p_id: otroId }));
          } catch {
            /* sin acceso */
          }
        }}
      />
    </div>
  );
}
