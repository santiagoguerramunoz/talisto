'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import Icon from '@/components/Icon';
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

  const cargarProfesionales = useCallback(async () => {
    const { data } = await supabase
      .from('profesionales')
      .select('id, nombre_publico, verificado, activo, departamentos, creado_en, perfiles(email, telefono)')
      .order('creado_en', { ascending: false });
    setProfesionales(data || []);
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
      .update({ precio_visita: precio, comision_visita: comision, duracion_visita_min: Number(form.duracion_visita_min) || 60 })
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
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  <button onClick={() => alternar(p, 'verificado')} className={`chip ${p.verificado ? 'chip-activo' : ''}`}>
                    {p.verificado ? <><Icon name="check" className="h-3.5 w-3.5" /> Verificado</> : 'Verificar'}
                  </button>
                  <button onClick={() => alternar(p, 'activo')} className={`chip ${p.activo ? '' : 'border-red-400/50 text-red-300'}`}>
                    {p.activo ? 'Suspender' : 'Reactivar'}
                  </button>
                </div>
              </div>
            </li>
          ))}
          {filtrados.length === 0 && <p className="tarjeta p-4 text-sm text-tinta-400">No hay profesionales.</p>}
        </ul>
      </section>
    </main>
  );
}
