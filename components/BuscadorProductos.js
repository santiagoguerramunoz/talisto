'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/util';
import { AVISO_SQL_09, cotizacionGuardada, guardarCotizacion, importe, sinFuncion } from '@/lib/proveedores';
import { haceCuanto } from '@/lib/equipo';

/**
 * Busca productos en las listas de los proveedores y los agrega.
 * onElegir(producto, { cotizacion }) — el modal queda abierto para seguir agregando.
 * proveedorId: busca solo en ese proveedor
 */
export default function BuscadorProductos({ abierto, onCerrar, onElegir, cuenta, proveedorId = null, monedaDestino = 'UYU', titulo = 'Buscar en proveedores' }) {
  const [texto, setTexto] = useState('');
  const [proveedor, setProveedor] = useState(proveedorId || '');
  const [proveedores, setProveedores] = useState([]);
  const [resultado, setResultado] = useState({ lista: [], cargando: false, error: '', bloqueo: false });
  const [agregados, setAgregados] = useState({});
  const [pidiendo, setPidiendo] = useState(null); // producto en dólares esperando la cotización
  const [cotizacion, setCotizacion] = useState('');
  const pedido = useRef(0);

  useEffect(() => {
    if (!abierto) return;
    setTexto('');
    setAgregados({});
    setPidiendo(null);
    setProveedor(proveedorId || '');
    setCotizacion(String(cotizacionGuardada() || ''));
    setResultado({ lista: [], cargando: false, error: '', bloqueo: false });
    if (!proveedorId) {
      supabase
        .from('proveedores')
        .select('id, nombre, profesional_id, productos')
        .eq('activo', true)
        .or(`profesional_id.eq.${cuenta},profesional_id.is.null`)
        .order('nombre')
        .then(({ data }) => setProveedores((data || []).filter((p) => p.productos > 0)));
    }
  }, [abierto, proveedorId, cuenta]);

  useEffect(() => {
    if (!abierto) return undefined;
    const t = texto.trim();
    if (t.length < 2 && !proveedor) {
      setResultado((r) => ({ ...r, lista: [], cargando: false }));
      return undefined;
    }
    const n = ++pedido.current;
    setResultado((r) => ({ ...r, cargando: true }));
    const espera = setTimeout(async () => {
      const { data, error } = await supabase.rpc('buscar_productos', { p_cuenta: cuenta, p_texto: t, p_proveedor: proveedor || null, p_limite: 40 });
      if (n !== pedido.current) return;
      if (error) {
        setResultado({
          lista: [],
          cargando: false,
          bloqueo: error.code === 'TL001',
          error: sinFuncion(error) ? AVISO_SQL_09 : mensajeError(error),
        });
        return;
      }
      setResultado({ lista: data || [], cargando: false, error: '', bloqueo: false });
    }, 280);
    return () => clearTimeout(espera);
  }, [texto, proveedor, abierto, cuenta]);

  function elegir(p, cot = null) {
    if (p.moneda !== monedaDestino && monedaDestino === 'UYU' && !cot) {
      setPidiendo(p);
      return;
    }
    onElegir(p, { cotizacion: cot });
    setAgregados((a) => ({ ...a, [p.id]: (a[p.id] || 0) + 1 }));
  }

  function confirmarCotizacion() {
    const c = Number(String(cotizacion).replace(',', '.'));
    if (!Number.isFinite(c) || c <= 0) return;
    guardarCotizacion(c);
    const p = pidiendo;
    setPidiendo(null);
    elegir(p, c);
  }

  const cuantos = Object.values(agregados).reduce((s, n) => s + n, 0);

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={titulo}
      pie={
        <button type="button" className="btn btn-menta w-full" onClick={onCerrar}>
          {cuantos ? `Listo · ${cuantos} ${cuantos === 1 ? 'agregado' : 'agregados'}` : 'Cerrar'}
        </button>
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <Icon name="buscar" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tinta-500" />
          <input
            className="campo pl-9"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Producto, marca o código"
            autoFocus
            aria-label="Buscar producto"
          />
        </div>
        {!proveedorId && proveedores.length > 1 && (
          <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1">
            <button type="button" onClick={() => setProveedor('')} className={`chip shrink-0 ${!proveedor ? 'chip-activo' : ''}`}>Todos</button>
            {proveedores.map((p) => (
              <button key={p.id} type="button" onClick={() => setProveedor(p.id)} className={`chip shrink-0 ${proveedor === p.id ? 'chip-activo' : ''}`}>
                {p.nombre}
              </button>
            ))}
          </div>
        )}

        {pidiendo && (
          <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm">
            <p className="font-semibold text-amber-200">{pidiendo.nombre} está en dólares ({importe(pidiendo.precio, 'USD')}).</p>
            <label className="mt-2 block text-xs text-tinta-300" htmlFor="bp-cot">Cotización del dólar para pasarlo a pesos</label>
            <div className="mt-1 flex gap-2">
              <input id="bp-cot" className="campo" inputMode="decimal" value={cotizacion} onChange={(e) => setCotizacion(e.target.value)} placeholder="Ej. 40,5" />
              <button type="button" className="btn btn-menta shrink-0" onClick={confirmarCotizacion}>Agregar</button>
            </div>
          </div>
        )}

        {resultado.error && (
          <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">
            {resultado.error}
            {resultado.bloqueo && (
              <Link href="/panel/planes" className="mt-2 block font-bold text-marca-naranja">Ver planes</Link>
            )}
          </div>
        )}

        {resultado.cargando && resultado.lista.length === 0 ? (
          <p className="py-6 text-center text-sm text-tinta-400">Buscando…</p>
        ) : resultado.lista.length === 0 && !resultado.error ? (
          <p className="py-6 text-center text-sm text-tinta-400">
            {texto.trim().length < 2 && !proveedor ? 'Escribí al menos 2 letras.' : 'No encontramos productos con esa búsqueda.'}
            {proveedores.length === 0 && !proveedorId && (
              <Link href="/panel/finanzas/compras?ver=proveedores" className="mt-2 block font-semibold text-menta-300">
                Cargá la lista de precios de tus proveedores
              </Link>
            )}
          </p>
        ) : (
          <ul className="divide-y divide-navy-800 overflow-hidden rounded-xl border border-navy-700">
            {resultado.lista.map((p) => {
              const sinStock = p.stock !== null && p.stock !== undefined && Number(p.stock) <= 0;
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => elegir(p)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-navy-850">
                    <span className="min-w-0 flex-1">
                      <b className="block text-sm leading-snug">{p.nombre}</b>
                      <span className="block truncate text-xs text-tinta-400">
                        {p.proveedor}
                        {p.de_talisto ? ' · TaListo!' : ''} · cód. {p.codigo}
                        {p.marca ? ` · ${p.marca}` : ''}
                      </span>
                      {p.stock !== null && p.stock !== undefined && (
                        <span className={`text-[11px] font-semibold ${sinStock ? 'text-red-300' : 'text-menta-300'}`}>
                          {sinStock ? 'Sin stock' : `Stock ${Number(p.stock).toLocaleString('es-UY')}`}
                          {p.stock_en ? <span className="font-normal text-tinta-500"> · {haceCuanto(p.stock_en)}</span> : null}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right">
                      <b className="block text-sm">{importe(p.precio, p.moneda)}</b>
                      <span className="block text-[11px] text-tinta-500">{p.iva_incluido ? 'IVA inc.' : '+ IVA'} · {p.unidad}</span>
                      {agregados[p.id] ? (
                        <span className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] font-bold text-menta-300">
                          <Icon name="check" className="h-3 w-3" /> {agregados[p.id] > 1 ? `×${agregados[p.id]}` : 'Agregado'}
                        </span>
                      ) : (
                        <span className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] font-bold text-menta-400">
                          <Icon name="mas" className="h-3 w-3" /> Agregar
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
