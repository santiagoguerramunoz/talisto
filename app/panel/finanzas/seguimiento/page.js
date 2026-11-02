'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import FinanzasEncabezado from '@/components/FinanzasEncabezado';
import BloqueoPlan from '@/components/BloqueoPlan';
import Historial from '@/components/Historial';
import { numeroTicket } from '@/components/GenerarTicket';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { avisar } from '@/lib/avisos';
import { esBusiness } from '@/lib/planes';
import { dinero } from '@/lib/precios';
import { fechaUY, numeroPresupuesto } from '@/lib/presupuestos';
import { fechaISO, sumarDias } from '@/lib/fechas';
import { mensajeError } from '@/lib/util';

// Etapas de la ruta, de la venta al cobro
const ETAPAS = [
  { id: 'sin_ticket', texto: 'Sin ticket', clase: 'bg-marca-naranja/15 text-marca-naranja' },
  { id: 'por_agendar', texto: 'Por agendar', clase: 'bg-amber-400/15 text-amber-300' },
  { id: 'materiales', texto: 'Materiales', clase: 'bg-amber-400/15 text-amber-300' },
  { id: 'agendado', texto: 'Agendado', clase: 'bg-[#176ba8]/25 text-[#8cc4ee]' },
  { id: 'en_curso', texto: 'En curso', clase: 'bg-[#0a84ff]/20 text-[#8cc8ff]' },
  { id: 'por_cobrar', texto: 'Por cobrar', clase: 'bg-violet-400/15 text-violet-200' },
  { id: 'cobrado', texto: 'Cobrado', clase: 'bg-menta-500/15 text-menta-300' },
];
const INFO = Object.fromEntries(ETAPAS.map((e, i) => [e.id, { ...e, paso: i }]));
const ESTADO_TICKET = {
  por_agendar: 'Por agendar',
  confirmado: 'Agendado',
  pendiente: 'Agendado',
  realizado: 'Terminado',
  cancelado: 'Cancelado',
  suspendido: 'Suspendido',
};

const activo = (t) => t.estado !== 'cancelado';
function etapaTicket(t) {
  if (t.estado === 'realizado') return 'por_cobrar';
  if (t.estado === 'por_agendar' || t.estado === 'suspendido') return 'por_agendar';
  if (t.pedido?.estado === 'pendiente') return 'materiales';
  if (t.en_curso || t.empezado) return 'en_curso';
  return 'agendado';
}
function etapaPresupuesto(p) {
  if (p.cobrado_en) return 'cobrado';
  const ts = (p.tickets || []).filter(activo);
  if (!ts.length) return 'sin_ticket';
  const etapas = ts.map(etapaTicket);
  // la etapa más atrasada manda
  return ETAPAS.find((e) => etapas.includes(e.id))?.id || 'agendado';
}
function alertas(tickets = []) {
  const a = [];
  tickets.forEach((t) => {
    if (t.estado === 'suspendido') a.push(`Ticket Nº ${numeroTicket(t.numero)} suspendido${t.nota_estado ? `: ${t.nota_estado}` : ''}`);
    if (t.pedido?.estado === 'rechazado') a.push(`Materiales del ticket Nº ${numeroTicket(t.numero)} rechazados${t.pedido.respuesta ? `: ${t.pedido.respuesta}` : ''}`);
    if (t.estado === 'cancelado') a.push(`Ticket Nº ${numeroTicket(t.numero)} cancelado${t.nota_estado ? `: ${t.nota_estado}` : ''}`);
  });
  return a;
}
const totalTexto = (p) =>
  p.moneda && p.moneda !== 'UYU'
    ? [p.total_usd > 0 && dinero(p.total_usd, 'USD', { decimales: false }), p.total_uyu > 0 && dinero(p.total_uyu, 'UYU', { decimales: false })].filter(Boolean).join(' + ')
    : dinero(p.total, 'UYU', { decimales: false });

export default function Seguimiento() {
  const { plan } = usePanel();
  if (esBusiness(plan?.plan)) return <SeguimientoBusiness />;
  return (
    <>
      <FinanzasEncabezado />
      <div className="px-4 pt-4">
        <BloqueoPlan plan="business" titulo="Seguimiento de la venta al cobro" texto="Cada presupuesto con sus tickets, materiales y cobro, con el historial de todo." />
      </div>
    </>
  );
}

function SeguimientoBusiness() {
  const { profesional, yo, empresa, permisos } = usePanel();
  const cuenta = profesional.id;
  const ve = !empresa || yo?.id === cuenta || (permisos || []).includes('seguimiento');
  const [dias, setDias] = useState(30);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState('');
  const [historial, setHistorial] = useState(null);
  const [corrigiendo, setCorrigiendo] = useState(null);
  const [ok, setOk] = useState('');

  const cargar = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('ruta_trabajos', { p_cuenta: cuenta, p_desde: fechaISO(sumarDias(new Date(), -dias)) });
    if (err) {
      setError(err.code === 'PGRST202' || err.code === '42883' ? 'Falta activar el seguimiento: corré el SQL 13 en Supabase.' : mensajeError(err));
      setDatos({ presupuestos: [], sueltos: [] });
      return;
    }
    setError('');
    setDatos(data || { presupuestos: [], sueltos: [] });
  }, [cuenta, dias]);

  useEffect(() => {
    if (ve) cargar();
  }, [cargar, ve]);

  const filas = useMemo(() => {
    if (!datos) return [];
    return [
      ...(datos.presupuestos || []).map((p) => ({ clave: `p-${p.id}`, tipo: 'presupuesto', p, etapa: etapaPresupuesto(p), alertas: alertas(p.tickets) })),
      ...(datos.sueltos || []).map((t) => ({ clave: `t-${t.id}`, tipo: 'ticket', t, etapa: t.estado === 'cancelado' ? 'cancelado' : t.estado === 'realizado' ? 'terminado' : etapaTicket(t), alertas: alertas([t]) })),
    ];
  }, [datos]);
  const cuenta_ = (id) => filas.filter((f) => (id === 'alertas' ? f.alertas.length : f.etapa === id)).length;
  const visibles = filas.filter((f) => !filtro || (filtro === 'alertas' ? f.alertas.length : f.etapa === filtro));

  if (!ve) {
    return (
      <>
        <FinanzasEncabezado />
        <p className="tarjeta m-4 p-5 text-center text-sm text-tinta-300">El seguimiento es para la cuenta principal y Gerencia general.</p>
      </>
    );
  }

  return (
    <>
      <FinanzasEncabezado />
      <div className="space-y-4 px-4 pt-4">
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        {ok && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{ok}</p>}

        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-tinta-300">De la venta al cobro: cada presupuesto aceptado con sus tickets, materiales y cobro.</p>
          <select className="campo w-auto py-1.5 text-sm" value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Período">
            <option value={30}>Últimos 30 días</option>
            <option value={90}>Últimos 90 días</option>
            <option value={365}>Último año</option>
          </select>
        </div>

        {/* La ruta con la cantidad en cada etapa */}
        <div className="-mx-4 overflow-x-auto px-4 pb-1">
          <div className="flex min-w-max items-stretch gap-1">
            {ETAPAS.map((e, i) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setFiltro(filtro === e.id ? '' : e.id)}
                className={`relative flex min-w-[5.2rem] flex-col items-center rounded-xl border px-2 py-2 text-center ${filtro === e.id ? 'border-menta-400 bg-menta-500/10' : 'border-navy-800 bg-navy-900'}`}
              >
                <span className="text-xl font-extrabold tabular-nums">{datos ? cuenta_(e.id) : '–'}</span>
                <span className="text-[11px] font-semibold text-tinta-400">{e.texto}</span>
                {i < ETAPAS.length - 1 && <Icon name="der" className="absolute -right-2.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-tinta-500" />}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setFiltro(filtro === 'alertas' ? '' : 'alertas')}
              className={`ml-2 flex min-w-[5.2rem] flex-col items-center rounded-xl border px-2 py-2 ${filtro === 'alertas' ? 'border-red-400 bg-red-500/10' : 'border-red-500/30 bg-navy-900'}`}
            >
              <span className="text-xl font-extrabold tabular-nums text-red-300">{datos ? cuenta_('alertas') : '–'}</span>
              <span className="text-[11px] font-semibold text-red-300">Alertas</span>
            </button>
          </div>
        </div>

        {datos === null ? (
          <p className="text-tinta-400">Cargando…</p>
        ) : visibles.length === 0 ? (
          <p className="tarjeta p-5 text-center text-sm text-tinta-400">{filtro ? 'Nada en esta etapa.' : 'No hay presupuestos aceptados ni tickets en este período.'}</p>
        ) : (
          <ul className="lista-pc space-y-2">
            {visibles.map((f) =>
              f.tipo === 'presupuesto' ? (
                <FilaPresupuesto key={f.clave} fila={f} onHistorial={setHistorial} onCorregir={setCorrigiendo} />
              ) : (
                <FilaSuelto key={f.clave} fila={f} onHistorial={setHistorial} onCorregir={setCorrigiendo} />
              )
            )}
          </ul>
        )}
        <p className="pb-4 text-xs text-tinta-500">
          Todo lo que pasa queda en el historial: quién lo hizo y cuándo. Las correcciones también quedan registradas, con el motivo.
        </p>
      </div>

      <Historial
        abierto={!!historial}
        cuenta={cuenta}
        presupuestoId={historial?.presupuestoId || null}
        turnoId={historial?.turnoId || null}
        titulo={historial?.titulo || 'Historial'}
        onCerrar={() => setHistorial(null)}
      />
      <Corregir
        ticket={corrigiendo}
        onCerrar={() => setCorrigiendo(null)}
        onListo={(texto) => {
          setCorrigiendo(null);
          setOk(texto);
          avisar();
          cargar();
        }}
      />
    </>
  );
}

function Pasos({ etapa }) {
  const n = INFO[etapa]?.paso ?? -1;
  return (
    <div className="mt-2 flex gap-1" aria-label={`Etapa: ${INFO[etapa]?.texto || etapa}`}>
      {ETAPAS.map((e, i) => (
        <span key={e.id} className={`h-1.5 flex-1 rounded-full ${i <= n ? (etapa === 'cobrado' ? 'bg-menta-400' : 'bg-[#5aa9e6]') : 'bg-navy-700'}`} title={e.texto} />
      ))}
    </div>
  );
}

function Ticket({ t, onHistorial, onCorregir }) {
  return (
    <li className="flex items-center gap-2 py-1.5 text-sm">
      <Icon name="maletin" className="h-4 w-4 shrink-0 text-[#8cc8ff]" />
      <span className="min-w-0 flex-1">
        <b>Ticket Nº {numeroTicket(t.numero)}</b>{' '}
        <span className="text-xs text-tinta-400">
          · {t.en_curso ? 'En curso' : ESTADO_TICKET[t.estado] || t.estado}
          {t.estado !== 'por_agendar' && t.inicio ? ` · ${new Date(t.inicio).toLocaleString('es-UY', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
          {t.asignado ? ` · ${t.asignado}` : t.estado !== 'por_agendar' ? ' · sin asignar' : ''}
          {t.pedido ? ` · materiales ${t.pedido.estado === 'pendiente' ? 'esperando a Stock' : t.pedido.estado}` : ''}
        </span>
      </span>
      <button type="button" className="shrink-0 rounded-lg p-1.5 text-tinta-400 hover:bg-navy-800" onClick={() => onHistorial({ turnoId: t.id, titulo: `Historial · Ticket Nº ${numeroTicket(t.numero)}` })} aria-label="Historial del ticket">
        <Icon name="reloj" className="h-4 w-4" />
      </button>
      <button type="button" className="shrink-0 rounded-lg p-1.5 text-tinta-400 hover:bg-navy-800" onClick={() => onCorregir(t)} aria-label="Corregir el ticket">
        <Icon name="editar" className="h-4 w-4" />
      </button>
    </li>
  );
}

function FilaPresupuesto({ fila, onHistorial, onCorregir }) {
  const { p, etapa } = fila;
  const info = INFO[etapa];
  return (
    <li className={`tarjeta p-3.5 ${fila.alertas.length ? 'border-red-500/40' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-tinta-400">
            Presupuesto Nº {numeroPresupuesto(p.numero)} · aceptado {fechaUY(p.aceptado_en)}
            {p.vendedor ? ` · ${p.vendedor}` : ''}
          </p>
          <p className="truncate font-bold">{p.cliente || 'Sin cliente'}</p>
          {p.titulo && <p className="truncate text-sm text-tinta-300">{p.titulo}</p>}
        </div>
        <div className="shrink-0 text-right">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${info?.clase}`}>{info?.texto}</span>
          <p className="mt-1 text-sm font-extrabold">{totalTexto(p)}</p>
        </div>
      </div>
      <Pasos etapa={etapa} />
      {(p.tickets || []).length > 0 && (
        <ul className="mt-2 divide-y divide-navy-800 rounded-xl bg-navy-850 px-2.5">
          {p.tickets.map((t) => (
            <Ticket key={t.id} t={t} onHistorial={onHistorial} onCorregir={onCorregir} />
          ))}
        </ul>
      )}
      {fila.alertas.map((a) => (
        <p key={a} className="mt-1.5 text-xs font-semibold text-red-300">⚠ {a}</p>
      ))}
      <div className="mt-2.5 flex gap-2">
        <Link href={`/panel/finanzas/presupuestos/${p.id}`} className="btn btn-sec flex-1 py-2 text-sm">
          <Icon name="documento" className="h-4 w-4" /> {etapa === 'sin_ticket' ? 'Generar ticket' : etapa === 'por_cobrar' ? 'Marcar cobrado' : 'Abrir'}
        </Link>
        <button type="button" className="btn btn-sec flex-1 py-2 text-sm" onClick={() => onHistorial({ presupuestoId: p.id, titulo: `Historial · Presupuesto Nº ${numeroPresupuesto(p.numero)}` })}>
          <Icon name="reloj" className="h-4 w-4" /> Historial
        </button>
      </div>
    </li>
  );
}

function FilaSuelto({ fila, onHistorial, onCorregir }) {
  const { t, etapa } = fila;
  const info = INFO[etapa] || { texto: etapa === 'terminado' ? 'Terminado' : 'Cancelado', clase: etapa === 'terminado' ? 'bg-menta-500/15 text-menta-300' : 'bg-navy-700 text-tinta-400' };
  return (
    <li className={`tarjeta p-3.5 ${fila.alertas.length ? 'border-red-500/40' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-tinta-400">Sin presupuesto (mantenimiento u otro)</p>
          <p className="truncate font-bold">{t.cliente || 'Sin cliente'}</p>
          {t.titulo && <p className="truncate text-sm text-tinta-300">{t.titulo}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${info.clase}`}>{info.texto}</span>
      </div>
      <ul className="mt-2 rounded-xl bg-navy-850 px-2.5">
        <Ticket t={t} onHistorial={onHistorial} onCorregir={onCorregir} />
      </ul>
      {fila.alertas.map((a) => (
        <p key={a} className="mt-1.5 text-xs font-semibold text-red-300">⚠ {a}</p>
      ))}
    </li>
  );
}

// Correcciones de gerencia (con motivo, quedan en el historial)
function Corregir({ ticket: t, onCerrar, onListo }) {
  const [accion, setAccion] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!t) return;
    setAccion(t.estado === 'realizado' || t.estado === 'cancelado' ? 'reabrir' : 'por_agendar');
    setMotivo('');
    setError('');
  }, [t]);

  if (!t) return null;
  const opciones = [
    (t.estado === 'realizado' || t.estado === 'cancelado') && ['reabrir', 'Reabrir', 'Vuelve a estar agendado para terminarlo'],
    t.estado !== 'cancelado' && ['cancelar', 'Cancelar', 'No se hace: queda cancelado'],
    t.estado !== 'por_agendar' && ['por_agendar', 'Por agendar', 'Se saca del operario para agendarlo de nuevo'],
  ].filter(Boolean);

  async function guardar() {
    if (!motivo.trim()) return setError('Poné el motivo: queda en el historial.');
    setGuardando(true);
    const { error: err } = await supabase.rpc('corregir_ticket', { p_tipo: 'turno', p_id: t.id, p_accion: accion, p_motivo: motivo.trim() });
    setGuardando(false);
    if (err) return setError(mensajeError(err));
    onListo(`Ticket Nº ${numeroTicket(t.numero)} corregido. Quedó registrado en el historial.`);
  }

  return (
    <Modal
      abierto
      onCerrar={() => !guardando && onCerrar()}
      titulo={`Corregir ticket Nº ${numeroTicket(t.numero)}`}
      pie={
        <button type="button" className="btn btn-menta w-full" onClick={guardar} disabled={guardando || !accion}>
          {guardando ? 'Guardando…' : 'Corregir'}
        </button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-tinta-300">Para errores (un ticket cerrado por equivocación, uno que no va, etc.). Lo demás se corrige en su pantalla: el presupuesto, el stock (anulando el comprobante) o la agenda.</p>
        <div className="space-y-1.5">
          {opciones.map(([v, titulo, ayuda]) => (
            <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${accion === v ? 'border-menta-400 bg-menta-500/10' : 'border-navy-700 bg-navy-850'}`}>
              <input type="radio" name="corr" className="mt-1 accent-[#2cc79b]" checked={accion === v} onChange={() => setAccion(v)} />
              <span>
                <b className="block text-sm">{titulo}</b>
                <span className="text-xs text-tinta-400">{ayuda}</span>
              </span>
            </label>
          ))}
        </div>
        <input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Motivo (queda en el historial)" aria-label="Motivo" />
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}
