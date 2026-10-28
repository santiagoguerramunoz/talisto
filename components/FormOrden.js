'use client';

import { useEffect, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import SelectorUbicacion from './SelectorUbicacion';
import { supabase } from '@/lib/supabase';
import { fechaISO, minutos } from '@/lib/fechas';
import { equivalenteOrden, importeOrden } from '@/lib/liquidacion';
import { linkGoogleMaps, linkWaze, mensajeError, monto } from '@/lib/util';

const ESTADOS_ORDEN = { pendiente: 'Pendiente', realizado: 'Realizada', cancelado: 'Cancelada' };

function Contador({ etiqueta, ayuda, valor, onChange }) {
  const v = Number(valor) || 0;
  const fijar = (n) => onChange(Math.max(0, Math.round(n * 2) / 2));
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-850 p-3">
      <p className="text-sm font-bold">{etiqueta}</p>
      {ayuda && <p className="text-xs text-tinta-400">{ayuda}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <button type="button" onClick={() => fijar(v - 0.5)} className="grid h-10 w-10 place-items-center rounded-xl bg-navy-700 text-xl font-bold" aria-label={`Restar medio ${etiqueta}`}>−</button>
        <span className="min-w-12 text-center text-2xl font-extrabold tabular-nums">{v.toLocaleString('es-UY', { minimumFractionDigits: v % 1 ? 1 : 0 })}</span>
        <button type="button" onClick={() => fijar(v + 0.5)} className="grid h-10 w-10 place-items-center rounded-xl bg-menta-500 text-xl font-bold text-navy-950" aria-label={`Sumar medio ${etiqueta}`}>+</button>
      </div>
    </div>
  );
}

export default function FormOrden({ abierto, onCerrar, onGuardado, profesionalId, empresas = [], orden, inicial }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) {
      setForm(null);
      return;
    }
    setError('');
    if (orden) {
      setForm({
        empresa_id: orden.empresa_id,
        numero_cliente: orden.numero_cliente || '',
        numero_ticket: orden.numero_ticket || '',
        fecha: orden.fecha,
        conHorario: !!orden.hora_inicio,
        desde: orden.hora_inicio ? String(orden.hora_inicio).slice(0, 5) : '09:00',
        hasta: orden.hora_fin ? String(orden.hora_fin).slice(0, 5) : '',
        cliente_final: orden.cliente_final || '',
        ubicacion: { direccion: orden.direccion || '', lat: orden.lat, lng: orden.lng },
        referencia: orden.referencia || '',
        pedido: orden.pedido || '',
        realizado: orden.realizado || '',
        acondicionamientos: Number(orden.acondicionamientos || 0),
        moes: Number(orden.moes || 0),
        precio: orden.precio_acondicionamiento ?? '',
        factor: orden.factor_moe ?? 1.75,
        estado: orden.estado,
      });
    } else {
      const empresa = empresas.find((e) => e.id === inicial?.empresa_id) || empresas[0];
      setForm({
        empresa_id: empresa?.id || '',
        numero_cliente: '',
        numero_ticket: '',
        fecha: inicial?.fecha || fechaISO(new Date()),
        conHorario: false,
        desde: '09:00',
        hasta: '',
        cliente_final: '',
        ubicacion: { direccion: '', lat: null, lng: null },
        referencia: '',
        pedido: '',
        realizado: '',
        acondicionamientos: 1,
        moes: 0,
        precio: empresa?.precio_acondicionamiento ?? '',
        factor: empresa?.factor_moe ?? 1.75,
        estado: 'pendiente',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, orden, inicial]);

  if (!form) return null;

  const cambiar = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const empresa = empresas.find((e) => e.id === form.empresa_id);

  function cambiarEmpresa(id) {
    const e = empresas.find((x) => x.id === id);
    setForm((f) => ({ ...f, empresa_id: id, precio: e?.precio_acondicionamiento ?? f.precio, factor: e?.factor_moe ?? f.factor }));
  }

  const calculo = {
    acondicionamientos: form.acondicionamientos,
    moes: form.moes,
    factor_moe: Number(form.factor) || 1.75,
    precio_acondicionamiento: form.precio === '' ? null : Number(form.precio),
  };
  const equivalente = equivalenteOrden(calculo);
  const importe = importeOrden(calculo);

  async function guardar(marcarRealizada = false) {
    setError('');
    if (!form.empresa_id) return setError('Elegí la empresa.');
    if (!form.numero_ticket.trim() && !form.numero_cliente.trim()) return setError('Poné al menos el número de ticket o el número de cliente.');
    if (form.conHorario && form.hasta && minutos(form.hasta) <= minutos(form.desde)) return setError('La hora de fin tiene que ser después de la de inicio.');

    // Aviso si ese ticket ya está cargado
    if (form.numero_ticket.trim()) {
      let q = supabase
        .from('ordenes')
        .select('id, fecha')
        .eq('empresa_id', form.empresa_id)
        .eq('numero_ticket', form.numero_ticket.trim())
        .limit(1);
      if (orden?.id) q = q.neq('id', orden.id);
      const { data: repetida } = await q;
      if (repetida?.length && !window.confirm(`El ticket ${form.numero_ticket.trim()} ya está cargado (${repetida[0].fecha}). ¿Guardar igual?`)) return;
    }

    setGuardando(true);
    const fila = {
      profesional_id: profesionalId,
      empresa_id: form.empresa_id,
      numero_cliente: form.numero_cliente.trim() || null,
      numero_ticket: form.numero_ticket.trim() || null,
      fecha: form.fecha,
      hora_inicio: form.conHorario ? form.desde : null,
      hora_fin: form.conHorario && form.hasta ? form.hasta : null,
      cliente_final: form.cliente_final.trim() || null,
      direccion: form.ubicacion.direccion?.trim() || null,
      referencia: form.referencia.trim() || null,
      lat: form.ubicacion.lat ?? null,
      lng: form.ubicacion.lng ?? null,
      pedido: form.pedido.trim() || null,
      realizado: form.realizado.trim() || null,
      acondicionamientos: form.acondicionamientos,
      moes: form.moes,
      precio_acondicionamiento: form.precio === '' ? null : Number(form.precio),
      factor_moe: Number(form.factor) || 1.75,
      estado: marcarRealizada ? 'realizado' : form.estado,
    };
    const consulta = orden?.id ? supabase.from('ordenes').update(fila).eq('id', orden.id) : supabase.from('ordenes').insert(fila);
    const { error: err } = await consulta;
    setGuardando(false);
    if (err) {
      setError(
        /ordenes|es_empresa/.test(err.message || '') && /does not exist|could not find/i.test(err.message || '')
          ? 'Falta correr en Supabase el archivo 03_ordenes_empresa.sql.'
          : mensajeError(err)
      );
      return;
    }
    onGuardado?.();
    onCerrar();
  }

  async function eliminar() {
    if (!orden?.id || !window.confirm('¿Eliminar esta orden?')) return;
    const { error: err } = await supabase.from('ordenes').delete().eq('id', orden.id);
    if (err) return setError(mensajeError(err));
    onGuardado?.();
    onCerrar();
  }

  const ubic = form.ubicacion;
  const tienePin = ubic.lat !== null && ubic.lat !== undefined;

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={orden?.id ? `Orden ${orden.numero_ticket || ''}`.trim() : 'Nueva orden'}
      pie={
        <div className="flex gap-2">
          {orden?.id && (
            <button type="button" className="btn btn-peligro px-3" onClick={eliminar} aria-label="Eliminar orden">
              <Icon name="borrar" />
            </button>
          )}
          {form.estado !== 'realizado' && (
            <button type="button" className="btn btn-sec flex-1" onClick={() => guardar(true)} disabled={guardando}>
              <Icon name="check" /> Realizada
            </button>
          )}
          <button type="button" className="btn btn-menta flex-1" onClick={() => guardar(false)} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {empresas.length > 1 && (
          <div>
            <label className="etiqueta" htmlFor="o-empresa">Empresa</label>
            <select id="o-empresa" className="campo" value={form.empresa_id} onChange={(e) => cambiarEmpresa(e.target.value)}>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>{e.nombre}</option>
              ))}
            </select>
          </div>
        )}
        {empresas.length === 1 && empresa && (
          <p className="flex items-center gap-2 text-sm text-tinta-300">
            <span className="h-3 w-3 rounded-full" style={{ background: empresa.color }} /> Orden de <b className="text-tinta-100">{empresa.nombre}</b>
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="etiqueta" htmlFor="o-cli">Nº de cliente</label>
            <input id="o-cli" className="campo" value={form.numero_cliente} onChange={(e) => cambiar('numero_cliente', e.target.value)} placeholder="Ej. 55310" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="o-tk">Nº de ticket</label>
            <input id="o-tk" className="campo" value={form.numero_ticket} onChange={(e) => cambiar('numero_ticket', e.target.value)} placeholder="Ej. 88812" />
          </div>
        </div>

        <div>
          <label className="etiqueta" htmlFor="o-fecha">Fecha</label>
          <input id="o-fecha" type="date" className="campo" value={form.fecha} onChange={(e) => e.target.value && cambiar('fecha', e.target.value)} />
          <label className="mt-2 flex items-center gap-2.5 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-[#2cc79b]" checked={form.conHorario} onChange={(e) => cambiar('conHorario', e.target.checked)} />
            Tiene horario
          </label>
          {form.conHorario && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input type="time" step="900" className="campo" value={form.desde} onChange={(e) => e.target.value && cambiar('desde', e.target.value)} aria-label="Desde" />
              <input type="time" step="900" className="campo" value={form.hasta} onChange={(e) => cambiar('hasta', e.target.value)} aria-label="Hasta (opcional)" />
            </div>
          )}
        </div>

        <div>
          <label className="etiqueta" htmlFor="o-final">Cliente de la empresa (nombre o detalle)</label>
          <input id="o-final" className="campo" value={form.cliente_final} onChange={(e) => cambiar('cliente_final', e.target.value)} placeholder="Opcional · no se guarda en tus clientes" />
        </div>

        <div>
          <span className="etiqueta">Dirección</span>
          <SelectorUbicacion valor={ubic} onChange={(u) => cambiar('ubicacion', u)} alto={180} />
          <input className="campo mt-2" value={form.referencia} onChange={(e) => cambiar('referencia', e.target.value)} placeholder="Referencia: apto, timbre, portería…" />
          {tienePin && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <a href={linkGoogleMaps(ubic)} target="_blank" rel="noreferrer" className="btn btn-sec py-2 text-sm"><Icon name="ir" className="h-4 w-4" /> Ir</a>
              <a href={linkWaze(ubic)} target="_blank" rel="noreferrer" className="btn btn-sec py-2 text-sm">Waze</a>
            </div>
          )}
        </div>

        <div>
          <label className="etiqueta" htmlFor="o-pedido">Qué hay que hacer</label>
          <textarea id="o-pedido" rows={2} className="campo" value={form.pedido} onChange={(e) => cambiar('pedido', e.target.value)} placeholder="Lo que dice el ticket" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="o-real">Detalle de lo realizado</label>
          <textarea id="o-real" rows={3} className="campo" value={form.realizado} onChange={(e) => cambiar('realizado', e.target.value)} placeholder="Esto va a la planilla de liquidación" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Contador etiqueta="Acondicionamientos" ayuda="Dispositivo con hasta 15 m de cable" valor={form.acondicionamientos} onChange={(v) => cambiar('acondicionamientos', v)} />
          <Contador etiqueta="MOE" ayuda={`Mano de obra especial (= ${Number(form.factor) || 1.75} acond.)`} valor={form.moes} onChange={(v) => cambiar('moes', v)} />
        </div>

        <div className="rounded-xl bg-navy-850 p-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="etiqueta" htmlFor="o-precio">Precio por acond. (UYU)</label>
              <input id="o-precio" type="number" inputMode="decimal" min="0" className="campo" value={form.precio} onChange={(e) => cambiar('precio', e.target.value)} placeholder="Sin definir" />
            </div>
            <div>
              <label className="etiqueta" htmlFor="o-factor">1 MOE equivale a</label>
              <input id="o-factor" type="number" inputMode="decimal" min="0.25" step="0.25" className="campo" value={form.factor} onChange={(e) => cambiar('factor', e.target.value)} />
            </div>
          </div>
          <p className="mt-2 text-sm text-tinta-300">
            Equivale a <b className="text-tinta-100">{equivalente.toLocaleString('es-UY', { maximumFractionDigits: 3 })}</b> acondicionamientos
            {importe !== null && (
              <>
                {' '}· <b className="text-menta-300">{monto(Math.round(importe * 100) / 100)}</b>
              </>
            )}
          </p>
        </div>

        <div>
          <span className="etiqueta">Estado</span>
          <div className="grid grid-cols-3 gap-1.5">
            {Object.entries(ESTADOS_ORDEN).map(([valor, texto]) => (
              <button key={valor} type="button" onClick={() => cambiar('estado', valor)} className={`chip ${form.estado === valor ? 'chip-activo' : ''}`}>
                {texto}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}
