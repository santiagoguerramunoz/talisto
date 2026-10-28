'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import FinanzasEncabezado from '@/components/FinanzasEncabezado';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { useAlVolver } from '@/lib/useAlVolver';
import { useAjustes } from '@/lib/ajustes';
import { pesos } from '@/lib/precios';
import { ESTADOS_PRESUPUESTO, fechaUY, numeroPresupuesto, presupuestoNuevo } from '@/lib/presupuestos';
import { AVISO_SQL_04, faltaSql04, faltaTabla } from '@/lib/sql';
import { mensajeError } from '@/lib/util';

const FILTROS = [
  ['todos', 'Todos'],
  ['borrador', 'Borradores'],
  ['enviado', 'Enviados'],
  ['aceptado', 'Aceptados'],
  ['por_cobrar', 'Por cobrar'],
  ['rechazado', 'Rechazados'],
];

export default function Presupuestos() {
  const router = useRouter();
  const { profesional } = usePanel();
  const { ajustes } = useAjustes(profesional.id);
  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState('todos');
  const [error, setError] = useState('');
  const [faltaSql, setFaltaSql] = useState(false);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('presupuestos')
      .select('id, numero, cliente_nombre, titulo, fecha, estado, total, subtotal, aceptado_en, cobrado_en, relevamiento_id, clientes(nombre, color)')
      .eq('profesional_id', profesional.id)
      .order('numero', { ascending: false });
    setCargando(false);
    if (err) {
      if (faltaTabla(err)) setFaltaSql(true);
      else setError(mensajeError(err));
      return;
    }
    setLista(data || []);
  }, [profesional.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);
  useAlVolver(cargar);

  async function nuevo() {
    setError('');
    setCreando(true);
    const { data, error: err } = await supabase
      .from('presupuestos')
      .insert(presupuestoNuevo({ profesionalId: profesional.id, ajustes }))
      .select('id')
      .single();
    setCreando(false);
    if (err) return setError(faltaSql04(err) ? AVISO_SQL_04 : mensajeError(err));
    router.push(`/panel/finanzas/presupuestos/${data.id}`);
  }

  const cuenta = (f) =>
    f === 'todos' ? lista.length : f === 'por_cobrar' ? lista.filter((p) => p.estado === 'aceptado' && !p.cobrado_en).length : lista.filter((p) => p.estado === f).length;
  const visibles = lista.filter((p) =>
    filtro === 'todos' ? true : filtro === 'por_cobrar' ? p.estado === 'aceptado' && !p.cobrado_en : p.estado === filtro
  );

  return (
    <>
      <FinanzasEncabezado
        accion={
          <button className="btn btn-menta py-2" onClick={nuevo} disabled={creando}>
            <Icon name="mas" /> Nuevo
          </button>
        }
      />
      <div className="px-4 pt-4">
        {faltaSql && (
          <p className="mb-3 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">
            Falta correr en Supabase el archivo <b>04_trabajos_finanzas.sql</b> para activar los presupuestos.
          </p>
        )}
        {error && <p className="mb-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
          {FILTROS.map(([valor, texto]) => {
            const n = cuenta(valor);
            return (
              <button key={valor} onClick={() => setFiltro(valor)} className={`chip shrink-0 ${filtro === valor ? 'chip-activo' : ''}`}>
                {texto}
                {n > 0 && <span className="rounded-full bg-navy-700 px-1.5 text-[11px] text-tinta-100">{n}</span>}
              </button>
            );
          })}
        </div>

        {cargando ? (
          <p className="text-tinta-400">Cargando…</p>
        ) : visibles.length === 0 ? (
          <div className="tarjeta p-6 text-center">
            <Icon name="documento" className="mx-auto h-8 w-8 text-marca-naranja" />
            <p className="mt-2 font-bold">{lista.length ? 'No hay presupuestos acá' : 'Todavía no hiciste presupuestos'}</p>
            <p className="mt-1 text-sm text-tinta-400">
              Armalos desde la ficha de un relevamiento (con los materiales que relevaste) o con <b>Nuevo</b>.
            </p>
            <Link href="/panel/relevamientos" className="btn btn-sec mt-4">Ir a relevamientos</Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {visibles.map((p) => {
              const estado = ESTADOS_PRESUPUESTO[p.estado] || ESTADOS_PRESUPUESTO.borrador;
              const nombre = p.cliente_nombre || p.clientes?.nombre || 'Sin cliente';
              return (
                <li key={p.id}>
                  <Link href={`/panel/finanzas/presupuestos/${p.id}`} className="tarjeta block p-4 hover:bg-navy-850">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-tinta-400">Nº {numeroPresupuesto(p.numero)} · {fechaUY(p.fecha)}</p>
                        <p className="truncate font-bold">{nombre}</p>
                        {p.titulo && <p className="truncate text-sm text-tinta-300">{p.titulo}</p>}
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${estado.clase}`}>{estado.texto}</span>
                        <p className="mt-1 font-extrabold">{pesos(p.total, { decimales: false })}</p>
                        {p.estado === 'aceptado' && (
                          <p className={`text-[11px] font-semibold ${p.cobrado_en ? 'text-menta-300' : 'text-amber-300'}`}>{p.cobrado_en ? 'Cobrado' : 'Por cobrar'}</p>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
