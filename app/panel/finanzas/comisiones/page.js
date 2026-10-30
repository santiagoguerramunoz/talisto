'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import FinanzasEncabezado from '@/components/FinanzasEncabezado';
import BloqueoPlan from '@/components/BloqueoPlan';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { avisar } from '@/lib/avisos';
import { esBusiness } from '@/lib/planes';
import { dinero, numero, r2 } from '@/lib/precios';
import { fechaUY, numeroPresupuesto } from '@/lib/presupuestos';
import { fechaISO } from '@/lib/fechas';
import { mensajeError } from '@/lib/util';

const sinSql = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || e.code === '42883' || e.code === '42703');
const AVISO_SQL_12 = 'Falta activar las comisiones: corré el SQL 12 en Supabase.';

const ESTADOS = {
  pendiente: { texto: 'Pendiente', clase: 'bg-amber-400/15 text-amber-300' },
  pagada: { texto: 'Pagada', clase: 'bg-menta-500/15 text-menta-300' },
  anulada: { texto: 'Anulada', clase: 'bg-navy-700 text-tinta-400' },
};
const FILTROS = [
  ['pendiente', 'Pendientes'],
  ['pagada', 'Pagadas'],
  ['todas', 'Todas'],
];
const BASES = { venta: 'la venta sin IVA', ganancia: 'la ganancia' };

// "US$ 12,00 + $ 150,00"
const montos = (uyu, usd) => [Number(usd) > 0 && dinero(usd, 'USD'), (Number(uyu) > 0 || !(Number(usd) > 0)) && dinero(uyu, 'UYU')].filter(Boolean).join(' + ');

export default function Comisiones() {
  const { plan } = usePanel();
  if (esBusiness(plan?.plan)) return <ComisionesBusiness />;
  return (
    <>
      <FinanzasEncabezado />
      <div className="px-4 pt-4">
        <BloqueoPlan
          plan="business"
          titulo="Comisiones por venta"
          texto="Cada vendedor con su %, calculadas solas al cobrar el presupuesto."
          puntos={['% sobre la venta sin IVA o sobre la ganancia', 'En pesos y en dólares', 'Pendientes y pagadas, con aviso al vendedor']}
        />
      </div>
    </>
  );
}

function ComisionesBusiness() {
  const { profesional, yo, user, empresa, permisos } = usePanel();
  const cuenta = profesional.id;
  const gestiona = !empresa || yo?.id === cuenta || (permisos || []).includes('comisiones');
  const [lista, setLista] = useState(null);
  const [vendedores, setVendedores] = useState([]);
  const [filtro, setFiltro] = useState('pendiente');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [editando, setEditando] = useState(null);

  const cargar = useCallback(async () => {
    let q = supabase
      .from('comisiones')
      .select('*, presupuestos(numero, cliente_nombre, titulo)')
      .eq('profesional_id', cuenta)
      .order('creado_en', { ascending: false })
      .limit(300);
    if (!gestiona) q = q.eq('vendedor_id', user.id);
    const [{ data, error: e1 }, v] = await Promise.all([q, gestiona ? supabase.rpc('vendedores_comision', { p_cuenta: cuenta }) : Promise.resolve({ data: [] })]);
    if (e1 || v.error) {
      setError(sinSql(e1 || v.error) ? AVISO_SQL_12 : mensajeError(e1 || v.error));
      setLista([]);
      return;
    }
    setError('');
    setLista(data || []);
    setVendedores(v.data || []);
  }, [cuenta, gestiona, user.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const visibles = (lista || []).filter((c) => (filtro === 'todas' ? true : c.estado === filtro));
  const resumen = useMemo(() => {
    const r = { pendiente: { uyu: 0, usd: 0, n: 0 }, pagada: { uyu: 0, usd: 0, n: 0 }, porVendedor: {} };
    (lista || []).forEach((c) => {
      if (c.estado === 'anulada') return;
      const k = c.estado;
      r[k].uyu += Number(c.monto_uyu) || 0;
      r[k].usd += Number(c.monto_usd) || 0;
      r[k].n += 1;
      const v = (r.porVendedor[c.vendedor_id] ||= { nombre: c.vendedor_nombre || 'Vendedor', pendiente: { uyu: 0, usd: 0 }, pagada: { uyu: 0, usd: 0 } });
      v[k].uyu += Number(c.monto_uyu) || 0;
      v[k].usd += Number(c.monto_usd) || 0;
    });
    return r;
  }, [lista]);

  async function marcarPagada(c) {
    setOk('');
    const { error: err } = await supabase.rpc('editar_comision', {
      p_id: c.id, p_porcentaje: null, p_monto_uyu: null, p_monto_usd: null, p_estado: 'pagada', p_pagada_en: fechaISO(new Date()), p_nota: c.nota,
    });
    if (err) return setError(mensajeError(err));
    avisar();
    setOk(`Comisión de ${c.vendedor_nombre || 'el vendedor'} marcada como pagada. Le llegó el aviso.`);
    cargar();
  }

  return (
    <>
      <FinanzasEncabezado />
      <div className="space-y-5 px-4 pt-4">
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        {ok && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{ok}</p>}

        <div className="grid grid-cols-2 gap-2">
          <div className="tarjeta p-3">
            <p className="text-xs font-semibold text-amber-300">{gestiona ? 'Por pagar' : 'Te deben'}</p>
            <p className="mt-0.5 text-lg font-extrabold leading-tight">{montos(resumen.pendiente.uyu, resumen.pendiente.usd)}</p>
            <p className="text-[11px] text-tinta-400">{resumen.pendiente.n} {resumen.pendiente.n === 1 ? 'comisión' : 'comisiones'}</p>
          </div>
          <div className="tarjeta p-3">
            <p className="text-xs font-semibold text-menta-300">Pagado</p>
            <p className="mt-0.5 text-lg font-extrabold leading-tight">{montos(resumen.pagada.uyu, resumen.pagada.usd)}</p>
            <p className="text-[11px] text-tinta-400">{resumen.pagada.n} {resumen.pagada.n === 1 ? 'comisión' : 'comisiones'}</p>
          </div>
        </div>

        {gestiona && Object.keys(resumen.porVendedor).length > 1 && (
          <section>
            <h2 className="titulo-seccion mb-2">Por vendedor</h2>
            <ul className="tarjeta divide-y divide-navy-800 overflow-hidden">
              {Object.entries(resumen.porVendedor).map(([id, v]) => (
                <li key={id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <b className="min-w-0 flex-1 truncate">{v.nombre}</b>
                  <span className="text-right text-xs">
                    <span className="block font-bold text-amber-300">{montos(v.pendiente.uyu, v.pendiente.usd)} por pagar</span>
                    <span className="text-tinta-400">{montos(v.pagada.uyu, v.pagada.usd)} pagado</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="titulo-seccion">{gestiona ? 'Comisiones' : 'Mis comisiones'}</h2>
            <div className="flex gap-1">
              {FILTROS.map(([v, t]) => (
                <button key={v} type="button" onClick={() => setFiltro(v)} className={`chip px-2.5 py-1 text-xs ${filtro === v ? 'chip-activo' : ''}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          {lista === null ? (
            <p className="text-tinta-400">Cargando…</p>
          ) : visibles.length === 0 ? (
            <p className="tarjeta p-5 text-center text-sm text-tinta-400">
              {filtro === 'pendiente' ? 'No hay comisiones por pagar.' : 'Todavía no hay comisiones acá.'} Se generan solas cuando un presupuesto se marca como cobrado.
            </p>
          ) : (
            <ul className="lista-pc space-y-2">
              {visibles.map((c) => {
                const e = ESTADOS[c.estado] || ESTADOS.pendiente;
                const pr = c.presupuestos || {};
                return (
                  <li key={c.id} className="tarjeta p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/panel/finanzas/presupuestos/${c.presupuesto_id}`} className="text-xs font-semibold text-tinta-400 hover:text-menta-300">
                          Presupuesto Nº {numeroPresupuesto(pr.numero)} · cobrado el {fechaUY(c.cobrado_en)}
                        </Link>
                        <p className="truncate font-bold">{pr.cliente_nombre || pr.titulo || 'Sin cliente'}</p>
                        <p className="text-xs text-tinta-300">
                          {gestiona && <b className="text-tinta-100">{c.vendedor_nombre} · </b>}
                          {Number(c.porcentaje).toLocaleString('es-UY')}% de {BASES[c.base]} ({montos(c.base_uyu, c.base_usd)})
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${e.clase}`}>{e.texto}</span>
                        <p className="mt-1 font-extrabold">{montos(c.monto_uyu, c.monto_usd)}</p>
                      </div>
                    </div>
                    {(c.nota || c.pagada_en || c.editada) && (
                      <p className="mt-1.5 text-xs text-tinta-400">
                        {c.pagada_en && `Pagada el ${fechaUY(c.pagada_en)}. `}
                        {c.nota && `“${c.nota}” `}
                        {c.editada && c.editado_por_nombre && `Editada por ${c.editado_por_nombre}.`}
                      </p>
                    )}
                    {gestiona && c.estado !== 'anulada' && (
                      <div className="mt-2.5 flex gap-2">
                        {c.estado === 'pendiente' && (
                          <button type="button" className="btn btn-menta flex-1 py-2 text-sm" onClick={() => marcarPagada(c)}>
                            <Icon name="check" className="h-4 w-4" /> Marcar pagada
                          </button>
                        )}
                        <button type="button" className="btn btn-sec flex-1 py-2 text-sm" onClick={() => setEditando(c)}>
                          <Icon name="editar" className="h-4 w-4" /> Editar
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {gestiona && <Vendedores cuenta={cuenta} lista={vendedores} onGuardado={cargar} />}
        <div className="h-2" />
      </div>

      <EditarComision
        comision={editando}
        onCerrar={() => setEditando(null)}
        onListo={() => {
          setEditando(null);
          setOk('Comisión guardada.');
          avisar();
          cargar();
        }}
      />
    </>
  );
}

function Vendedores({ cuenta, lista, onGuardado }) {
  const [form, setForm] = useState({});
  const [estado, setEstado] = useState({ guardando: '', error: '', ok: '' });

  useEffect(() => {
    setForm(
      Object.fromEntries(
        lista.map((v) => [v.usuario_id, { porcentaje: v.porcentaje === null || v.porcentaje === undefined ? '' : String(v.porcentaje), base: v.base || 'venta', activo: !!v.activo }])
      )
    );
  }, [lista]);

  const cambiar = (id, campo, valor) => setForm((f) => ({ ...f, [id]: { ...f[id], [campo]: valor } }));

  async function guardar(v) {
    const f = form[v.usuario_id];
    const pct = numero(f.porcentaje);
    if (pct === null || pct < 0 || pct > 100) return setEstado({ guardando: '', error: `${v.nombre}: el % va de 0 a 100.`, ok: '' });
    setEstado({ guardando: v.usuario_id, error: '', ok: '' });
    const { error } = await supabase.rpc('guardar_comision_vendedor', {
      p_cuenta: cuenta, p_usuario: v.usuario_id, p_porcentaje: pct, p_base: f.base, p_activo: f.activo,
    });
    if (error) return setEstado({ guardando: '', error: mensajeError(error), ok: '' });
    setEstado({ guardando: '', error: '', ok: `Guardado: ${v.nombre}.` });
    onGuardado?.();
  }

  return (
    <section>
      <h2 className="titulo-seccion mb-1">Comisión de cada vendedor</h2>
      <p className="mb-2 text-xs text-tinta-400">
        Se calcula sola al marcar un presupuesto como cobrado, en la moneda de cada renglón. Cambiar el % no toca las comisiones que ya se generaron.
      </p>
      {estado.error && <p className="mb-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>}
      {estado.ok && <p className="mb-2 rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{estado.ok}</p>}
      <ul className="lista-pc space-y-2">
        {lista.map((v) => {
          const f = form[v.usuario_id] || { porcentaje: '', base: 'venta', activo: false };
          return (
            <li key={v.usuario_id} className="tarjeta p-3">
              <div className="flex items-center justify-between gap-2">
                <b className="min-w-0 truncate">
                  {v.nombre}
                  {v.principal && <span className="font-normal text-tinta-400"> (cuenta principal)</span>}
                </b>
                <label className="flex shrink-0 items-center gap-2 text-xs text-tinta-300">
                  Cobra comisión
                  <input type="checkbox" className="h-5 w-5 accent-[#2cc79b]" checked={f.activo} onChange={(e) => cambiar(v.usuario_id, 'activo', e.target.checked)} />
                </label>
              </div>
              {f.activo && (
                <div className="mt-2 grid grid-cols-[6rem_1fr] gap-2">
                  <label className="text-[11px] text-tinta-400">
                    %
                    <input
                      className="campo mt-0.5 px-2 py-2 text-sm"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.5"
                      value={f.porcentaje}
                      onChange={(e) => cambiar(v.usuario_id, 'porcentaje', e.target.value)}
                      placeholder="Ej. 5"
                    />
                  </label>
                  <label className="text-[11px] text-tinta-400">
                    Sobre
                    <select className="campo mt-0.5 px-2 py-2 text-sm" value={f.base} onChange={(e) => cambiar(v.usuario_id, 'base', e.target.value)}>
                      <option value="venta">La venta sin IVA</option>
                      <option value="ganancia">La ganancia (venta − costo)</option>
                    </select>
                  </label>
                </div>
              )}
              <button type="button" className="btn btn-sec mt-2 w-full py-2 text-sm" onClick={() => guardar(v)} disabled={estado.guardando === v.usuario_id}>
                {estado.guardando === v.usuario_id ? 'Guardando…' : 'Guardar'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EditarComision({ comision: c, onCerrar, onListo }) {
  const [f, setF] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!c) return;
    setF({
      porcentaje: String(c.porcentaje),
      monto_uyu: String(c.monto_uyu),
      monto_usd: String(c.monto_usd),
      estado: c.estado,
      pagada_en: c.pagada_en || fechaISO(new Date()),
      nota: c.nota || '',
    });
    setError('');
  }, [c]);

  if (!c || !f) return null;
  const conUsd = Number(c.base_usd) > 0 || Number(c.monto_usd) > 0;
  const conUyu = Number(c.base_uyu) > 0 || Number(c.monto_uyu) > 0 || !conUsd;

  // al cambiar el % se recalculan los montos (se pueden corregir a mano)
  function cambiarPct(v) {
    const pct = numero(v);
    setF((x) => ({
      ...x,
      porcentaje: v,
      ...(pct !== null ? { monto_uyu: String(r2((Number(c.base_uyu) * pct) / 100)), monto_usd: String(r2((Number(c.base_usd) * pct) / 100)) } : {}),
    }));
  }

  async function guardar() {
    const pct = numero(f.porcentaje);
    if (pct === null || pct < 0 || pct > 100) return setError('El % va de 0 a 100.');
    setGuardando(true);
    const { error: err } = await supabase.rpc('editar_comision', {
      p_id: c.id,
      p_porcentaje: pct,
      p_monto_uyu: numero(f.monto_uyu) ?? 0,
      p_monto_usd: numero(f.monto_usd) ?? 0,
      p_estado: f.estado,
      p_pagada_en: f.estado === 'pagada' ? f.pagada_en : null,
      p_nota: f.nota.trim() || null,
    });
    setGuardando(false);
    if (err) return setError(mensajeError(err));
    onListo();
  }

  return (
    <Modal
      abierto
      onCerrar={() => !guardando && onCerrar()}
      titulo="Editar comisión"
      pie={
        <button type="button" className="btn btn-menta w-full" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-tinta-300">
          <b className="text-tinta-100">{c.vendedor_nombre}</b> · Presupuesto Nº {numeroPresupuesto(c.presupuestos?.numero)}
          <span className="block text-xs">Base: {BASES[c.base]} = {montos(c.base_uyu, c.base_usd)}</span>
        </p>
        <div className={`grid gap-2 ${conUsd && conUyu ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <label className="text-xs text-tinta-400">
            %
            <input className="campo mt-0.5" type="number" inputMode="decimal" min="0" max="100" step="0.5" value={f.porcentaje} onChange={(e) => cambiarPct(e.target.value)} />
          </label>
          {conUyu && (
            <label className="text-xs text-tinta-400">
              Monto $
              <input className="campo mt-0.5" type="number" inputMode="decimal" min="0" value={f.monto_uyu} onChange={(e) => setF({ ...f, monto_uyu: e.target.value })} />
            </label>
          )}
          {conUsd && (
            <label className="text-xs text-tinta-400">
              Monto US$
              <input className="campo mt-0.5" type="number" inputMode="decimal" min="0" value={f.monto_usd} onChange={(e) => setF({ ...f, monto_usd: e.target.value })} />
            </label>
          )}
        </div>
        <div>
          <p className="etiqueta">Estado</p>
          <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-navy-850 p-1.5">
            {Object.entries(ESTADOS).map(([v, e]) => (
              <button key={v} type="button" onClick={() => setF({ ...f, estado: v })} className={`rounded-xl py-2 text-sm font-bold ${f.estado === v ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}>
                {e.texto}
              </button>
            ))}
          </div>
        </div>
        {f.estado === 'pagada' && (
          <label className="block text-xs text-tinta-400">
            Fecha de pago
            <input type="date" className="campo mt-0.5" value={f.pagada_en} onChange={(e) => e.target.value && setF({ ...f, pagada_en: e.target.value })} />
          </label>
        )}
        <label className="block text-xs text-tinta-400">
          Nota (la ve el vendedor)
          <input className="campo mt-0.5" value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} maxLength={500} placeholder="Ej. Pagado por transferencia" />
        </label>
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}
