'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import EditorMateriales from '@/components/EditorMateriales';
import FormTurno from '@/components/FormTurno';
import CompraMateriales from '@/components/CompraMateriales';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { cargarClientes } from '@/lib/clientes';
import { useAjustes } from '@/lib/ajustes';
import { indexarClientes } from '@/lib/agenda';
import { fechaISO } from '@/lib/fechas';
import {
  MONEDAS_PRESUPUESTO, dinero, importeLinea, limpiarMateriales, materialesParaEditar, monedaLinea, numero, textoTotales, totalesMonedas,
} from '@/lib/precios';
import { ESTADOS_PRESUPUESTO, fechaUY, numeroPresupuesto, sumarDiasISO } from '@/lib/presupuestos';
import { crearPdfPresupuesto, nombreArchivoPresupuesto } from '@/lib/presupuestoPdf';
import { AVISO_SQL_04, faltaSql04 } from '@/lib/sql';
import { linkWhatsapp, mensajeError } from '@/lib/util';
import { esBusiness, esPro } from '@/lib/planes';
import { avisar } from '@/lib/avisos';
import BloqueoPlan from '@/components/BloqueoPlan';

const texto = (v) => (v === null || v === undefined ? '' : String(v));

function formDesde(p) {
  return {
    cliente_id: p.cliente_id || '',
    cliente_nombre: p.cliente_nombre || '',
    cliente_direccion: p.cliente_direccion || '',
    titulo: p.titulo || '',
    fecha: p.fecha,
    validez_dias: texto(p.validez_dias ?? 15),
    items: materialesParaEditar(p.items),
    mano_obra: texto(p.mano_obra),
    mano_obra_texto: p.mano_obra_texto || 'Mano de obra',
    iva_porcentaje: texto(p.iva_porcentaje ?? 22),
    notas: p.notas || '',
    moneda: p.moneda || 'UYU',
    cotizacion: texto(p.cotizacion),
    mano_obra_moneda: p.mano_obra_moneda || 'UYU',
    vendedor_id: p.vendedor_id || '',
  };
}

function filaDesde(f, conMonedas = false) {
  return {
    cliente_id: f.cliente_id || null,
    cliente_nombre: f.cliente_nombre.trim() || null,
    cliente_direccion: f.cliente_direccion.trim() || null,
    titulo: f.titulo.trim() || null,
    fecha: f.fecha,
    validez_dias: Math.min(365, Math.max(1, Math.round(numero(f.validez_dias) || 15))),
    items: limpiarMateriales(f.items),
    mano_obra: numero(f.mano_obra),
    mano_obra_texto: f.mano_obra_texto.trim() || 'Mano de obra',
    iva_porcentaje: Math.min(100, Math.max(0, numero(f.iva_porcentaje) ?? 22)),
    notas: f.notas.trim() || null,
    // Moneda (SQL 12): solo se manda si se usa, así sigue andando sin el SQL
    ...(conMonedas || f.moneda !== 'UYU'
      ? {
          moneda: f.moneda,
          cotizacion: numero(f.cotizacion) > 0 ? numero(f.cotizacion) : null,
          mano_obra_moneda: f.moneda === 'mixto' ? f.mano_obra_moneda : f.moneda === 'USD' ? 'USD' : 'UYU',
          ...(f.vendedor_id ? { vendedor_id: f.vendedor_id } : {}),
        }
      : {}),
  };
}

async function bajarLogo(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch {
    return null;
  }
}

export default function EditorPresupuesto() {
  const { plan } = usePanel();
  if (esPro(plan?.plan)) return <EditorPresupuestoPro />;
  return (
    <div className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <Link href="/panel/finanzas/presupuestos" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-tinta-400">
        <Icon name="izq" className="h-4 w-4" /> Presupuestos
      </Link>
      <BloqueoPlan titulo="Presupuestos profesionales" texto="Ver y editar presupuestos es parte del plan Pro." />
    </div>
  );
}

function EditorPresupuestoPro() {
  const { id } = useParams();
  const router = useRouter();
  const { profesional, user, yo, empresa, permisos } = usePanel();
  const { ajustes } = useAjustes(profesional.id);
  const [revision, setRevision] = useState(null); // stock y precio de hoy de los materiales del catálogo
  const puedeComprar = !empresa || yo?.id === profesional.id || (permisos || []).includes('compras');
  const [p, setP] = useState(null);
  const [form, setForm] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState({});
  const [cambios, setCambios] = useState(false);
  const [modalTurno, setModalTurno] = useState(null);
  const [pdfListo, setPdfListo] = useState(null); // si el celular pide tocar de nuevo para compartir
  const [vendedores, setVendedores] = useState(null); // quien maneja comisiones puede elegir el vendedor
  const [comision, setComision] = useState(null);
  const business = esBusiness(usePanel().plan?.plan);

  const cargar = useCallback(async () => {
    const [{ data, error }, cl] = await Promise.all([
      supabase.from('presupuestos').select('*').eq('id', id).maybeSingle(),
      cargarClientes(profesional.id),
    ]);
    setCargando(false);
    if (error) return setAviso({ error: faltaSql04(error) ? AVISO_SQL_04 : mensajeError(error) });
    setClientes(cl.data || []);
    setP(data);
    if (data) setForm(formDesde(data));
    setCambios(false);
  }, [id, profesional.id]);

  const cargarComision = useCallback(async () => {
    const { data } = await supabase.from('comisiones').select('*').eq('presupuesto_id', id).maybeSingle();
    setComision(data || null);
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Comisiones (SQL 12, Business): vendedores y la comisión de este presupuesto
  useEffect(() => {
    if (!business) return;
    supabase.rpc('vendedores_comision', { p_cuenta: profesional.id }).then(({ data, error }) => setVendedores(error ? null : data || []));
    cargarComision();
  }, [business, profesional.id, cargarComision]);

  const indice = useMemo(() => indexarClientes(clientes), [clientes]);

  if (cargando) return <p className="p-4 text-tinta-400">Cargando…</p>;
  if (!p || !form) {
    return (
      <div className="p-4">
        <p className="text-tinta-300">{aviso.error || 'No encontramos este presupuesto.'}</p>
        <Link href="/panel/finanzas/presupuestos" className="btn btn-sec mt-4">Volver a presupuestos</Link>
      </div>
    );
  }

  const cambiar = (campo, v) => {
    setForm((f) => ({ ...f, [campo]: v }));
    setCambios(true);
  };
  const tm = totalesMonedas(form);
  const dosMonedas = tm.usaUSD && tm.usaUYU;
  const usaDolares = form.moneda !== 'UYU';
  const faltaCotizacion = usaDolares && !(numero(form.cotizacion) > 0);
  const monedaMO = form.moneda === 'mixto' ? form.mano_obra_moneda : form.moneda === 'USD' ? 'USD' : 'UYU';
  const estado = ESTADOS_PRESUPUESTO[p.estado] || ESTADOS_PRESUPUESTO.borrador;
  const cliente = clientes.find((c) => c.id === form.cliente_id);
  const negocio = {
    nombre: profesional.nombre_publico,
    razon_social: ajustes.razon_social,
    rut: ajustes.rut,
    telefono: ajustes.telefono || profesional.whatsapp,
    email: ajustes.email || user.email,
    direccion: ajustes.direccion,
  };

  // Al pasar todo a pesos o a dólares, los precios se convierten con la cotización
  function elegirMoneda(m) {
    if (m === form.moneda) return;
    const cotTexto = m !== 'UYU' && !numero(form.cotizacion) && ajustes.cotizacion_dolar ? String(ajustes.cotizacion_dolar) : form.cotizacion;
    const cot = numero(cotTexto);
    let convertidos = 0;
    const convertir = (valor, de) => {
      const v = numero(valor);
      if (v === null || de === m || !(cot > 0)) return valor;
      convertidos += 1;
      return String(Math.round((m === 'USD' ? v / cot : v * cot) * 100) / 100);
    };
    const items =
      m === 'mixto'
        ? form.items.map((x) => ({ ...x, moneda: monedaLinea(x, form.moneda) }))
        : form.items.map((x) => {
            const de = monedaLinea(x, form.moneda);
            return { ...x, costo: convertir(x.costo, de), precio: convertir(x.precio, de), moneda: m };
          });
    const moDe = form.moneda === 'mixto' ? form.mano_obra_moneda : form.moneda === 'USD' ? 'USD' : 'UYU';
    const manoObra = m === 'mixto' ? form.mano_obra : convertir(form.mano_obra, moDe);
    setForm((f) => ({ ...f, moneda: m, cotizacion: cotTexto, items, mano_obra: manoObra, mano_obra_moneda: m === 'mixto' ? moDe : m === 'USD' ? 'USD' : 'UYU' }));
    setCambios(true);
    if (convertidos > 0) setAviso({ ok: `Pasé los precios a ${m === 'USD' ? 'dólares' : 'pesos'} con el dólar a ${dinero(cot, 'UYU')}. Revisalos y guardá.` });
    else if (m !== 'mixto' && !(cot > 0) && form.items.some((x) => numero(x.precio))) setAviso({ error: 'Poné la cotización del dólar y revisá los precios: quedaron como estaban.' });
  }

  async function calcularComision() {
    setAviso({});
    const { error } = await supabase.rpc('calcular_comision', { p_presupuesto: p.id });
    if (error) return setAviso({ error: mensajeError(error) });
    avisar();
    cargarComision();
    setAviso({ ok: 'Comisión calculada.' });
  }

  function elegirCliente(clienteId) {
    const c = clientes.find((x) => x.id === clienteId);
    setForm((f) => ({
      ...f,
      cliente_id: clienteId,
      cliente_nombre: c ? c.nombre : f.cliente_nombre,
      cliente_direccion: c && !f.cliente_direccion.trim() ? c.direcciones?.[0]?.direccion || '' : f.cliente_direccion,
    }));
    setCambios(true);
  }

  // Guarda el formulario (y algún cambio extra como el estado). Devuelve la fila guardada.
  async function guardar(extra = {}, mensaje = 'Guardado.') {
    setAviso({});
    setOcupado(true);
    const { data, error } = await supabase
      .from('presupuestos')
      .update({ ...filaDesde(form, 'moneda' in p), ...extra })
      .eq('id', p.id)
      .select('*')
      .single();
    setOcupado(false);
    if (error) {
      setAviso({ error: faltaSql04(error) ? AVISO_SQL_04 : mensajeError(error) });
      return null;
    }
    setP(data);
    setForm(formDesde(data));
    setCambios(false);
    if (mensaje) setAviso({ ok: mensaje });
    if ('cobrado_en' in extra || 'vendedor_id' in extra) {
      avisar();
      cargarComision();
    }
    return data;
  }

  async function armarPdf() {
    const guardado = await guardar({}, '');
    if (!guardado) return null;
    setOcupado(true);
    try {
      const logo = await bajarLogo(ajustes.logo_url);
      const bytes = await crearPdfPresupuesto({ presupuesto: guardado, negocio, logo });
      return new File([bytes], nombreArchivoPresupuesto(guardado), { type: 'application/pdf' });
    } catch (e) {
      setAviso({ error: `No se pudo armar el PDF: ${mensajeError(e)}` });
      return null;
    } finally {
      setOcupado(false);
    }
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

  async function enviarArchivo(archivo) {
    let compartido = false;
    try {
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [archivo] })) {
        await navigator.share({ files: [archivo], title: archivo.name });
      } else {
        bajar(archivo);
      }
      compartido = true;
      setPdfListo(null);
    } catch (e) {
      // Algunos celulares piden un segundo toque después de armar el PDF
      if (e?.name === 'NotAllowedError') setPdfListo(archivo);
    }
    if (compartido && p.estado === 'borrador') await guardar({ estado: 'enviado' }, 'Presupuesto enviado.');
  }

  async function compartir() {
    const archivo = await armarPdf();
    if (archivo) await enviarArchivo(archivo);
  }

  async function descargar() {
    const archivo = await armarPdf();
    if (archivo) bajar(archivo);
  }

  async function ver() {
    const archivo = await armarPdf();
    if (!archivo) return;
    const url = URL.createObjectURL(archivo);
    const ventana = window.open(url, '_blank');
    if (!ventana) bajar(archivo);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function eliminar() {
    if (!window.confirm(`¿Eliminar el presupuesto Nº ${numeroPresupuesto(p.numero)}?`)) return;
    const { error } = await supabase.from('presupuestos').delete().eq('id', p.id);
    if (error) return setAviso({ error: mensajeError(error) });
    router.replace('/panel/finanzas/presupuestos');
  }

  const hasta = sumarDiasISO(form.fecha, numero(form.validez_dias) || 15);
  const telefono = cliente?.telefono;
  const textoWhatsapp = `Hola ${form.cliente_nombre || ''}! Te paso el presupuesto Nº ${numeroPresupuesto(p.numero)} por ${textoTotales(tm)} (IVA incluido). Cualquier consulta me decís.${
    negocio.nombre ? ` — ${negocio.nombre}` : ''
  }`;
  const filasCliente = [
    ...form.items
      .filter((m) => String(m.item || '').trim())
      .map((m) => ({ desc: m.item, cant: numero(m.cantidad) ?? 0, unit: numero(m.precio) ?? 0, imp: importeLinea(m), mon: monedaLinea(m, form.moneda) })),
    ...(tm[monedaMO].manoObra > 0
      ? [{ desc: form.mano_obra_texto || 'Mano de obra', cant: 1, unit: tm[monedaMO].manoObra, imp: tm[monedaMO].manoObra, mon: monedaMO }]
      : []),
  ];
  const monedasCliente = dosMonedas ? ['USD', 'UYU'] : [tm.usaUSD ? 'USD' : 'UYU'];

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/panel/finanzas/presupuestos" className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver">
            <Icon name="izq" />
          </Link>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-marca-naranja/15 text-marca-naranja">
            <Icon name="documento" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-tinta-400">Presupuesto · {form.cliente_nombre || 'Sin cliente'}</p>
            <h1 className="truncate text-xl font-extrabold">Nº {numeroPresupuesto(p.numero)}</h1>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${estado.clase}`}>{estado.texto}</span>
        </div>
      </header>

      <div className="space-y-6 px-4 pt-4">
        {p.relevamiento_id && (
          <Link href={`/panel/relevamientos/${p.relevamiento_id}`} className="flex items-center gap-2 text-sm font-semibold text-menta-400">
            <Icon name="relevamiento" className="h-4 w-4" /> Ver el relevamiento
          </Link>
        )}

        {/* Cliente y trabajo */}
        <section className="tarjeta space-y-3 p-4">
          <div>
            <label className="etiqueta" htmlFor="p-cli">Cliente</label>
            <select id="p-cli" className="campo" value={form.cliente_id} onChange={(e) => elegirCliente(e.target.value)}>
              <option value="">— Otro (escribir el nombre) —</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>
          {!form.cliente_id && (
            <input className="campo" value={form.cliente_nombre} onChange={(e) => cambiar('cliente_nombre', e.target.value)} placeholder="Nombre del cliente" aria-label="Nombre del cliente" />
          )}
          <input className="campo" value={form.cliente_direccion} onChange={(e) => cambiar('cliente_direccion', e.target.value)} placeholder="Dirección del trabajo" aria-label="Dirección del trabajo" />
          <div>
            <label className="etiqueta" htmlFor="p-titulo">Trabajo</label>
            <input id="p-titulo" className="campo" value={form.titulo} onChange={(e) => cambiar('titulo', e.target.value)} placeholder="Ej. Cambio de tablero y 3 enchufes nuevos" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="etiqueta" htmlFor="p-fecha">Fecha</label>
              <input id="p-fecha" type="date" className="campo" value={form.fecha} onChange={(e) => e.target.value && cambiar('fecha', e.target.value)} />
            </div>
            <div>
              <label className="etiqueta" htmlFor="p-validez">Válido (días)</label>
              <input id="p-validez" type="number" inputMode="numeric" min="1" max="365" className="campo" value={form.validez_dias} onChange={(e) => cambiar('validez_dias', e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-tinta-400">Válido hasta el {fechaUY(hasta)}.</p>
        </section>

        {/* Moneda */}
        <section className="tarjeta space-y-3 p-4">
          <div>
            <p className="etiqueta">¿En qué moneda se cobra?</p>
            <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-navy-850 p-1.5">
              {MONEDAS_PRESUPUESTO.map(([v, t, simbolo]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => elegirMoneda(v)}
                  aria-pressed={form.moneda === v}
                  className={`rounded-xl px-1 py-2 text-sm font-bold ${form.moneda === v ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}
                >
                  {t}
                  <span className="block text-[11px] font-semibold opacity-70">{simbolo}</span>
                </button>
              ))}
            </div>
            {aviso.ok?.startsWith('Pasé') && <p className="mt-1.5 text-xs font-semibold text-menta-300">{aviso.ok}</p>}
            {form.moneda === 'mixto' && (
              <p className="mt-1.5 text-xs text-tinta-400">Cada renglón va en su moneda: tocá el <b>$</b> o <b>US$</b> de cada uno. El cliente ve dos columnas y dos totales.</p>
            )}
          </div>
          {usaDolares && (
            <div className="grid grid-cols-[1fr_9rem] items-end gap-2">
              <label className="text-sm font-semibold text-tinta-300" htmlFor="p-cot">
                Cotización del dólar
                <span className="block text-xs font-normal text-tinta-400">Pesos por US$ 1, para la equivalencia y Finanzas</span>
              </label>
              <input
                id="p-cot"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                className={`campo ${faltaCotizacion ? 'border-amber-400/70' : ''}`}
                value={form.cotizacion}
                onChange={(e) => cambiar('cotizacion', e.target.value)}
                placeholder="Ej. 40,25"
              />
            </div>
          )}
        </section>

        {/* Ítems con costo y margen */}
        <EditorMateriales
          moneda={form.moneda}
          materiales={form.items}
          onChange={(items) => cambiar('items', items)}
          margenDefecto={ajustes.margen_materiales}
          titulo="Materiales e ítems"
          textoAgregar="Agregar ítem"
          vacio="Agregá los materiales con su costo: el margen calcula el precio final de cada ítem. Con Proveedores los buscás en las listas de precios."
          cuenta={profesional.id}
          revision={revision}
        />

        <CompraMateriales
          presupuesto={p}
          items={form.items}
          onItems={(items) => cambiar('items', items)}
          cuenta={profesional.id}
          puedeComprar={puedeComprar}
          revision={revision}
          onRevision={setRevision}
          guardarAntes={() => guardar({}, '')}
        />

        {/* Mano de obra e IVA */}
        <section className="tarjeta space-y-3 p-4">
          <div className="grid grid-cols-[1fr_8rem] gap-2">
            <div>
              <label className="etiqueta" htmlFor="p-mot">Concepto</label>
              <input id="p-mot" className="campo" value={form.mano_obra_texto} onChange={(e) => cambiar('mano_obra_texto', e.target.value)} />
            </div>
            <div>
              <label className="etiqueta" htmlFor="p-mo">Mano de obra</label>
              <div className="flex gap-1">
                {form.moneda === 'mixto' && (
                  <button
                    type="button"
                    onClick={() => cambiar('mano_obra_moneda', monedaMO === 'USD' ? 'UYU' : 'USD')}
                    className={`shrink-0 rounded-lg px-2 text-xs font-extrabold ${monedaMO === 'USD' ? 'bg-[#2f9e5b]/25 text-[#7be0a5]' : 'bg-[#176ba8]/25 text-[#8cc4ee]'}`}
                    aria-label="Moneda de la mano de obra (tocá para cambiar)"
                  >
                    {monedaMO === 'USD' ? 'US$' : '$'}
                  </button>
                )}
                <input id="p-mo" type="number" inputMode="decimal" min="0" className="campo min-w-0" value={form.mano_obra} onChange={(e) => cambiar('mano_obra', e.target.value)} placeholder={monedaMO === 'USD' ? 'US$' : 'UYU'} />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-semibold text-tinta-300" htmlFor="p-iva">IVA (%)</label>
            <input id="p-iva" type="number" inputMode="decimal" min="0" max="100" className="campo w-32" value={form.iva_porcentaje} onChange={(e) => cambiar('iva_porcentaje', e.target.value)} />
          </div>
          <div className="border-t border-navy-800 pt-3 text-sm">
            <div className={`grid gap-x-3 gap-y-1 ${dosMonedas ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[1fr_auto]'}`}>
              {dosMonedas && (
                <>
                  <span />
                  <span className="text-right text-[11px] font-bold uppercase text-[#7be0a5]">US$</span>
                  <span className="text-right text-[11px] font-bold uppercase text-[#8cc4ee]">Pesos</span>
                </>
              )}
              {[
                ['Materiales', 'venta', 'text-tinta-300'],
                ['Mano de obra', 'manoObra', 'text-tinta-300'],
                ['Subtotal', 'subtotal', 'font-semibold'],
                [`IVA ${numero(form.iva_porcentaje) ?? 0}%`, 'iva', 'text-tinta-300'],
              ].map(([etq, campo, clase]) => (
                <div key={campo} className={`contents ${clase}`}>
                  <span>{etq}</span>
                  {monedasCliente.map((k) => (
                    <span key={k} className="text-right tabular-nums">{dinero(tm[k][campo], k)}</span>
                  ))}
                </div>
              ))}
              <div className="contents text-lg font-extrabold">
                <span className="pt-1">Total IVA inc.</span>
                {monedasCliente.map((k) => (
                  <span key={k} className="pt-1 text-right tabular-nums text-menta-300">{dinero(tm[k].total, k)}</span>
                ))}
              </div>
            </div>
            {usaDolares && tm.cotizacion > 0 && (
              <p className="mt-2 rounded-xl bg-[#176ba8]/15 p-2.5 text-xs text-[#a9d4f5]">
                {dosMonedas ? 'Todo junto equivale' : 'Equivale'} a <b>{dinero(tm.equivalente.total, 'UYU')}</b> o <b>{dinero(tm.equivalente.total / tm.cotizacion, 'USD')}</b> con el dólar a{' '}
                {dinero(tm.cotizacion, 'UYU')}.
              </p>
            )}
            {faltaCotizacion && <p className="mt-2 text-xs font-semibold text-amber-300">Poné la cotización del dólar para poder guardar.</p>}
          </div>
          <p className="rounded-xl bg-navy-850 p-2.5 text-xs text-tinta-400">
            Solo para vos: costo de materiales {monedasCliente.map((k) => dinero(tm[k].costo, k)).join(' + ')} · ganancia{' '}
            {monedasCliente.map((k) => dinero(tm[k].ganancia, k)).join(' + ')} (con la mano de obra).
          </p>
        </section>

        <section>
          <label className="etiqueta" htmlFor="p-notas">Condiciones</label>
          <textarea id="p-notas" rows={3} className="campo" value={form.notas} onChange={(e) => cambiar('notas', e.target.value)} placeholder="Forma de pago, garantía, plazo…" />
        </section>

        {aviso.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{aviso.error}</p>}
        {aviso.ok && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{aviso.ok}</p>}

        <button className={`btn w-full ${cambios ? 'btn-menta' : 'btn-sec'}`} onClick={() => guardar()} disabled={ocupado}>
          {ocupado ? 'Guardando…' : cambios ? 'Guardar cambios' : 'Guardado'}
        </button>

        {/* Lo que ve el cliente */}
        <section>
          <h2 className="titulo-seccion mb-2">Así lo ve tu cliente</h2>
          <div className="overflow-hidden rounded-2xl bg-white p-4 text-[#1d2633] shadow-lg">
            <div className="flex items-start justify-between gap-3">
              {ajustes.logo_url ? <img src={ajustes.logo_url} alt="" className="h-12 max-w-[7rem] object-contain" /> : <span />}
              <div className="text-right text-[11px] leading-tight text-[#6b7684]">
                <p className="text-sm font-bold text-[#0b1730]">{negocio.nombre}</p>
                {[negocio.razon_social, negocio.rut && `RUT ${negocio.rut}`, negocio.telefono, negocio.email].filter(Boolean).map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </div>
            </div>
            <div className="mt-3 flex items-end justify-between border-t-2 border-[#ec8328] pt-2">
              <p className="text-lg font-extrabold text-[#0b1730]">PRESUPUESTO</p>
              <p className="text-right text-[11px] text-[#6b7684]">
                <b className="text-[#0b1730]">Nº {numeroPresupuesto(p.numero)}</b>
                <br />
                {fechaUY(form.fecha)} · válido hasta {fechaUY(hasta)}
              </p>
            </div>
            <div className="mt-2 rounded-lg bg-[#f3f6f9] p-2 text-xs">
              <p className="font-bold text-[#0b1730]">{form.cliente_nombre || '—'}</p>
              {form.cliente_direccion && <p>{form.cliente_direccion}</p>}
              {form.titulo && <p>Trabajo: {form.titulo}</p>}
            </div>
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="bg-[#0b1730] text-white">
                  <th className="px-2 py-1.5 text-left font-semibold">Descripción</th>
                  {!dosMonedas && <th className="px-1 py-1.5 text-right font-semibold">Cant.</th>}
                  {!dosMonedas && <th className="px-1 py-1.5 text-right font-semibold">Unit.</th>}
                  {monedasCliente.map((k) => (
                    <th key={k} className="px-2 py-1.5 text-right font-semibold">{dosMonedas ? (k === 'USD' ? 'US$' : '$') : 'Importe'}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filasCliente.map((f, i) => (
                  <tr key={i} className={i % 2 ? 'bg-[#f3f6f9]' : ''}>
                    <td className="px-2 py-1.5">
                      {f.desc}
                      {dosMonedas && (
                        <span className="block text-[10px] text-[#6b7684]">
                          {f.cant.toLocaleString('es-UY')} × {dinero(f.unit, f.mon)}
                        </span>
                      )}
                    </td>
                    {!dosMonedas && <td className="px-1 py-1.5 text-right">{f.cant.toLocaleString('es-UY')}</td>}
                    {!dosMonedas && <td className="px-1 py-1.5 text-right whitespace-nowrap">{dinero(f.unit, f.mon)}</td>}
                    {monedasCliente.map((k) => (
                      <td key={k} className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">{f.mon === k ? dinero(f.imp, k) : ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 ml-auto w-60 space-y-0.5 text-xs">
              {[
                ['Subtotal', 'subtotal'],
                [`IVA ${numero(form.iva_porcentaje) ?? 0}%`, 'iva'],
              ].map(([etq, campo]) => (
                <div key={campo} className="flex justify-between gap-2 text-[#6b7684]">
                  <span>{etq}</span>
                  <span className="text-right">{monedasCliente.map((k) => dinero(tm[k][campo], k)).join(' + ')}</span>
                </div>
              ))}
              {monedasCliente.map((k) => (
                <div key={k} className="flex justify-between rounded bg-[#0b1730] px-2 py-1 text-sm font-bold text-white">
                  <span>Total{dosMonedas ? (k === 'USD' ? ' en dólares' : ' en pesos') : ''}</span>
                  <span>{dinero(tm[k].total, k)}</span>
                </div>
              ))}
              {usaDolares && tm.cotizacion > 0 && (
                <p className="pt-0.5 text-right text-[10px] text-[#6b7684]">
                  Equivale a {dinero(tm.equivalente.total, 'UYU')} (US$ 1 = {dinero(tm.cotizacion, 'UYU')})
                </p>
              )}
            </div>
            {form.notas && <p className="mt-3 whitespace-pre-line text-[11px] text-[#6b7684]">{form.notas}</p>}
          </div>
          {!ajustes.logo_url && (
            <p className="mt-2 text-xs text-tinta-400">
              ¿Tenés logo? Subilo en <Link href="/panel/perfil" className="font-semibold text-menta-400">Perfil</Link> y sale en el presupuesto.
            </p>
          )}
        </section>

        {/* Enviar */}
        <section className="space-y-2">
          {pdfListo ? (
            <button className="btn btn-menta w-full py-3.5" onClick={() => enviarArchivo(pdfListo)}>
              <Icon name="compartir" /> PDF listo: tocá para compartir
            </button>
          ) : (
            <button className="btn btn-menta w-full py-3.5" onClick={compartir} disabled={ocupado}>
              <Icon name="compartir" /> {ocupado ? 'Armando el PDF…' : 'Compartir PDF'}
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-sec" onClick={descargar} disabled={ocupado}>
              <Icon name="descargar" /> Descargar
            </button>
            <button className="btn btn-sec" onClick={ver} disabled={ocupado}>
              <Icon name="ojo" /> Ver PDF
            </button>
          </div>
          {telefono && (
            <a href={linkWhatsapp(telefono, textoWhatsapp)} target="_blank" rel="noreferrer" className="btn btn-sec w-full">
              <Icon name="whatsapp" /> Avisarle por WhatsApp
            </a>
          )}
        </section>

        {/* Estado y cobro */}
        <section>
          <h2 className="titulo-seccion mb-2">Estado</h2>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {Object.entries(ESTADOS_PRESUPUESTO).map(([valor, e]) => (
              <button
                key={valor}
                type="button"
                onClick={() => p.estado !== valor && guardar({ estado: valor }, valor === 'aceptado' ? '¡Aceptado! Ya cuenta como ingreso en Finanzas.' : 'Estado guardado.')}
                className={`chip ${p.estado === valor ? 'chip-activo' : ''}`}
                disabled={ocupado}
              >
                {e.texto}
              </button>
            ))}
          </div>
          {p.estado === 'aceptado' && (
            <div className="tarjeta mt-3 space-y-3 p-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[#2cc79b]"
                  checked={!!p.cobrado_en}
                  onChange={(e) => guardar({ cobrado_en: e.target.checked ? fechaISO(new Date()) : null }, e.target.checked ? 'Marcado como cobrado.' : 'Quedó por cobrar.')}
                />
                <span>
                  <b>Cobrado</b>
                  <span className="block text-xs text-tinta-400">Aceptado el {fechaUY(p.aceptado_en)}{p.cobrado_en ? ` · cobrado el ${fechaUY(p.cobrado_en)}` : ''}</span>
                </span>
              </label>
              {p.cobrado_en && (
                <input type="date" className="campo" value={p.cobrado_en} onChange={(e) => e.target.value && guardar({ cobrado_en: e.target.value }, 'Fecha de cobro guardada.')} aria-label="Fecha de cobro" />
              )}
              {form.cliente_id && (
                <button type="button" className="btn btn-sec w-full" onClick={() => setModalTurno({ inicial: { cliente_id: form.cliente_id, fecha: fechaISO(new Date()), hora: '09:00' } })}>
                  <Icon name="agenda" /> Agendar el trabajo
                </button>
              )}
            </div>
          )}
        </section>

        {/* Vendedor y comisión (Business) */}
        {business && (vendedores || comision || p.vendedor_id) && (
          <section>
            <h2 className="titulo-seccion mb-2">Venta y comisión</h2>
            <div className="tarjeta space-y-3 p-4">
              {vendedores ? (
                <div>
                  <label className="etiqueta" htmlFor="p-vend">Vendedor</label>
                  <select
                    id="p-vend"
                    className="campo"
                    value={form.vendedor_id}
                    onChange={(e) => e.target.value && guardar({ vendedor_id: e.target.value }, 'Vendedor guardado.')}
                    disabled={ocupado}
                  >
                    {!form.vendedor_id && <option value="">Sin vendedor</option>}
                    {vendedores.map((v) => (
                      <option key={v.usuario_id} value={v.usuario_id}>
                        {v.nombre}
                        {v.principal ? ' (cuenta principal)' : ''}
                        {v.activo && v.porcentaje !== null ? ` · ${Number(v.porcentaje).toLocaleString('es-UY')}% de la ${v.base === 'ganancia' ? 'ganancia' : 'venta'}` : ' · sin comisión'}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-sm text-tinta-300">
                  Vendedor: <b>{p.vendedor_id === user.id ? 'vos' : comision?.vendedor_nombre || 'otra persona del equipo'}</b>
                </p>
              )}
              {comision ? (
                <Link href="/panel/finanzas/comisiones" className="flex items-center gap-3 rounded-xl bg-navy-850 p-3 text-sm hover:bg-navy-800">
                  <Icon name="billetera" className="h-5 w-5 shrink-0 text-menta-300" />
                  <span className="min-w-0 flex-1">
                    <b className="block">
                      Comisión de {comision.vendedor_nombre || 'el vendedor'}:{' '}
                      {[comision.monto_usd > 0 && dinero(comision.monto_usd, 'USD'), (comision.monto_uyu > 0 || !(comision.monto_usd > 0)) && dinero(comision.monto_uyu, 'UYU')]
                        .filter(Boolean)
                        .join(' + ')}
                    </b>
                    <span className="text-xs text-tinta-400">
                      {Number(comision.porcentaje).toLocaleString('es-UY')}% de la {comision.base === 'ganancia' ? 'ganancia' : 'venta sin IVA'} ·{' '}
                      {comision.estado === 'pagada' ? `pagada el ${fechaUY(comision.pagada_en)}` : comision.estado === 'anulada' ? 'anulada' : 'pendiente de pago'}
                    </span>
                  </span>
                  <Icon name="der" className="h-4 w-4 shrink-0 text-tinta-400" />
                </Link>
              ) : p.cobrado_en ? (
                vendedores ? (
                  <button type="button" className="btn btn-sec w-full" onClick={calcularComision} disabled={ocupado}>
                    <Icon name="calculadora" className="h-4 w-4" /> Calcular la comisión
                  </button>
                ) : (
                  <p className="text-xs text-tinta-400">Este presupuesto no generó comisión.</p>
                )
              ) : (
                <p className="text-xs text-tinta-400">La comisión se genera sola cuando lo marcás como cobrado.</p>
              )}
            </div>
          </section>
        )}

        <button type="button" className="btn btn-peligro w-full" onClick={eliminar}>
          <Icon name="borrar" /> Eliminar presupuesto
        </button>
      </div>

      <FormTurno
        abierto={!!modalTurno}
        onCerrar={() => setModalTurno(null)}
        onGuardado={() => setAviso({ ok: 'Trabajo agendado.' })}
        profesionalId={profesional.id}
        nombreProfesional={profesional.nombre_publico}
        clientes={clientes}
        bloques={[]}
        indice={indice}
        turno={null}
        inicial={modalTurno?.inicial}
      />
    </>
  );
}
