'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { numero } from '@/lib/precios';
import {
  ESTADOS_MOV, MOTIVOS_DEVOLUCION, TIPOS_MOV, cant, conUnidad, desglose, errorCantidad, fechaHora, numeroMov, rpcStock, rutaMov,
  textoComprobante, textoError, textoRenglon, tituloMov,
} from '@/lib/stock';
import { numeroOrden } from '@/lib/proveedores';
import { TIENE_REMITO, bajarLogo, crearPdfRemito, nombreArchivoRemito, numeroRemito } from '@/lib/remitoPdf';
import { supabase } from '@/lib/supabase';
import { usePanel } from './PanelContext';

/**
 * Comprobante de stock con lo que se puede hacer según quién lo mira:
 * quien recibe confirma (todo, distinto o rechaza) · quien lo mandó cancela · quien maneja el stock anula.
 */
export default function DetalleMovimiento({ mov: movimiento, onCerrar, onCambio, yo, gestiona = false, empresa = '', onVerOtro }) {
  const [mov, setMov] = useState(movimiento);
  const [modo, setModo] = useState('');
  const [recibido, setRecibido] = useState({});
  const [nota, setNota] = useState('');
  const [estado, setEstado] = useState({ ocupado: false, error: '', ok: '' });
  const [armando, setArmando] = useState('');
  const panel = usePanel();
  const cuenta = panel?.profesional?.id;

  useEffect(() => {
    setMov(movimiento);
    setModo('');
    setNota('');
    setEstado({ ocupado: false, error: '', ok: '' });
    setRecibido(Object.fromEntries((movimiento?.items || []).map((i) => [i.n, String(Number(i.cantidad))])));
  }, [movimiento]);

  if (!mov) return null;

  const esMioRecibir = mov.destino_tipo === 'operario' ? mov.destino_usuario === yo : mov.destino_tipo === 'deposito' && gestiona;
  const pendiente = mov.estado === 'pendiente';
  const puedeResponder = pendiente && esMioRecibir;
  const puedeCancelar = pendiente && (mov.creado_por === yo || mov.origen_usuario === yo || gestiona);
  const puedeAnular = gestiona && mov.estado === 'hecho' && mov.tipo !== 'anulacion' && !mov.anulado_por;
  const est = ESTADOS_MOV[mov.estado] || ESTADOS_MOV.hecho;
  const tipo = TIPOS_MOV[mov.tipo] || TIPOS_MOV.ingreso;

  async function hacer(fn, ok) {
    setEstado({ ocupado: true, error: '', ok: '' });
    try {
      await fn();
      try {
        setMov(await rpcStock('stock_comprobante', { p_id: mov.id }));
      } catch {
        /* se ve al recargar */
      }
      setEstado({ ocupado: false, error: '', ok });
      setNota('');
      setModo('');
      onCambio?.();
    } catch (e) {
      setEstado({ ocupado: false, error: textoError(e), ok: '' });
    }
  }

  const aceptarTodo = () => hacer(() => rpcStock('stock_responder', { p_movimiento: mov.id, p_aceptar: true, p_recibido: null, p_nota: nota.trim() || null }), '¡Recibido! Ya está en el stock.');
  function aceptarDistinto() {
    const rec = {};
    for (const i of mov.items) {
      const v = numero(recibido[i.n]);
      const err = v === 0 ? '' : errorCantidad(v, i);
      if (v === null || v < 0 || v > Number(i.cantidad) + 1e-9 || err) {
        return setEstado({ ocupado: false, error: `${i.nombre}: poné entre 0 y ${conUnidad(i.cantidad, i)}${err ? ` (${err.toLowerCase()})` : ''}.`, ok: '' });
      }
      rec[i.n] = v;
    }
    if (!nota.trim()) return setEstado({ ocupado: false, error: 'Contá qué pasó con lo que no llegó.', ok: '' });
    return hacer(() => rpcStock('stock_responder', { p_movimiento: mov.id, p_aceptar: true, p_recibido: rec, p_nota: nota.trim() }), 'Listo: entró lo que llegó y el resto volvió al origen.');
  }
  const rechazar = () => {
    if (!nota.trim()) return setEstado({ ocupado: false, error: 'Contá por qué lo rechazás.', ok: '' });
    return hacer(() => rpcStock('stock_responder', { p_movimiento: mov.id, p_aceptar: false, p_recibido: null, p_nota: nota.trim() }), 'Rechazado: volvió al origen.');
  };
  const cancelar = () => hacer(() => rpcStock('stock_cancelar', { p_movimiento: mov.id, p_nota: nota.trim() || null }), 'Cancelado: volvió al origen.');
  const anular = () => {
    if (!nota.trim()) return setEstado({ ocupado: false, error: 'Poné el motivo de la anulación.', ok: '' });
    return hacer(() => rpcStock('stock_anular', { p_movimiento: mov.id, p_motivo: nota.trim() }), 'Anulado. Quedan el original y su anulación.');
  };

  async function compartir() {
    const texto = textoComprobante(mov, empresa);
    try {
      if (navigator.share) await navigator.share({ text: texto, title: `${tituloMov(mov)} ${numeroMov(mov.numero)}` });
      else {
        await navigator.clipboard.writeText(texto);
        setEstado((e) => ({ ...e, ok: 'Copiado: pegalo donde quieras.' }));
      }
    } catch {
      /* cancelado */
    }
  }

  // Remito en PDF: número único, datos del negocio y lugar para firmas
  const conRemito = !!mov.remito && TIENE_REMITO.includes(mov.tipo);
  async function armarRemito() {
    let negocio = { nombre: empresa };
    if (cuenta) {
      const { data } = await supabase.rpc('negocio_para_documentos', { p_cuenta: cuenta });
      if (data) negocio = data;
    }
    const logo = await bajarLogo(negocio.logo_url);
    const bytes = await crearPdfRemito({ mov: { ...mov, motivoTexto: MOTIVOS_DEVOLUCION[mov.motivo] }, negocio, logo });
    return new File([bytes], nombreArchivoRemito(mov), { type: 'application/pdf' });
  }
  function bajar(archivo) {
    const url = URL.createObjectURL(archivo);
    const a = document.createElement('a');
    a.href = url;
    a.download = archivo.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function remito(accion) {
    setEstado((e) => ({ ...e, error: '', ok: '' }));
    const movil = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    // En el celular se abre el PDF en otra pestaña (desde ahí se imprime); la pestaña se abre ya para que no la bloqueen
    const ventana = accion === 'imprimir' && movil ? window.open('', '_blank') : null;
    setArmando(accion);
    try {
      const archivo = await armarRemito();
      if (accion === 'descargar') bajar(archivo);
      else if (accion === 'compartir') {
        if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [archivo] })) {
          await navigator.share({ files: [archivo], title: archivo.name, text: `Remito Nº ${numeroRemito(mov.remito)}${empresa ? ` · ${empresa}` : ''}` });
        } else {
          bajar(archivo);
          setEstado((e) => ({ ...e, ok: 'Se bajó el PDF: adjuntalo donde quieras mandarlo.' }));
        }
      } else if (accion === 'imprimir') {
        const url = URL.createObjectURL(archivo);
        if (ventana) ventana.location.href = url;
        else {
          const marco = document.createElement('iframe');
          marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
          marco.src = url;
          marco.onload = () => {
            try {
              marco.contentWindow.focus();
              marco.contentWindow.print();
            } catch {
              window.open(url, '_blank');
            }
          };
          document.body.appendChild(marco);
          setTimeout(() => {
            marco.remove();
            URL.revokeObjectURL(url);
          }, 120000);
        }
      }
    } catch (e) {
      ventana?.close();
      if (e?.name !== 'AbortError' && e?.name !== 'NotAllowedError') setEstado((x) => ({ ...x, error: `No se pudo armar el remito: ${e?.message || e}` }));
    }
    setArmando('');
  }
  const linkMail = conRemito
    ? `mailto:?subject=${encodeURIComponent(`Remito Nº ${numeroRemito(mov.remito)}${empresa ? ` · ${empresa}` : ''}`)}&body=${encodeURIComponent(textoComprobante(mov, empresa))}`
    : '';

  const items = mov.items || [];
  return (
    <Modal
      abierto={!!mov}
      onCerrar={() => !estado.ocupado && onCerrar()}
      titulo={`${tituloMov(mov)}`}
      pie={
        puedeResponder && !modo ? (
          <div className="space-y-2">
            <button type="button" className="btn btn-menta w-full" onClick={aceptarTodo} disabled={estado.ocupado}>
              <Icon name="check" /> {estado.ocupado ? 'Guardando…' : 'Recibí todo'}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-sec" onClick={() => setModo('distinto')} disabled={estado.ocupado}>Llegó distinto</button>
              <button type="button" className="btn btn-sec text-red-300" onClick={() => setModo('rechazar')} disabled={estado.ocupado}>Rechazar</button>
            </div>
          </div>
        ) : modo ? (
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <button type="button" className="btn btn-sec" onClick={() => (setModo(''), setEstado((e) => ({ ...e, error: '' })))} disabled={estado.ocupado}>Volver</button>
            <button
              type="button"
              className={modo === 'distinto' ? 'btn btn-menta' : 'btn btn-peligro'}
              disabled={estado.ocupado}
              onClick={modo === 'distinto' ? aceptarDistinto : modo === 'rechazar' ? rechazar : modo === 'cancelar' ? cancelar : anular}
            >
              {estado.ocupado ? 'Guardando…' : modo === 'distinto' ? 'Confirmar lo que llegó' : modo === 'rechazar' ? 'Rechazar' : modo === 'cancelar' ? 'Cancelar el envío' : 'Anular comprobante'}
            </button>
          </div>
        ) : null
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-menta-500/10 text-menta-300">
            <Icon name={tipo.icono} />
          </span>
          <div className="min-w-0 flex-1">
            {conRemito && <p className="text-xs font-extrabold uppercase tracking-wide text-marca-naranja">Remito Nº {numeroRemito(mov.remito)}</p>}
            <p className="flex flex-wrap items-center gap-2">
              <b>{numeroMov(mov.numero)}</b>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${est.clase}`}>{est.texto}</span>
              {mov.anulado_por && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-bold text-red-300">Anulado</span>}
            </p>
            <p className="mt-0.5 text-sm text-tinta-200">{rutaMov(mov)}</p>
            <p className="text-xs text-tinta-400">
              {fechaHora(mov.creado_en)}
              {mov.por ? ` · por ${mov.por}` : ''}
            </p>
          </div>
        </div>

        {pendiente && (
          <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">
            {esMioRecibir
              ? mov.destino_tipo === 'deposito'
                ? `Revisá lo que llegó a ${mov.destino} y confirmalo. Hasta que no lo confirmes, no entra al stock del depósito.`
                : 'Revisá lo que te llegó y confirmalo. Hasta que no confirmes, no entra a tu stock.'
              : `Esperando que ${mov.destino_tipo === 'operario' ? mov.destino : 'el depósito'} confirme que lo recibió. Mientras tanto no está en ningún lado: está en camino.`}
          </p>
        )}

        <ul className="divide-y divide-navy-800 rounded-xl border border-navy-700">
          {items.map((i) => {
            const conRecibido = i.recibido !== null && i.recibido !== undefined && Number(i.recibido) !== Number(i.cantidad);
            const desg = desglose(i.cantidad, i);
            return (
              <li key={i.n} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <b className="block text-sm leading-snug">{i.nombre}</b>
                    {i.codigo && <span className="text-[11px] text-tinta-400">{i.codigo}</span>}
                  </span>
                  {mov.tipo === 'conteo' ? (
                    <span className="shrink-0 text-right text-sm">
                      <b className={Number(i.cantidad) === 0 ? 'text-menta-300' : 'text-amber-300'}>
                        {Number(i.cantidad) === 0 ? 'Coincide' : `${Number(i.cantidad) > 0 ? '+' : '−'}${conUnidad(Math.abs(i.cantidad), i)}`}
                      </b>
                      <span className="block text-[11px] text-tinta-400">
                        había {conUnidad(i.anterior, i)} · contaron {conUnidad(Number(i.anterior) + Number(i.cantidad), i)}
                      </span>
                    </span>
                  ) : (
                    <span className="shrink-0 text-right text-sm font-bold">{textoRenglon(i)}</span>
                  )}
                </div>
                {mov.tipo !== 'conteo' && desg && !i.presentacion && <p className="mt-0.5 text-[11px] text-tinta-400">{desg}</p>}
                {conRecibido && (
                  <p className="mt-1 text-xs font-semibold text-amber-300">Recibido: {conUnidad(i.recibido, i)}</p>
                )}
                {modo === 'distinto' && (
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <span className="text-tinta-300">Llegó</span>
                    <input
                      className="campo w-28 px-2 py-1.5 text-sm"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={recibido[i.n] ?? ''}
                      onChange={(e) => setRecibido((r) => ({ ...r, [i.n]: e.target.value }))}
                      aria-label={`Cuánto llegó de ${i.nombre}`}
                    />
                    <span className="text-tinta-400">{i.unidad} de {cant(i.cantidad, i.decimales)}</span>
                  </label>
                )}
              </li>
            );
          })}
        </ul>

        <dl className="space-y-1.5 text-sm">
          {mov.motivo && mov.tipo === 'devolucion' && MOTIVOS_DEVOLUCION[mov.motivo] && <Dato t="Motivo" v={MOTIVOS_DEVOLUCION[mov.motivo]} />}
          {mov.motivo && mov.tipo === 'devolucion_proveedor' && <Dato t="Motivo" v={mov.motivo} />}
          {mov.referencia && <Dato t="Referencia" v={mov.referencia} />}
          {mov.orden_compra_id && (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-tinta-400">Orden</dt>
              <dd>
                <Link href={`/panel/finanzas/compras/${mov.orden_compra_id}`} className="font-semibold text-menta-400">
                  Orden de compra Nº {numeroOrden(mov.orden_numero)}
                </Link>
              </dd>
            </div>
          )}
          {mov.nota && <Dato t={mov.tipo === 'anulacion' ? 'Por qué' : 'Nota'} v={mov.nota} />}
          {(mov.respondido_por || mov.respuesta) && mov.estado !== 'pendiente' && (
            <Dato
              t={mov.estado === 'rechazado' ? 'Rechazado' : mov.estado === 'cancelado' ? 'Cancelado' : 'Confirmado'}
              v={`${mov.respondido_por || ''}${mov.respondido_en ? ` · ${fechaHora(mov.respondido_en)}` : ''}${mov.respuesta ? ` — ${mov.respuesta}` : ''}`}
            />
          )}
          {mov.anula_a && (
            <Dato t="Anula" v={<button type="button" className="font-semibold text-menta-400" onClick={() => onVerOtro?.(mov.anula_a)}>{numeroMov(mov.anula_numero)}</button>} />
          )}
          {mov.anulado_por && (
            <Dato t="Anulado por" v={<button type="button" className="font-semibold text-red-300" onClick={() => onVerOtro?.(mov.anulado_por)}>{numeroMov(mov.anulado_numero)}</button>} />
          )}
        </dl>

        {(modo === 'distinto' || modo === 'rechazar' || modo === 'cancelar' || modo === 'anular') && (
          <div>
            <label className="etiqueta" htmlFor="dm-nota">
              {modo === 'distinto' ? '¿Qué pasó con lo que no llegó?' : modo === 'rechazar' ? '¿Por qué lo rechazás?' : modo === 'cancelar' ? 'Nota (opcional)' : 'Motivo de la anulación'}
            </label>
            <input id="dm-nota" className="campo" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} />
            {modo === 'anular' && (
              <p className="mt-1 text-xs text-tinta-400">Se hace un comprobante nuevo que deshace este. Los dos quedan en el historial.</p>
            )}
            {(modo === 'distinto' || modo === 'rechazar') && <p className="mt-1 text-xs text-tinta-400">Lo que no recibís vuelve a donde salió.</p>}
          </div>
        )}

        {estado.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>}
        {estado.ok && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{estado.ok}</p>}

        {!modo && conRemito && (
          <section className="rounded-xl border border-navy-700 p-3">
            <p className="flex items-center gap-2 text-sm font-bold">
              <Icon name="documento" className="h-4 w-4 text-marca-naranja" /> Remito Nº {numeroRemito(mov.remito)}
            </p>
            <p className="mt-0.5 text-xs text-tinta-400">Con los datos de la empresa, los materiales y lugar para las firmas.</p>
            <div className="mt-2.5 grid grid-cols-2 gap-2 min-[420px]:grid-cols-4">
              <button type="button" className="btn btn-sec px-2 py-2 text-sm" onClick={() => remito('descargar')} disabled={!!armando}>
                <Icon name="descargar" className="h-4 w-4" /> {armando === 'descargar' ? 'Armando…' : 'Descargar'}
              </button>
              <button type="button" className="btn btn-sec px-2 py-2 text-sm" onClick={() => remito('imprimir')} disabled={!!armando}>
                <Icon name="imprimir" className="h-4 w-4" /> {armando === 'imprimir' ? 'Armando…' : 'Imprimir'}
              </button>
              <button type="button" className="btn btn-sec px-2 py-2 text-sm" onClick={() => remito('compartir')} disabled={!!armando}>
                <Icon name="compartir" className="h-4 w-4" /> {armando === 'compartir' ? 'Armando…' : 'Compartir'}
              </button>
              <a href={linkMail} className="btn btn-sec px-2 py-2 text-sm">
                <Icon name="mail" className="h-4 w-4" /> Por mail
              </a>
            </div>
            <p className="mt-1.5 text-[11px] text-tinta-500">Por mail va el detalle escrito. Para mandar el PDF adjunto usá Compartir o Descargar.</p>
          </section>
        )}

        {!modo && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="chip" onClick={compartir}>
              <Icon name="compartir" className="h-3.5 w-3.5" /> {conRemito ? 'Compartir texto' : 'Compartir'}
            </button>
            {puedeCancelar && (
              <button type="button" className="chip" onClick={() => setModo('cancelar')}>
                <Icon name="cerrar" className="h-3.5 w-3.5" /> Cancelar el envío
              </button>
            )}
            {puedeAnular && (
              <button type="button" className="chip text-red-300" onClick={() => setModo('anular')}>
                <Icon name="repetir" className="h-3.5 w-3.5" /> Anular
              </button>
            )}
          </div>
        )}

        {mov.huella && (
          <p className="flex items-center gap-1.5 text-[11px] text-tinta-500">
            <Icon name="escudo" className="h-3.5 w-3.5" /> Sellado · {mov.huella.slice(0, 16)}
          </p>
        )}
      </div>
    </Modal>
  );
}

function Dato({ t, v }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-tinta-400">{t}</dt>
      <dd className="min-w-0 text-tinta-200">{v}</dd>
    </div>
  );
}
