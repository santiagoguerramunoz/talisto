'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { usePanel } from './PanelContext';
import { supabase } from '@/lib/supabase';
import { useAjustes } from '@/lib/ajustes';
import { comprimirImagen } from '@/lib/imagenes';
import { categoriasDe } from '@/lib/gastos';
import { dinero, numero, r2 } from '@/lib/precios';
import { cotizacionGuardada, guardarCotizacion } from '@/lib/proveedores';
import { normalizarMaterial } from '@/lib/stock';
import { mensajeError } from '@/lib/util';

const TIPOS_OK = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_PDF = 2.8 * 1024 * 1024;
const norm = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const UNIDADES = { u: 'u', un: 'u', uni: 'u', unid: 'u', unidad: 'u', unidades: 'u', und: 'u', uds: 'u', cu: 'u', 'c u': 'u', m: 'm', mt: 'm', mts: 'm', metro: 'm', metros: 'm', kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', l: 'l', lt: 'l', lts: 'l', litro: 'l', litros: 'l', m2: 'm²', m3: 'm³' };
export const unidadNormal = (u) => UNIDADES[norm(u)] || (String(u || '').trim().slice(0, 12) || 'u');
const valor = (v) => (v === null || v === undefined ? '' : String(v));
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
const idNuevo = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const aBase64 = (blob) =>
  new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = mal;
    r.readAsDataURL(blob);
  });

// Material del stock que corresponde a un renglón (código, nombre exacto o parecido)
function materialDe(it, materiales) {
  const q = norm(it.descripcion);
  const cod = norm(it.codigo);
  return (
    (cod && materiales.find((m) => norm(m.codigo) === cod)) ||
    (q && materiales.find((m) => norm(m.nombre) === q)) ||
    (q && materiales.find((m) => norm(m.nombre).length > 3 && (q.includes(norm(m.nombre)) || norm(m.nombre).includes(q)))) ||
    null
  );
}
// Cuánto entra al stock en la unidad del material (si la factura viene por caja o rollo y el material la tiene)
function cantidadStock(it, m) {
  const c = numero(it.cantidad) ?? 1;
  if (!m) return c;
  const pres = (m.presentaciones || []).find((p) => norm(p.nombre) && (norm(p.nombre).includes(norm(it.unidad)) || norm(it.descripcion).includes(norm(p.nombre))));
  return pres && unidadNormal(it.unidad) !== m.unidad ? r2(c * Number(pres.factor)) : c;
}
const importeItem = (it) => r2((numero(it.cantidad) ?? 1) * (numero(it.precio_unitario) ?? 0) * (1 - (numero(it.descuento_pct) ?? 0) / 100));

/**
 * Foto de una factura, e-ticket, remito o comprobante → la IA lo lee → se revisa → gasto o compra (proveedor, precios y stock).
 * retomar: { id, datos, archivos } de un comprobante leído que quedó sin guardar
 */
export default function LeerComprobante({ abierto, onCerrar, onListo, retomar = null }) {
  const { profesional, yo, empresa, permisos, plan } = usePanel();
  const cuenta = profesional.id;
  const principal = !empresa || yo?.id === cuenta;
  const tiene = (p) => principal || (permisos || []).includes(p);
  const puedeGastos = tiene('gastos');
  const puedeCompras = tiene('compras') || tiene('stock');
  const { ajustes } = useAjustes(cuenta);
  const categorias = useMemo(() => categoriasDe(ajustes).map((c) => c.nombre), [ajustes]);

  const [paso, setPaso] = useState('elegir');
  const [archivos, setArchivos] = useState([]); // { id, file, url, tipo }
  const [error, setError] = useState('');
  const [uso, setUso] = useState(null);
  const [lectura, setLectura] = useState(null); // { id, datos, fotos: [url] }
  const [f, setF] = useState(null);
  const [extra, setExtra] = useState({ proveedores: [], materiales: [], depositos: [], gestiona: false, listo: false });
  const [guardando, setGuardando] = useState(false);
  const [duplicado, setDuplicado] = useState('');
  const [hecho, setHecho] = useState(null);
  const [verFoto, setVerFoto] = useState(false);
  const camara = useRef(null);
  const subir = useRef(null);

  // Al abrir: reinicio, uso del mes y datos para emparejar
  useEffect(() => {
    if (!abierto) return;
    setError('');
    setDuplicado('');
    setHecho(null);
    setVerFoto(false);
    setArchivos([]);
    setLectura(null);
    setF(null);
    setPaso('elegir');
    supabase.rpc('lecturas_ia', { p_cuenta: cuenta }).then(({ data }) => setUso(data || null));
    (async () => {
      const [{ data: provs }, lug] = await Promise.all([
        supabase.from('proveedores').select('id, nombre, rut, moneda, iva_incluido').eq('profesional_id', cuenta).order('nombre'),
        plan?.plan === 'business' ? supabase.rpc('stock_lugares', { p_cuenta: cuenta }) : Promise.resolve({ data: null }),
      ]);
      let materiales = [];
      if (lug?.data?.gestiona) {
        const { data } = await supabase.from('materiales').select('id, codigo, nombre, unidad, decimales, presentaciones').eq('profesional_id', cuenta).eq('activo', true).order('nombre').limit(3000);
        materiales = (data || []).map(normalizarMaterial);
      }
      setExtra({ proveedores: provs || [], materiales, depositos: (lug?.data?.depositos || []).filter((d) => d.activo), gestiona: !!lug?.data?.gestiona, listo: true });
    })();
  }, [abierto, cuenta, plan?.plan]);

  // Retomar uno que quedó leído
  useEffect(() => {
    if (!abierto || !retomar) return;
    (async () => {
      const fotos = [];
      for (const ruta of retomar.archivos || []) {
        const { data } = await supabase.storage.from('comprobantes').createSignedUrl(ruta, 600);
        if (data?.signedUrl) fotos.push({ url: data.signedUrl, pdf: ruta.endsWith('.pdf') });
      }
      setLectura({ id: retomar.id, datos: retomar.datos, fotos });
      setPaso('revisar');
    })();
  }, [abierto, retomar]);

  // Arma el formulario con lo leído (cuando ya están los proveedores y materiales)
  useEffect(() => {
    if (!lectura?.datos || f || !extra.listo) return;
    setF(armarFormulario(lectura.datos));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lectura, extra]);

  function armarFormulario(d) {
    const rut = String(d.proveedor?.rut || '').replace(/\D/g, '');
    const prov =
      (rut && extra.proveedores.find((p) => String(p.rut || '').replace(/\D/g, '') === rut)) ||
      (d.proveedor?.nombre && extra.proveedores.find((p) => norm(p.nombre) === norm(d.proveedor.nombre))) ||
      null;
    const conStock = extra.gestiona && extra.materiales !== null;
    const tipo = d.tipo === 'gasto' && puedeGastos ? 'gasto' : puedeCompras ? 'compra' : 'gasto';
    const cot = numero(ajustes?.cotizacion_dolar) || cotizacionGuardada() || '';
    const total = numero(d.total);
    return {
      tipo,
      fecha: d.fecha || hoyISO(),
      numero: d.numero || '',
      tipo_documento: d.tipo_documento || '',
      moneda: d.moneda === 'USD' ? 'USD' : 'UYU',
      cotizacion: valor(cot),
      total: valor(total),
      gasto: {
        categoria: categorias.includes(d.categoria_gasto) ? d.categoria_gasto : tipo === 'compra' ? 'Insumos' : 'Otros',
        descripcion: [d.descripcion_gasto, d.proveedor?.nombre].filter(Boolean).join(' · ').slice(0, 200),
        monto: valor(total),
        litros: valor(d.litros),
        precio_unitario: valor(d.precio_litro),
      },
      proveedor: {
        id: prov?.id || '',
        nombre: d.proveedor?.nombre || '',
        rut: d.proveedor?.rut || '',
        telefono: d.proveedor?.telefono || '',
        direccion: d.proveedor?.direccion || '',
        email: d.proveedor?.email || '',
      },
      precios_con_iva: !!d.precios_con_iva,
      al_stock: conStock,
      destino: (extra.depositos.find((x) => x.principal) || extra.depositos[0])?.id || '',
      sumar_gasto: false,
      items: (d.items || []).map((it, k) => {
        const m = conStock ? materialDe(it, extra.materiales) : null;
        return {
          k,
          incluir: true,
          codigo: it.codigo || '',
          descripcion: it.descripcion || '',
          cantidad: valor(it.cantidad ?? 1),
          unidad: it.unidad || 'u',
          precio_unitario: valor(it.precio_unitario),
          descuento_pct: valor(it.descuento_pct),
          iva_pct: it.iva_pct ?? 22,
          al_stock: it.es_material !== false,
          material_id: m?.id || '',
          cantidad_stock: valor(cantidadStock(it, m)),
        };
      }),
    };
  }

  const set = (cambios) => setF((x) => ({ ...x, ...cambios }));
  const setGasto = (cambios) => setF((x) => ({ ...x, gasto: { ...x.gasto, ...cambios } }));
  const setProv = (cambios) => setF((x) => ({ ...x, proveedor: { ...x.proveedor, ...cambios } }));
  const setItem = (k, cambios) => setF((x) => ({ ...x, items: x.items.map((it) => (it.k === k ? { ...it, ...cambios } : it)) }));

  function agregar(lista) {
    setError('');
    const nuevos = [];
    for (const file of Array.from(lista || [])) {
      if (!TIPOS_OK.includes(file.type) && !file.type.startsWith('image/')) {
        setError('Ese formato no sirve: usá una foto (JPG o PNG) o un PDF.');
        continue;
      }
      if (file.type === 'application/pdf' && file.size > MAX_PDF) {
        setError('El PDF pesa más de 2,8 MB. Probá sacándole una foto.');
        continue;
      }
      nuevos.push({ id: idNuevo(), file, tipo: file.type, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : '' });
    }
    setArchivos((a) => [...a, ...nuevos].slice(0, 3));
  }

  async function leer() {
    if (!archivos.length) return;
    setError('');
    setPaso('leyendo');
    try {
      const mes = hoyISO().slice(0, 7);
      const paraIA = [];
      const rutas = [];
      for (const a of archivos) {
        const pdf = a.tipo === 'application/pdf';
        const blob = pdf ? a.file : await comprimirImagen(a.file, 1600, 0.85);
        const tipo = pdf ? 'application/pdf' : blob.type || 'image/jpeg';
        if (!TIPOS_OK.includes(tipo)) throw new Error('No pudimos procesar esa foto. Probá sacándola de nuevo.');
        paraIA.push({ tipo, datos: await aBase64(blob) });
        const ruta = `${cuenta}/${mes}/${idNuevo()}.${pdf ? 'pdf' : tipo === 'image/png' ? 'png' : 'jpg'}`;
        const { error: e } = await supabase.storage.from('comprobantes').upload(ruta, blob, { contentType: tipo, upsert: false });
        if (!e) rutas.push(ruta);
      }
      const { data: s } = await supabase.auth.getSession();
      const r = await fetch('/api/comprobantes/leer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token || ''}` },
        body: JSON.stringify({ cuenta, archivos: paraIA, rutas, categorias }),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.pista ? `${res.error} ${res.pista}` : res.error || 'No se pudo leer el comprobante. Probá de nuevo.');
      setUso((u) => ({ ...(u || {}), usadas: res.usadas, limite: res.limite }));
      setLectura({ id: res.id, datos: res.datos, fotos: archivos.map((a) => ({ url: a.url || '', pdf: a.tipo === 'application/pdf' })) });
      setF(null);
      setPaso('revisar');
    } catch (e) {
      setError(e.message || 'No se pudo leer el comprobante.');
      setPaso('elegir');
    }
  }

  const sumaItems = f ? r2(f.items.filter((it) => it.incluir).reduce((s, it) => s + importeItem(it), 0)) : 0;
  const cot = numero(f?.cotizacion);
  const aPesos = (n) => (f?.moneda === 'USD' ? (cot ? r2(n * cot) : null) : n);
  const provElegido = f?.proveedor.id ? extra.proveedores.find((p) => p.id === f.proveedor.id) : null;
  const pideCotizacion = f && (f.moneda === 'USD' || (f.tipo === 'compra' && provElegido && provElegido.moneda !== f.moneda));

  async function guardar(forzar = false) {
    setError('');
    setDuplicado('');
    if (f.tipo === 'compra' && !f.proveedor.id && !f.proveedor.nombre.trim()) return setError('Poné el nombre del proveedor.');
    if (pideCotizacion && !cot) return setError('Poné la cotización del dólar.');
    const montoGasto = f.tipo === 'gasto' || f.sumar_gasto ? numero(f.gasto.monto) : null;
    if ((f.tipo === 'gasto' || f.sumar_gasto) && (montoGasto === null || montoGasto < 0)) return setError('Poné el monto en pesos.');
    const stockOn = f.tipo === 'compra' && f.al_stock && extra.gestiona;
    const datos = {
      tipo: f.tipo,
      fecha: f.fecha,
      numero: f.numero.trim(),
      tipo_documento: f.tipo_documento,
      moneda: f.moneda,
      cotizacion: cot,
      total: numero(f.total),
      gasto: {
        categoria: f.gasto.categoria,
        descripcion: f.gasto.descripcion.trim(),
        monto: montoGasto,
        litros: numero(f.gasto.litros),
        precio_unitario: numero(f.gasto.precio_unitario),
      },
      proveedor: { ...f.proveedor, nombre: f.proveedor.nombre.trim() },
      precios_con_iva: f.precios_con_iva,
      al_stock: stockOn,
      destino: f.destino || null,
      sumar_gasto: f.tipo === 'compra' && f.sumar_gasto,
      items: f.items.map((it) => ({
        incluir: it.incluir,
        codigo: it.codigo.trim(),
        descripcion: it.descripcion.trim(),
        cantidad: numero(it.cantidad),
        unidad: it.unidad,
        precio_unitario: numero(it.precio_unitario),
        descuento_pct: numero(it.descuento_pct),
        iva_pct: numero(it.iva_pct),
        al_stock: stockOn && it.al_stock,
        material_id: it.material_id || null,
        cantidad_stock: numero(it.cantidad_stock),
        unidad_stock: unidadNormal(it.unidad),
      })),
    };
    setGuardando(true);
    const { data, error: err } = await supabase.rpc('registrar_comprobante', { p_id: lectura.id, p_datos: datos, p_forzar: forzar });
    setGuardando(false);
    if (err) {
      if (err.code === 'TL005') return setDuplicado(err.message);
      return setError(mensajeError(err));
    }
    if (cot) guardarCotizacion(cot);
    setHecho(data);
    setPaso('listo');
    onListo?.(data);
  }

  async function descartar() {
    if (lectura?.id) await supabase.rpc('descartar_comprobante', { p_id: lectura.id });
    onListo?.(null);
    onCerrar();
  }

  if (!abierto) return null;

  const restan = uso?.limite != null ? Math.max(0, uso.limite - (uso.usadas || 0)) : null;
  const pie =
    paso === 'elegir' ? (
      <div className="space-y-2">
        <button type="button" className="btn btn-menta w-full" disabled={!archivos.length} onClick={leer}>
          <Icon name="check" /> Leer con IA
        </button>
        {restan !== null && (
          <p className="text-center text-[11px] text-tinta-500">
            Este mes: {uso.usadas || 0} de {uso.limite} lecturas{restan <= 5 ? ` · quedan ${restan}` : ''}
          </p>
        )}
      </div>
    ) : paso === 'revisar' && f ? (
      <div className="space-y-2">
        {duplicado && (
          <div className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">
            {duplicado}
            <button type="button" className="mt-2 block font-bold text-amber-100 underline" onClick={() => guardar(true)} disabled={guardando}>
              Es otro: guardarlo igual
            </button>
          </div>
        )}
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button type="button" className="btn btn-sec px-4" onClick={descartar} disabled={guardando}>
            Descartar
          </button>
          <button type="button" className="btn btn-menta" onClick={() => guardar(false)} disabled={guardando}>
            <Icon name="check" /> {guardando ? 'Guardando…' : f.tipo === 'gasto' ? 'Guardar el gasto' : 'Guardar la compra'}
          </button>
        </div>
      </div>
    ) : paso === 'listo' ? (
      <button type="button" className="btn btn-menta w-full" onClick={onCerrar}>
        Listo
      </button>
    ) : null;

  return (
    <Modal abierto onCerrar={onCerrar} titulo={paso === 'revisar' ? 'Revisá lo que leyó la IA' : 'Leer comprobante con IA'} pie={pie}>
      <div className="space-y-4">
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

        {paso === 'elegir' && (
          <>
            <p className="text-sm text-tinta-300">
              Sacale una foto a la factura, e-ticket, remito o ticket (o subí el PDF). La IA lo lee y vos revisás antes de guardar: un gasto va a <b>Mis gastos</b>; una
              compra deja el <b>proveedor con sus precios</b> para tus presupuestos{extra.gestiona ? <> y los materiales entran al <b>stock</b></> : null}.
            </p>
            {archivos.length > 0 && (
              <ul className="grid grid-cols-3 gap-2">
                {archivos.map((a, i) => (
                  <li key={a.id} className="relative aspect-[3/4] overflow-hidden rounded-xl border border-navy-700 bg-navy-850">
                    {a.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.url} alt={`Página ${i + 1}`} className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full place-items-center text-center text-xs text-tinta-300">
                        <Icon name="documento" className="mx-auto h-7 w-7" />
                        PDF
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label="Quitar"
                      className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"
                      onClick={() => setArchivos((x) => x.filter((y) => y.id !== a.id))}
                    >
                      <Icon name="cerrar" className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {archivos.length < 3 && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-sec flex-col gap-1 py-4" onClick={() => camara.current?.click()}>
                  <Icon name="camara" className="h-6 w-6" />
                  {archivos.length ? 'Otra página' : 'Sacar foto'}
                </button>
                <button type="button" className="btn btn-sec flex-col gap-1 py-4" onClick={() => subir.current?.click()}>
                  <Icon name="imagen" className="h-6 w-6" />
                  Subir foto o PDF
                </button>
              </div>
            )}
            <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => (agregar(e.target.files), (e.target.value = ''))} />
            <input ref={subir} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => (agregar(e.target.files), (e.target.value = ''))} />
            <p className="text-[11px] text-tinta-500">Tip: el comprobante entero, de frente, con luz y sin sombras. Si es largo, sacá hasta 3 fotos.</p>
          </>
        )}

        {paso === 'leyendo' && (
          <div className="grid place-items-center gap-3 py-10 text-center">
            <span className="h-10 w-10 animate-spin rounded-full border-4 border-navy-700 border-t-menta-400" />
            <p className="font-semibold">Leyendo el comprobante…</p>
            <p className="text-xs text-tinta-400">Tarda unos segundos.</p>
          </div>
        )}

        {paso === 'revisar' && !f && <p className="text-sm text-tinta-400">Cargando…</p>}

        {paso === 'revisar' && f && (
          <>
            {lectura?.fotos?.length > 0 && (
              <div>
                <button type="button" className="chip" onClick={() => setVerFoto((v) => !v)}>
                  <Icon name="ojo" className="h-3.5 w-3.5" /> {verFoto ? 'Ocultar la foto' : 'Ver la foto'}
                </button>
                {verFoto && (
                  <div className="mt-2 space-y-2">
                    {lectura.fotos.map((x, i) =>
                      x.pdf ? (
                        x.url.startsWith('http') && (
                          <a key={i} href={x.url} target="_blank" rel="noreferrer" className="chip">
                            <Icon name="documento" className="h-3.5 w-3.5" /> Abrir el PDF
                          </a>
                        )
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={x.url} alt={`Comprobante ${i + 1}`} className="w-full rounded-xl border border-navy-700" />
                      )
                    )}
                  </div>
                )}
              </div>
            )}
            {lectura?.datos?.nota && <p className="rounded-xl bg-amber-400/10 p-3 text-xs text-amber-200">La IA avisa: {lectura.datos.nota}</p>}

            {/* Gasto o compra */}
            <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-navy-850 p-1.5">
              {[
                ['gasto', 'Gasto', 'billetera', puedeGastos],
                ['compra', 'Compra', 'caja', puedeCompras],
              ].map(([v, t, ic, ok]) => (
                <button
                  key={v}
                  type="button"
                  disabled={!ok}
                  onClick={() => set({ tipo: v })}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold disabled:opacity-40 ${f.tipo === v ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}
                >
                  <Icon name={ic} className="h-4 w-4" /> {t}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="etiqueta">Fecha</span>
                <input type="date" className="campo min-w-0" value={f.fecha} onChange={(e) => set({ fecha: e.target.value })} />
              </label>
              <label className="block">
                <span className="etiqueta">{f.tipo_documento || 'Comprobante'} Nº</span>
                <input className="campo min-w-0" value={f.numero} maxLength={40} onChange={(e) => set({ numero: e.target.value })} placeholder="A-1234" />
              </label>
              <label className="block">
                <span className="etiqueta">Moneda</span>
                <select className="campo min-w-0" value={f.moneda} onChange={(e) => set({ moneda: e.target.value })}>
                  <option value="UYU">Pesos</option>
                  <option value="USD">Dólares</option>
                </select>
              </label>
              <label className="block">
                <span className="etiqueta">Total</span>
                <input inputMode="decimal" className="campo min-w-0" value={f.total} onChange={(e) => set({ total: e.target.value })} />
              </label>
              {pideCotizacion && (
                <label className="col-span-2 block">
                  <span className="etiqueta">Cotización del dólar</span>
                  <input inputMode="decimal" className="campo" value={f.cotizacion} onChange={(e) => set({ cotizacion: e.target.value })} placeholder="Ej. 40,50" />
                </label>
              )}
            </div>

            {f.tipo === 'gasto' ? (
              <BloqueGasto f={f} categorias={categorias} setGasto={setGasto} aPesos={aPesos} />
            ) : (
              <>
                {/* Proveedor */}
                <section className="space-y-2 rounded-2xl border border-navy-700 p-3">
                  <p className="etiqueta !mb-0">Proveedor</p>
                  <select className="campo" value={f.proveedor.id} onChange={(e) => setProv({ id: e.target.value })}>
                    <option value="">{f.proveedor.nombre ? `Nuevo: ${f.proveedor.nombre}` : '— Proveedor nuevo —'}</option>
                    {extra.proveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                        {p.rut ? ` · RUT ${p.rut}` : ''}
                      </option>
                    ))}
                  </select>
                  {f.proveedor.id ? (
                    <p className="text-xs text-menta-300">Ya está en tus proveedores: se le actualizan los precios.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <input className="campo col-span-2" value={f.proveedor.nombre} maxLength={120} onChange={(e) => setProv({ nombre: e.target.value })} placeholder="Nombre del proveedor" />
                      <input className="campo min-w-0" value={f.proveedor.rut} maxLength={20} onChange={(e) => setProv({ rut: e.target.value })} placeholder="RUT" inputMode="numeric" />
                      <input className="campo min-w-0" value={f.proveedor.telefono} maxLength={40} onChange={(e) => setProv({ telefono: e.target.value })} placeholder="Teléfono" inputMode="tel" />
                    </div>
                  )}
                </section>

                {/* Stock */}
                {extra.gestiona && (
                  <label className="flex items-center justify-between gap-3 rounded-2xl border border-navy-700 p-3">
                    <span className="flex items-start gap-2.5">
                      <Icon name="caja" className="mt-0.5 h-5 w-5 shrink-0 text-menta-300" />
                      <span>
                        <b className="block text-sm">Ingresar al stock</b>
                        <span className="text-xs text-tinta-400">Los materiales tildados entran con un comprobante de ingreso.</span>
                      </span>
                    </span>
                    <input type="checkbox" className="h-5 w-5 accent-menta-500" checked={f.al_stock} onChange={(e) => set({ al_stock: e.target.checked })} />
                  </label>
                )}
                {extra.gestiona && f.al_stock && extra.depositos.length > 1 && (
                  <select className="campo" value={f.destino} onChange={(e) => set({ destino: e.target.value })} aria-label="Depósito">
                    {extra.depositos.map((d) => (
                      <option key={d.id} value={d.id}>
                        Entra a: {d.nombre}
                      </option>
                    ))}
                  </select>
                )}

                {/* Renglones */}
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="etiqueta !mb-0">Artículos · {f.items.filter((it) => it.incluir).length}</p>
                    <label className="flex items-center gap-1.5 text-xs text-tinta-300">
                      <input type="checkbox" className="accent-menta-500" checked={f.precios_con_iva} onChange={(e) => set({ precios_con_iva: e.target.checked })} />
                      Precios con IVA
                    </label>
                  </div>
                  {f.items.map((it) => (
                    <Renglon key={it.k} it={it} moneda={f.moneda} conStock={extra.gestiona && f.al_stock} materiales={extra.materiales} onCambiar={(c) => setItem(it.k, c)} />
                  ))}
                  <button
                    type="button"
                    className="chip"
                    onClick={() =>
                      set({
                        items: [
                          ...f.items,
                          { k: Date.now(), incluir: true, codigo: '', descripcion: '', cantidad: '1', unidad: 'u', precio_unitario: '', descuento_pct: '', iva_pct: 22, al_stock: true, material_id: '', cantidad_stock: '1' },
                        ],
                      })
                    }
                  >
                    <Icon name="mas" className="h-3.5 w-3.5" /> Agregar artículo
                  </button>
                  <p className="text-right text-xs text-tinta-400">
                    Suma de los artículos: <b className="text-tinta-100">{dinero(sumaItems, f.moneda)}</b>
                    {f.precios_con_iva ? ' con IVA' : ' sin IVA'}
                    {numero(f.total) ? ` · Total del comprobante: ${dinero(numero(f.total), f.moneda)}` : ''}
                  </p>
                </section>

                {puedeGastos && (
                  <section className="space-y-2 rounded-2xl border border-navy-700 p-3">
                    <label className="flex items-center justify-between gap-3">
                      <span>
                        <b className="block text-sm">Sumarlo también a Mis gastos</b>
                        <span className="text-xs text-tinta-400">Los materiales ya cuentan como costo en el presupuesto de cada trabajo. Activalo si no los vas a cobrar en un presupuesto.</span>
                      </span>
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-menta-500"
                        checked={f.sumar_gasto}
                        onChange={(e) => {
                          const monto = aPesos(numero(f.total) ?? sumaItems);
                          set({ sumar_gasto: e.target.checked, gasto: { ...f.gasto, monto: valor(monto ?? f.gasto.monto) } });
                        }}
                      />
                    </label>
                    {f.sumar_gasto && (
                      <div className="grid grid-cols-2 gap-2">
                        <select className="campo min-w-0" value={f.gasto.categoria} onChange={(e) => setGasto({ categoria: e.target.value })} aria-label="Categoría">
                          {categorias.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                        <input inputMode="decimal" className="campo min-w-0" value={f.gasto.monto} onChange={(e) => setGasto({ monto: e.target.value })} placeholder="Monto en pesos" aria-label="Monto en pesos" />
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
          </>
        )}

        {paso === 'listo' && hecho && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-2xl border border-menta-500/40 bg-menta-500/10 p-4">
              <Icon name="check" className="mt-0.5 h-6 w-6 shrink-0 text-menta-300" />
              <div>
                <p className="font-bold">{hecho.tipo === 'gasto' ? 'Gasto guardado' : 'Compra guardada'}</p>
                <p className="text-sm text-tinta-200">{hecho.resumen}</p>
                {hecho.materiales_nuevos > 0 && (
                  <p className="mt-1 text-xs text-tinta-400">
                    {hecho.materiales_nuevos} {hecho.materiales_nuevos === 1 ? 'material nuevo quedó' : 'materiales nuevos quedaron'} en el stock: revisá su unidad y mínimo cuando puedas.
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {hecho.gasto_id && (
                <Link href="/panel/finanzas/gastos" className="btn btn-sec py-2.5 text-sm" onClick={onCerrar}>
                  Ver Mis gastos
                </Link>
              )}
              {hecho.proveedor_id && (
                <Link href={`/panel/finanzas/proveedores/${hecho.proveedor_id}`} className="btn btn-sec py-2.5 text-sm" onClick={onCerrar}>
                  Ver el proveedor
                </Link>
              )}
              {hecho.movimiento_id && (
                <Link href={`/panel/finanzas/stock?mov=${hecho.movimiento_id}`} className="btn btn-sec py-2.5 text-sm" onClick={onCerrar}>
                  Ver el ingreso
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function BloqueGasto({ f, categorias, setGasto, aPesos }) {
  const totalPesos = f.moneda === 'USD' ? aPesos(numero(f.total) ?? 0) : null;
  return (
    <section className="space-y-3">
      <div>
        <p className="etiqueta">Categoría</p>
        <div className="flex flex-wrap gap-1.5">
          {categorias.map((c) => (
            <button key={c} type="button" className={`chip ${f.gasto.categoria === c ? 'chip-activo' : ''}`} onClick={() => setGasto({ categoria: c })}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="etiqueta">Descripción</span>
        <input className="campo" value={f.gasto.descripcion} maxLength={200} onChange={(e) => setGasto({ descripcion: e.target.value })} placeholder="Ej. Nafta Súper 30 L" />
      </label>
      {(f.gasto.litros || f.gasto.categoria === 'Movilidad') && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="etiqueta">Litros</span>
            <input inputMode="decimal" className="campo min-w-0" value={f.gasto.litros} onChange={(e) => setGasto({ litros: e.target.value })} />
          </label>
          <label className="block">
            <span className="etiqueta">Precio del litro</span>
            <input inputMode="decimal" className="campo min-w-0" value={f.gasto.precio_unitario} onChange={(e) => setGasto({ precio_unitario: e.target.value })} />
          </label>
        </div>
      )}
      <label className="block">
        <span className="etiqueta">Monto en pesos</span>
        <input inputMode="decimal" className="campo text-lg font-bold" value={f.gasto.monto} onChange={(e) => setGasto({ monto: e.target.value })} />
        {f.moneda === 'USD' && (
          <span className="mt-1 flex items-center justify-between text-xs text-tinta-400">
            {totalPesos ? `${dinero(numero(f.total), 'USD')} = ${dinero(totalPesos)}` : 'Poné la cotización para pasarlo a pesos'}
            {totalPesos && (
              <button type="button" className="font-semibold text-menta-400" onClick={() => setGasto({ monto: String(totalPesos) })}>
                Usar
              </button>
            )}
          </span>
        )}
      </label>
    </section>
  );
}

function Renglon({ it, moneda, conStock, materiales, onCambiar }) {
  const m = it.material_id ? materiales.find((x) => x.id === it.material_id) : null;
  return (
    <div className={`space-y-2 rounded-2xl border p-2.5 ${it.incluir ? 'border-navy-700 bg-navy-850' : 'border-navy-800 opacity-50'}`}>
      <div className="flex items-center gap-2">
        <input type="checkbox" className="h-5 w-5 shrink-0 accent-menta-500" checked={it.incluir} onChange={(e) => onCambiar({ incluir: e.target.checked })} aria-label="Incluir" />
        <input className="campo min-w-0 flex-1 py-2 text-sm" value={it.descripcion} maxLength={300} onChange={(e) => onCambiar({ descripcion: e.target.value })} aria-label="Descripción" />
      </div>
      {it.incluir && (
        <>
          <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-1.5">
            <label className="block min-w-0">
              <span className="text-[10px] text-tinta-500">Cantidad</span>
              <input inputMode="decimal" className="campo min-w-0 py-1.5 text-sm" value={it.cantidad} onChange={(e) => onCambiar({ cantidad: e.target.value, cantidad_stock: m && m.unidad !== unidadNormal(it.unidad) ? it.cantidad_stock : e.target.value })} />
            </label>
            <label className="block min-w-0">
              <span className="text-[10px] text-tinta-500">Unidad</span>
              <input className="campo min-w-0 py-1.5 text-sm" value={it.unidad} maxLength={20} onChange={(e) => onCambiar({ unidad: e.target.value })} />
            </label>
            <label className="block min-w-0">
              <span className="text-[10px] text-tinta-500">Precio unitario</span>
              <input inputMode="decimal" className="campo min-w-0 py-1.5 text-sm" value={it.precio_unitario} onChange={(e) => onCambiar({ precio_unitario: e.target.value })} placeholder="Sin precio" />
            </label>
          </div>
          <p className="flex justify-between text-[11px] text-tinta-400">
            <span>
              {it.codigo ? `Cód. ${it.codigo}` : ''}
              {numero(it.descuento_pct) ? ` · ${numero(it.descuento_pct)}% de descuento` : ''}
            </span>
            {numero(it.precio_unitario) !== null && <b className="text-tinta-200">{dinero(importeItem(it), moneda)}</b>}
          </p>
          {conStock && (
            <div className="space-y-1.5 border-t border-navy-700 pt-2">
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input type="checkbox" className="accent-menta-500" checked={it.al_stock} onChange={(e) => onCambiar({ al_stock: e.target.checked })} />
                Entra al stock
              </label>
              {it.al_stock && (
                <div className="grid grid-cols-[1fr_auto] items-center gap-1.5">
                  <select className="campo min-w-0 py-1.5 text-xs" value={it.material_id} onChange={(e) => onCambiar({ material_id: e.target.value })} aria-label="Material del stock">
                    <option value="">Material nuevo en el stock</option>
                    {materiales.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nombre}
                        {x.codigo ? ` (${x.codigo})` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="flex items-center gap-1 text-xs text-tinta-300">
                    <input inputMode="decimal" className="campo w-20 py-1.5 text-xs" value={it.cantidad_stock} onChange={(e) => onCambiar({ cantidad_stock: e.target.value })} aria-label="Cantidad que entra" />
                    {m?.unidad || unidadNormal(it.unidad)}
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
