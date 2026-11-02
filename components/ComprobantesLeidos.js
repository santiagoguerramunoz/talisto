'use client';

import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import LeerComprobante from './LeerComprobante';
import { usePanel } from './PanelContext';
import { supabase } from '@/lib/supabase';
import { dinero } from '@/lib/precios';

const ESTADO = {
  registrado: ['Guardado', 'bg-menta-500/15 text-menta-300'],
  leido: ['Sin terminar', 'bg-amber-400/15 text-amber-300'],
  leyendo: ['Leyendo', 'bg-navy-700 text-tinta-300'],
  descartado: ['Descartado', 'bg-navy-700 text-tinta-400'],
  error: ['No se leyó', 'bg-red-500/15 text-red-300'],
};
const cuando = (iso) => new Date(iso).toLocaleString('es-UY', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Botón "Foto de un comprobante" con su ventana (para poner en cualquier pantalla) */
export function BotonComprobante({ className = 'btn btn-sec', texto = 'Leer con IA', onListo }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setAbierto(true)}>
        <Icon name="camara" className="h-4 w-4" /> {texto}
      </button>
      <LeerComprobante abierto={abierto} onCerrar={() => setAbierto(false)} onListo={onListo} />
    </>
  );
}

/** Últimos comprobantes leídos con IA: quién, qué se cargó, la foto y los que quedaron sin terminar */
export default function ComprobantesLeidos({ recarga = 0, onListo }) {
  const { profesional } = usePanel();
  const cuenta = profesional.id;
  const [lista, setLista] = useState(null);
  const [uso, setUso] = useState(null);
  const [abiertos, setAbiertos] = useState(false);
  const [retomar, setRetomar] = useState(null);
  const [propio, setPropio] = useState(0);

  const cargar = useCallback(async () => {
    const [{ data, error }, u] = await Promise.all([
      supabase
        .from('comprobantes')
        .select('id, estado, tipo, documento, numero, fecha, moneda, total, proveedor_nombre, resumen, usuario_nombre, registrado_por_nombre, creado_en, archivos, datos, error')
        .eq('profesional_id', cuenta)
        .in('estado', ['leido', 'registrado', 'descartado'])
        .order('creado_en', { ascending: false })
        .limit(30),
      supabase.rpc('lecturas_ia', { p_cuenta: cuenta }),
    ]);
    setLista(error ? [] : data || []);
    setUso(u.data || null);
  }, [cuenta]);

  useEffect(() => {
    cargar();
  }, [cargar, recarga, propio]);

  async function verFoto(c) {
    const ruta = c.archivos?.[0];
    if (!ruta) return;
    const { data } = await supabase.storage.from('comprobantes').createSignedUrl(ruta, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }

  if (!lista?.length) return null;
  const visibles = abiertos ? lista : lista.slice(0, 4);
  return (
    <section className="tarjeta overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-navy-800 px-4 py-3">
        <h2 className="flex items-center gap-2 font-bold">
          <Icon name="camara" className="h-4 w-4 text-menta-300" /> Comprobantes leídos con IA
        </h2>
        {uso?.limite != null && (
          <span className="text-[11px] text-tinta-400">
            Este mes {uso.usadas || 0}/{uso.limite}
          </span>
        )}
      </div>
      <ul className="divide-y divide-navy-800">
        {visibles.map((c) => {
          const [et, color] = ESTADO[c.estado] || ESTADO.leido;
          return (
            <li key={c.id} className="flex items-start gap-3 px-4 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-navy-850 text-tinta-300">
                <Icon name={c.tipo === 'gasto' ? 'billetera' : 'caja'} className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <b className="truncate text-sm">{c.proveedor_nombre || (c.tipo === 'gasto' ? 'Gasto' : 'Comprobante')}</b>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${color}`}>{et}</span>
                </p>
                <p className="truncate text-xs text-tinta-400">
                  {[c.documento, c.numero && `Nº ${c.numero}`, c.total != null && dinero(c.total, c.moneda)].filter(Boolean).join(' · ')}
                </p>
                {c.estado === 'registrado' && c.resumen && <p className="text-xs text-tinta-300">{c.resumen}</p>}
                {c.estado === 'error' && c.error && <p className="text-xs text-red-300/80">{c.error}</p>}
                <p className="text-[11px] text-tinta-500">
                  {cuando(c.creado_en)} · {c.registrado_por_nombre || c.usuario_nombre || 'Equipo'}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {c.estado === 'leido' && c.datos && (
                    <button type="button" className="chip chip-activo py-1 text-xs" onClick={() => setRetomar({ id: c.id, datos: c.datos, archivos: c.archivos })}>
                      Terminar de cargar
                    </button>
                  )}
                  {c.archivos?.length > 0 && (
                    <button type="button" className="chip py-1 text-xs" onClick={() => verFoto(c)}>
                      <Icon name="imagen" className="h-3 w-3" /> Ver foto
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {lista.length > 4 && (
        <button type="button" className="w-full border-t border-navy-800 py-2.5 text-xs font-semibold text-tinta-300" onClick={() => setAbiertos((v) => !v)}>
          {abiertos ? 'Ver menos' : `Ver los ${lista.length}`}
        </button>
      )}
      <LeerComprobante
        abierto={!!retomar}
        retomar={retomar}
        onCerrar={() => setRetomar(null)}
        onListo={(r) => {
          setPropio((n) => n + 1);
          onListo?.(r);
        }}
      />
    </section>
  );
}
