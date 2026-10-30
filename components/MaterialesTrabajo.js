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

/**
 * Materiales del stock en un trabajo (ticket B2B o trabajo de la agenda).
 * modo 'operario': usa de su stock y devuelve lo que sobró a su stock.
 * modo 'gestion': manda desde cualquier depósito o persona y devuelve a donde elija.
 */
export default function MaterialesTrabajo({ cuenta, tipo, id, modo = 'operario', onCambio, ocultarSinSql = false, titulo = '' }) {
  const panel = usePanel();
  const yo = panel?.yo?.id || panel?.user?.id;
  const [d, setD] = useState({ cargando: true, error: '', datos: null });
  const [accion, setAccion] = useState('');
  const [renglones, setRenglones] = useState([]);
  const [lugar, setLugar] = useState('');
  const [motivo, setMotivo] = useState('sobrante');
  const [ctx, setCtx] = useState(null);
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

  // Quien maneja el stock: lugares y existencias para elegir de dónde sale
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
  const miStock = useMemo(() => (datos?.mi_stock || []).map(normalizarMaterial), [datos]);

  const { catalogo, disponible } = useMemo(() => {
    if (accion === 'devolver') return { catalogo: enTrabajo, disponible: Object.fromEntries(enTrabajo.map((m) => [m.id, Number(m.cantidad)])) };
    if (modo === 'operario') return { catalogo: miStock, disponible: Object.fromEntries(miStock.map((m) => [m.id, Number(m.cantidad)])) };
    const todos = (ctx?.materiales || []).map(normalizarMaterial);
    return {
      catalogo: todos,
      disponible: Object.fromEntries(todos.map((m) => [m.id, Number((m.lugares || []).find((l) => l.ubicacion_id === lugar)?.cantidad || 0)])),
    };
  }, [accion, modo, enTrabajo, miStock, ctx, lugar]);

  function abrir(a) {
    setEstado({ guardando: false, error: '', ok: '' });
    setAccion(a);
    setMotivo('sobrante');
    if (a === 'usar' && modo === 'operario') {
      // arranca con lo previsto en el ticket que tengo en mi stock
      const previstos = (datos?.previstos || []).filter((p) => p.material_id);
      setRenglones(
        previstos
          .map((p) => {
            const m = miStock.find((x) => x.id === p.material_id);
            if (!m) return null;
            const ya = Number(enTrabajo.find((x) => x.id === m.id)?.cantidad || 0);
            const falta = Math.max(0, Number(p.cantidad || 0) - ya);
            return falta > 0 ? nuevoRenglon(m, Math.min(falta, Number(m.cantidad))) : null;
          })
          .filter(Boolean)
      );
    } else setRenglones([]);
    if (a === 'devolver' && modo === 'operario') setLugar(datos?.mio || '');
  }

  async function guardar() {
    setEstado({ guardando: true, error: '', ok: '' });
    const { items, error } = renglonesAItems(renglones);
    if (error) return setEstado({ guardando: false, error, ok: '' });
    const origenOperario = datos?.mio;
    try {
      let r;
      if (accion === 'usar') {
        const origen = modo === 'operario' ? origenOperario : lugar;
        if (!origen) return setEstado({ guardando: false, error: 'Elegí de dónde salen.', ok: '' });
        r = await rpcStock('stock_a_trabajo', { p_cuenta: cuenta, p_origen: origen, p_tipo: tipo, p_trabajo: id, p_items: items, p_nota: null });
      } else {
        const destino = modo === 'operario' ? origenOperario : lugar;
        if (!destino) return setEstado({ guardando: false, error: 'Elegí a dónde vuelven.', ok: '' });
        r = await rpcStock('stock_desde_trabajo', { p_cuenta: cuenta, p_tipo: tipo, p_trabajo: id, p_destino: destino, p_items: items, p_motivo: motivo, p_nota: null });
      }
      setAccion('');
      setRenglones([]);
      setCtx(null);
      setEstado({ guardando: false, error: '', ok: `${numeroMov(r.numero)}: ${accion === 'usar' ? 'materiales cargados en el trabajo' : 'devolución registrada'}.` });
      await cargar();
      onCambio?.();
    } catch (e) {
      setEstado({ guardando: false, error: textoError(e), ok: '' });
    }
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
  const previstos = datos.previstos || [];
  const movimientos = datos.movimientos || [];
  const lugares = [...(ctx?.depositos || []), ...(ctx?.equipo || [])].filter((l) => l.activo !== false);

  return envolver(
    <div className="space-y-3">
      {/* Lo que hay en el trabajo */}
      {enTrabajo.length ? (
        <ul className="divide-y divide-navy-800 rounded-xl border border-navy-700">
          {enTrabajo.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-2 p-2.5">
              <span className="min-w-0">
                <b className="block text-sm leading-snug">{m.nombre}</b>
                {m.codigo && <span className="text-[11px] text-tinta-400">{m.codigo}</span>}
              </span>
              <span className="shrink-0 text-right">
                <b className="block text-sm">{conUnidad(m.cantidad, m)}</b>
                {desglose(m.cantidad, m) && <span className="text-[11px] text-tinta-400">{desglose(m.cantidad, m)}</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">Todavía no se usaron materiales del stock en este trabajo.</p>
      )}

      {previstos.length > 0 && (
        <div className="rounded-xl bg-navy-850 p-2.5 text-xs text-tinta-300">
          <b className="mb-1 block text-tinta-200">Previsto en el ticket</b>
          {previstos.map((p, k) => {
            const ya = p.material_id ? Number(enTrabajo.find((m) => m.id === p.material_id)?.cantidad || 0) : 0;
            const mio = p.material_id && modo === 'operario' ? miStock.find((m) => m.id === p.material_id) : null;
            return (
              <p key={k} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  {p.item} {p.cantidad ? `· ${Number(p.cantidad).toLocaleString('es-UY')} ${p.unidad || ''}` : ''}
                </span>
                <span className="shrink-0 text-tinta-400">
                  {!p.material_id ? 'no está en el stock' : ya > 0 ? `cargado ${Number(ya).toLocaleString('es-UY')}` : mio ? `tenés ${Number(mio.cantidad).toLocaleString('es-UY')}` : modo === 'operario' ? 'no tenés' : ''}
                </span>
              </p>
            );
          })}
        </div>
      )}

      {estado.ok && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{estado.ok}</p>}

      {!puede && modo === 'operario' && (
        <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">Este trabajo se cerró hace más de 2 días: para corregir materiales, avisale a quien maneja el stock.</p>
      )}

      {/* Acciones */}
      {accion ? (
        <section className="space-y-3 rounded-2xl border border-navy-700 p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold">{accion === 'usar' ? (modo === 'operario' ? 'Usar de mi stock' : 'Mandar materiales') : 'Devolver lo que sobró'}</h3>
            <button type="button" className="rounded-lg p-1.5 text-tinta-400 hover:text-tinta-100" onClick={() => setAccion('')} aria-label="Cerrar">
              <Icon name="cerrar" className="h-4 w-4" />
            </button>
          </div>
          {modo === 'gestion' && (
            <div>
              <label className="etiqueta" htmlFor="mt-lugar">{accion === 'usar' ? 'Salen de' : 'Vuelven a'}</label>
              <select id="mt-lugar" className="campo" value={lugar} onChange={(e) => (setLugar(e.target.value), accion === 'usar' && setRenglones([]))}>
                <option value="">Elegí…</option>
                {lugares.map((l) => (
                  <option key={l.id} value={l.id}>{l.nombre}</option>
                ))}
              </select>
            </div>
          )}
          {modo === 'operario' && accion === 'devolver' && <p className="text-xs text-tinta-400">Vuelve a tu stock. Después, si no lo vas a usar, lo devolvés al depósito.</p>}
          {accion === 'devolver' && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(MOTIVOS_DEVOLUCION).map(([v, t]) => (
                <button key={v} type="button" className={`chip ${motivo === v ? 'chip-activo' : ''}`} onClick={() => setMotivo(v)}>{t}</button>
              ))}
            </div>
          )}
          {modo === 'gestion' && accion === 'usar' && !ctx ? (
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
          <button type="button" className="btn btn-menta w-full" onClick={guardar} disabled={estado.guardando || !renglones.length}>
            {estado.guardando ? 'Guardando…' : accion === 'usar' ? 'Cargar en el trabajo' : 'Registrar devolución'}
          </button>
        </section>
      ) : (
        (puede || modo === 'gestion') && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-menta py-2.5 text-sm" onClick={() => abrir('usar')} disabled={modo === 'operario' && !miStock.length}>
              <Icon name="mas" className="h-4 w-4" /> {modo === 'operario' ? 'Usar de mi stock' : 'Mandar materiales'}
            </button>
            <button type="button" className="btn btn-sec py-2.5 text-sm" onClick={() => abrir('devolver')} disabled={!enTrabajo.length}>
              <Icon name="repetir" className="h-4 w-4" /> Devolver
            </button>
          </div>
        )
      )}
      {modo === 'operario' && !miStock.length && !accion && puede && (
        <p className="text-xs text-tinta-400">No tenés materiales a tu cargo. Cuando el depósito te entregue, los confirmás en Mi stock y los usás acá.</p>
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
