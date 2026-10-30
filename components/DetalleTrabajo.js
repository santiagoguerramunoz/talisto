'use client';

import { useEffect, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { Reloj } from './ControlTiempo';
import { ESTADO_COTIZACION } from './PedirCotizacion';
import { BotonesCierre } from './CierreTrabajo';
import { usePanel } from './PanelContext';
import { supabase } from '@/lib/supabase';
import { ESTADOS_TRABAJO, textoRecordatorio } from '@/lib/trabajos';
import { linkGoogleMaps, linkWaze, linkWhatsapp } from '@/lib/util';
import { hhmm } from '@/lib/equipo';

const TIPO = {
  ticket: 'Ticket',
  trabajo: 'Trabajo',
  visita: 'Visita técnica',
  relevamiento: 'Relevamiento',
};

export function EtiquetaCliente({ b2b, className = '' }) {
  return b2b ? (
    <span className={`inline-flex items-center gap-1 rounded-md bg-[#0a84ff]/20 px-1.5 py-0.5 text-[10.5px] font-extrabold uppercase tracking-wide text-[#8cc8ff] ${className}`}>
      <Icon name="empresa" className="h-3 w-3" /> B2B · Empresa
    </span>
  ) : (
    <span className={`inline-flex items-center gap-1 rounded-md bg-violet-400/15 px-1.5 py-0.5 text-[10.5px] font-extrabold uppercase tracking-wide text-violet-200 ${className}`}>
      <Icon name="perfil" className="h-3 w-3" /> B2C · Particular
    </span>
  );
}

function Bloque({ titulo, children }) {
  return (
    <section className="rounded-2xl bg-navy-850 p-3">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-tinta-400">{titulo}</p>
      {children}
    </section>
  );
}

/** Todo lo del trabajo en una pantalla: qué hay que hacer, dónde, con quién hablar, materiales y cotizar */
export default function DetalleTrabajo({ item, cuenta, onCerrar, onIniciar, onCerrarCon, onMateriales, onCotizar, ocupado, bloqueado, recarga = 0 }) {
  const { empresa } = usePanel();
  const [cotizaciones, setCotizaciones] = useState([]);

  useEffect(() => {
    if (!item) return undefined;
    let vivo = true;
    supabase
      .from('cotizaciones_pedidas')
      .select('id, numero, estado, items, respuesta, creado_en')
      .eq(item.rpc === 'ticket' ? 'orden_id' : 'turno_id', item.id)
      .order('creado_en', { ascending: false })
      .limit(10)
      .then(({ data, error }) => vivo && setCotizaciones(error ? [] : data || []));
    return () => {
      vivo = false;
    };
  }, [item, recarga]);

  if (!item) return null;
  const info = ESTADOS_TRABAJO[item.estado] || ESTADOS_TRABAJO.pendiente;
  const terminado = item.estado === 'finalizado';
  const corriendo = item.estado === 'en_curso';
  const sesiones = item.tiempos.filter((t) => t?.inicio);
  const wa = linkWhatsapp(item.telefono, textoRecordatorio({ negocio: empresa?.nombre, cliente: item.contacto, fechaIso: item.fechaIso, hora: item.horaTexto }));

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={TIPO[item.tipo] || 'Trabajo'}
      pie={
        terminado ? null : corriendo ? (
          <BotonesCierre onCerrarCon={onCerrarCon} />
        ) : (
          <div className="space-y-1.5">
            <button type="button" className="btn btn-menta w-full py-3 text-base font-extrabold" onClick={onIniciar} disabled={ocupado || bloqueado}>
              <Icon name="play" /> {ocupado ? 'Iniciando…' : sesiones.length ? 'Retomar' : 'Iniciar'}
            </button>
            {bloqueado && <p className="text-center text-xs text-tinta-500">Primero cerrá el trabajo que tenés en curso.</p>}
          </div>
        )
      }
    >
      <div className="space-y-3">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <EtiquetaCliente b2b={item.b2b} />
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${info.clase}`}>
              {corriendo && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0a84ff]" />}
              {info.texto}
            </span>
          </div>
          <h3 className="mt-1.5 text-xl font-extrabold leading-tight">{item.titulo}</h3>
          {item.contacto && item.contacto !== item.titulo && <p className="text-sm text-tinta-300">{item.contacto}</p>}
        </div>

        <Bloque titulo="Cuándo">
          <p className="font-semibold">
            {item.fechaTexto} · {item.cuando}
          </p>
          {item.deOtroDia && <p className="text-xs text-[#8cc4ee]">Viene de otro día</p>}
          {sesiones.length > 0 && (
            <p className="mt-1 text-xs text-tinta-400">
              Inicio {hhmm(sesiones[0].inicio)}
              {sesiones[sesiones.length - 1]?.fin ? ` · Fin ${hhmm(sesiones[sesiones.length - 1].fin)}` : ''}
              {sesiones.length > 1 ? ` · ${sesiones.length} tramos` : ''} · <Reloj tiempos={item.tiempos} className={corriendo ? 'font-bold text-[#8cc8ff]' : ''} />
            </p>
          )}
        </Bloque>

        {item.pedido && (
          <Bloque titulo={item.tipo === 'relevamiento' ? 'Qué pide el cliente' : 'Qué hay que hacer'}>
            <p className="whitespace-pre-line text-[15px] leading-snug text-tinta-100">{item.pedido}</p>
            {item.notas && <p className="mt-2 whitespace-pre-line text-sm text-tinta-300">Notas: {item.notas}</p>}
          </Bloque>
        )}

        {(item.lugar || item.telefono) && (
          <Bloque titulo="Dónde y con quién">
            {item.lugar && (
              <p className="flex gap-1.5 text-sm text-tinta-100">
                <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-tinta-400" />
                <span>
                  {item.lugar.direccion || 'Ubicación marcada en el mapa'}
                  {item.lugar.referencia && <span className="block text-xs text-tinta-400">{item.lugar.referencia}</span>}
                </span>
              </p>
            )}
            <div className={`mt-2 grid gap-2 ${[item.lugar, item.lugar, item.telefono, wa && !terminado].filter(Boolean).length > 3 ? 'grid-cols-2' : 'grid-flow-col'}`}>
              {item.lugar && (
                <a href={linkGoogleMaps(item.lugar)} target="_blank" rel="noreferrer" className="btn btn-sec py-2 text-sm">
                  <Icon name="ir" className="h-4 w-4" /> Ir
                </a>
              )}
              {item.lugar && (
                <a href={linkWaze(item.lugar)} target="_blank" rel="noreferrer" className="btn btn-sec py-2 text-sm">
                  Waze
                </a>
              )}
              {item.telefono && (
                <a href={`tel:${String(item.telefono).replace(/[^\d+]/g, '')}`} className="btn btn-sec py-2 text-sm">
                  <Icon name="telefono" className="h-4 w-4" /> Llamar
                </a>
              )}
              {wa && !terminado && (
                <a href={wa} target="_blank" rel="noreferrer" className="btn btn-sec py-2 text-sm text-[#5be38e]">
                  <Icon name="whatsapp" className="h-4 w-4" /> Avisar
                </a>
              )}
            </div>
          </Bloque>
        )}

        {item.materiales?.length > 0 && (
          <Bloque titulo="Materiales previstos">
            <ul className="space-y-0.5 text-sm text-tinta-200">
              {item.materiales.map((m, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>{m.item}</span>
                  {m.cantidad ? <span className="shrink-0 tabular-nums text-tinta-400">{m.cantidad}{m.unidad ? ` ${m.unidad}` : ''}</span> : null}
                </li>
              ))}
            </ul>
          </Bloque>
        )}

        {item.nota && !terminado && (
          <p className="rounded-xl bg-red-500/10 p-2.5 text-sm text-red-200">
            {item.estado === 'multidia' ? 'Avance' : 'Motivo'}: {item.nota}
          </p>
        )}
        {terminado && item.resolucion && (
          <Bloque titulo="Cómo quedó">
            <p className="whitespace-pre-line text-sm text-menta-200">{item.resolucion}</p>
          </Bloque>
        )}

        <div className={`grid gap-2 ${onMateriales && onCotizar ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {onMateriales && (
            <button type="button" className="btn btn-sec py-2.5" onClick={onMateriales}>
              <Icon name="caja" className="h-5 w-5" /> Materiales
            </button>
          )}
          {onCotizar && (
            <button type="button" className="btn btn-sec py-2.5" onClick={onCotizar}>
              <Icon name="calculadora" className="h-5 w-5" /> Cotizar
            </button>
          )}
        </div>

        {cotizaciones.length > 0 && (
          <Bloque titulo="Cotizaciones pedidas">
            <ul className="divide-y divide-navy-700">
              {cotizaciones.map((c) => {
                const e = ESTADO_COTIZACION[c.estado] || ESTADO_COTIZACION.pendiente;
                return (
                  <li key={c.id} className="py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <b>Pedido Nº {c.numero}</b>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${e.clase}`}>{e.texto}</span>
                    </div>
                    <p className="text-xs text-tinta-400">{(c.items || []).map((x) => x.descripcion).join(' · ')}</p>
                    {c.respuesta && <p className="mt-0.5 text-xs text-tinta-300">Respuesta: {c.respuesta}</p>}
                  </li>
                );
              })}
            </ul>
          </Bloque>
        )}
      </div>
    </Modal>
  );
}
