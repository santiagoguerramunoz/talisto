'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/util';
import { haceCuanto } from '@/lib/equipo';
import { TIPO_XLSX } from '@/lib/xlsx';
import { CAMPOS, adivinarMapeo, leerNumero, leerTabla, normalizarTexto, productosDe } from '@/lib/planillas';
import { AVISO_SQL_09, FUENTES, apiProveedores, importarProductos, importe, planillaModelo, sinFuncion } from '@/lib/proveedores';

const DATOS = [
  ['contacto', 'Contacto', 'Nombre de quien atiende'],
  ['telefono', 'Teléfono', '2900 0000'],
  ['whatsapp', 'WhatsApp', '099 000 000'],
  ['email', 'Email', 'ventas@proveedor.com.uy'],
  ['pedido_email', 'Email para las órdenes (si es otro)', 'pedidos@proveedor.com.uy'],
  ['rut', 'RUT', ''],
  ['direccion', 'Dirección', ''],
  ['web', 'Sitio web', 'https://'],
];

const vacio = (v) => (v === null || v === undefined ? '' : String(v));

export default function Proveedor() {
  const { id } = useParams();
  const router = useRouter();
  const { profesional, perfil, yo, empresa, permisos } = usePanel();
  const [v, setV] = useState(null);
  const [form, setForm] = useState(null);
  const [estado, setEstado] = useState({ cargando: true, ocupado: false, error: '', ok: '' });

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('proveedores').select('*').eq('id', id).maybeSingle();
    if (error || !data) {
      setEstado({ cargando: false, ocupado: false, error: error ? (sinFuncion(error) ? AVISO_SQL_09 : mensajeError(error)) : 'No encontramos este proveedor.', ok: '' });
      return;
    }
    setV(data);
    setForm({
      ...Object.fromEntries(['nombre', 'notas', ...DATOS.map((d) => d[0])].map((k) => [k, vacio(data[k])])),
      moneda: data.moneda,
      iva_incluido: data.iva_incluido,
      activo: data.activo,
      fuente: data.fuente,
      fuente_url: vacio(data.fuente_url),
      formato: data.formato,
      stock_url: vacio(data.stock_url),
      pedido_url: vacio(data.pedido_url),
      auth_header: vacio(data.auth_header) || 'Authorization',
      lista: vacio(data.mapeo?.lista),
      stock_vivo: vacio(data.mapeo?.stock_vivo),
    });
    setEstado((e) => ({ ...e, cargando: false }));
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (estado.cargando) return <p className="p-4 text-tinta-400">Cargando…</p>;
  if (!v || !form) {
    return (
      <div className="p-4">
        <p className="text-tinta-300">{estado.error}</p>
        <Link href="/panel/finanzas/compras?ver=proveedores" className="btn btn-sec mt-4">Volver a proveedores</Link>
      </div>
    );
  }

  const deTalisto = !v.profesional_id;
  const puedeEditar = deTalisto ? !!perfil?.es_admin : !empresa || yo?.id === profesional.id || (permisos || []).includes('compras');
  const cambiar = (k, valor) => setForm((f) => ({ ...f, [k]: valor }));
  const avisar = (cambios) => setEstado((e) => ({ ...e, ...cambios }));

  async function guardar(extra = {}, mensaje = 'Guardado.') {
    avisar({ ocupado: true, error: '', ok: '' });
    const fila = {
      nombre: form.nombre.trim(),
      notas: form.notas.trim() || null,
      ...Object.fromEntries(DATOS.map(([k]) => [k, form[k].trim() || null])),
      moneda: form.moneda,
      iva_incluido: form.iva_incluido,
      activo: form.activo,
      fuente: form.fuente,
      fuente_url: form.fuente_url.trim() || null,
      formato: form.formato,
      stock_url: form.stock_url.trim() || null,
      pedido_url: form.pedido_url.trim() || null,
      auth_header: form.auth_header.trim() || null,
      mapeo: { ...(v.mapeo || {}), lista: form.lista.trim() || undefined, stock_vivo: form.stock_vivo.trim() || undefined },
      ...extra,
    };
    for (const k of ['fuente_url', 'stock_url', 'pedido_url']) {
      if (fila[k] && !/^https:\/\//i.test(fila[k])) {
        avisar({ ocupado: false, error: 'Los links tienen que empezar con https://' });
        return false;
      }
    }
    const { data, error } = await supabase.from('proveedores').update(fila).eq('id', v.id).select('*').single();
    if (error) {
      avisar({ ocupado: false, error: mensajeError(error) });
      return false;
    }
    setV(data);
    avisar({ ocupado: false, ok: mensaje });
    return true;
  }

  async function eliminar() {
    if (!window.confirm(`¿Eliminar a ${v.nombre} y su lista de precios? Las órdenes de compra ya hechas se conservan.`)) return;
    const { error } = await supabase.from('proveedores').delete().eq('id', v.id);
    if (error) return avisar({ error: mensajeError(error) });
    router.replace('/panel/finanzas/compras?ver=proveedores');
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/panel/finanzas/compras?ver=proveedores" className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver">
            <Icon name="izq" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-tinta-400">{deTalisto ? 'Proveedor de TaListo!' : 'Proveedor'}</p>
            <h1 className="truncate text-xl font-extrabold">{v.nombre}</h1>
          </div>
          {!v.activo && <span className="shrink-0 rounded-full bg-navy-700 px-2.5 py-1 text-xs font-bold text-tinta-300">Pausado</span>}
        </div>
      </header>

      <div className="space-y-6 px-4 pt-4">
        {estado.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>}
        {estado.ok && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{estado.ok}</p>}

        {puedeEditar ? (
          <ListaDePrecios v={v} form={form} cambiar={cambiar} guardar={guardar} avisar={avisar} recargar={cargar} ocupado={estado.ocupado} />
        ) : (
          <section className="tarjeta p-4 text-sm text-tinta-300">
            <p>
              <b className="text-tinta-100">{v.productos.toLocaleString('es-UY')} productos</b>
              {v.sincronizado_en ? ` · lista actualizada ${haceCuanto(v.sincronizado_en)}` : ''}
              {v.moneda === 'USD' ? ' · precios en dólares' : ''} · {v.iva_incluido ? 'IVA incluido' : 'precios sin IVA'}
            </p>
            {deTalisto && <p className="mt-1 text-xs text-tinta-400">Lo administra TaListo!. Buscá sus productos desde el presupuesto.</p>}
          </section>
        )}

        <Productos v={v} puedeEditar={puedeEditar} onCambio={cargar} />

        {/* Datos del proveedor */}
        <section className="tarjeta space-y-3 p-4">
          <h2 className="font-bold">Datos del proveedor</h2>
          <div>
            <label className="etiqueta" htmlFor="pv-nombre">Nombre</label>
            <input id="pv-nombre" className="campo" value={form.nombre} disabled={!puedeEditar} onChange={(e) => cambiar('nombre', e.target.value)} />
          </div>
          {DATOS.map(([k, t, ph]) => (
            <div key={k}>
              <label className="etiqueta" htmlFor={`pv-${k}`}>{t}</label>
              <input id={`pv-${k}`} className="campo" value={form[k]} disabled={!puedeEditar} onChange={(e) => cambiar(k, e.target.value)} placeholder={ph} />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="etiqueta" htmlFor="pv-moneda">Moneda de la lista</label>
              <select id="pv-moneda" className="campo" value={form.moneda} disabled={!puedeEditar} onChange={(e) => cambiar('moneda', e.target.value)}>
                <option value="UYU">Pesos (UYU)</option>
                <option value="USD">Dólares (USD)</option>
              </select>
            </div>
            <label className="mt-6 flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-[#2cc79b]" checked={form.iva_incluido} disabled={!puedeEditar} onChange={(e) => cambiar('iva_incluido', e.target.checked)} />
              Precios con IVA
            </label>
          </div>
          <div>
            <label className="etiqueta" htmlFor="pv-notas">Notas</label>
            <textarea id="pv-notas" rows={2} className="campo" value={form.notas} disabled={!puedeEditar} onChange={(e) => cambiar('notas', e.target.value)} placeholder="Días de entrega, condiciones de pago, descuentos…" />
          </div>
          {puedeEditar && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-5 w-5 accent-[#2cc79b]" checked={form.activo} onChange={(e) => cambiar('activo', e.target.checked)} />
                Activo (sus productos aparecen al buscar)
              </label>
              <button type="button" className="btn btn-menta w-full" onClick={() => guardar()} disabled={estado.ocupado}>
                {estado.ocupado ? 'Guardando…' : 'Guardar datos'}
              </button>
            </>
          )}
        </section>

        {puedeEditar && (
          <button type="button" className="btn btn-peligro w-full" onClick={eliminar}>
            <Icon name="borrar" /> Eliminar proveedor
          </button>
        )}
        <div className="h-2" />
      </div>
    </>
  );
}

// ------------------------------------------------ Lista de precios ---
function ListaDePrecios({ v, form, cambiar, guardar, avisar, recargar, ocupado }) {
  const [clave, setClave] = useState('');
  const [cambiandoClave, setCambiandoClave] = useState(false);
  const [prueba, setPrueba] = useState(null);
  const [mapeo, setMapeo] = useState(null);
  const [trabajando, setTrabajando] = useState('');

  async function guardarClave() {
    const { error } = await supabase.rpc('guardar_clave_proveedor', { p_proveedor: v.id, p_clave: clave });
    if (error) return avisar({ error: mensajeError(error) });
    setClave('');
    setCambiandoClave(false);
    avisar({ ok: clave ? 'Clave guardada. No se vuelve a mostrar.' : 'Clave borrada.', error: '' });
    recargar();
  }

  async function probar() {
    if (!(await guardar({}, ''))) return;
    setTrabajando('probar');
    avisar({ error: '', ok: '' });
    try {
      const r = await apiProveedores('sincronizar', { proveedor_id: v.id, probar: true });
      setPrueba(r);
      setMapeo(r.mapeo);
    } catch (e) {
      avisar({ error: e.message });
    }
    setTrabajando('');
  }

  async function actualizar() {
    if (mapeo) {
      const limpio = Object.fromEntries(Object.entries(mapeo).filter(([, x]) => x));
      if (!(await guardar({ mapeo: { ...limpio, lista: form.lista.trim() || undefined, stock_vivo: form.stock_vivo.trim() || undefined } }, ''))) return;
    } else if (!(await guardar({}, ''))) return;
    setTrabajando('actualizar');
    avisar({ error: '', ok: '' });
    try {
      const r = await apiProveedores('sincronizar', { proveedor_id: v.id });
      setPrueba(null);
      avisar({ ok: `Lista actualizada: ${(r.activos ?? 0).toLocaleString('es-UY')} productos (${r.nuevos} nuevos${r.bajas ? `, ${r.bajas} ya no están` : ''}).` });
      recargar();
    } catch (e) {
      if (e.datos?.campos) {
        setPrueba({ campos: e.datos.campos, mapeo: e.datos.mapeo, muestra: [], total: 0 });
        setMapeo(e.datos.mapeo);
      }
      avisar({ error: e.message });
      recargar();
    }
    setTrabajando('');
  }

  const remoto = form.fuente === 'url' || form.fuente === 'api';

  return (
    <section className="tarjeta space-y-4 p-4">
      <div>
        <h2 className="font-bold">Lista de precios</h2>
        <p className="text-sm text-tinta-400">
          {v.productos.toLocaleString('es-UY')} productos activos
          {v.sincronizado_en ? ` · actualizada ${haceCuanto(v.sincronizado_en)}` : ' · todavía sin cargar'}
        </p>
        {v.sincronizacion && <p className="mt-0.5 text-xs text-tinta-500">Última carga: {v.sincronizacion}</p>}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {Object.entries(FUENTES).map(([k, f]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              cambiar('fuente', k);
              setPrueba(null);
            }}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold ${form.fuente === k ? 'border-menta-500/60 bg-menta-500/10 text-tinta-100' : 'border-navy-700 text-tinta-300'}`}
          >
            <Icon name={f.icono} className="h-4 w-4 shrink-0" /> {f.texto}
          </button>
        ))}
      </div>
      <p className="text-xs text-tinta-400">{FUENTES[form.fuente]?.ayuda}</p>

      {form.fuente === 'planilla' && <SubirPlanilla v={v} avisar={avisar} recargar={recargar} guardarFuente={() => (v.fuente !== 'planilla' ? guardar({}, '') : true)} />}

      {remoto && (
        <div className="space-y-3">
          <div>
            <label className="etiqueta" htmlFor="pv-url">{form.fuente === 'api' ? 'Link de la API con la lista de productos' : 'Link de la lista'}</label>
            <input id="pv-url" className="campo" value={form.fuente_url} onChange={(e) => cambiar('fuente_url', e.target.value)} placeholder="https://" inputMode="url" />
            {form.fuente === 'url' && (
              <p className="mt-1 text-xs text-tinta-500">En Google Sheets: Archivo → Compartir → Publicar en la Web → elegí la hoja y "Valores separados por comas (.csv)".</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="etiqueta" htmlFor="pv-formato">Formato</label>
              <select id="pv-formato" className="campo" value={form.formato} onChange={(e) => cambiar('formato', e.target.value)}>
                <option value="auto">Automático</option>
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
                <option value="xlsx">Excel</option>
              </select>
            </div>
            {form.fuente === 'api' && (
              <div>
                <label className="etiqueta" htmlFor="pv-lista">Ruta de la lista (JSON)</label>
                <input id="pv-lista" className="campo" value={form.lista} onChange={(e) => cambiar('lista', e.target.value)} placeholder="Ej. data.items" />
              </div>
            )}
          </div>

          {form.fuente === 'api' && (
            <>
              <div className="rounded-xl border border-navy-700 p-3">
                <p className="text-sm font-semibold">Clave de la API</p>
                <p className="text-xs text-tinta-400">Se guarda protegida: nadie la puede volver a ver, ni vos. Solo el servidor la usa para hablar con el proveedor.</p>
                {v.tiene_clave && !cambiandoClave ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="flex-1 text-sm text-menta-300">
                      <Icon name="candado" className="mr-1 inline h-4 w-4" /> Clave guardada
                    </span>
                    <button type="button" className="chip" onClick={() => setCambiandoClave(true)}>Cambiar</button>
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <input
                        className="campo"
                        type="password"
                        autoComplete="off"
                        value={clave}
                        onChange={(e) => setClave(e.target.value)}
                        placeholder={v.tiene_clave ? 'Nueva clave (vacío = borrarla)' : 'Pegá la clave que te dio el proveedor'}
                        aria-label="Clave de la API"
                      />
                      <button type="button" className="btn btn-menta" onClick={guardarClave}>Guardar</button>
                    </div>
                    <div>
                      <label className="etiqueta" htmlFor="pv-hdr">Encabezado donde va la clave</label>
                      <input id="pv-hdr" className="campo" value={form.auth_header} onChange={(e) => cambiar('auth_header', e.target.value)} placeholder="Authorization" />
                      <p className="mt-1 text-xs text-tinta-500">Si es Authorization se manda como "Bearer clave". Otros: X-Api-Key, Api-Key…</p>
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="etiqueta" htmlFor="pv-stock">Link de stock al momento (opcional)</label>
                <input id="pv-stock" className="campo" value={form.stock_url} onChange={(e) => cambiar('stock_url', e.target.value)} placeholder="https://api.proveedor.com/stock/{codigo}" inputMode="url" />
                <p className="mt-1 text-xs text-tinta-500">Con {'{codigo}'} donde va el código del producto. Si la respuesta es complicada, indicá dónde está el número:</p>
                <input className="campo mt-1" value={form.stock_vivo} onChange={(e) => cambiar('stock_vivo', e.target.value)} placeholder="Ruta del stock en la respuesta, ej. data.disponible (opcional)" aria-label="Ruta del stock" />
              </div>
              <div>
                <label className="etiqueta" htmlFor="pv-pedido">Link para recibir órdenes de compra (opcional)</label>
                <input id="pv-pedido" className="campo" value={form.pedido_url} onChange={(e) => cambiar('pedido_url', e.target.value)} placeholder="https://api.proveedor.com/pedidos" inputMode="url" />
                <p className="mt-1 text-xs text-tinta-500">TaListo! le manda la orden en JSON (POST) con el comprador, los productos y las cantidades.</p>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-sec" onClick={probar} disabled={!!trabajando || ocupado || !form.fuente_url}>
              {trabajando === 'probar' ? 'Probando…' : 'Probar'}
            </button>
            <button type="button" className="btn btn-menta" onClick={actualizar} disabled={!!trabajando || ocupado || !form.fuente_url}>
              <Icon name="repetir" className={`h-4 w-4 ${trabajando === 'actualizar' ? 'animate-spin' : ''}`} /> {trabajando === 'actualizar' ? 'Cargando…' : 'Actualizar lista'}
            </button>
          </div>

          {prueba && (
            <div className="space-y-3 rounded-xl border border-navy-700 p-3">
              <p className="text-sm">
                {prueba.total ? (
                  <>
                    Encontramos <b>{prueba.total.toLocaleString('es-UY')} productos</b>. Revisá que cada dato salga de la columna correcta:
                  </>
                ) : (
                  'No encontramos productos. Elegí qué columna es cada dato:'
                )}
              </p>
              <ElegirColumnas campos={prueba.campos || []} mapeo={mapeo || {}} onChange={setMapeo} />
              {prueba.muestra?.length > 0 && <Muestra productos={prueba.muestra} moneda={form.moneda} />}
            </div>
          )}
        </div>
      )}

      {(form.fuente === 'manual' || remoto) && v.fuente !== form.fuente && (
        <button type="button" className="btn btn-sec w-full" onClick={() => guardar({}, 'Guardado.')} disabled={ocupado}>
          Usar "{FUENTES[form.fuente].texto}"
        </button>
      )}
    </section>
  );
}

function ElegirColumnas({ campos, mapeo, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {CAMPOS.map((c) => (
        <label key={c.id} className="block">
          <span className="mb-0.5 block text-[11px] text-tinta-400">
            {c.texto}
            {c.obligatorio ? ' *' : ''}
          </span>
          <select className="campo px-2 py-1.5 text-sm" value={mapeo[c.id] || ''} onChange={(e) => onChange({ ...mapeo, [c.id]: e.target.value || undefined })}>
            <option value="">— No está —</option>
            {campos.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

function Muestra({ productos, moneda }) {
  return (
    <ul className="divide-y divide-navy-800 rounded-xl bg-navy-850 text-sm">
      {productos.map((p, i) => (
        <li key={i} className="flex items-start gap-2 px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block leading-snug">{p.nombre}</span>
            <span className="text-[11px] text-tinta-400">
              {p.codigo ? `cód. ${p.codigo}` : 'sin código'} · {p.unidad}
              {p.stock !== undefined ? ` · stock ${p.stock}` : ''}
            </span>
          </span>
          <b className="shrink-0">{importe(p.precio, moneda)}</b>
        </li>
      ))}
    </ul>
  );
}

function SubirPlanilla({ v, avisar, recargar, guardarFuente }) {
  const entrada = useRef(null);
  const [archivo, setArchivo] = useState(null); // { nombre, bytes, hojas, hoja, campos, filas }
  const [mapeo, setMapeo] = useState({});
  const [progreso, setProgreso] = useState(null);

  async function abrir(file, hoja = 0) {
    avisar({ error: '', ok: '' });
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) return avisar({ error: 'La planilla es demasiado grande (máximo 25 MB).' });
    try {
      // ojo: los archivos (Blob) tienen un método .bytes() en los navegadores nuevos
      const bytes = typeof Blob !== 'undefined' && file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file.contenido;
      const t = await leerTabla(bytes, { hoja });
      const guardado = Object.fromEntries(Object.entries(v.mapeo || {}).filter(([k, x]) => CAMPOS.some((c) => c.id === k) && t.campos.includes(x)));
      setMapeo({ ...adivinarMapeo(t.campos), ...guardado });
      setArchivo({ nombre: file.name || file.nombre, bytes, hojas: t.hojas || [], hoja, campos: t.campos, filas: t.filas });
    } catch (e) {
      avisar({ error: e.message || 'No pudimos leer la planilla.' });
    }
  }

  const productos = archivo ? productosDe(archivo.filas, mapeo) : [];

  async function importar() {
    if (!productos.length) return;
    if (!(await guardarFuente())) return;
    setProgreso({ hechos: 0, total: productos.length });
    try {
      const r = await importarProductos(v.id, productos, {
        onProgreso: (hechos, total) => setProgreso({ hechos, total }),
        resumen: `Planilla ${archivo.nombre}: ${productos.length} productos`,
      });
      const limpio = Object.fromEntries(Object.entries(mapeo).filter(([, x]) => x));
      await supabase.from('proveedores').update({ mapeo: { ...(v.mapeo || {}), ...limpio } }).eq('id', v.id);
      avisar({ ok: `Lista cargada: ${(r.activos ?? 0).toLocaleString('es-UY')} productos (${r.nuevos} nuevos${r.bajas ? `, ${r.bajas} que ya no están quedaron fuera` : ''}).` });
      setArchivo(null);
      recargar();
    } catch (e) {
      avisar({ error: sinFuncion(e) ? AVISO_SQL_09 : mensajeError(e) });
    }
    setProgreso(null);
  }

  function bajarModelo() {
    const blob = new Blob([planillaModelo()], { type: TIPO_XLSX });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Lista-de-precios-modelo-TaListo.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return (
    <div className="space-y-3">
      <input
        ref={entrada}
        type="file"
        accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        className="hidden"
        onChange={(e) => {
          abrir(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-menta" onClick={() => entrada.current?.click()} disabled={!!progreso}>
          <Icon name="descargar" className="h-4 w-4 rotate-180" /> Subir planilla
        </button>
        <button type="button" className="btn btn-sec whitespace-nowrap px-2" onClick={bajarModelo}>
          <Icon name="descargar" className="h-4 w-4" /> Modelo .xlsx
        </button>
      </div>
      <p className="text-xs text-tinta-500">Excel (.xlsx) o CSV. Cada vez que subís la lista nueva, los precios se actualizan y lo que ya no está deja de aparecer.</p>

      {archivo && (
        <div className="space-y-3 rounded-xl border border-navy-700 p-3">
          <p className="text-sm">
            <b>{archivo.nombre}</b> · {archivo.filas.length.toLocaleString('es-UY')} filas
          </p>
          {archivo.hojas.length > 1 && (
            <select className="campo" value={archivo.hoja} onChange={(e) => abrir({ contenido: archivo.bytes, nombre: archivo.nombre, size: 0 }, Number(e.target.value))} aria-label="Hoja">
              {archivo.hojas.map((h, i) => (
                <option key={h} value={i}>Hoja: {h}</option>
              ))}
            </select>
          )}
          <ElegirColumnas campos={archivo.campos} mapeo={mapeo} onChange={setMapeo} />
          {productos.length > 0 ? (
            <>
              <p className="text-sm text-tinta-300">
                Se van a cargar <b className="text-tinta-100">{productos.length.toLocaleString('es-UY')} productos</b>
                {archivo.filas.length - productos.length > 0 ? ` (${archivo.filas.length - productos.length} filas sin descripción o precio quedan afuera)` : ''}. Así se ven:
              </p>
              <Muestra productos={productos.slice(0, 5)} moneda={v.moneda} />
            </>
          ) : (
            <p className="text-sm text-amber-300">Elegí la columna de la descripción y la del precio.</p>
          )}
          {progreso ? (
            <div>
              <div className="h-2 overflow-hidden rounded-full bg-navy-700">
                <div className="h-full bg-menta-400 transition-all" style={{ width: `${(progreso.hechos / progreso.total) * 100}%` }} />
              </div>
              <p className="mt-1 text-center text-xs text-tinta-400">Cargando {progreso.hechos.toLocaleString('es-UY')} de {progreso.total.toLocaleString('es-UY')}…</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-sec" onClick={() => setArchivo(null)}>Cancelar</button>
              <button type="button" className="btn btn-menta" onClick={importar} disabled={!productos.length}>Cargar lista</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------- Productos ---
function Productos({ v, puedeEditar, onCambio }) {
  const [texto, setTexto] = useState('');
  const [datos, setDatos] = useState({ lista: [], total: 0, cargando: true });
  const [pagina, setPagina] = useState(0);
  const [editando, setEditando] = useState(null);
  const pedido = useRef(0);

  const cargar = useCallback(async () => {
    const n = ++pedido.current;
    let q = supabase
      .from('productos_proveedor')
      .select('id, codigo, nombre, marca, unidad, precio, stock, stock_en, activo', { count: 'exact' })
      .eq('proveedor_id', v.id)
      .eq('activo', true)
      .order('nombre')
      .range(pagina * 50, pagina * 50 + 49);
    const palabras = normalizarTexto(texto).split(' ').filter(Boolean).slice(0, 5);
    palabras.forEach((w) => {
      q = q.ilike('texto', `%${w}%`);
    });
    const { data, count } = await q;
    if (n !== pedido.current) return;
    setDatos({ lista: data || [], total: count || 0, cargando: false });
  }, [v.id, texto, pagina]);

  useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
  }, [cargar]);

  const paginas = Math.ceil(datos.total / 50);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="titulo-seccion">Productos ({datos.total.toLocaleString('es-UY')})</h2>
        {puedeEditar && (
          <button type="button" className="chip chip-activo" onClick={() => setEditando({})}>
            <Icon name="mas" className="h-3.5 w-3.5" /> Producto
          </button>
        )}
      </div>
      <div className="relative mb-2">
        <Icon name="buscar" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tinta-500" />
        <input
          className="campo pl-9"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setPagina(0);
          }}
          placeholder="Buscar en la lista"
          aria-label="Buscar en la lista"
        />
      </div>
      {datos.lista.length === 0 ? (
        <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">{datos.cargando ? 'Cargando…' : texto ? 'Sin resultados.' : 'La lista está vacía.'}</p>
      ) : (
        <ul className="divide-y divide-navy-800 overflow-hidden rounded-xl border border-navy-700">
          {datos.lista.map((p) => (
            <li key={p.id}>
              <button type="button" disabled={!puedeEditar} onClick={() => setEditando(p)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-navy-850 disabled:hover:bg-transparent">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-snug">{p.nombre}</span>
                  <span className="text-[11px] text-tinta-400">
                    cód. {p.codigo}
                    {p.marca ? ` · ${p.marca}` : ''} · {p.unidad}
                    {p.stock !== null ? ` · stock ${Number(p.stock).toLocaleString('es-UY')}` : ''}
                  </span>
                </span>
                <b className="shrink-0 text-sm">{importe(p.precio, v.moneda)}</b>
              </button>
            </li>
          ))}
        </ul>
      )}
      {paginas > 1 && (
        <div className="mt-2 flex items-center justify-center gap-3 text-sm">
          <button type="button" className="btn btn-sec px-2.5 py-1.5" onClick={() => setPagina((x) => Math.max(0, x - 1))} disabled={pagina === 0} aria-label="Anterior">
            <Icon name="izq" className="h-4 w-4" />
          </button>
          <span className="text-tinta-400">
            {pagina + 1} de {paginas}
          </span>
          <button type="button" className="btn btn-sec px-2.5 py-1.5" onClick={() => setPagina((x) => Math.min(paginas - 1, x + 1))} disabled={pagina >= paginas - 1} aria-label="Siguiente">
            <Icon name="der" className="h-4 w-4" />
          </button>
        </div>
      )}
      <EditarProducto
        producto={editando}
        proveedor={v}
        onCerrar={() => setEditando(null)}
        onGuardado={() => {
          setEditando(null);
          cargar();
          onCambio();
        }}
      />
    </section>
  );
}

function EditarProducto({ producto, proveedor, onCerrar, onGuardado }) {
  const [f, setF] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!producto) return;
    setError('');
    setF({
      codigo: vacio(producto.codigo),
      nombre: vacio(producto.nombre),
      marca: vacio(producto.marca),
      unidad: vacio(producto.unidad) || 'u',
      precio: vacio(producto.precio),
      stock: vacio(producto.stock),
    });
  }, [producto]);

  if (!producto || !f) return null;
  const nuevo = !producto.id;

  async function guardar() {
    const precio = leerNumero(f.precio);
    if (!f.nombre.trim() || precio === null || precio < 0) return setError('Poné la descripción y el precio.');
    const fila = {
      codigo: f.codigo.trim() || `M-${Date.now().toString(36)}`,
      nombre: f.nombre.trim(),
      marca: f.marca.trim() || null,
      unidad: f.unidad.trim() || 'u',
      precio,
      stock: leerNumero(f.stock),
      stock_en: f.stock.trim() ? new Date().toISOString() : null,
      activo: true,
    };
    const { error: e } = nuevo
      ? await supabase.from('productos_proveedor').insert({ ...fila, proveedor_id: proveedor.id })
      : await supabase.from('productos_proveedor').update(fila).eq('id', producto.id);
    if (e) return setError(e.code === '23505' ? 'Ya hay un producto con ese código.' : mensajeError(e));
    await supabase.rpc('contar_productos', { p_proveedor: proveedor.id });
    onGuardado();
  }

  async function quitar() {
    if (!window.confirm('¿Sacar este producto de la lista?')) return;
    const { error: e } = await supabase.from('productos_proveedor').update({ activo: false }).eq('id', producto.id);
    if (e) return setError(mensajeError(e));
    await supabase.rpc('contar_productos', { p_proveedor: proveedor.id });
    onGuardado();
  }

  return (
    <Modal
      abierto={!!producto}
      onCerrar={onCerrar}
      titulo={nuevo ? 'Nuevo producto' : 'Editar producto'}
      pie={
        <div className="flex gap-2">
          {!nuevo && (
            <button type="button" className="btn btn-peligro px-3" onClick={quitar} aria-label="Sacar de la lista">
              <Icon name="borrar" />
            </button>
          )}
          <button type="button" className="btn btn-menta flex-1" onClick={guardar}>Guardar</button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="etiqueta" htmlFor="ep-nom">Descripción</label>
          <input id="ep-nom" className="campo" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="etiqueta" htmlFor="ep-cod">Código</label>
            <input id="ep-cod" className="campo" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} placeholder="Opcional" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="ep-marca">Marca</label>
            <input id="ep-marca" className="campo" value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="etiqueta" htmlFor="ep-un">Unidad</label>
            <input id="ep-un" className="campo" value={f.unidad} onChange={(e) => setF({ ...f, unidad: e.target.value })} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="ep-pre">Precio ({proveedor.moneda})</label>
            <input id="ep-pre" className="campo" inputMode="decimal" value={f.precio} onChange={(e) => setF({ ...f, precio: e.target.value })} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="ep-st">Stock</label>
            <input id="ep-st" className="campo" inputMode="decimal" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} placeholder="—" />
          </div>
        </div>
        {(proveedor.fuente === 'planilla' || proveedor.fuente === 'url' || proveedor.fuente === 'api') && (
          <p className="text-xs text-tinta-500">Ojo: al cargar la lista nueva del proveedor, los productos que no estén en ella dejan de aparecer.</p>
        )}
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}
