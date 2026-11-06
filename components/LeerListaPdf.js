'use client';

import { useRef, useState } from 'react';
import Icon from './Icon';
import { supabase } from '@/lib/supabase';
import { comprimirImagen } from '@/lib/imagenes';
import { juntarProductos } from '@/lib/listasIA';
import { aBase64, abrirPdf, pdfDePaginas, tandasDe } from '@/lib/listaPdf';
import { AVISO_SQL_09, importarProductos, importe, sinFuncion } from '@/lib/proveedores';
import { mensajeError } from '@/lib/util';

const POR_TANDA = 2; // páginas por tanda: así cada respuesta de la IA es corta y rápida
const MAX_PAGINAS = 80;
const MAX_FOTOS = 30;
const MAX_PDF = 40 * 1024 * 1024;
const MAX_B64 = 3_900_000;
const A_LA_VEZ = 2;
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];

let siguienteK = 0;
const nuevaTanda = (datos) => ({ k: ++siguienteK, estado: 'pendiente', productos: [], error: '', moneda: '', iva: null, nota: '', ...datos });
const etiqueta = (t) => (t.foto ? `Foto ${t.desde}` : t.desde === t.hasta ? `Pág. ${t.desde}` : `Págs. ${t.desde}–${t.hasta}`);
const ESTILO = {
  pendiente: 'border-navy-700 text-tinta-400',
  leyendo: 'border-[#0a84ff]/50 bg-[#0a84ff]/10 text-[#8cc8ff]',
  ok: 'border-menta-500/40 bg-menta-500/10 text-menta-200',
  error: 'border-red-400/40 bg-red-500/10 text-red-200',
};

function errorGrande(mensaje) {
  const e = new Error(mensaje);
  e.grande = true;
  return e;
}

/**
 * Lista de precios en PDF o fotos → la IA la lee de a tandas → se revisa → productos del proveedor.
 * Toda la lista cuenta como una lectura del mes. Si una tanda falla se reintenta sola sin tocar las demás.
 */
export default function LeerListaPdf({ v, avisar, recargar, guardarFuente }) {
  const entrada = useRef(null);
  const [origen, setOrigen] = useState(null); // { nombre, tipo, paginas, doc }
  const [tandas, setTandasEstado] = useState([]);
  const tandasRef = useRef([]);
  const lecturaRef = useRef(null);
  const cortarRef = useRef(false);
  const [leyendo, setLeyendo] = useState(false);
  const [abriendo, setAbriendo] = useState(false);
  const [aviso, setAviso] = useState('');
  const [uso, setUso] = useState(null);
  const [completa, setCompleta] = useState(false);
  const [progreso, setProgreso] = useState(null);

  const setTandas = (f) => {
    tandasRef.current = typeof f === 'function' ? f(tandasRef.current) : f;
    setTandasEstado(tandasRef.current);
  };
  const poner = (k, cambios) => setTandas((lista) => lista.map((t) => (t.k === k ? { ...t, ...cambios } : t)));

  function reiniciar() {
    cortarRef.current = true;
    lecturaRef.current = null;
    setOrigen(null);
    setTandas([]);
    setAviso('');
    setCompleta(false);
  }

  async function elegir(lista) {
    const archivos = Array.from(lista || []);
    if (!archivos.length) return;
    avisar({ error: '', ok: '' });
    setAviso('');
    lecturaRef.current = null;
    const pdf = archivos.find((a) => a.type === 'application/pdf' || /\.pdf$/i.test(a.name || ''));
    if (pdf) {
      if (pdf.size > MAX_PDF) return setAviso('El PDF pesa más de 40 MB. Partilo en dos y cargá cada parte.');
      setAbriendo(true);
      try {
        const { doc, paginas } = await abrirPdf(pdf);
        if (!paginas) throw new Error('El PDF no tiene páginas.');
        if (paginas > MAX_PAGINAS) throw new Error(`Tiene ${paginas} páginas y el máximo es ${MAX_PAGINAS}. Partilo en dos PDF y cargá cada uno.`);
        setOrigen({ nombre: pdf.name || 'lista.pdf', tipo: 'pdf', paginas, doc });
        setTandas(tandasDe(paginas, POR_TANDA).map((t) => nuevaTanda(t)));
      } catch (e) {
        setAviso(e.message);
      }
      setAbriendo(false);
      return;
    }
    const fotos = archivos.filter((a) => a.type.startsWith('image/')).slice(0, MAX_FOTOS);
    if (!fotos.length) return setAviso('Elegí un PDF o fotos de la lista.');
    setOrigen({ nombre: fotos.length === 1 ? fotos[0].name || 'foto' : `${fotos.length} fotos`, tipo: 'fotos', paginas: fotos.length });
    setTandas(fotos.map((foto, i) => nuevaTanda({ desde: i + 1, hasta: i + 1, foto })));
  }

  async function archivoDe(t) {
    if (t.foto) {
      const blob = await comprimirImagen(t.foto, 2000, 0.85);
      const tipo = blob.type || 'image/jpeg';
      if (!TIPOS.includes(tipo)) throw new Error('No pudimos procesar esa foto. Probá sacándola de nuevo.');
      const datos = await aBase64(blob);
      if (datos.length > MAX_B64) throw new Error('La foto pesa demasiado.');
      return { tipo, datos };
    }
    const datos = await aBase64(await pdfDePaginas(origen.doc, t.desde, t.hasta));
    if (datos.length > MAX_B64) throw errorGrande(t.desde === t.hasta ? `La página ${t.desde} pesa demasiado para leerla.` : 'Estas páginas pesan demasiado juntas.');
    return { tipo: 'application/pdf', datos };
  }

  // Una tanda de varias páginas que no salió se vuelve a leer de a una página
  function partir(k, cola) {
    const t = tandasRef.current.find((x) => x.k === k);
    const sueltas = Array.from({ length: t.hasta - t.desde + 1 }, (_, i) => nuevaTanda({ desde: t.desde + i, hasta: t.desde + i }));
    setTandas((lista) => lista.flatMap((x) => (x.k === k ? sueltas : [x])));
    cola.unshift(...sueltas.map((x) => x.k));
  }

  async function leerUna(k, cola, cantidad) {
    const t = tandasRef.current.find((x) => x.k === k);
    if (!t) return;
    poner(k, { estado: 'leyendo', error: '' });
    let archivo;
    try {
      archivo = await archivoDe(t);
    } catch (e) {
      if (e.grande && t.desde < t.hasta) return partir(k, cola);
      return poner(k, { estado: 'error', error: e.message || 'No pudimos preparar esta parte.' });
    }
    let r;
    let res = {};
    try {
      const { data: s } = await supabase.auth.getSession();
      const indice = tandasRef.current.findIndex((x) => x.k === k);
      r = await fetch('/api/proveedores/leer-lista', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token || ''}` },
        body: JSON.stringify({
          proveedor_id: v.id,
          lectura: lecturaRef.current,
          tandas: cantidad,
          parte: { n: indice + 1, de: tandasRef.current.length, desde: t.desde, hasta: t.hasta, tipo: t.foto ? 'foto' : 'pdf' },
          archivos: [archivo],
        }),
      });
      res = await r.json().catch(() => ({}));
    } catch {
      return poner(k, { estado: 'error', error: 'No hay conexión. Revisá tu internet y reintentá.' });
    }
    if (res.lectura) lecturaRef.current = res.lectura;
    if (res.usadas != null) setUso({ usadas: res.usadas, limite: res.limite });
    if (r.ok) {
      return poner(k, { estado: 'ok', productos: res.productos || [], moneda: res.moneda || '', iva: res.precios_con_iva ?? null, nota: res.nota || '' });
    }
    if (res.fatal) {
      cortarRef.current = true;
      setAviso(res.error || 'No se pudo leer la lista.');
      return poner(k, { estado: 'error', error: res.error || 'No se pudo leer.' });
    }
    const porTamano = r.status === 413 || res.grande || res.motivo === 'incompleto' || res.motivo === 'tiempo';
    if (porTamano && t.desde < t.hasta) return partir(k, cola);
    return poner(k, { estado: 'error', error: res.error || 'No se pudo leer esta parte.' });
  }

  async function leer() {
    cortarRef.current = false;
    setAviso('');
    const cola = tandasRef.current.filter((t) => t.estado !== 'ok').map((t) => t.k);
    setTandas((lista) => lista.map((t) => (t.estado === 'ok' ? t : { ...t, estado: 'pendiente', error: '' })));
    const cantidad = Math.min(40, tandasRef.current.length);
    setLeyendo(true);
    // De a una hasta que se abra la lectura (así el plan y el tope se controlan antes de seguir)
    while (!lecturaRef.current && cola.length && !cortarRef.current) await leerUna(cola.shift(), cola, cantidad);
    const trabajar = async () => {
      while (cola.length && !cortarRef.current && lecturaRef.current) await leerUna(cola.shift(), cola, cantidad);
    };
    await Promise.all(Array.from({ length: A_LA_VEZ }, trabajar));
    // Las que quedaron sin leer porque se cortó
    setTandas((lista) => lista.map((t) => (t.estado === 'leyendo' || t.estado === 'pendiente' ? { ...t, estado: t.estado === 'leyendo' ? 'error' : 'pendiente' } : t)));
    setLeyendo(false);
  }

  const listas = tandas.filter((t) => t.estado === 'ok');
  const conError = tandas.filter((t) => t.estado === 'error');
  const sinLeer = tandas.filter((t) => t.estado === 'pendiente');
  const terminadas = listas.length + conError.length;
  const productos = juntarProductos(listas.map((t) => t.productos));
  const leidos = listas.reduce((s, t) => s + t.productos.length, 0);
  const monedas = [...new Set(listas.map((t) => t.moneda).filter(Boolean))];
  const otraMoneda = monedas.find((m) => m !== v.moneda);
  const ivas = [...new Set(listas.map((t) => t.iva).filter((x) => x !== null))];
  const otroIva = ivas.length === 1 && ivas[0] !== !!v.iva_incluido;
  const notas = [...new Set(listas.map((t) => t.nota).filter(Boolean))].slice(0, 3);
  const empezo = tandas.some((t) => t.estado !== 'pendiente');
  const todoBien = listas.length === tandas.length && tandas.length > 0;

  async function cargar() {
    if (!productos.length) return;
    if (!(await guardarFuente())) return;
    setProgreso({ hechos: 0, total: productos.length });
    try {
      const r = await importarProductos(
        v.id,
        productos.map((p) => ({ codigo: p.codigo || null, nombre: p.nombre, marca: p.marca || null, unidad: p.unidad, precio: p.precio, categoria: p.categoria || null })),
        {
          completa: completa && todoBien,
          onProgreso: (hechos, total) => setProgreso({ hechos, total }),
          resumen: `PDF ${origen.nombre}: ${productos.length} productos leídos con IA`,
        }
      );
      avisar({
        ok: `Lista cargada: ${(r.nuevos + r.actualizados).toLocaleString('es-UY')} productos (${r.nuevos} nuevos)${r.bajas === 1 ? '; 1 que ya no está quedó fuera' : r.bajas ? `; ${r.bajas} que ya no están quedaron fuera` : ''}.`,
        error: '',
      });
      reiniciar();
      recargar();
    } catch (e) {
      avisar({ error: sinFuncion(e) ? AVISO_SQL_09 : mensajeError(e) });
    }
    setProgreso(null);
  }

  const input = (
    <input
      ref={entrada}
      type="file"
      accept="application/pdf,image/*"
      multiple
      className="hidden"
      onChange={(e) => {
        elegir(e.target.files);
        e.target.value = '';
      }}
    />
  );

  if (!origen) {
    return (
      <div className="space-y-2 rounded-xl border border-dashed border-navy-700 p-3">
        {input}
        <p className="text-sm font-semibold">¿La lista viene en PDF o en papel?</p>
        <p className="text-xs text-tinta-400">
          La IA la lee de a {POR_TANDA} páginas por vez y vos revisás antes de cargarla. Toda la lista cuenta como 1 lectura del mes. Hasta {MAX_PAGINAS} páginas o {MAX_FOTOS} fotos.
        </p>
        <button type="button" className="btn btn-sec w-full" onClick={() => entrada.current?.click()} disabled={abriendo}>
          <Icon name="documento" className="h-4 w-4" /> {abriendo ? 'Abriendo…' : 'Leer PDF o fotos con IA'}
        </button>
        {aviso && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{aviso}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-navy-700 p-3">
      {input}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm">
          <b className="break-all">{origen.nombre}</b>
          <span className="block text-xs text-tinta-400">
            {origen.tipo === 'pdf' ? `${origen.paginas} ${origen.paginas === 1 ? 'página' : 'páginas'}` : `${origen.paginas} ${origen.paginas === 1 ? 'foto' : 'fotos'}`} · {tandas.length}{' '}
            {tandas.length === 1 ? 'tanda' : 'tandas'}
            {uso?.limite != null ? ` · este mes ${uso.usadas} de ${uso.limite} lecturas` : ''}
          </span>
        </p>
        {!leyendo && !progreso && (
          <button type="button" className="shrink-0 rounded-full p-1 text-tinta-400 hover:text-tinta-100" onClick={reiniciar} aria-label="Cancelar">
            <Icon name="cerrar" className="h-4 w-4" />
          </button>
        )}
      </div>

      {empezo && (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-navy-700">
            <div className="h-full bg-menta-400 transition-all" style={{ width: `${(terminadas / tandas.length) * 100}%` }} />
          </div>
          <p className="mt-1 text-xs text-tinta-400">
            {leyendo ? 'Leyendo… ' : ''}
            {listas.length} de {tandas.length} {tandas.length === 1 ? 'tanda lista' : 'tandas listas'} · {productos.length.toLocaleString('es-UY')} productos
            {leyendo ? ' · no cierres esta pantalla' : ''}
          </p>
        </div>
      )}

      <ul className="flex flex-wrap gap-1.5" aria-label="Tandas">
        {tandas.map((t) => (
          <li key={t.k} className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${ESTILO[t.estado]}`} title={t.error || undefined}>
            {etiqueta(t)}
            {t.estado === 'ok' ? ` · ${t.productos.length}` : t.estado === 'leyendo' ? ' · …' : t.estado === 'error' ? ' · falló' : ''}
          </li>
        ))}
      </ul>

      {aviso && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{aviso}</p>}

      {!empezo && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-sec" onClick={reiniciar}>Cancelar</button>
          <button type="button" className="btn btn-menta" onClick={leer}>
            <Icon name="check" className="h-4 w-4" /> Leer con IA
          </button>
        </div>
      )}

      {leyendo && (
        <button type="button" className="btn btn-sec w-full" onClick={() => (cortarRef.current = true)}>
          <Icon name="pausa" className="h-4 w-4" /> Parar después de estas
        </button>
      )}

      {empezo && !leyendo && (
        <div className="space-y-3">
          {(conError.length > 0 || sinLeer.length > 0) && (
            <div className="space-y-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-200">
              <p>
                {conError.length > 0 && <>No se pudo leer: {conError.map(etiqueta).join(', ')}. </>}
                {sinLeer.length > 0 && <>Quedan sin leer: {sinLeer.map(etiqueta).join(', ')}. </>}
                Reintentá solo {conError.length + sinLeer.length === 1 ? 'esa' : 'esas'} o cargá lo que ya se leyó.
              </p>
              {conError[0]?.error && <p className="text-xs text-red-300">{conError[0].error}</p>}
              <button type="button" className="btn btn-sec w-full" onClick={leer}>
                <Icon name="repetir" className="h-4 w-4" /> Reintentar {conError.length + sinLeer.length === 1 ? 'esa' : `esas ${conError.length + sinLeer.length}`}
              </button>
            </div>
          )}

          {otraMoneda && (
            <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">
              La lista parece estar en {otraMoneda === 'USD' ? 'dólares' : 'pesos'} y el proveedor está en {v.moneda === 'USD' ? 'dólares' : 'pesos'}. Cambiá la moneda en sus datos antes de cargarla.
            </p>
          )}
          {otroIva && (
            <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">
              La lista dice que sus precios {ivas[0] ? 'incluyen' : 'no incluyen'} IVA y el proveedor está como {v.iva_incluido ? 'con' : 'sin'} IVA. Revisalo en sus datos.
            </p>
          )}
          {notas.map((n) => (
            <p key={n} className="rounded-xl bg-amber-400/10 px-3 py-2 text-xs text-amber-200">La IA avisa: {n}</p>
          ))}

          {productos.length > 0 ? (
            <>
              <p className="text-sm text-tinta-300">
                Encontró <b className="text-tinta-100">{productos.length.toLocaleString('es-UY')} productos con precio</b>
                {leidos - productos.length === 1 ? ' (1 repetido queda una sola vez)' : leidos > productos.length ? ` (${leidos - productos.length} repetidos quedan una sola vez)` : ''}. Revisá algunos:
              </p>
              <ul className="divide-y divide-navy-800 rounded-xl bg-navy-850 text-sm">
                {productos.slice(0, 6).map((p, i) => (
                  <li key={i} className="flex items-start gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block leading-snug">{p.nombre}</span>
                      <span className="text-[11px] text-tinta-400">
                        {p.codigo ? `cód. ${p.codigo}` : 'sin código'} · {p.unidad}
                        {p.marca ? ` · ${p.marca}` : ''}
                        {p.categoria ? ` · ${p.categoria}` : ''}
                      </span>
                    </span>
                    <b className="shrink-0">{importe(p.precio, v.moneda)}</b>
                  </li>
                ))}
              </ul>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[#2cc79b]"
                  checked={completa && todoBien}
                  disabled={!todoBien}
                  onChange={(e) => setCompleta(e.target.checked)}
                />
                <span>
                  Es la lista completa del proveedor: lo que no está en ella deja de aparecer.
                  <span className="block text-xs text-tinta-400">
                    {todoBien ? 'Si no la marcás, solo se suman productos y se actualizan precios.' : 'Solo se puede cuando se leyeron todas las páginas: ahora solo se suman productos y se actualizan precios.'}
                  </span>
                </span>
              </label>

              {progreso ? (
                <div>
                  <div className="h-2 overflow-hidden rounded-full bg-navy-700">
                    <div className="h-full bg-menta-400 transition-all" style={{ width: `${(progreso.hechos / progreso.total) * 100}%` }} />
                  </div>
                  <p className="mt-1 text-center text-xs text-tinta-400">Cargando {progreso.hechos.toLocaleString('es-UY')} de {progreso.total.toLocaleString('es-UY')}…</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="btn btn-sec" onClick={reiniciar}>Cancelar</button>
                  <button type="button" className="btn btn-menta" onClick={cargar}>
                    Cargar {productos.length.toLocaleString('es-UY')}
                  </button>
                </div>
              )}
            </>
          ) : (
            listas.length > 0 && <p className="text-sm text-amber-300">No encontramos productos con precio en lo que se leyó.</p>
          )}
        </div>
      )}
    </div>
  );
}
