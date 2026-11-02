'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/util';

const ICONO = { presupuesto: 'documento', ticket: 'maletin', materiales: 'caja', stock: 'ruta', comision: 'billetera' };
const COLOR = {
  presupuesto: 'bg-marca-naranja/15 text-marca-naranja',
  ticket: 'bg-[#0a84ff]/15 text-[#8cc8ff]',
  materiales: 'bg-amber-400/15 text-amber-300',
  stock: 'bg-menta-500/15 text-menta-300',
  comision: 'bg-violet-400/15 text-violet-200',
};
const dia = (iso) => new Date(iso).toLocaleDateString('es-UY', { weekday: 'long', day: 'numeric', month: 'long' });
const hora = (iso) => new Date(iso).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });

/** Todo lo que pasó con un presupuesto y sus tickets (o con un ticket suelto): quién, qué y cuándo */
export default function Historial({ abierto, cuenta, presupuestoId = null, turnoId = null, ordenId = null, titulo = 'Historial', onCerrar }) {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!abierto) return;
    setLista(null);
    setError('');
    supabase
      .rpc('historial', { p_cuenta: cuenta, p_presupuesto: presupuestoId, p_turno: turnoId, p_orden: ordenId })
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.code === 'PGRST202' || err.code === '42883' ? 'Falta activar el seguimiento: corré el SQL 13 en Supabase.' : mensajeError(err));
          setLista([]);
        } else setLista(data || []);
      });
  }, [abierto, cuenta, presupuestoId, turnoId, ordenId]);

  if (!abierto) return null;
  let ultimoDia = '';
  return (
    <Modal abierto onCerrar={onCerrar} titulo={titulo}>
      <div className="space-y-3">
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        {lista === null ? (
          <p className="text-sm text-tinta-400">Cargando…</p>
        ) : lista.length === 0 && !error ? (
          <p className="text-sm text-tinta-400">Todavía no hay movimientos registrados.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-navy-700 pl-5">
            {lista.map((e) => {
              const d = dia(e.cuando);
              const nuevoDia = d !== ultimoDia;
              ultimoDia = d;
              const correccion = /corrección/i.test(e.accion);
              return (
                <li key={e.id} className="relative">
                  {nuevoDia && <p className="-ml-5 mb-2 text-[11px] font-bold uppercase tracking-wide text-tinta-500">{d}</p>}
                  <span className={`absolute -left-[31px] grid h-5 w-5 place-items-center rounded-full ${COLOR[e.tipo] || COLOR.ticket}`}>
                    <Icon name={ICONO[e.tipo] || 'check'} className="h-3 w-3" />
                  </span>
                  <p className={`text-sm font-semibold leading-snug ${correccion ? 'text-amber-200' : 'text-tinta-100'}`}>{e.accion}</p>
                  {e.detalle && <p className="text-xs text-tinta-300">{e.detalle}</p>}
                  <p className="text-[11px] text-tinta-500">
                    {hora(e.cuando)} · {e.quien || 'Sistema'}
                    {e.movimiento_id && (
                      <>
                        {' · '}
                        <Link href={`/panel/finanzas/stock?mov=${e.movimiento_id}`} className="font-semibold text-menta-400">
                          Ver comprobante
                        </Link>
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Modal>
  );
}
