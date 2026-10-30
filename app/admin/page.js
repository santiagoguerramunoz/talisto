'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import ClavesAvisos from '@/components/ClavesAvisos';
import { NOMBRE_PLAN } from '@/lib/planes';
import { supabase } from '@/lib/supabase';
import { mensajeError, monto } from '@/lib/util';

export default function Admin() {
  const router = useRouter();
  const [perfil, setPerfil] = useState(null);
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState(null);
  const [profesionales, setProfesionales] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [planes, setPlanes] = useState(null); // null = falta el SQL 05
  const [editarPlan, setEditarPlan] = useState(null);
  const [empresas, setEmpresas] = useState({});

  const cargarProfesionales = useCallback(async () => {
    const { data } = await supabase
      .from('profesionales')
      .select('id, nombre_publico, verificado, activo, departamentos, creado_en, perfiles(email, telefono)')
      .order('creado_en', { ascending: false });
    setProfesionales(data || []);
    const { data: pl, error } = await supabase.from('planes').select('*');
    setPlanes(error ? null : Object.fromEntries((pl || []).map((p) => [p.usuario_id, p])));
    const { data: em } = await supabase.from('empresas').select('id, nombre, dueno_id, miembros(count)');
    setEmpresas(Object.fromEntries((em || []).map((e) => [e.dueno_id, { nombre: e.nombre, cuentas: e.miembros?.[0]?.count ?? 0 }])));
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return router.replace('/login');
      const { data: p } = await supabase.from('perfiles').select('*').eq('id', data.session.user.id).maybeSingle();
      if (!p?.es_admin) return router.replace(p?.rol === 'profesional' ? '/panel' : '/inicio');
      setPerfil(p);
      const { data: c } = await supabase.from('configuracion').select('*').eq('id', 1).maybeSingle();
      setConfig(c);
      setForm({
        precio_visita: c?.precio_visita ?? 1500,
        comision_visita: c?.comision_visita ?? 200,
        duracion_visita_min: c?.duracion_visita_min ?? 60,
        ...(c && 'precio_pro' in c
          ? {
              precio_pro: c.precio_pro,
              precio_business: c.precio_business,
              free_exportaciones_mes: c.free_exportaciones_mes,
              free_empresas_b2b: c.free_empresas_b2b,
              business_cuentas_defecto: c.business_cuentas_defecto,
            }
          : {}),
      });
      cargarProfesionales();
    })();
  }, [router, cargarProfesionales]);

  async function guardarConfig() {
    setEstado({});
    const precio = Number(form.precio_visita);
    const comision = Number(form.comision_visita);
    if (!(precio >= 0) || !(comision >= 0)) return setEstado({ error: 'Los montos tienen que ser números positivos.' });
    if (comision > precio) return setEstado({ error: 'La comisión no puede ser mayor que el precio de la visita.' });
    setGuardando(true);
    const { data, error } = await supabase
      .from('configuracion')
      .update({
        precio_visita: precio,
        comision_visita: comision,
        duracion_visita_min: Number(form.duracion_visita_min) || 60,
        ...('precio_pro' in form
          ? {
              precio_pro: Math.max(0, Number(form.precio_pro) || 0),
              precio_business: Math.max(0, Number(form.precio_business) || 0),
              free_exportaciones_mes: Math.max(0, Math.round(Number(form.free_exportaciones_mes) || 0)),
              free_empresas_b2b: Math.max(0, Math.round(Number(form.free_empresas_b2b) || 0)),
              business_cuentas_defecto: Math.max(1, Math.round(Number(form.business_cuentas_defecto) || 1)),
            }
          : {}),
      })
      .eq('id', 1)
      .select()
      .maybeSingle();
    setGuardando(false);
    if (error) return setEstado({ error: mensajeError(error) });
    if (!data) return setEstado({ error: 'No se guardó: revisá que tu usuario tenga permisos de admin.' });
    setConfig(data);
    setEstado({ ok: 'Configuración guardada. Se aplica a las visitas nuevas; las ya agendadas mantienen su precio.' });
  }

  async function alternar(pro, campo) {
    const { error } = await supabase.from('profesionales').update({ [campo]: !pro[campo] }).eq('id', pro.id);
    if (error) return window.alert(mensajeError(error));
    setProfesionales((lista) => lista.map((p) => (p.id === pro.id ? { ...p, [campo]: !p[campo] } : p)));
  }

  if (!perfil || !form) return <div className="grid min-h-dvh place-items-center text-tinta-400">Cargando…</div>;

  const neto = (Number(form.precio_visita) || 0) - (Number(form.comision_visita) || 0);
  const q = busqueda.trim().toLowerCase();
  const filtrados = q
    ? profesionales.filter((p) => p.nombre_publico.toLowerCase().includes(q) || (p.perfiles?.email || '').toLowerCase().includes(q))
    : profesionales;
  const pendientes = profesionales.filter((p) => !p.verificado).length;

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-12">
      <header className="flex items-center justify-between py-2">
        <Logo />
        <div className="flex items-center gap-2">
          {perfil.rol === 'profesional' && <Link href="/panel" className="chip">Mi agenda</Link>}
          <button onClick={async () => { await supabase.auth.signOut(); router.replace('/'); }} className="rounded-full p-2 text-tinta-400 hover:text-tinta-100" aria-label="Cerrar sesión">
            <Icon name="salir" />
          </button>
        </div>
      </header>

      <h1 className="mt-6 flex items-center gap-2 text-2xl font-extrabold"><Icon name="escudo" className="h-6 w-6 text-menta-400" /> Administración</h1>

      <section className="mt-6">
        <h2 className="titulo-seccion mb-2">Visita técnica y comisión</h2>
        <div className="tarjeta space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="etiqueta" htmlFor="a-precio">Precio de la visita (UYU)</label>
              <input id="a-precio" type="number" min="0" className="campo" value={form.precio_visita} onChange={(e) => setForm({ ...form, precio_visita: e.target.value })} />
            </div>
            <div>
              <label className="etiqueta" htmlFor="a-comision">Comisión TaListo! (UYU)</label>
              <input id="a-comision" type="number" min="0" className="campo" value={form.comision_visita} onChange={(e) => setForm({ ...form, comision_visita: e.target.value })} />
            </div>
            <div>
              <label className="etiqueta" htmlFor="a-duracion">Duración de la visita (min)</label>
              <input id="a-duracion" type="number" min="15" max="480" step="15" className="campo" value={form.duracion_visita_min} onChange={(e) => setForm({ ...form, duracion_visita_min: e.target.value })} />
            </div>
          </div>
          <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-300">
            El cliente paga <b className="text-tinta-100">{monto(form.precio_visita)}</b> · el profesional recibe{' '}
            <b className="text-menta-300">{monto(neto)}</b> · TaListo! se queda con <b className="text-tinta-100">{monto(form.comision_visita)}</b>
          </p>
          {config?.actualizado_en && (
            <p className="text-xs text-tinta-500">Última modificación: {new Date(config.actualizado_en).toLocaleString('es-UY')}</p>
          )}
          {estado.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>}
          {estado.ok && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{estado.ok}</p>}
          <button className="btn btn-menta w-full sm:w-auto" onClick={guardarConfig} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar configuración'}</button>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="titulo-seccion mb-2">Planes Pro y Business</h2>
        {'precio_pro' in form ? (
          <div className="tarjeta space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="etiqueta" htmlFor="a-pro">Pro por mes (UYU)</label>
                <input id="a-pro" type="number" min="0" className="campo" value={form.precio_pro} onChange={(e) => setForm({ ...form, precio_pro: e.target.value })} />
              </div>
              <div>
                <label className="etiqueta" htmlFor="a-bus">Business por mes (UYU)</label>
                <input id="a-bus" type="number" min="0" className="campo" value={form.precio_business} onChange={(e) => setForm({ ...form, precio_business: e.target.value })} />
              </div>
              <div>
                <label className="etiqueta" htmlFor="a-exp">Free: planillas Excel por mes</label>
                <input id="a-exp" type="number" min="0" className="campo" value={form.free_exportaciones_mes} onChange={(e) => setForm({ ...form, free_exportaciones_mes: e.target.value })} />
              </div>
              <div>
                <label className="etiqueta" htmlFor="a-b2b">Free: clientes B2B con trabajos</label>
                <input id="a-b2b" type="number" min="0" className="campo" value={form.free_empresas_b2b} onChange={(e) => setForm({ ...form, free_empresas_b2b: e.target.value })} />
              </div>
              <div>
                <label className="etiqueta" htmlFor="a-cta">Business: cuentas por empresa (por defecto)</label>
                <input id="a-cta" type="number" min="1" className="campo" value={form.business_cuentas_defecto} onChange={(e) => setForm({ ...form, business_cuentas_defecto: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-tinta-500">Con precio 0 el plan no se ofrece por Mercado Pago (igual lo podés regalar).</p>
            <button className="btn btn-menta w-full sm:w-auto" onClick={guardarConfig} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar precios y límites'}</button>
          </div>
        ) : (
          <p className="tarjeta p-4 text-sm text-amber-200">Falta correr en Supabase el archivo <b>05_planes.sql</b> para manejar los planes.</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="titulo-seccion mb-2">Avisos</h2>
        <ClavesAvisos />
      </section>

      <section className="mt-8">
        <h2 className="titulo-seccion mb-2">Proveedores de TaListo!</h2>
        <Link href="/panel/finanzas/compras?ver=proveedores" className="tarjeta flex items-center gap-3 p-4 hover:bg-navy-850">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-marca-naranja/15 text-marca-naranja">
            <Icon name="caja" />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block">Marketplace de proveedores</b>
            <span className="text-xs text-tinta-400">Sumá proveedores con su lista (Excel, link o API) para todas las cuentas Pro y Business, sin comisión.</span>
          </span>
          <Icon name="der" className="h-4 w-4 text-tinta-500" />
        </Link>
      </section>

      <section className="mt-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="titulo-seccion">Profesionales ({profesionales.length})</h2>
          {pendientes > 0 && <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-semibold text-amber-300">{pendientes} sin verificar</span>}
        </div>
        <input className="campo mb-3" placeholder="Buscar por nombre o email" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <ul className="space-y-2">
          {filtrados.map((p) => (
            <li key={p.id} className="tarjeta p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold">{p.nombre_publico || '(sin nombre)'}</p>
                  <p className="truncate text-xs text-tinta-400">
                    {p.perfiles?.email}
                    {p.perfiles?.telefono ? ` · ${p.perfiles.telefono}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-tinta-500">
                    {p.departamentos?.length ? p.departamentos.join(', ') : 'Sin zona cargada'} · desde {new Date(p.creado_en).toLocaleDateString('es-UY')}
                  </p>
                  {planes && <PlanChip plan={planes[p.id]} empresa={empresas[p.id]} cuentasDefecto={form.business_cuentas_defecto} />}
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  <button onClick={() => alternar(p, 'verificado')} className={`chip ${p.verificado ? 'chip-activo' : ''}`}>
                    {p.verificado ? <><Icon name="check" className="h-3.5 w-3.5" /> Verificado</> : 'Verificar'}
                  </button>
                  <button onClick={() => alternar(p, 'activo')} className={`chip ${p.activo ? '' : 'border-red-400/50 text-red-300'}`}>
                    {p.activo ? 'Suspender' : 'Reactivar'}
                  </button>
                  {planes && (
                    <button onClick={() => setEditarPlan(p)} className="chip">
                      <Icon name="estrella" className="h-3.5 w-3.5" /> Plan
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
          {filtrados.length === 0 && <p className="tarjeta p-4 text-sm text-tinta-400">No hay profesionales.</p>}
        </ul>
      </section>

      {editarPlan && (
        <RegalarPlan
          pro={editarPlan}
          actual={planes?.[editarPlan.id]}
          cuentasDefecto={form.business_cuentas_defecto}
          onCerrar={() => setEditarPlan(null)}
          onGuardado={(fila) => {
            setPlanes((m) => ({ ...m, [fila.usuario_id]: fila }));
            setEditarPlan(null);
          }}
        />
      )}
    </main>
  );
}

const vigente = (p) => p && p.plan !== 'free' && (!p.vence_en || new Date(p.vence_en) > new Date());

function PlanChip({ plan, empresa, cuentasDefecto }) {
  const cual = vigente(plan) ? plan.plan : 'free';
  const vence = plan?.vence_en && vigente(plan) ? new Date(plan.vence_en).toLocaleDateString('es-UY') : null;
  const origen = cual === 'free' ? '' : plan.origen === 'regalo' ? 'regalo' : 'Mercado Pago';
  return (
    <p className="mt-1.5 inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span className={`rounded-full px-2 py-0.5 font-bold ${cual === 'free' ? 'bg-navy-800 text-tinta-300' : 'bg-marca-naranja/15 text-marca-naranja'}`}>{NOMBRE_PLAN[cual]}</span>
      {origen && <span className="text-tinta-400">{origen}{vence ? ` · hasta ${vence}` : ' · sin vencimiento'}</span>}
      {cual === 'business' && !empresa && <span className="text-tinta-400">· hasta {plan.max_cuentas ?? cuentasDefecto} cuentas</span>}
      {empresa && <span className="text-tinta-300">· {empresa.nombre}: {empresa.cuentas} de {plan?.max_cuentas ?? cuentasDefecto} cuentas</span>}
      {plan?.mp_estado && plan.origen !== 'mercadopago' && <span className="text-tinta-500">· MP {plan.mp_estado}</span>}
    </p>
  );
}

// El admin regala Pro o Business (sin vencimiento o hasta una fecha) o lo quita
function RegalarPlan({ pro, actual, cuentasDefecto, onCerrar, onGuardado }) {
  const [form, setForm] = useState(() => ({
    plan: vigente(actual) ? actual.plan : 'pro',
    hasta: actual?.vence_en && actual.origen === 'regalo' ? actual.vence_en.slice(0, 10) : '',
    max_cuentas: actual?.max_cuentas ?? '',
    nota: actual?.nota || '',
  }));
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const mpVigente = actual?.mp_estado === 'authorized' && actual?.mp_plan;

  async function guardar(quitar = false) {
    setError('');
    let fila;
    if (quitar || form.plan === 'free') {
      // Sin regalo: si paga con Mercado Pago vuelve a ese plan, si no a Free
      fila = mpVigente
        ? { plan: actual.mp_plan, origen: 'mercadopago', vence_en: actual.mp_proximo_cobro ? new Date(new Date(actual.mp_proximo_cobro).getTime() + 3 * 864e5).toISOString() : null }
        : { plan: 'free', origen: 'free', vence_en: null };
    } else {
      if (form.hasta && new Date(`${form.hasta}T23:59:59`) <= new Date()) return setError('La fecha tiene que ser futura.');
      fila = {
        plan: form.plan,
        origen: 'regalo',
        vence_en: form.hasta ? new Date(`${form.hasta}T23:59:59-03:00`).toISOString() : null,
      };
    }
    fila.max_cuentas = form.max_cuentas === '' ? null : Math.max(1, Math.round(Number(form.max_cuentas)));
    fila.nota = form.nota.trim() || null;
    setGuardando(true);
    const { data, error: err } = await supabase.from('planes').upsert({ usuario_id: pro.id, ...fila }, { onConflict: 'usuario_id' }).select().maybeSingle();
    setGuardando(false);
    if (err) return setError(mensajeError(err));
    onGuardado(data);
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo={`Plan de ${pro.nombre_publico || pro.perfiles?.email || 'profesional'}`}>
      <div className="space-y-4 p-5">
        <div>
          <p className="etiqueta">Plan</p>
          <div className="grid grid-cols-3 gap-1.5">
            {['free', 'pro', 'business'].map((c) => (
              <button key={c} type="button" onClick={() => setForm({ ...form, plan: c })} className={`chip justify-center ${form.plan === c ? 'chip-activo' : ''}`}>
                {NOMBRE_PLAN[c]}
              </button>
            ))}
          </div>
        </div>
        {form.plan !== 'free' && (
          <>
            <div>
              <label className="etiqueta" htmlFor="r-hasta">Regalo hasta (vacío = sin vencimiento)</label>
              <input id="r-hasta" type="date" className="campo" value={form.hasta} onChange={(e) => setForm({ ...form, hasta: e.target.value })} />
            </div>
            {form.plan === 'business' && (
              <div>
                <label className="etiqueta" htmlFor="r-cuentas">Cuentas que puede tener la empresa</label>
                <input id="r-cuentas" type="number" min="1" className="campo" placeholder={`Por defecto: ${cuentasDefecto}`} value={form.max_cuentas} onChange={(e) => setForm({ ...form, max_cuentas: e.target.value })} />
              </div>
            )}
          </>
        )}
        <div>
          <label className="etiqueta" htmlFor="r-nota">Nota interna</label>
          <input id="r-nota" className="campo" placeholder="Ej. Promo lanzamiento" value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} />
        </div>
        {mpVigente && <p className="rounded-xl bg-navy-850 p-3 text-xs text-tinta-300">Tiene una suscripción activa de Mercado Pago ({NOMBRE_PLAN[actual.mp_plan]}). Si quitás el regalo, vuelve a ese plan.</p>}
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button className="btn btn-menta flex-1" onClick={() => guardar(false)} disabled={guardando}>
            {form.plan === 'free' ? 'Dejar en Free' : `Regalar ${NOMBRE_PLAN[form.plan]}`}
          </button>
          {actual?.origen === 'regalo' && form.plan !== 'free' && (
            <button className="btn btn-sec" onClick={() => guardar(true)} disabled={guardando}>Quitar regalo</button>
          )}
        </div>
      </div>
    </Modal>
  );
}
