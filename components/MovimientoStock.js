'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import EditorMaterial from './EditorMaterial';
import StockRenglones, { nuevoRenglon } from './StockRenglones';
import { supabase } from '@/lib/supabase';
import {
  MOTIVOS_BAJA, MOTIVOS_DEVOLUCION, MOTIVOS_INGRESO, aBase, estadoTrabajo, normalizarMaterial, numeroMov, renglonesAItems, rpcStock, textoError,
} from '@/lib/stock';

export const ACCIONES = {
  ingreso: { titulo: 'Ingresar al stock', boton: 'Ingresar', modo: 'entrada', icono: 'descargar' },
  entrega: { titulo: 'Entregar o pasar', boton: 'Entregar', modo: 'salida', icono: 'ruta' },
  a_trabajo: { titulo: 'Mandar a un trabajo', boton: 'Mandar al trabajo', modo: 'salida', icono: 'herramienta' },
  devolucion_trabajo: { titulo: 'Devolución de un trabajo', boton: 'Registrar devolución', modo: 'salida', icono: 'repetir' },
  devolucion_proveedor: { titulo: 'Devolver al proveedor', boton: 'Registrar devolución', modo: 'salida', icono: 'empresa' },
  baja: { titulo: 'Dar de baja', boton: 'Dar de baja', modo: 'salida', icono: 'borrar' },
  conteo: { titulo: 'Conteo', boton: 'Guardar conteo', modo: 'conteo', icono: 'check' },
  devolver: { titulo: 'Devolver al depósito', boton: 'Devolver', modo: 'salida', icono: 'repetir' },
  pase: { titulo: 'Pasar a un compañero', boton: 'Pasar', modo: 'salida', icono: 'ruta' },
};

/**
 * Nuevo movimiento de stock.
 * ctx: { depositos, equipo, mio, gestiona, veCostos, materiales (con lugares: [{ubicacion_id, cantidad}]), trabajos }
 * Para una persona del equipo (devolver / pase), ctx.materiales es su stock (con cantidad).
 */
export default function MovimientoStock({ abierto, onCerrar, onListo, cuenta, accion, ctx, preset = {} }) {
  const conf = ACCIONES[accion] || ACCIONES.entrega;
  const operario = accion === 'devolver' || accion === 'pase';
  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  const [trabajo, setTrabajo] = useState(null);
  const [trabajoStock, setTrabajoStock] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [proveedores, setProveedores] = useState([]);
  const [referencia, setReferencia] = useState('');
  const [nota, setNota] = useState('');
  const [renglones, setRenglones] = useState([]);
  const [extras, setExtras] = useState([]);
  const [creando, setCreando] = useState(null);
  const [estado, setEstado] = useState({ guardando: false, error: '' });

  const depositos = (ctx?.depositos || []).filter((d) => d.activo !== false);
  const equipoActivo = (ctx?.equipo || []).filter((p) => p.activo !== false);
  const lugaresStock = [...(ctx?.depositos || []), ...(ctx?.equipo || [])];

  useEffect(() => {
    if (!abierto) return;
    const principal = depositos[0]?.id || '';
    setOrigen(preset.origen || (operario ? ctx?.mio || '' : accion === 'ingreso' ? '' : principal));
    setDestino(preset.destino || (accion === 'ingreso' || accion === 'devolucion_trabajo' || accion === 'devolver' ? principal : ''));
    setTrabajo(preset.trabajo || null);
    setTrabajoStock(null);
    setMotivo(accion === 'ingreso' ? 'compra' : accion === 'baja' ? 'rotura' : accion === 'devolucion_trabajo' ? 'sobrante' : accion === 'conteo' ? 'conteo' : '');
    setProveedor(preset.proveedor || '');
    setReferencia('');
    setNota('');
    setRenglones([]);
    setExtras([]);
    setEstado({ guardando: false, error: '' });
    if (accion === 'ingreso' || accion === 'devolucion_proveedor') {
      supabase
        .from('proveedores')
        .select('id, nombre')
        .eq('activo', true)
        .order('nombre')
        .then(({ data }) => setProveedores(data || []));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, accion]);

  // Materiales de un trabajo (para devolver lo que sobró)
  useEffect(() => {
    if (!abierto || accion !== 'devolucion_trabajo' || !trabajo) return;
    let vivo = true;
    setTrabajoStock(null);
    rpcStock('stock_de_trabajo', { p_cuenta: cuenta, p_tipo: trabajo.tipo, p_trabajo: trabajo.id })
      .then((d) => vivo && setTrabajoStock((d.materiales || []).map(normalizarMaterial)))
      .catch((e) => vivo && setEstado({ guardando: false, error: textoError(e) }));
    return () => {
      vivo = false;
    };
  }, [abierto, accion, trabajo, cuenta]);

  // Catálogo y disponible según de dónde sale
  const { catalogo, disponible, sistema } = useMemo(() => {
    const todos = [...(ctx?.materiales || []).map(normalizarMaterial), ...extras];
    if (conf.modo === 'entrada') return { catalogo: todos, disponible: null, sistema: null };
    if (accion === 'devolucion_trabajo') {
      const lista = trabajoStock || [];
      return { catalogo: lista, disponible: Object.fromEntries(lista.map((m) => [m.id, Number(m.cantidad)])), sistema: null };
    }
    if (operario) return { catalogo: todos, disponible: Object.fromEntries(todos.map((m) => [m.id, Number(m.cantidad || 0)])), sistema: null };
    const enOrigen = (m) => Number((m.lugares || []).find((l) => l.ubicacion_id === origen)?.cantidad || 0);
    const mapa = Object.fromEntries(todos.map((m) => [m.id, enOrigen(m)]));
    if (conf.modo === 'conteo') return { catalogo: todos, disponible: null, sistema: mapa };
    return { catalogo: todos, disponible: mapa, sistema: null };
  }, [ctx, extras, conf.modo, accion, trabajoStock, operario, origen]);

  // Conteo: arranca con lo que el sistema dice que hay en ese lugar
  const ultimoOrigen = useRef('');
  useEffect(() => {
    if (!abierto) {
      ultimoOrigen.current = '';
      return;
    }
    if (accion !== 'conteo' || !origen || ultimoOrigen.current === origen) return;
    ultimoOrigen.current = origen;
    setRenglones(catalogo.filter((m) => (sistema?.[m.id] || 0) > 0).map((m) => nuevoRenglon(m)));
  }, [abierto, accion, origen, catalogo, sistema]);

  function cambiarOrigen(v) {
    setOrigen(v);
    if (accion !== 'conteo') setRenglones([]);
  }

  async function guardar() {
    setEstado({ guardando: true, error: '' });
    const { items, error } = renglonesAItems(renglones, { conteo: conf.modo === 'conteo', conCosto: conf.modo === 'entrada' && ctx?.veCostos });
    const falla = (t) => setEstado({ guardando: false, error: t });
    if (error) return falla(error);
    if (disponible) {
      const suma = {};
      renglones.forEach((r) => {
        suma[r.material.id] = (suma[r.material.id] || 0) + (aBase(r.valor, r.pres, r.material) || 0);
      });
      const falta = renglones.find((r) => suma[r.material.id] > (disponible[r.material.id] || 0) + 1e-9);
      if (falta) return falla(`No alcanza ${falta.material.nombre}: revisá la cantidad.`);
    }
    const c = { p_cuenta: cuenta };
    let llamada;
    try {
      switch (accion) {
        case 'ingreso':
          if (!destino) return falla('Elegí a qué lugar entra.');
          if (motivo === 'otro' && !nota.trim()) return falla('Contá de dónde viene el material.');
          llamada = rpcStock('stock_ingresar', { ...c, p_destino: destino, p_items: items, p_motivo: motivo, p_proveedor: proveedor || null, p_referencia: referencia.trim() || null, p_nota: nota.trim() || null });
          break;
        case 'entrega':
        case 'devolver':
        case 'pase':
          if (!origen || !destino) return falla(accion === 'pase' ? 'Elegí a quién se lo pasás.' : 'Elegí de dónde sale y a dónde va.');
          llamada = rpcStock('stock_transferir', { ...c, p_origen: origen, p_destino: destino, p_items: items, p_nota: nota.trim() || null });
          break;
        case 'a_trabajo':
          if (!origen || !trabajo) return falla('Elegí de dónde salen y el trabajo.');
          llamada = rpcStock('stock_a_trabajo', { ...c, p_origen: origen, p_tipo: trabajo.tipo, p_trabajo: trabajo.id, p_items: items, p_nota: nota.trim() || null });
          break;
        case 'devolucion_trabajo':
          if (!trabajo || !destino) return falla('Elegí el trabajo y a dónde vuelve.');
          llamada = rpcStock('stock_desde_trabajo', { ...c, p_tipo: trabajo.tipo, p_trabajo: trabajo.id, p_destino: destino, p_items: items, p_motivo: motivo, p_nota: nota.trim() || null });
          break;
        case 'devolucion_proveedor':
          if (!origen) return falla('Elegí de dónde sale.');
          if (!motivo.trim()) return falla('Poné el motivo de la devolución.');
          llamada = rpcStock('stock_devolver_proveedor', { ...c, p_origen: origen, p_items: items, p_proveedor: proveedor || null, p_orden_compra: null, p_motivo: motivo.trim(), p_referencia: referencia.trim() || null, p_nota: nota.trim() || null });
          break;
        case 'baja':
          if (!origen) return falla('Elegí de dónde sale.');
          if (motivo === 'otro' && !nota.trim()) return falla('Contá el motivo de la baja.');
          llamada = rpcStock('stock_baja', { ...c, p_origen: origen, p_items: items, p_motivo: motivo, p_nota: nota.trim() || null });
          break;
        case 'conteo':
          if (!origen) return falla('Elegí qué lugar contaste.');
          llamada = rpcStock('stock_conteo', { ...c, p_ubicacion: origen, p_lineas: items, p_motivo: motivo || 'conteo', p_nota: nota.trim() || null });
          break;
        default:
          return falla('Acción no válida');
      }
      const r = await llamada;
      setEstado({ guardando: false, error: '' });
      const dest = lugaresStock.find((l) => l.id === destino);
      onListo?.({
        ...r,
        mensaje:
          r.estado === 'pendiente'
            ? `${numeroMov(r.numero)}: queda pendiente hasta que ${dest?.nombre || 'quien lo recibe'} confirme que lo recibió.`
            : accion === 'conteo'
              ? `${numeroMov(r.numero)}: conteo guardado${r.diferencias ? ` con ${r.diferencias} ${r.diferencias === 1 ? 'diferencia' : 'diferencias'}` : ', todo coincide'}.`
              : `${numeroMov(r.numero)}: listo.`,
      });
      onCerrar();
    } catch (e) {
      setEstado({ guardando: false, error: textoError(e) });
    }
  }

  const lugarSelect = ({ id, valor, onCambio, etiqueta, incluirInactivos = false, excluir = '', solo = null }) => (
    <div>
      <label className="etiqueta" htmlFor={id}>{etiqueta}</label>
      <select id={id} className="campo" value={valor} onChange={(e) => onCambio(e.target.value)}>
        <option value="">Elegí…</option>
        {solo !== 'equipo' && (
          <optgroup label="Depósitos">
            {(ctx?.depositos || [])
              .filter((d) => (incluirInactivos || d.activo !== false) && d.id !== excluir)
              .map((d) => (
                <option key={d.id} value={d.id}>{d.nombre}</option>
              ))}
          </optgroup>
        )}
        {solo !== 'depositos' && (ctx?.equipo || []).length > 0 && (
          <optgroup label="Equipo">
            {(ctx?.equipo || [])
              .filter((p) => (incluirInactivos || p.activo !== false) && p.id !== excluir)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                  {p.activo === false ? ' (ya no está en el equipo)' : ''}
                </option>
              ))}
          </optgroup>
        )}
      </select>
    </div>
  );

  const destinoElegido = lugaresStock.find((l) => l.id === destino);
  const aPersona = destinoElegido && (ctx?.equipo || []).some((p) => p.id === destino) && !destinoElegido.yo;

  return (
    <>
      <Modal
        abierto={abierto}
        onCerrar={() => !estado.guardando && onCerrar()}
        titulo={conf.titulo}
        pie={
          <button type="button" className="btn btn-menta w-full" onClick={guardar} disabled={estado.guardando}>
            {estado.guardando ? 'Guardando…' : conf.boton}
          </button>
        }
      >
        <div className="space-y-4">
          {/* De dónde y a dónde */}
          {accion === 'ingreso' && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(MOTIVOS_INGRESO).map(([v, t]) => (
                  <button key={v} type="button" className={`chip ${motivo === v ? 'chip-activo' : ''}`} onClick={() => setMotivo(v)}>{t}</button>
                ))}
              </div>
              {lugarSelect({ id: 'ms-dest', valor: destino, onCambio: setDestino, etiqueta: 'Entra a' })}
              {motivo === 'compra' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="etiqueta" htmlFor="ms-prov">Proveedor</label>
                    <select id="ms-prov" className="campo" value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
                      <option value="">Sin indicar</option>
                      {proveedores.map((p) => (
                        <option key={p.id} value={p.id}>{p.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="etiqueta" htmlFor="ms-ref">Remito o factura</label>
                    <input id="ms-ref" className="campo" value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={80} placeholder="Opcional" />
                  </div>
                </div>
              )}
              {motivo === 'compra' && <p className="-mt-2 text-xs text-tinta-400">Si la compraste con una orden de compra, recibila desde la orden: queda vinculada.</p>}
            </>
          )}

          {(accion === 'entrega' || accion === 'a_trabajo' || accion === 'devolucion_proveedor' || accion === 'baja' || accion === 'conteo') &&
            lugarSelect({ id: 'ms-orig', valor: origen, onCambio: cambiarOrigen, etiqueta: accion === 'conteo' ? 'Qué lugar contaste' : 'Sale de', incluirInactivos: accion !== 'conteo' })}
          {accion === 'entrega' && (
            <>
              {lugarSelect({ id: 'ms-dest2', valor: destino, onCambio: setDestino, etiqueta: 'Va a', excluir: origen })}
              {aPersona && (
                <p className="-mt-2 text-xs text-amber-200">Queda pendiente hasta que {destinoElegido.nombre} confirme en la app que lo recibió.</p>
              )}
            </>
          )}
          {accion === 'devolver' && (
            <>
              {lugarSelect({ id: 'ms-dev', valor: destino, onCambio: setDestino, etiqueta: 'Vuelve a', solo: 'depositos' })}
              <p className="-mt-2 text-xs text-tinta-400">Queda pendiente hasta que en el depósito confirmen que lo recibieron.</p>
            </>
          )}
          {accion === 'pase' && (
            <>
              <div>
                <label className="etiqueta" htmlFor="ms-comp">A quién se lo pasás</label>
                <select id="ms-comp" className="campo" value={destino} onChange={(e) => setDestino(e.target.value)}>
                  <option value="">Elegí…</option>
                  {equipoActivo.filter((p) => !p.yo).map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </div>
              <p className="-mt-2 text-xs text-tinta-400">Sale de tu stock y queda pendiente hasta que tu compañero confirme que lo recibió.</p>
            </>
          )}

          {(accion === 'a_trabajo' || accion === 'devolucion_trabajo') && (
            <ElegirTrabajo cuenta={cuenta} valor={trabajo} onElegir={(t) => (setTrabajo(t), setRenglones([]))} sugeridos={accion === 'devolucion_trabajo' ? ctx?.trabajos : null} />
          )}
          {accion === 'devolucion_trabajo' && (
            <>
              {lugarSelect({ id: 'ms-vuelve', valor: destino, onCambio: setDestino, etiqueta: 'Vuelve a' })}
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(MOTIVOS_DEVOLUCION).map(([v, t]) => (
                  <button key={v} type="button" className={`chip ${motivo === v ? 'chip-activo' : ''}`} onClick={() => setMotivo(v)}>{t}</button>
                ))}
              </div>
            </>
          )}

          {accion === 'devolucion_proveedor' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="etiqueta" htmlFor="ms-prov2">Proveedor</label>
                  <select id="ms-prov2" className="campo" value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
                    <option value="">Sin indicar</option>
                    {proveedores.map((p) => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="etiqueta" htmlFor="ms-ref2">Nota de crédito / remito</label>
                  <input id="ms-ref2" className="campo" value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={80} placeholder="Opcional" />
                </div>
              </div>
              <div>
                <label className="etiqueta" htmlFor="ms-mot">Motivo</label>
                <input id="ms-mot" className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={40} placeholder="Ej. Vino fallado, se pidió de más" list="ms-motivos" />
                <datalist id="ms-motivos">
                  <option value="Vino fallado" />
                  <option value="Se pidió de más" />
                  <option value="No era lo pedido" />
                </datalist>
              </div>
            </>
          )}

          {accion === 'baja' && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(MOTIVOS_BAJA).map(([v, t]) => (
                <button key={v} type="button" className={`chip ${motivo === v ? 'chip-activo' : ''}`} onClick={() => setMotivo(v)}>{t}</button>
              ))}
            </div>
          )}

          {accion === 'conteo' && (
            <div className="flex flex-wrap gap-1.5">
              {[
                ['conteo', 'Conteo'],
                ['inicial', 'Stock inicial'],
              ].map(([v, t]) => (
                <button key={v} type="button" className={`chip ${motivo === v ? 'chip-activo' : ''}`} onClick={() => setMotivo(v)}>{t}</button>
              ))}
            </div>
          )}

          {/* Renglones */}
          <section>
            <h3 className="titulo-seccion mb-2">Materiales</h3>
            {accion === 'conteo' && origen && (
              <p className="mb-2 text-xs text-tinta-400">Cargá lo que hay de verdad. Lo que dejes vacío no se cuenta. Queda la diferencia con lo que decía el sistema.</p>
            )}
            {(accion === 'ingreso' ? true : accion === 'devolucion_trabajo' ? !!trabajo : !!origen) ? (
              accion === 'devolucion_trabajo' && trabajoStock === null ? (
                <p className="text-sm text-tinta-400">Cargando…</p>
              ) : (
                <StockRenglones
                  key={`${accion}-${origen}-${trabajo?.id || ''}`}
                  catalogo={catalogo}
                  disponible={disponible}
                  sistema={sistema}
                  renglones={renglones}
                  onChange={setRenglones}
                  modo={conf.modo}
                  conCosto={conf.modo === 'entrada' && !!ctx?.veCostos}
                  onCrearMaterial={conf.modo === 'entrada' && ctx?.gestiona ? (nombre) => setCreando({ nombre }) : null}
                  vacio={accion === 'devolucion_trabajo' ? 'Ese trabajo no tiene materiales del stock.' : ''}
                />
              )
            ) : (
              <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">
                {accion === 'devolucion_trabajo' ? 'Elegí el trabajo.' : 'Elegí de dónde sale para ver lo que hay.'}
              </p>
            )}
          </section>

          <div>
            <label className="etiqueta" htmlFor="ms-nota">{accion === 'baja' && motivo === 'otro' ? 'Motivo de la baja' : accion === 'ingreso' && motivo === 'otro' ? 'De dónde viene' : 'Nota (opcional)'}</label>
            <input id="ms-nota" className="campo" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} />
          </div>

          {estado.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>}
        </div>
      </Modal>

      <EditorMaterial
        abierto={!!creando}
        onCerrar={() => setCreando(null)}
        cuenta={cuenta}
        nombreInicial={creando?.nombre || ''}
        veCostos={!!ctx?.veCostos}
        onGuardado={(m) => {
          if (!m) return;
          setExtras((x) => [...x, m]);
          setRenglones((r) => [...r, nuevoRenglon(m)]);
        }}
      />
    </>
  );
}

/** Buscador de tickets y trabajos de la agenda (recientes y abiertos) */
export function ElegirTrabajo({ cuenta, valor, onElegir, sugeridos = null }) {
  const [q, setQ] = useState('');
  const [lista, setLista] = useState(null);
  const [error, setError] = useState('');
  const pedido = useRef(0);

  useEffect(() => {
    if (valor) return undefined;
    const n = ++pedido.current;
    const t = setTimeout(async () => {
      try {
        const d = await rpcStock('stock_trabajos', { p_cuenta: cuenta, p_texto: q.trim() || null });
        if (n === pedido.current) {
          setLista(d || []);
          setError('');
        }
      } catch (e) {
        if (n === pedido.current) setError(textoError(e));
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, cuenta, valor]);

  if (valor) {
    return (
      <div>
        <p className="etiqueta">Trabajo</p>
        <div className="flex items-center gap-2 rounded-xl border border-menta-500/40 bg-menta-500/10 p-2.5">
          <Icon name={valor.tipo === 'ticket' ? 'maletin' : 'herramienta'} className="h-5 w-5 shrink-0 text-menta-300" />
          <span className="min-w-0 flex-1 text-sm">
            <b className="block truncate">{valor.nombre}</b>
            {valor.asignado && <span className="text-xs text-tinta-300">Asignado a {valor.asignado}</span>}
          </span>
          <button type="button" className="chip" onClick={() => onElegir(null)}>Cambiar</button>
        </div>
      </div>
    );
  }

  const conStock = (sugeridos || []).map((s) => ({
    tipo: s.orden_id ? 'ticket' : 'turno',
    id: s.orden_id || s.turno_id,
    nombre: s.nombre,
    estado: s.trabajo_estado,
    conMateriales: true,
  })).filter((s) => s.id);
  const resultados = [...conStock, ...(lista || []).filter((x) => !conStock.some((s) => s.id === x.id))];

  return (
    <div>
      <label className="etiqueta" htmlFor="et-q">Trabajo</label>
      <input id="et-q" className="campo" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por cliente, ticket o empresa" />
      {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
      <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-navy-700">
        {lista === null && !conStock.length ? (
          <li className="p-3 text-sm text-tinta-400">Cargando…</li>
        ) : resultados.length === 0 ? (
          <li className="p-3 text-sm text-tinta-400">No hay trabajos con ese nombre en los últimos 2 meses.</li>
        ) : (
          resultados.map((t) => (
            <li key={`${t.tipo}-${t.id}`} className="border-b border-navy-800 last:border-0">
              <button type="button" onClick={() => onElegir(t)} className="flex w-full items-center gap-2 p-2.5 text-left hover:bg-navy-850">
                <Icon name={t.tipo === 'ticket' ? 'maletin' : 'herramienta'} className="h-4 w-4 shrink-0 text-tinta-400" />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm">{t.nombre}</b>
                  <span className="text-[11px] text-tinta-400">
                    {t.fecha ? `${t.fecha.split('-').reverse().slice(0, 2).join('/')} · ` : ''}
                    {estadoTrabajo(t.estado)}
                    {t.asignado ? ` · ${t.asignado}` : ''}
                    {t.conMateriales ? ' · con materiales' : ''}
                  </span>
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
