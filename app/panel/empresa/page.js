'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import BloqueoPlan from '@/components/BloqueoPlan';
import { usePanel } from '@/components/PanelContext';
import { useContextoEquipo } from '@/lib/equipo';
import { supabase } from '@/lib/supabase';
import { esBusiness } from '@/lib/planes';
import { PERMISOS, TEXTO_PERMISO, linkInvitacion, textoInvitacion } from '@/lib/empresa';
import { qrSvg } from '@/lib/qr';
import { mensajeError } from '@/lib/util';

const fecha = (iso) => new Date(iso).toLocaleDateString('es-UY', { day: 'numeric', month: 'short' });

function Aviso({ estado }) {
  if (estado?.error) return <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>;
  if (estado?.ok) return <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{estado.ok}</p>;
  return null;
}

function ElegirRoles({ roles, elegidos, onCambiar }) {
  return (
    <div className="space-y-1.5">
      {roles.map((r) => {
        const activo = elegidos.includes(r.id);
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onCambiar(activo ? elegidos.filter((x) => x !== r.id) : [...elegidos, r.id])}
            className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left ${activo ? 'border-menta-500/60 bg-menta-500/10' : 'border-navy-700 bg-navy-850'}`}
          >
            <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border ${activo ? 'border-menta-400 bg-menta-500 text-navy-950' : 'border-navy-600'}`}>
              {activo && <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">
                {r.nombre} {r.bloqueado && <span className="ml-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-300">Bloqueado</span>}
              </span>
              <span className="block text-xs text-tinta-400">{r.permisos.map((p) => TEXTO_PERMISO[p] || p).join(' · ') || 'Sin permisos'}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// QR y formas de mandar la invitación
function Compartir({ invitacion, empresa, onCerrar }) {
  const link = linkInvitacion(invitacion.codigo);
  const texto = textoInvitacion(empresa, link);
  const svg = useMemo(() => qrSvg(link), [link]);
  const [copiado, setCopiado] = useState(false);
  const puedeCompartir = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  async function copiar() {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      window.prompt('Copiá el link:', link);
    }
  }
  return (
    <Modal abierto onCerrar={onCerrar} titulo="Invitación lista">
      <div className="space-y-4 p-5">
        <p className="text-sm text-tinta-300">
          {invitacion.email ? (
            <>Solo la puede usar <b className="text-tinta-100">{invitacion.email}</b>. Si entra a TaListo! con ese email, también la ve al abrir la app.</>
          ) : (
            <>Que la persona escanee el QR con la cámara del celular. Sirve para <b className="text-tinta-100">una sola cuenta</b>.</>
          )}
        </p>
        <div className="mx-auto w-56 overflow-hidden rounded-2xl bg-white p-2" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="break-all rounded-xl bg-navy-850 p-2.5 text-center text-xs text-tinta-300">{link}</p>
        <div className="grid grid-cols-2 gap-2">
          <a className="btn btn-menta" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer">
            <Icon name="whatsapp" /> WhatsApp
          </a>
          <a className="btn btn-sec" href={`mailto:${invitacion.email || ''}?subject=${encodeURIComponent(`Invitación a ${empresa} en TaListo!`)}&body=${encodeURIComponent(texto)}`}>
            Email
          </a>
          <button type="button" className="btn btn-sec" onClick={copiar}>{copiado ? 'Copiado ✓' : 'Copiar link'}</button>
          {puedeCompartir && (
            <button type="button" className="btn btn-sec" onClick={() => navigator.share({ title: `Invitación a ${empresa}`, text: texto }).catch(() => {})}>
              <Icon name="compartir" /> Compartir
            </button>
          )}
        </div>
        <p className="text-xs text-tinta-500">Vence el {new Date(invitacion.vence_en).toLocaleDateString('es-UY')}. La podés cancelar desde la lista de invitaciones.</p>
      </div>
    </Modal>
  );
}

function Invitar({ empresaId, roles, onCerrar, onCreada }) {
  const [email, setEmail] = useState('');
  const [elegidos, setElegidos] = useState(() => roles.filter((r) => r.nombre === 'Producción').map((r) => r.id));
  const [estado, setEstado] = useState({});
  const [guardando, setGuardando] = useState(false);
  async function crear() {
    setEstado({});
    const correo = email.trim().toLowerCase();
    if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return setEstado({ error: 'Revisá el email.' });
    if (!elegidos.length) return setEstado({ error: 'Elegí al menos un rol.' });
    setGuardando(true);
    const { data, error } = await supabase.from('invitaciones').insert({ empresa_id: empresaId, email: correo || null, roles: elegidos }).select().single();
    setGuardando(false);
    if (error) return setEstado({ error: mensajeError(error) });
    onCreada(data);
  }
  return (
    <Modal abierto onCerrar={onCerrar} titulo="Invitar a alguien">
      <div className="space-y-4 p-5">
        <div>
          <label className="etiqueta" htmlFor="inv-email">Email (opcional)</label>
          <input id="inv-email" type="email" className="campo" placeholder="operario@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="mt-1 text-xs text-tinta-500">Con email, solo esa persona la puede usar. Sin email, te queda un QR para escanear en el momento.</p>
        </div>
        <div>
          <p className="etiqueta">Roles</p>
          <ElegirRoles roles={roles} elegidos={elegidos} onCambiar={setElegidos} />
        </div>
        <Aviso estado={estado} />
        <button type="button" className="btn btn-menta w-full" onClick={crear} disabled={guardando}>
          {guardando ? 'Creando…' : email.trim() ? 'Crear invitación' : 'Crear invitación con QR'}
        </button>
      </div>
    </Modal>
  );
}

function EditarMiembro({ miembro, roles, onCerrar, onCambio }) {
  const [elegidos, setElegidos] = useState(miembro.roles || []);
  const [estado, setEstado] = useState({});
  const [guardando, setGuardando] = useState(false);

  async function guardarRoles() {
    setEstado({});
    setGuardando(true);
    const quitar = (miembro.roles || []).filter((r) => !elegidos.includes(r));
    const poner = elegidos.filter((r) => !(miembro.roles || []).includes(r));
    const ops = [];
    if (quitar.length) ops.push(supabase.from('miembros_roles').delete().eq('miembro_id', miembro.id).in('rol_id', quitar));
    if (poner.length) ops.push(supabase.from('miembros_roles').insert(poner.map((rol_id) => ({ miembro_id: miembro.id, rol_id }))));
    const res = await Promise.all(ops);
    setGuardando(false);
    const err = res.find((r) => r.error)?.error;
    if (err) return setEstado({ error: mensajeError(err) });
    onCambio('Roles guardados.');
  }
  async function bloquear() {
    const nuevo = miembro.estado === 'activo' ? 'bloqueado' : 'activo';
    const { error } = await supabase.from('miembros').update({ estado: nuevo }).eq('id', miembro.id);
    if (error) return setEstado({ error: mensajeError(error) });
    onCambio(nuevo === 'bloqueado' ? 'Cuenta bloqueada: ya no entra a la empresa.' : 'Cuenta desbloqueada.');
  }
  async function quitar() {
    if (!window.confirm(`¿Quitar a ${miembro.nombre} de la empresa? Su cuenta personal sigue funcionando.`)) return;
    const { error } = await supabase.from('miembros').delete().eq('id', miembro.id);
    if (error) return setEstado({ error: mensajeError(error) });
    onCambio('La cuenta salió de la empresa.');
  }
  return (
    <Modal abierto onCerrar={onCerrar} titulo={miembro.nombre}>
      <div className="space-y-4 p-5">
        <p className="text-sm text-tinta-400">{miembro.email} · en el equipo desde el {fecha(miembro.creado_en)}</p>
        <div>
          <p className="etiqueta">Roles</p>
          <ElegirRoles roles={roles} elegidos={elegidos} onCambiar={setElegidos} />
        </div>
        <Aviso estado={estado} />
        <button type="button" className="btn btn-menta w-full" onClick={guardarRoles} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar roles'}</button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-sec" onClick={bloquear}>
            <Icon name="candado" className="h-[18px] w-[18px]" /> {miembro.estado === 'activo' ? 'Bloquear' : 'Desbloquear'}
          </button>
          <button type="button" className="btn btn-sec text-red-300" onClick={quitar}>
            <Icon name="borrar" className="h-[18px] w-[18px]" /> Quitar
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditarRol({ rol, empresaId, onCerrar, onCambio }) {
  const [form, setForm] = useState(() => ({ nombre: rol?.nombre || '', permisos: rol?.permisos || [], bloqueado: !!rol?.bloqueado }));
  const [estado, setEstado] = useState({});
  const [guardando, setGuardando] = useState(false);
  const alternar = (p) => setForm((f) => ({ ...f, permisos: f.permisos.includes(p) ? f.permisos.filter((x) => x !== p) : [...f.permisos, p] }));

  async function guardar() {
    setEstado({});
    if (!form.nombre.trim()) return setEstado({ error: 'Poné un nombre al rol.' });
    setGuardando(true);
    const fila = { nombre: form.nombre.trim(), permisos: form.permisos, bloqueado: form.bloqueado };
    const { error } = rol?.id
      ? await supabase.from('roles_empresa').update(fila).eq('id', rol.id)
      : await supabase.from('roles_empresa').insert({ ...fila, empresa_id: empresaId, orden: 10 });
    setGuardando(false);
    if (error) return setEstado({ error: /duplicate|unique/i.test(error.message || '') ? 'Ya hay un rol con ese nombre.' : mensajeError(error) });
    onCambio(rol?.id ? 'Rol guardado.' : 'Rol creado.');
  }
  async function borrar() {
    if (!window.confirm(`¿Borrar el rol ${rol.nombre}? Las cuentas que lo tienen lo pierden.`)) return;
    const { error } = await supabase.from('roles_empresa').delete().eq('id', rol.id);
    if (error) return setEstado({ error: mensajeError(error) });
    onCambio('Rol borrado.');
  }
  return (
    <Modal abierto onCerrar={onCerrar} titulo={rol?.id ? `Rol: ${rol.nombre}` : 'Nuevo rol'}>
      <div className="space-y-4 p-5">
        <div>
          <label className="etiqueta" htmlFor="rol-nombre">Nombre</label>
          <input id="rol-nombre" className="campo" placeholder="Ej. Supervisor" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </div>
        <div>
          <p className="etiqueta">Permisos</p>
          <div className="space-y-1.5">
            {PERMISOS.map((p) => {
              const activo = form.permisos.includes(p.id);
              return (
                <button key={p.id} type="button" onClick={() => alternar(p.id)} className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left ${activo ? 'border-menta-500/60 bg-menta-500/10' : 'border-navy-700 bg-navy-850'}`}>
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border ${activo ? 'border-menta-400 bg-menta-500 text-navy-950' : 'border-navy-600'}`}>
                    {activo && <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{p.texto}</span>
                    <span className="block text-xs text-tinta-400">{p.detalle}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-xl bg-navy-850 px-3 py-3">
          <span>
            <span className="block font-semibold">Bloquear este rol</span>
            <span className="block text-xs text-tinta-400">Mientras esté bloqueado, nadie usa sus permisos</span>
          </span>
          <input type="checkbox" className="h-5 w-5 accent-[#2cc79b]" checked={form.bloqueado} onChange={(e) => setForm({ ...form, bloqueado: e.target.checked })} />
        </label>
        <Aviso estado={estado} />
        <button type="button" className="btn btn-menta w-full" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar rol'}</button>
        {rol?.id && (
          <button type="button" className="btn btn-sec w-full text-red-300" onClick={borrar}>
            <Icon name="borrar" className="h-[18px] w-[18px]" /> Borrar rol
          </button>
        )}
      </div>
    </Modal>
  );
}

function CrearEmpresa({ onCreada, nombreSugerido }) {
  const [nombre, setNombre] = useState(nombreSugerido || '');
  const [estado, setEstado] = useState({});
  const [guardando, setGuardando] = useState(false);
  async function crear() {
    setEstado({});
    if (!nombre.trim()) return setEstado({ error: 'Poné el nombre de tu empresa.' });
    setGuardando(true);
    const { error } = await supabase.rpc('crear_mi_empresa', { p_nombre: nombre.trim() });
    setGuardando(false);
    if (error) return setEstado({ error: mensajeError(error) });
    onCreada();
  }
  return (
    <section className="tarjeta space-y-4 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-marca-naranja/15 text-marca-naranja"><Icon name="empresa" /></span>
        <div>
          <h2 className="text-lg font-extrabold">Creá tu empresa</h2>
          <p className="text-sm text-tinta-300">Tus clientes, agenda y finanzas pasan a ser los de la empresa, y sumás a tu equipo con roles: Administración, Producción y Ventas (los podés cambiar).</p>
        </div>
      </div>
      <div>
        <label className="etiqueta" htmlFor="emp-nombre">Nombre de la empresa</label>
        <input id="emp-nombre" className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Climatec Instalaciones" />
      </div>
      <Aviso estado={estado} />
      <button type="button" className="btn btn-menta w-full" onClick={crear} disabled={guardando}>{guardando ? 'Creando…' : 'Crear empresa'}</button>
    </section>
  );
}

export default function Empresa() {
  const { yo, empresa: enEmpresa, permisos, espacios, planPersonal, recargar } = usePanel();
  const ctxEquipo = useContextoEquipo();
  const empresaId = enEmpresa && (permisos || []).includes('equipo') ? enEmpresa.id : espacios?.miEmpresa?.id || null;
  const [info, setInfo] = useState(null);
  const [roles, setRoles] = useState([]);
  const [equipo, setEquipo] = useState([]);
  const [invitaciones, setInvitaciones] = useState([]);
  const [modal, setModal] = useState(null);
  const [estado, setEstado] = useState({});
  const [nombre, setNombre] = useState('');

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    const [i, r, e, inv] = await Promise.all([
      supabase.rpc('info_empresa', { p_empresa: empresaId }),
      supabase.from('roles_empresa').select('*').eq('empresa_id', empresaId).order('orden').order('nombre'),
      supabase.rpc('equipo_empresa', { p_empresa: empresaId }),
      supabase.from('invitaciones').select('*').eq('empresa_id', empresaId).eq('estado', 'pendiente').order('creado_en', { ascending: false }),
    ]);
    if (i.error) return setEstado({ error: mensajeError(i.error) });
    setInfo(i.data);
    setNombre(i.data?.nombre || '');
    setRoles(r.data || []);
    setEquipo(e.data || []);
    setInvitaciones((inv.data || []).filter((x) => new Date(x.vence_en) > new Date()));
  }, [empresaId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function listo(texto) {
    setModal(null);
    setEstado({ ok: texto });
    cargar();
  }

  async function guardarNombre() {
    setEstado({});
    const { error } = await supabase.from('empresas').update({ nombre: nombre.trim() }).eq('id', empresaId);
    if (error) return setEstado({ error: mensajeError(error) });
    setEstado({ ok: 'Nombre guardado.' });
    recargar();
  }

  async function cancelarInvitacion(inv) {
    const { error } = await supabase.from('invitaciones').update({ estado: 'cancelada' }).eq('id', inv.id);
    if (error) return setEstado({ error: mensajeError(error) });
    listo('Invitación cancelada.');
  }

  const nombreRol = (id) => roles.find((r) => r.id === id)?.nombre;
  const lleno = info && info.usadas >= info.cupo;

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/panel/perfil" className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver">
            <Icon name="izq" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-extrabold">{info?.nombre || 'Mi empresa'}</h1>
            {info && <p className="text-xs text-tinta-400">{info.usadas} de {info.cupo} cuentas del equipo</p>}
          </div>
        </div>
      </header>

      <div className="space-y-6 px-4 pt-4">
        <Aviso estado={estado} />

        {!empresaId ? (
          esBusiness(planPersonal?.plan) ? (
            <CrearEmpresa nombreSugerido={yo?.nombre_publico} onCreada={recargar} />
          ) : (
            <BloqueoPlan
              plan="business"
              titulo="Tu empresa con equipo"
              texto="Sumá a tus operarios y administrativos con su propia cuenta y permisos."
              puntos={['Invitaciones por email o QR', 'Roles editables: Administración, Producción, Ventas', 'Bloqueo de roles y cuentas', 'Cada uno conserva su cuenta personal']}
            />
          )
        ) : !info ? (
          <p className="text-tinta-400">Cargando…</p>
        ) : (
          <>
            {!info.activa && <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">La empresa no tiene Business activo: el equipo no puede entrar hasta que se renueve.</p>}

            {ctxEquipo.puedeMonitorear && (
              <Link href="/panel/equipo" className="tarjeta flex items-center gap-3 p-4 hover:bg-navy-850">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#0a84ff]/15 text-[#8cc8ff]">
                  <Icon name="ruta" />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block">Equipo en ruta</b>
                  <span className="text-xs text-tinta-400">Tickets de cada uno, tiempos en cada cliente y dónde está ahora</span>
                </span>
                <Icon name="der" className="h-4 w-4 text-tinta-500" />
              </Link>
            )}

            {/* Equipo */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="titulo-seccion">Equipo</h2>
                <button type="button" className="btn btn-menta py-2" onClick={() => setModal({ tipo: 'invitar' })} disabled={lleno}>
                  <Icon name="mas" /> Invitar
                </button>
              </div>
              {lleno && <p className="mb-2 rounded-xl bg-navy-850 p-3 text-xs text-tinta-300">Llegaste al máximo de {info.cupo} cuentas de tu plan. Para sumar más, pedíselo a TaListo!.</p>}
              {equipo.length === 0 ? (
                <p className="tarjeta p-4 text-sm text-tinta-400">Todavía no sumaste a nadie. Tocá <b>Invitar</b> y mandá la invitación por WhatsApp, email o QR.</p>
              ) : (
                <ul className="tarjeta divide-y divide-navy-800 overflow-hidden">
                  {equipo.map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => setModal({ tipo: 'miembro', miembro: m })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-navy-850">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy-800 font-bold text-tinta-200">{(m.nombre || '?').slice(0, 1).toUpperCase()}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">
                            {m.nombre}
                            {m.estado !== 'activo' && <span className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-300">Bloqueada</span>}
                          </span>
                          <span className="block truncate text-xs text-tinta-400">{(m.roles || []).map(nombreRol).filter(Boolean).join(' · ') || 'Sin roles'}</span>
                        </span>
                        <Icon name="der" className="h-4 w-4 shrink-0 text-tinta-500" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Invitaciones pendientes */}
            {invitaciones.length > 0 && (
              <section>
                <h2 className="titulo-seccion mb-2">Invitaciones pendientes</h2>
                <ul className="tarjeta divide-y divide-navy-800 overflow-hidden">
                  {invitaciones.map((inv) => (
                    <li key={inv.id} className="flex items-center gap-2 px-4 py-3">
                      <button type="button" onClick={() => setModal({ tipo: 'compartir', invitacion: inv })} className="min-w-0 flex-1 text-left">
                        <span className="block truncate font-semibold">{inv.email || 'QR / link abierto'}</span>
                        <span className="block truncate text-xs text-tinta-400">
                          {inv.roles.map(nombreRol).filter(Boolean).join(' · ')} · vence {fecha(inv.vence_en)}
                        </span>
                      </button>
                      <button type="button" className="chip" onClick={() => setModal({ tipo: 'compartir', invitacion: inv })}>QR</button>
                      <button type="button" className="rounded-full p-2 text-tinta-400 hover:text-red-300" onClick={() => cancelarInvitacion(inv)} aria-label="Cancelar invitación">
                        <Icon name="cerrar" className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Roles */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="titulo-seccion">Roles y permisos</h2>
                <button type="button" className="chip" onClick={() => setModal({ tipo: 'rol', rol: null })}><Icon name="mas" className="h-4 w-4" /> Nuevo rol</button>
              </div>
              <ul className="tarjeta divide-y divide-navy-800 overflow-hidden">
                {roles.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setModal({ tipo: 'rol', rol: r })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-navy-850">
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          {r.nombre}
                          {r.bloqueado && <span className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-300">Bloqueado</span>}
                        </span>
                        <span className="block text-xs text-tinta-400">{r.permisos.map((p) => TEXTO_PERMISO[p] || p).join(' · ') || 'Sin permisos'}</span>
                      </span>
                      <Icon name="editar" className="h-4 w-4 shrink-0 text-tinta-500" />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-tinta-500">
                Producción trabaja en los tickets que le asignan, sin ver importes, gastos ni ganancias. Administración agenda y gestiona, pero no se inicia en
                tickets ni relevamientos. Tus cuentas nunca pierden acceso a sus datos personales.
              </p>
            </section>

            {/* Nombre */}
            {info.dueno_id === yo?.id && (
              <section>
                <h2 className="titulo-seccion mb-2">Nombre de la empresa</h2>
                <div className="flex gap-2">
                  <input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} aria-label="Nombre de la empresa" />
                  <button type="button" className="btn btn-sec shrink-0" onClick={guardarNombre} disabled={!nombre.trim() || nombre.trim() === info.nombre}>Guardar</button>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {modal?.tipo === 'invitar' && (
        <Invitar
          empresaId={empresaId}
          roles={roles}
          onCerrar={() => setModal(null)}
          onCreada={(inv) => {
            setModal({ tipo: 'compartir', invitacion: inv });
            cargar();
          }}
        />
      )}
      {modal?.tipo === 'compartir' && <Compartir invitacion={modal.invitacion} empresa={info?.nombre || 'la empresa'} onCerrar={() => setModal(null)} />}
      {modal?.tipo === 'miembro' && <EditarMiembro miembro={modal.miembro} roles={roles} onCerrar={() => setModal(null)} onCambio={listo} />}
      {modal?.tipo === 'rol' && <EditarRol rol={modal.rol} empresaId={empresaId} onCerrar={() => setModal(null)} onCambio={listo} />}
    </>
  );
}
