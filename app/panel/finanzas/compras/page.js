'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import FinanzasEncabezado from '@/components/FinanzasEncabezado';
import BloqueoPlan from '@/components/BloqueoPlan';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { esPro } from '@/lib/planes';
import { fechaUY } from '@/lib/presupuestos';
import { mensajeError } from '@/lib/util';
import { haceCuanto } from '@/lib/equipo';
import { AVISO_SQL_09, ESTADOS_COMPRA, FUENTES, importe, numeroOrden, sinFuncion } from '@/lib/proveedores';

export default function Compras() {
  return (
    <Suspense fallback={<p className="p-4 text-tinta-400">Cargando…</p>}>
      <Contenido />
    </Suspense>
  );
}

function Contenido() {
  const { plan } = usePanel();
  const params = useSearchParams();
  const router = useRouter();
  const ver = params.get('ver') === 'proveedores' ? 'proveedores' : 'ordenes';

  return (
    <>
      <FinanzasEncabezado />
      <div className="space-y-4 px-4 pt-4">
        {!esPro(plan?.plan) ? (
          <BloqueoPlan
            titulo="Proveedores y órdenes de compra"
            texto="Cargá las listas de precios de tus proveedores, buscá los productos al presupuestar y armá las órdenes de compra."
            puntos={['Listas en Excel, CSV, link o API', 'El precio se carga solo en el presupuesto', 'Stock al momento con la API del proveedor', 'Orden de compra en PDF, WhatsApp o email']}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 rounded-xl bg-navy-900 p-1 text-sm font-bold">
              {[
                ['ordenes', 'Órdenes de compra'],
                ['proveedores', 'Proveedores'],
              ].map(([v, t]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => router.replace(v === 'ordenes' ? '/panel/finanzas/compras' : '/panel/finanzas/compras?ver=proveedores')}
                  className={`rounded-lg py-2 ${ver === v ? 'bg-navy-700 text-tinta-100' : 'text-tinta-400'}`}
                >
                  {t}
                </button>
              ))}
            </div>
            {ver === 'ordenes' ? <Ordenes /> : <Proveedores />}
          </>
        )}
      </div>
    </>
  );
}

function usePuedeComprar() {
  const { yo, profesional, empresa, permisos } = usePanel();
  return !empresa || yo?.id === profesional.id || (permisos || []).includes('compras');
}

function Ordenes() {
  const { profesional } = usePanel();
  const router = useRouter();
  const puede = usePuedeComprar();
  const [datos, setDatos] = useState({ cargando: true, lista: [], error: '' });
  const [filtro, setFiltro] = useState('abiertas');
  const [nueva, setNueva] = useState(false);

  useEffect(() => {
    supabase
      .from('ordenes_compra')
      .select('id, numero, proveedor_nombre, fecha, estado, subtotal, moneda, items, presupuesto_id')
      .eq('profesional_id', profesional.id)
      .order('numero', { ascending: false })
      .limit(300)
      .then(({ data, error }) =>
        setDatos({ cargando: false, lista: data || [], error: error ? (sinFuncion(error) ? AVISO_SQL_09 : mensajeError(error)) : '' })
      );
  }, [profesional.id]);

  const abiertas = (o) => ['borrador', 'enviada', 'confirmada', 'parcial'].includes(o.estado);
  const lista = datos.lista.filter((o) => (filtro === 'abiertas' ? abiertas(o) : filtro === 'todas' ? true : o.estado === filtro));

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="-mx-4 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-4">
          {[
            ['abiertas', 'Abiertas'],
            ['recibida', 'Recibidas'],
            ['todas', 'Todas'],
          ].map(([v, t]) => (
            <button key={v} type="button" onClick={() => setFiltro(v)} className={`chip shrink-0 ${filtro === v ? 'chip-activo' : ''}`}>
              {t}
            </button>
          ))}
        </div>
        {puede && (
          <button type="button" className="btn btn-menta shrink-0 px-3 py-2 text-sm" onClick={() => setNueva(true)}>
            <Icon name="mas" className="h-4 w-4" /> Nueva
          </button>
        )}
      </div>
      {datos.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{datos.error}</p>}
      {datos.cargando ? (
        <p className="py-6 text-center text-tinta-400">Cargando…</p>
      ) : lista.length === 0 && !datos.error ? (
        <section className="tarjeta p-5 text-center text-sm text-tinta-300">
          <Icon name="caja" className="mx-auto h-8 w-8 text-tinta-500" />
          <p className="mt-2 font-semibold text-tinta-100">{filtro === 'abiertas' ? 'No tenés órdenes abiertas' : 'Sin órdenes'}</p>
          <p className="mt-1">Se arman desde un presupuesto (Compra de materiales) o con Nueva.</p>
        </section>
      ) : (
        <ul className="lista-pc space-y-2">
          {lista.map((o) => (
            <li key={o.id}>
              <Link href={`/panel/finanzas/compras/${o.id}`} className="tarjeta flex items-center gap-3 p-3 hover:bg-navy-850">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-menta-500/10 text-menta-300">
                  <Icon name="caja" className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate">{o.proveedor_nombre}</b>
                  <span className="block truncate text-xs text-tinta-400">
                    OC {numeroOrden(o.numero)} · {fechaUY(o.fecha)} · {(o.items || []).length} {(o.items || []).length === 1 ? 'ítem' : 'ítems'}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <b className="block text-sm">{importe(o.subtotal, o.moneda)}</b>
                  <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-bold ${ESTADOS_COMPRA[o.estado]?.clase}`}>{ESTADOS_COMPRA[o.estado]?.texto}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <NuevaOrden abierto={nueva} onCerrar={() => setNueva(false)} onCreada={(id) => router.push(`/panel/finanzas/compras/${id}`)} />
    </>
  );
}

function NuevaOrden({ abierto, onCerrar, onCreada }) {
  const { profesional } = usePanel();
  const [proveedores, setProveedores] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!abierto) return;
    setError('');
    supabase
      .from('proveedores')
      .select('id, nombre, profesional_id, contacto, telefono, whatsapp, email, pedido_email, rut, moneda, iva_incluido')
      .eq('activo', true)
      .or(`profesional_id.eq.${profesional.id},profesional_id.is.null`)
      .order('nombre')
      .then(({ data }) => setProveedores(data || []));
  }, [abierto, profesional.id]);

  async function crear(p) {
    setError('');
    const { data, error: e } = await supabase
      .from('ordenes_compra')
      .insert({
        profesional_id: profesional.id,
        proveedor_id: p.id,
        proveedor_nombre: p.nombre,
        proveedor_datos: { contacto: p.contacto || null, telefono: p.telefono || null, whatsapp: p.whatsapp || null, email: p.pedido_email || p.email || null, rut: p.rut || null },
        moneda: p.moneda || 'UYU',
        iva_incluido: !!p.iva_incluido,
      })
      .select('id')
      .single();
    if (e) return setError(mensajeError(e));
    onCreada(data.id);
  }

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Nueva orden de compra">
      <div className="space-y-3">
        <p className="text-sm text-tinta-300">¿A qué proveedor?</p>
        {proveedores.length === 0 ? (
          <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">Primero cargá un proveedor en la pestaña Proveedores.</p>
        ) : (
          <ul className="divide-y divide-navy-800 rounded-xl border border-navy-700">
            {proveedores.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => crear(p)} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-navy-850">
                  <span className="min-w-0 flex-1 font-semibold">{p.nombre}</span>
                  {!p.profesional_id && <span className="rounded-full bg-marca-naranja/15 px-2 py-0.5 text-[10.5px] font-bold text-marca-naranja">TaListo!</span>}
                  <Icon name="der" className="h-4 w-4 text-tinta-500" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}

function Proveedores() {
  const { profesional, perfil } = usePanel();
  const router = useRouter();
  const puede = usePuedeComprar();
  const [datos, setDatos] = useState({ cargando: true, lista: [], error: '' });
  const [nuevo, setNuevo] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase
      .from('proveedores')
      .select('id, nombre, profesional_id, fuente, productos, sincronizado_en, sincronizacion, activo, moneda')
      .or(`profesional_id.eq.${profesional.id},profesional_id.is.null`)
      .order('nombre');
    setDatos({ cargando: false, lista: data || [], error: error ? (sinFuncion(error) ? AVISO_SQL_09 : mensajeError(error)) : '' });
  }, [profesional.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const propios = datos.lista.filter((p) => p.profesional_id);
  const deTalisto = datos.lista.filter((p) => !p.profesional_id);

  const Tarjeta = ({ p }) => (
    <li>
      <Link href={`/panel/finanzas/proveedores/${p.id}`} className={`tarjeta flex items-center gap-3 p-3 hover:bg-navy-850 ${p.activo ? '' : 'opacity-50'}`}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy-800 text-tinta-300">
          <Icon name={FUENTES[p.fuente]?.icono || 'documento'} className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate">{p.nombre}</b>
          <span className="block truncate text-xs text-tinta-400">
            {p.productos.toLocaleString('es-UY')} productos · {FUENTES[p.fuente]?.corto}
            {p.moneda === 'USD' ? ' · en dólares' : ''}
            {p.sincronizado_en ? ` · ${haceCuanto(p.sincronizado_en)}` : ''}
          </span>
        </span>
        <Icon name="der" className="h-4 w-4 shrink-0 text-tinta-500" />
      </Link>
    </li>
  );

  return (
    <>
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm text-tinta-300">Sus listas de precios se usan al buscar materiales en el presupuesto.</p>
        {puede && (
          <button type="button" className="btn btn-menta shrink-0 px-3 py-2 text-sm" onClick={() => setNuevo(true)}>
            <Icon name="mas" className="h-4 w-4" /> Proveedor
          </button>
        )}
      </div>
      {datos.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{datos.error}</p>}
      {datos.cargando ? (
        <p className="py-6 text-center text-tinta-400">Cargando…</p>
      ) : (
        <>
          <section>
            <h2 className="titulo-seccion mb-2">Mis proveedores</h2>
            {propios.length === 0 ? (
              <p className="tarjeta p-4 text-sm text-tinta-400">
                Todavía no cargaste proveedores. Sumá el tuyo y subí su lista de precios en Excel, o conectá su link o su API.
              </p>
            ) : (
              <ul className="space-y-2">
                {propios.map((p) => (
                  <Tarjeta key={p.id} p={p} />
                ))}
              </ul>
            )}
          </section>
          {(deTalisto.length > 0 || perfil?.es_admin) && (
            <section>
              <h2 className="titulo-seccion mb-2">Proveedores de TaListo!</h2>
              <p className="mb-2 text-xs text-tinta-400">Los suma TaListo! para todas las cuentas Pro y Business, sin comisión.</p>
              {deTalisto.length === 0 ? (
                <p className="tarjeta p-4 text-sm text-tinta-400">Todavía no hay. Como admin, podés sumarlos con el botón Proveedor.</p>
              ) : (
                <ul className="space-y-2">
                  {deTalisto.map((p) => (
                    <Tarjeta key={p.id} p={p} />
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
      <NuevoProveedor abierto={nuevo} onCerrar={() => setNuevo(false)} onCreado={(id) => router.push(`/panel/finanzas/proveedores/${id}`)} />
    </>
  );
}

function NuevoProveedor({ abierto, onCerrar, onCreado }) {
  const { profesional, perfil } = usePanel();
  const [nombre, setNombre] = useState('');
  const [paraTodos, setParaTodos] = useState(false);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (abierto) {
      setNombre('');
      setParaTodos(false);
      setError('');
    }
  }, [abierto]);

  async function crear() {
    if (!nombre.trim()) return setError('Poné el nombre del proveedor.');
    setGuardando(true);
    const { data, error: e } = await supabase
      .from('proveedores')
      .insert({ profesional_id: paraTodos ? null : profesional.id, nombre: nombre.trim() })
      .select('id')
      .single();
    setGuardando(false);
    if (e) return setError(sinFuncion(e) ? AVISO_SQL_09 : mensajeError(e));
    onCreado(data.id);
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Nuevo proveedor"
      pie={
        <button type="button" className="btn btn-menta w-full" onClick={crear} disabled={guardando}>
          {guardando ? 'Creando…' : 'Crear y cargar su lista'}
        </button>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="etiqueta" htmlFor="np-nombre">Nombre</label>
          <input id="np-nombre" className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Distribuidora El Sol" autoFocus />
        </div>
        {perfil?.es_admin && (
          <label className="flex items-start gap-3 rounded-xl bg-navy-850 p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#2cc79b]" checked={paraTodos} onChange={(e) => setParaTodos(e.target.checked)} />
            <span>
              <b className="text-tinta-100">Proveedor de TaListo!</b>
              <span className="block text-tinta-400">Lo ven todas las cuentas Pro y Business. Lo administrás vos como admin.</span>
            </span>
          </label>
        )}
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}
