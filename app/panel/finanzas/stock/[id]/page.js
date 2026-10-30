'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import DetalleMovimiento from '@/components/DetalleMovimiento';
import EditorMaterial from '@/components/EditorMaterial';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { TIPOS_MOV, cant, conUnidad, desglose, fechaHora, numeroMov, rpcStock, textoError } from '@/lib/stock';

const EVENTO = {
  confirmacion: 'Confirmado al recibir',
  rechazo: 'Volvió: no lo recibieron',
  cancelacion: 'Volvió: se canceló el envío',
};

export default function FichaMaterial() {
  const { id } = useParams();
  const panel = usePanel();
  const { profesional, yo, user, permisos, empresa } = panel;
  const cuenta = profesional.id;
  const esDueno = yo?.id === profesional.id;
  const veCostos = esDueno || (permisos || []).includes('importes') || (permisos || []).includes('compras');
  const puedeEditar = esDueno || (permisos || []).includes('stock') || (permisos || []).includes('compras');
  const gestiona = esDueno || (permisos || []).includes('stock');
  const [m, setM] = useState(null);
  const [lugares, setLugares] = useState([]);
  const [vinculos, setVinculos] = useState([]);
  const [kardex, setKardex] = useState({ lista: [], cargando: true, fin: false });
  const [filtro, setFiltro] = useState('');
  const [error, setError] = useState('');
  const [editando, setEditando] = useState(false);
  const [detalle, setDetalle] = useState(null);

  const cargarKardex = useCallback(
    async (ubic = '', antes = null) => {
      setKardex((k) => ({ ...k, cargando: true, ...(antes ? {} : { lista: [] }) }));
      try {
        const lista = await rpcStock('stock_kardex', { p_cuenta: cuenta, p_material: id, p_ubicacion: ubic || null, p_antes: antes, p_limite: 60 });
        setKardex((k) => ({ lista: antes ? [...k.lista, ...lista] : lista, cargando: false, fin: lista.length < 60 }));
      } catch (e) {
        setError(textoError(e));
        setKardex((k) => ({ ...k, cargando: false }));
      }
    },
    [cuenta, id]
  );

  const cargar = useCallback(async () => {
    const [mat, cos, st, vin] = await Promise.all([
      supabase.from('materiales').select('*').eq('id', id).maybeSingle(),
      veCostos ? supabase.from('materiales_costos').select('costo, moneda, actualizado_en').eq('material_id', id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('stock').select('cantidad, ubicacion_id, ubicaciones_stock(id, nombre, tipo, activo)').eq('material_id', id).gt('cantidad', 0),
      supabase.from('materiales_vinculos').select('factor, producto_id, productos_proveedor(codigo, nombre, unidad, precio, proveedores(nombre))').eq('material_id', id),
    ]);
    if (mat.error || !mat.data) {
      setError(mat.error ? textoError(mat.error) : 'No encontramos este material.');
      return;
    }
    setM({ ...mat.data, costo: cos.data?.costo ?? null, moneda: cos.data?.moneda ?? 'UYU', costo_en: cos.data?.actualizado_en ?? null });
    setLugares((st.data || []).filter((s) => s.ubicaciones_stock));
    setVinculos(vin.data || []);
  }, [id, veCostos]);

  useEffect(() => {
    cargar();
  }, [cargar]);
  useEffect(() => {
    cargarKardex(filtro);
  }, [cargarKardex, filtro]);

  if (error && !m) {
    return (
      <div className="p-4">
        <p className="text-tinta-300">{error}</p>
        <Link href="/panel/finanzas/stock" className="btn btn-sec mt-4">Volver al stock</Link>
      </div>
    );
  }
  if (!m) return <p className="p-4 text-tinta-400">Cargando…</p>;

  const empresaLugares = lugares.filter((l) => l.ubicaciones_stock.tipo !== 'trabajo');
  const enObra = lugares.filter((l) => l.ubicaciones_stock.tipo === 'trabajo');
  const total = empresaLugares.reduce((s, l) => s + Number(l.cantidad), 0);
  const desg = desglose(total, m);
  const lugaresKardex = [...new Map(kardex.lista.map((k) => [k.ubicacion_id, k.lugar])).entries()];

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/panel/finanzas/stock" className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver">
            <Icon name="izq" />
          </Link>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-menta-500/10 text-menta-300">
            <Icon name="caja" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-tinta-400">{[m.codigo, m.marca, m.categoria].filter(Boolean).join(' · ') || 'Material'}</p>
            <h1 className="truncate text-xl font-extrabold">{m.nombre}</h1>
          </div>
          {puedeEditar && (
            <button type="button" className="btn btn-sec shrink-0 px-3 py-2" onClick={() => setEditando(true)} aria-label="Editar material">
              <Icon name="editar" />
            </button>
          )}
        </div>
      </header>

      <div className="space-y-5 px-4 pt-4">
        {m.activo === false && <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-300">Material archivado.</p>}

        <section className="tarjeta p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-tinta-400">En la empresa</p>
          <p className="mt-1 text-3xl font-extrabold">
            {cant(total, m.decimales)} <span className="text-lg text-tinta-300">{m.unidad}</span>
          </p>
          {desg && <p className="text-sm text-tinta-300">{desg}</p>}
          {m.stock_minimo !== null && m.stock_minimo !== undefined && (
            <p className={`mt-1 text-xs ${total < Number(m.stock_minimo) ? 'font-semibold text-amber-300' : 'text-tinta-400'}`}>
              Mínimo: {conUnidad(m.stock_minimo, m)}
            </p>
          )}
          {veCostos && m.costo !== null && (
            <p className="mt-1 text-xs text-tinta-400">
              Último costo: {m.moneda === 'USD' ? 'US$' : '$'} {Number(m.costo).toLocaleString('es-UY', { maximumFractionDigits: 2 })} por {m.unidad}
              {m.moneda !== 'USD' && total > 0 ? ` · stock ≈ $ ${Math.round(total * Number(m.costo)).toLocaleString('es-UY')}` : ''}
            </p>
          )}
          {(m.presentaciones || []).length > 0 && (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {m.presentaciones.map((p) => (
                <span key={p.nombre} className="rounded-full bg-navy-800 px-2 py-0.5 text-[11px] text-tinta-300">
                  {p.nombre} = {cant(p.factor, m.decimales)} {m.unidad}
                </span>
              ))}
            </p>
          )}
        </section>

        <section>
          <h2 className="titulo-seccion mb-2">Dónde está</h2>
          {empresaLugares.length || enObra.length ? (
            <ul className="divide-y divide-navy-800 rounded-xl border border-navy-700">
              {[...empresaLugares, ...enObra].map((l) => (
                <li key={l.ubicacion_id} className="flex items-center justify-between gap-2 p-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon
                      name={l.ubicaciones_stock.tipo === 'deposito' ? 'empresa' : l.ubicaciones_stock.tipo === 'operario' ? 'perfil' : 'herramienta'}
                      className="h-4 w-4 shrink-0 text-tinta-400"
                    />
                    <span className="min-w-0 truncate">
                      {l.ubicaciones_stock.nombre}
                      {l.ubicaciones_stock.tipo === 'trabajo' && <span className="text-tinta-400"> (en obra)</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <b>{conUnidad(l.cantidad, m)}</b>
                    {desglose(l.cantidad, m) && <span className="block text-[11px] text-tinta-400">{desglose(l.cantidad, m)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">Sin stock en este momento.</p>
          )}
        </section>

        {vinculos.length > 0 && (
          <section>
            <h2 className="titulo-seccion mb-2">En las listas de proveedores</h2>
            <ul className="space-y-1.5 text-sm">
              {vinculos.map((v) => (
                <li key={v.producto_id} className="rounded-xl bg-navy-850 p-2.5">
                  <b className="block">{v.productos_proveedor?.nombre}</b>
                  <span className="text-xs text-tinta-400">
                    {v.productos_proveedor?.proveedores?.nombre} · cód. {v.productos_proveedor?.codigo} · cada {v.productos_proveedor?.unidad || 'u'} trae {cant(v.factor, m.decimales)} {m.unidad}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="titulo-seccion mb-2">Movimientos (kardex)</h2>
          {lugaresKardex.length > 1 || filtro ? (
            <div className="-mx-4 mb-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
              <button type="button" className={`chip shrink-0 ${!filtro ? 'chip-activo' : ''}`} onClick={() => setFiltro('')}>Todos los lugares</button>
              {(filtro ? [[filtro, kardex.lista[0]?.lugar || 'Lugar']] : lugaresKardex).map(([u, n]) => (
                <button key={u} type="button" className={`chip shrink-0 ${filtro === u ? 'chip-activo' : ''}`} onClick={() => setFiltro(u)}>{n}</button>
              ))}
            </div>
          ) : null}
          {kardex.lista.length === 0 && !kardex.cargando ? (
            <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">Todavía no tiene movimientos.</p>
          ) : (
            <ul className="divide-y divide-navy-800 rounded-xl border border-navy-700">
              {kardex.lista.map((k) => (
                <li key={k.id}>
                  <button
                    type="button"
                    className={`flex w-full items-start gap-3 p-3 text-left hover:bg-navy-850 ${k.anulado ? 'opacity-60' : ''}`}
                    onClick={async () => {
                      try {
                        setDetalle(await rpcStock('stock_comprobante', { p_id: k.movimiento_id }));
                      } catch (e) {
                        setError(textoError(e));
                      }
                    }}
                  >
                    <span className={`w-16 shrink-0 text-right text-sm font-extrabold ${Number(k.cantidad) > 0 ? 'text-menta-300' : 'text-red-300'}`}>
                      {Number(k.cantidad) > 0 ? '+' : '−'}
                      {cant(Math.abs(k.cantidad), m.decimales)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-sm">
                        {EVENTO[k.evento] || TIPOS_MOV[k.tipo]?.texto || k.tipo} {k.anulado && <span className="text-xs text-red-300">(anulado)</span>}
                      </b>
                      <span className="block truncate text-[11px] text-tinta-400">
                        {k.lugar} · {numeroMov(k.numero)} · {fechaHora(k.creado_en)}
                        {k.por ? ` · ${k.por}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-[11px] text-tinta-400">
                      queda
                      <b className="block text-sm text-tinta-200">{cant(k.saldo, m.decimales)}</b>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {kardex.cargando && <p className="mt-2 text-center text-sm text-tinta-400">Cargando…</p>}
          {!kardex.cargando && !kardex.fin && kardex.lista.length > 0 && (
            <button type="button" className="btn btn-sec mt-2 w-full" onClick={() => cargarKardex(filtro, kardex.lista[kardex.lista.length - 1].id)}>
              Ver más
            </button>
          )}
          <p className="mt-2 text-xs text-tinta-500">“Queda” es lo que había en ese lugar después de cada movimiento.</p>
        </section>
        <div className="h-2" />
      </div>

      <EditorMaterial
        abierto={editando}
        onCerrar={() => setEditando(false)}
        cuenta={cuenta}
        material={m}
        veCostos={veCostos}
        onGuardado={(x) => (x ? cargar() : window.location.assign('/panel/finanzas/stock'))}
      />
      <DetalleMovimiento
        mov={detalle}
        onCerrar={() => setDetalle(null)}
        onCambio={() => {
          cargar();
          cargarKardex(filtro);
        }}
        yo={yo?.id || user?.id}
        gestiona={gestiona}
        empresa={empresa?.nombre || profesional.nombre_publico || ''}
        onVerOtro={async (otro) => {
          try {
            setDetalle(await rpcStock('stock_comprobante', { p_id: otro }));
          } catch (e) {
            setError(textoError(e));
          }
        }}
      />
    </>
  );
}
