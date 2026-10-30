'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import DetalleMovimiento from '@/components/DetalleMovimiento';
import FilaMovimiento from '@/components/FilaMovimiento';
import MovimientoStock from '@/components/MovimientoStock';
import { usePanel } from '@/components/PanelContext';
import { cant, desglose, fechaHora, normalizarMaterial, numeroMov, resumenItems, rpcStock, rutaMov, textoError, tituloMov } from '@/lib/stock';

// Lo que tiene a su cargo cada persona del equipo: confirmar lo que le entregan, devolver al depósito y pasar a un compañero
export default function MiStock() {
  const panel = usePanel();
  const { profesional, empresa, yo, user } = panel;
  const cuenta = profesional.id;
  const miId = yo?.id || user?.id;
  const [d, setD] = useState({ cargando: true, error: '', datos: null });
  const [movs, setMovs] = useState([]);
  const [accion, setAccion] = useState('');
  const [detalle, setDetalle] = useState(null);
  const [aviso, setAviso] = useState('');
  const [ultimoMov, setUltimoMov] = useState(null);
  const [ocupado, setOcupado] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [datos, lista] = await Promise.all([
        rpcStock('mi_stock', { p_cuenta: cuenta }),
        rpcStock('stock_movimientos', { p_cuenta: cuenta, p_ubicacion: null, p_material: null, p_tipo: null, p_antes: null, p_limite: 30 }),
      ]);
      setD({ cargando: false, error: '', datos });
      setMovs(lista || []);
    } catch (e) {
      setD({ cargando: false, error: textoError(e), datos: null });
    }
  }, [cuenta]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const datos = d.datos;
  const materiales = useMemo(() => (datos?.materiales || []).map(normalizarMaterial), [datos]);
  const ctx = useMemo(
    () => (datos ? { depositos: datos.depositos || [], equipo: datos.equipo || [], mio: datos.ubicacion, materiales, gestiona: false } : null),
    [datos, materiales]
  );

  async function recibirTodo(m) {
    setOcupado(m.id);
    setAviso('');
    try {
      await rpcStock('stock_responder', { p_movimiento: m.id, p_aceptar: true, p_recibido: null, p_nota: null });
      setAviso(`${numeroMov(m.numero)}: recibido. Ya está en tu stock.`);
      await cargar();
    } catch (e) {
      setAviso(textoError(e));
    }
    setOcupado('');
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/panel" className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver a mis tickets">
            <Icon name="izq" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold">Mi stock</h1>
            <p className="truncate text-xs font-semibold text-menta-300">{empresa?.nombre}</p>
          </div>
        </div>
      </header>

      <div className="space-y-5 px-4 pt-4">
        {d.cargando && <p className="py-6 text-center text-tinta-400">Cargando…</p>}
        {d.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{d.error}</p>}
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

        {datos && (
          <>
            {(datos.recibir || []).length > 0 && (
              <section>
                <h2 className="titulo-seccion mb-2">Para confirmar</h2>
                <ul className="space-y-2">
                  {datos.recibir.map((m) => (
                    <li key={m.id} className="tarjeta border-amber-400/50 p-3">
                      <p className="flex items-center justify-between gap-2 text-sm">
                        <b>{tituloMov(m)} de {m.origen}</b>
                        <span className="shrink-0 text-[11px] text-tinta-400">{numeroMov(m.numero)}</span>
                      </p>
                      <p className="text-[11px] text-tinta-400">
                        {fechaHora(m.creado_en)}
                        {m.por ? ` · ${m.por}` : ''}
                      </p>
                      <ul className="mt-2 space-y-0.5 text-sm">
                        {m.items.map((i) => (
                          <li key={i.n} className="flex justify-between gap-2">
                            <span className="min-w-0 truncate">{i.nombre}</span>
                            <b className="shrink-0">{cant(i.cantidad, i.decimales)} {i.unidad}</b>
                          </li>
                        ))}
                      </ul>
                      {m.nota && <p className="mt-1 text-xs text-tinta-300">Nota: {m.nota}</p>}
                      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                        <button type="button" className="btn btn-menta py-2.5" onClick={() => recibirTodo(m)} disabled={ocupado === m.id}>
                          <Icon name="check" /> {ocupado === m.id ? 'Guardando…' : 'Recibí todo'}
                        </button>
                        <button type="button" className="btn btn-sec py-2.5" onClick={() => setDetalle(m)}>Otra cosa</button>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-tinta-400">Confirmá solo lo que tenés en la mano: hasta que no lo confirmes, no queda a tu cargo.</p>
              </section>
            )}

            <section>
              <h2 className="titulo-seccion mb-2">A mi cargo</h2>
              {materiales.length ? (
                <ul className="divide-y divide-navy-800 rounded-xl border border-navy-700">
                  {materiales.map((m) => (
                    <li key={m.id} className="flex items-start justify-between gap-3 p-3">
                      <span className="min-w-0">
                        <b className="block leading-snug">{m.nombre}</b>
                        {(m.codigo || m.marca) && <span className="text-[11px] text-tinta-400">{[m.codigo, m.marca].filter(Boolean).join(' · ')}</span>}
                      </span>
                      <span className="shrink-0 text-right">
                        <b className="block">
                          {cant(m.cantidad, m.decimales)} {m.unidad}
                        </b>
                        {desglose(m.cantidad, m) && <span className="text-[11px] text-tinta-400">{desglose(m.cantidad, m)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">
                  No tenés materiales a tu cargo. Cuando el depósito te entregue algo, te aparece arriba para confirmarlo.
                </p>
              )}
              {materiales.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" className="btn btn-sec py-2.5 text-sm" onClick={() => (setAviso(''), setAccion('devolver'))} disabled={!(datos.depositos || []).length}>
                    <Icon name="repetir" className="h-4 w-4" /> Devolver al depósito
                  </button>
                  <button type="button" className="btn btn-sec py-2.5 text-sm" onClick={() => (setAviso(''), setAccion('pase'))} disabled={!(datos.equipo || []).length}>
                    <Icon name="ruta" className="h-4 w-4" /> Pasar a un compañero
                  </button>
                </div>
              )}
              <p className="mt-2 text-xs text-tinta-400">Lo que usás en un trabajo lo cargás desde el ticket, en Materiales.</p>
            </section>

            {(datos.enviados || []).length > 0 && (
              <section>
                <h2 className="titulo-seccion mb-2">Enviado, sin confirmar</h2>
                <ul className="space-y-2">
                  {datos.enviados.map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => setDetalle(m)} className="tarjeta w-full p-3 text-left hover:bg-navy-850">
                        <span className="flex justify-between gap-2 text-sm">
                          <b className="min-w-0 truncate">{rutaMov(m)}</b>
                          <span className="shrink-0 text-[11px] text-tinta-400">{numeroMov(m.numero)}</span>
                        </span>
                        <span className="block truncate text-xs text-tinta-300">{resumenItems(m.items)}</span>
                        <span className="text-[11px] text-amber-300">Esperando que {m.destino_tipo === 'operario' ? m.destino : 'el depósito'} confirme · tocá para cancelar</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {movs.length > 0 && (
              <section>
                <h2 className="titulo-seccion mb-2">Últimos movimientos</h2>
                <ul className="space-y-2">
                  {movs.map((m) => (
                    <FilaMovimiento key={m.id} m={m} onAbrir={() => setDetalle(m)} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        <div className="h-2" />
      </div>

      {ctx && (
        <MovimientoStock
          abierto={!!accion}
          onCerrar={() => setAccion('')}
          onListo={(r) => {
            setAviso(r.mensaje);
            setUltimoMov(r.id || null);
            cargar();
          }}
          cuenta={cuenta}
          accion={accion || 'devolver'}
          ctx={ctx}
        />
      )}
      <DetalleMovimiento
        mov={detalle}
        onCerrar={() => setDetalle(null)}
        onCambio={cargar}
        yo={miId}
        gestiona={false}
        empresa={empresa?.nombre || ''}
        onVerOtro={async (id) => {
          try {
            setDetalle(await rpcStock('stock_comprobante', { p_id: id }));
          } catch (e) {
            setAviso(textoError(e));
          }
        }}
      />
    </>
  );
}
