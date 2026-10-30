'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import BotonInstalar from '@/components/BotonInstalar';
import AjustesNegocio from '@/components/AjustesNegocio';
import BloqueoPlan from '@/components/BloqueoPlan';
import EspacioTrabajo from '@/components/EspacioTrabajo';
import { NOMBRE_PLAN, esPro, textoVencimiento } from '@/lib/planes';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { DIAS, SEMANA_ORDEN } from '@/lib/fechas';
import { DEPARTAMENTOS, SUFIJO_TARIFA, TIPOS_TARIFA, mensajeError, monto } from '@/lib/util';

export default function Perfil() {
  const panel = usePanel();
  const { perfil, user, recargar, empresa } = panel;
  // El perfil es siempre el personal, aunque se esté trabajando en una empresa
  const profesional = panel.yo || panel.profesional;
  const plan = panel.planPersonal || panel.plan;

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-extrabold">{profesional.nombre_publico || 'Mi perfil'}</h1>
            {profesional.verificado ? (
              <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-menta-300">
                <Icon name="escudo" className="h-3.5 w-3.5" /> Profesional verificado
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-amber-300">Pendiente de verificación por TaListo!</p>
            )}
          </div>
          {perfil.es_admin && (
            <Link href="/admin" className="chip shrink-0"><Icon name="ajustes" className="h-4 w-4" /> Admin</Link>
          )}
        </div>
      </header>

      <div className="space-y-8 px-4 pt-4">
        <MiPlan plan={plan} />
        <EspacioTrabajo />
        <BotonInstalar variante="tarjeta" />
        <DatosPublicos profesional={profesional} onGuardado={recargar} />
        {empresa ? null : esPro(plan?.plan) ? (
          <AjustesNegocio profesional={profesional} email={user.email} />
        ) : (
          <section>
            <h2 className="titulo-seccion mb-2">Presupuestos y datos del negocio</h2>
            <BloqueoPlan compacto titulo="Logo y datos de tu negocio" texto="Razón social, RUT, teléfono y logo en tus presupuestos" />
          </section>
        )}
        <Servicios profesionalId={profesional.id} />
        <HorarioTrabajo profesionalId={profesional.id} />
        <VisitaTecnica />
        <Cuenta email={user.email} />
      </div>
    </>
  );
}

function MiPlan({ plan }) {
  if (!plan || plan.sinSql) return null;
  const cual = plan.plan || 'free';
  const vence = textoVencimiento(plan);
  const detalle =
    cual === 'free'
      ? 'Agenda, relevamientos, clientes y mapa. Pasate a Pro para presupuestos y finanzas.'
      : plan.origen === 'regalo'
        ? vence ? `Regalo de TaListo! hasta el ${vence}` : 'Regalo de TaListo! sin vencimiento'
        : plan.mp_estado === 'cancelled'
          ? `Suscripción cancelada: sigue activa hasta el ${vence}`
          : vence ? `Suscripción con Mercado Pago · próxima renovación ${vence}` : 'Suscripción con Mercado Pago';
  return (
    <Link href="/panel/planes" className="tarjeta flex items-center gap-3 p-4 hover:bg-navy-850">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${cual === 'free' ? 'bg-navy-800 text-tinta-300' : 'bg-marca-naranja/15 text-marca-naranja'}`}>
        <Icon name={cual === 'business' ? 'empresa' : 'estrella'} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold uppercase tracking-wide text-tinta-400">Mi plan</span>
        <span className="block text-lg font-extrabold">TaListo! {NOMBRE_PLAN[cual]}</span>
        <span className="block text-xs text-tinta-400">{detalle}</span>
      </span>
      <Icon name="der" className="h-4 w-4 shrink-0 text-tinta-500" />
    </Link>
  );
}

function Seccion({ titulo, children, accion }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="titulo-seccion">{titulo}</h2>
        {accion}
      </div>
      {children}
    </section>
  );
}

function Estado({ ok, error }) {
  if (error) return <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>;
  if (ok) return <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{ok}</p>;
  return null;
}

function DatosPublicos({ profesional, onGuardado }) {
  const [form, setForm] = useState({
    nombre_publico: profesional.nombre_publico || '',
    bio: profesional.bio || '',
    whatsapp: profesional.whatsapp || '',
    departamentos: profesional.departamentos || [],
    barrios: (profesional.barrios || []).join(', '),
    radio_km: profesional.radio_km ?? '',
  });
  const [estado, setEstado] = useState({});
  const [guardando, setGuardando] = useState(false);

  const alternarDepto = (d) =>
    setForm((f) => ({
      ...f,
      departamentos: f.departamentos.includes(d) ? f.departamentos.filter((x) => x !== d) : [...f.departamentos, d],
    }));

  async function guardar() {
    setEstado({});
    if (!form.nombre_publico.trim()) return setEstado({ error: 'Escribí tu nombre o nombre comercial.' });
    setGuardando(true);
    const { error } = await supabase
      .from('profesionales')
      .update({
        nombre_publico: form.nombre_publico.trim(),
        bio: form.bio.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        departamentos: form.departamentos,
        barrios: form.barrios.split(',').map((b) => b.trim()).filter(Boolean),
        radio_km: form.radio_km === '' ? null : Number(form.radio_km),
      })
      .eq('id', profesional.id);
    setGuardando(false);
    if (error) return setEstado({ error: mensajeError(error) });
    setEstado({ ok: 'Perfil guardado.' });
    onGuardado?.();
  }

  return (
    <Seccion titulo="Perfil público y zona de trabajo">
      <div className="tarjeta space-y-4 p-4">
        <div>
          <label className="etiqueta" htmlFor="p-nombre">Nombre o nombre comercial</label>
          <input id="p-nombre" className="campo" value={form.nombre_publico} onChange={(e) => setForm({ ...form, nombre_publico: e.target.value })} />
        </div>
        <div>
          <label className="etiqueta" htmlFor="p-bio">Sobre vos</label>
          <textarea id="p-bio" rows={3} className="campo" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="Experiencia, matrícula, garantía, lo que te diferencia…" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="p-wa">WhatsApp de trabajo</label>
          <input id="p-wa" type="tel" className="campo" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="099 123 456" />
        </div>
        <div>
          <span className="etiqueta">Departamentos donde trabajás</span>
          <div className="flex flex-wrap gap-2">
            {DEPARTAMENTOS.map((d) => (
              <button key={d} type="button" className={`chip ${form.departamentos.includes(d) ? 'chip-activo' : ''}`} onClick={() => alternarDepto(d)}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="etiqueta" htmlFor="p-barrios">Barrios o localidades (separados por coma)</label>
          <input id="p-barrios" className="campo" value={form.barrios} onChange={(e) => setForm({ ...form, barrios: e.target.value })} placeholder="Pocitos, Punta Carretas, Ciudad de la Costa" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="p-radio">Distancia máxima que te movés (km, opcional)</label>
          <input id="p-radio" type="number" min="1" max="500" className="campo" value={form.radio_km} onChange={(e) => setForm({ ...form, radio_km: e.target.value })} />
        </div>
        <Estado {...estado} />
        <button className="btn btn-menta w-full" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar perfil'}</button>
      </div>
    </Seccion>
  );
}

const SERVICIO_VACIO = { categoria_id: '', titulo: '', descripcion: '', tipo_tarifa: 'hora', precio: '', moneda: 'UYU', activo: true };

function Servicios({ profesionalId }) {
  const [servicios, setServicios] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    const [s, c] = await Promise.all([
      supabase.from('servicios').select('*, categorias(nombre)').eq('profesional_id', profesionalId).order('creado_en'),
      supabase.from('categorias').select('id, nombre').eq('activa', true).order('orden'),
    ]);
    setServicios(s.data || []);
    setCategorias(c.data || []);
  }, [profesionalId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardar() {
    setError('');
    const f = modal;
    if (!f.titulo.trim()) return setError('Escribí el nombre del servicio.');
    if (f.tipo_tarifa !== 'a_convenir' && f.precio === '') return setError('Poné el precio o elegí "A convenir".');
    const fila = {
      profesional_id: profesionalId,
      categoria_id: f.categoria_id ? Number(f.categoria_id) : null,
      titulo: f.titulo.trim(),
      descripcion: f.descripcion.trim() || null,
      tipo_tarifa: f.tipo_tarifa,
      precio: f.tipo_tarifa === 'a_convenir' || f.precio === '' ? null : Number(f.precio),
      moneda: f.moneda,
      activo: f.activo,
    };
    const consulta = f.id ? supabase.from('servicios').update(fila).eq('id', f.id) : supabase.from('servicios').insert(fila);
    const { error: err } = await consulta;
    if (err) return setError(mensajeError(err));
    setModal(null);
    cargar();
  }

  async function eliminar() {
    if (!modal?.id || !window.confirm('¿Eliminar este servicio?')) return;
    const { error: err } = await supabase.from('servicios').delete().eq('id', modal.id);
    if (err) return setError(mensajeError(err));
    setModal(null);
    cargar();
  }

  return (
    <Seccion
      titulo="Servicios y tarifas"
      accion={
        <button
          className="chip chip-activo"
          onClick={() => {
            setError('');
            setModal({ ...SERVICIO_VACIO });
          }}
        >
          <Icon name="mas" className="h-3.5 w-3.5" /> Agregar
        </button>
      }
    >
      {servicios.length === 0 ? (
        <p className="tarjeta p-4 text-sm text-tinta-400">Agregá lo que hacés y cuánto cobrás. Es lo que van a ver los clientes cuando te busquen.</p>
      ) : (
        <ul className="tarjeta divide-y divide-navy-800 overflow-hidden">
          {servicios.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => {
                  setError('');
                  setModal({
                    id: s.id,
                    categoria_id: s.categoria_id ? String(s.categoria_id) : '',
                    titulo: s.titulo,
                    descripcion: s.descripcion || '',
                    tipo_tarifa: s.tipo_tarifa,
                    precio: s.precio ?? '',
                    moneda: s.moneda,
                    activo: s.activo,
                  });
                }}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-navy-850 ${s.activo ? '' : 'opacity-50'}`}
              >
                <Icon name="maletin" className="h-5 w-5 shrink-0 text-menta-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{s.titulo}</span>
                  <span className="block truncate text-xs text-tinta-400">{s.categorias?.nombre || 'Sin categoría'}{s.activo ? '' : ' · Pausado'}</span>
                </span>
                <span className="shrink-0 text-right text-sm font-bold">
                  {s.tipo_tarifa === 'a_convenir' ? 'A convenir' : `${monto(s.precio, s.moneda)} ${SUFIJO_TARIFA[s.tipo_tarifa]}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        abierto={!!modal}
        onCerrar={() => setModal(null)}
        titulo={modal?.id ? 'Editar servicio' : 'Nuevo servicio'}
        pie={
          <div className="flex gap-2">
            {modal?.id && (
              <button className="btn btn-peligro px-3" onClick={eliminar} aria-label="Eliminar servicio"><Icon name="borrar" /></button>
            )}
            <button className="btn btn-menta flex-1" onClick={guardar}>Guardar servicio</button>
          </div>
        }
      >
        {modal && (
          <div className="space-y-4">
            <div>
              <label className="etiqueta" htmlFor="s-cat">Categoría</label>
              <select
                id="s-cat"
                className="campo"
                value={modal.categoria_id}
                onChange={(e) => {
                  const cat = categorias.find((c) => String(c.id) === e.target.value);
                  setModal((m) => ({ ...m, categoria_id: e.target.value, titulo: m.titulo || cat?.nombre || '' }));
                }}
              >
                <option value="">— Elegí una categoría —</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="etiqueta" htmlFor="s-titulo">Nombre del servicio</label>
              <input id="s-titulo" className="campo" value={modal.titulo} onChange={(e) => setModal({ ...modal, titulo: e.target.value })} placeholder="Ej. Instalación de tablero eléctrico" />
            </div>
            <div>
              <label className="etiqueta" htmlFor="s-desc">Descripción (opcional)</label>
              <textarea id="s-desc" rows={2} className="campo" value={modal.descripcion} onChange={(e) => setModal({ ...modal, descripcion: e.target.value })} />
            </div>
            <div>
              <span className="etiqueta">Cómo cobrás</span>
              <div className="flex flex-wrap gap-2">
                {Object.entries(TIPOS_TARIFA).map(([valor, texto]) => (
                  <button key={valor} type="button" className={`chip ${modal.tipo_tarifa === valor ? 'chip-activo' : ''}`} onClick={() => setModal({ ...modal, tipo_tarifa: valor })}>
                    {texto}
                  </button>
                ))}
              </div>
            </div>
            {modal.tipo_tarifa !== 'a_convenir' && (
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="etiqueta" htmlFor="s-precio">Precio</label>
                  <input id="s-precio" type="number" inputMode="decimal" min="0" className="campo" value={modal.precio} onChange={(e) => setModal({ ...modal, precio: e.target.value })} />
                </div>
                <div>
                  <label className="etiqueta" htmlFor="s-moneda">Moneda</label>
                  <select id="s-moneda" className="campo" value={modal.moneda} onChange={(e) => setModal({ ...modal, moneda: e.target.value })}>
                    <option value="UYU">UYU</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>
            )}
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-[#2cc79b]" checked={modal.activo} onChange={(e) => setModal({ ...modal, activo: e.target.checked })} />
              Visible para los clientes
            </label>
            {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
          </div>
        )}
      </Modal>
    </Seccion>
  );
}

function HorarioTrabajo({ profesionalId }) {
  const [dias, setDias] = useState(null);
  const [estado, setEstado] = useState({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    supabase
      .from('horarios_trabajo')
      .select('*')
      .eq('profesional_id', profesionalId)
      .order('hora_inicio')
      .then(({ data }) => {
        const base = {};
        SEMANA_ORDEN.forEach((d) => {
          const f = (data || []).find((h) => Number(h.dia) === d);
          base[d] = f
            ? { activo: true, desde: String(f.hora_inicio).slice(0, 5), hasta: String(f.hora_fin).slice(0, 5) }
            : { activo: d >= 1 && d <= 5 && !(data || []).length, desde: '08:00', hasta: '18:00' };
        });
        setDias(base);
      });
  }, [profesionalId]);

  if (!dias) return null;

  const cambiar = (d, campo, valor) => setDias((x) => ({ ...x, [d]: { ...x[d], [campo]: valor } }));

  async function guardar() {
    setEstado({});
    const filas = SEMANA_ORDEN.filter((d) => dias[d].activo).map((d) => ({
      profesional_id: profesionalId,
      dia: d,
      hora_inicio: dias[d].desde,
      hora_fin: dias[d].hasta,
    }));
    if (filas.some((f) => f.hora_fin <= f.hora_inicio)) return setEstado({ error: 'En algún día la hora de fin es anterior a la de inicio.' });
    setGuardando(true);
    const borrar = await supabase.from('horarios_trabajo').delete().eq('profesional_id', profesionalId);
    if (borrar.error) {
      setGuardando(false);
      return setEstado({ error: mensajeError(borrar.error) });
    }
    if (filas.length) {
      const { error } = await supabase.from('horarios_trabajo').insert(filas);
      if (error) {
        setGuardando(false);
        return setEstado({ error: mensajeError(error) });
      }
    }
    setGuardando(false);
    setEstado({ ok: 'Horario guardado.' });
  }

  return (
    <Seccion titulo="Días y horario de trabajo">
      <div className="tarjeta divide-y divide-navy-800 overflow-hidden">
        {SEMANA_ORDEN.map((d) => (
          <div key={d} className="flex items-center gap-3 px-4 py-2.5">
            <label className="flex w-28 shrink-0 items-center gap-2.5 text-sm font-semibold">
              <input type="checkbox" className="h-5 w-5 accent-[#2cc79b]" checked={dias[d].activo} onChange={(e) => cambiar(d, 'activo', e.target.checked)} />
              {DIAS[d]}
            </label>
            {dias[d].activo ? (
              <div className="flex flex-1 items-center gap-2">
                <input type="time" step="900" className="campo px-2 py-2 text-sm" value={dias[d].desde} onChange={(e) => e.target.value && cambiar(d, 'desde', e.target.value)} aria-label={`${DIAS[d]} desde`} />
                <span className="text-tinta-500">–</span>
                <input type="time" step="900" className="campo px-2 py-2 text-sm" value={dias[d].hasta} onChange={(e) => e.target.value && cambiar(d, 'hasta', e.target.value)} aria-label={`${DIAS[d]} hasta`} />
              </div>
            ) : (
              <span className="text-sm text-tinta-500">No trabajo</span>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-tinta-400">Los clientes solo van a poder reservar dentro de este horario, en los huecos libres de tu agenda.</p>
      <div className="mt-3 space-y-3">
        <Estado {...estado} />
        <button className="btn btn-menta w-full" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar horario'}</button>
      </div>
    </Seccion>
  );
}

function VisitaTecnica() {
  const [config, setConfig] = useState(null);

  useEffect(() => {
    supabase.from('configuracion').select('*').eq('id', 1).maybeSingle().then(({ data }) => setConfig(data));
  }, []);

  if (!config) return null;
  const neto = Number(config.precio_visita) - Number(config.comision_visita);

  return (
    <Seccion titulo="Visita técnica por TaListo!">
      <div className="tarjeta flex gap-4 p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-menta-500/15 text-menta-400">
          <Icon name="dinero" />
        </span>
        <div className="text-sm text-tinta-300">
          <p>
            Las visitas que te reserven por la app cuestan <b className="text-tinta-100">{monto(config.precio_visita, config.moneda)}</b>.
          </p>
          <p className="mt-1">
            Vos recibís <b className="text-menta-300">{monto(neto, config.moneda)}</b> · comisión TaListo! {monto(config.comision_visita, config.moneda)}.
          </p>
          <p className="mt-1 text-xs text-tinta-400">Después de la visita, el trabajo lo arreglás libremente con el cliente.</p>
        </div>
      </div>
    </Seccion>
  );
}

function Cuenta({ email }) {
  return (
    <Seccion titulo="Cuenta">
      <div className="tarjeta flex items-center justify-between gap-3 p-4">
        <p className="min-w-0 truncate text-sm text-tinta-300">{email}</p>
        <button onClick={() => supabase.auth.signOut()} className="btn btn-sec shrink-0 py-2 text-sm">
          <Icon name="salir" className="h-4 w-4" /> Cerrar sesión
        </button>
      </div>
    </Seccion>
  );
}
