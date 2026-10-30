'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import { usePanel } from '@/components/PanelContext';
import { supabase } from '@/lib/supabase';
import { FUNCIONES, NOMBRE_PLAN, esPro, precioPlan, textoVencimiento } from '@/lib/planes';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, body) {
  const { data } = await supabase.auth.getSession();
  const r = await fetch('/api/suscripcion', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || 'No se pudo completar. Intentá de nuevo.');
  return datos;
}

const INFO = {
  free: { lema: 'Para organizar tu día', icono: 'agenda' },
  pro: { lema: 'Todo para tu trabajo independiente', icono: 'estrella' },
  business: { lema: 'Para empresas con equipo', icono: 'empresa' },
};

function Valor({ v }) {
  if (v === true) return <Icon name="check" className="h-4 w-4 shrink-0 text-menta-400" />;
  if (v === false) return <Icon name="cerrar" className="h-4 w-4 shrink-0 text-tinta-600" />;
  return <span className="shrink-0 rounded-full bg-navy-800 px-2 py-0.5 text-[11px] font-semibold text-tinta-200">{v}</span>;
}

function Contenido() {
  const params = useSearchParams();
  const panel = usePanel();
  const { user, recargarPlan } = panel;
  const plan = panel.planPersonal || panel.plan; // el plan es siempre el de tu cuenta
  const [disponible, setDisponible] = useState(null);
  const [elegido, setElegido] = useState(null);
  const [email, setEmail] = useState(user?.email || '');
  const [estado, setEstado] = useState({});
  const [trabajando, setTrabajando] = useState(false);
  const [confirmando, setConfirmando] = useState(params.get('mp') === 'volver');

  useEffect(() => {
    fetch('/api/suscripcion', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setDisponible(!!d.disponible))
      .catch(() => setDisponible(false));
  }, []);

  // Volviendo de Mercado Pago: confirmar el pago y actualizar el plan
  useEffect(() => {
    if (params.get('mp') !== 'volver') return undefined;
    const id = params.get('preapproval_id');
    let vivo = true;
    (async () => {
      if (id) await api('PUT', { preapproval_id: id }).catch(() => {});
      for (let i = 0; i < 10 && vivo; i++) {
        const p = await recargarPlan();
        if (esPro(p?.plan) && p?.origen === 'mercadopago') break;
        await esperar(3000);
      }
      if (vivo) setConfirmando(false);
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function suscribirme() {
    setEstado({});
    setTrabajando(true);
    try {
      const { url } = await api('POST', { plan: elegido, email });
      window.location.href = url;
    } catch (e) {
      setEstado({ error: e.message });
      setTrabajando(false);
    }
  }

  async function cancelar() {
    if (!window.confirm('¿Cancelar la suscripción? Tu plan sigue activo hasta el final del mes que ya pagaste.')) return;
    setEstado({});
    setTrabajando(true);
    try {
      await api('DELETE');
      await recargarPlan();
      setEstado({ ok: 'Listo, cancelaste la suscripción. No se te va a cobrar más.' });
    } catch (e) {
      setEstado({ error: e.message });
    }
    setTrabajando(false);
  }

  const actual = plan?.plan || 'free';
  const vence = textoVencimiento(plan);
  const suscripto = plan?.origen === 'mercadopago' && plan?.mp_estado === 'authorized';

  function boton(cual) {
    if (cual === actual) {
      return (
        <div className="space-y-2">
          <p className="flex items-center justify-center gap-1.5 rounded-xl bg-menta-500/10 py-2.5 text-sm font-bold text-menta-300">
            <Icon name="check" className="h-4 w-4" /> Tu plan
          </p>
          {cual !== 'free' && (
            <p className="text-center text-xs text-tinta-400">
              {plan.origen === 'regalo'
                ? vence ? `Regalo de TaListo! hasta el ${vence}` : 'Regalo de TaListo! sin vencimiento'
                : plan.mp_estado === 'cancelled'
                  ? `Cancelada: sigue activa hasta el ${vence}`
                  : vence ? `Se renueva sola · próximo período hasta el ${vence}` : 'Suscripción con Mercado Pago'}
            </p>
          )}
          {cual !== 'free' && suscripto && (
            <button className="btn btn-sec w-full" onClick={cancelar} disabled={trabajando}>Cancelar suscripción</button>
          )}
        </div>
      );
    }
    if (cual === 'free') return null;
    if (cual === 'pro' && actual === 'business') {
      return <p className="rounded-xl bg-navy-850 py-2.5 text-center text-sm text-tinta-400">Incluido en tu plan Business</p>;
    }
    const sinPrecio = !precioPlan(plan, cual);
    if (!disponible || sinPrecio) {
      return <p className="rounded-xl bg-navy-850 py-2.5 text-center text-sm font-semibold text-tinta-300">{disponible === null ? '…' : 'Muy pronto'}</p>;
    }
    return (
      <button className="btn btn-menta w-full" onClick={() => setElegido(cual)}>
        <Icon name="estrella" /> Pasarme a {NOMBRE_PLAN[cual]}
      </button>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-navy-800 bg-navy-950/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/panel/perfil" className="rounded-full p-1.5 text-tinta-300 hover:bg-navy-800" aria-label="Volver">
            <Icon name="izq" />
          </Link>
          <div>
            <h1 className="text-2xl font-extrabold">Planes</h1>
            <p className="text-xs text-tinta-400">Tu plan: <b className="text-tinta-100">TaListo! {NOMBRE_PLAN[actual]}</b></p>
          </div>
        </div>
      </header>

      <div className="space-y-4 px-4 pt-4">
        {confirmando && (
          <p className="flex items-center gap-2 rounded-xl bg-navy-850 p-3 text-sm text-tinta-200">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-navy-600 border-t-menta-400" /> Confirmando tu pago con Mercado Pago…
          </p>
        )}
        {!confirmando && params.get('mp') === 'volver' && esPro(actual) && plan?.origen === 'mercadopago' && (
          <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">¡Listo! Ya tenés TaListo! {NOMBRE_PLAN[actual]}.</p>
        )}
        {estado.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>}
        {estado.ok && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{estado.ok}</p>}

        {['free', 'pro', 'business'].map((cual) => (
          <section key={cual} className={`tarjeta overflow-hidden ${cual === actual ? 'border-menta-500/50' : cual === 'pro' ? 'border-marca-naranja/40' : ''}`}>
            <div className="flex items-start gap-3 p-4">
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${cual === 'free' ? 'bg-navy-800 text-tinta-300' : 'bg-marca-naranja/15 text-marca-naranja'}`}>
                <Icon name={INFO[cual].icono} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-extrabold">{NOMBRE_PLAN[cual]}</h2>
                <p className="text-sm text-tinta-400">{INFO[cual].lema}</p>
              </div>
              <p className="shrink-0 text-right font-extrabold">{cual === 'free' ? 'Gratis' : precioPlan(plan, cual) || ''}</p>
            </div>
            <ul className="space-y-2 border-t border-navy-800 px-4 py-3 text-sm">
              {FUNCIONES.filter((f) => f[cual] !== false || cual === 'free').map((f) => (
                <li key={f.texto} className={`flex items-center justify-between gap-3 ${f[cual] === false ? 'text-tinta-500' : 'text-tinta-200'}`}>
                  <span>{f.texto}</span>
                  <Valor v={f[cual]} />
                </li>
              ))}
            </ul>
            <div className="border-t border-navy-800 p-3">{boton(cual)}</div>
          </section>
        ))}

        <p className="pb-4 text-xs text-tinta-500">
          La suscripción se cobra cada mes con Mercado Pago y la cancelás cuando quieras desde acá. Si la cancelás, el plan sigue hasta el final del período
          pago y después vuelve a Free sin perder tus datos.
        </p>
      </div>

      <Modal abierto={!!elegido} onCerrar={() => !trabajando && setElegido(null)} titulo={`Pasarme a ${NOMBRE_PLAN[elegido] || ''}`}>
        <div className="space-y-4 p-5">
          <p className="text-sm text-tinta-300">
            Vas a pagar <b className="text-tinta-100">{precioPlan(plan, elegido)}</b> con Mercado Pago. Se renueva sola cada mes y la podés cancelar cuando quieras.
          </p>
          <div>
            <label className="etiqueta" htmlFor="mp-email">Email de tu cuenta de Mercado Pago</label>
            <input id="mp-email" type="email" className="campo" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <p className="mt-1 text-xs text-tinta-500">Tiene que ser el mismo con el que entrás a Mercado Pago.</p>
          </div>
          {estado.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>}
          <button className="btn btn-menta w-full" onClick={suscribirme} disabled={trabajando}>
            {trabajando ? 'Abriendo Mercado Pago…' : 'Ir a Mercado Pago'}
          </button>
        </div>
      </Modal>
    </>
  );
}

export default function Planes() {
  return (
    <Suspense fallback={<p className="p-4 text-tinta-400">Cargando…</p>}>
      <Contenido />
    </Suspense>
  );
}
