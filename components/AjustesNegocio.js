'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { supabase } from '@/lib/supabase';
import { useAjustes } from '@/lib/ajustes';
import { prepararLogo } from '@/lib/imagenes';
import { numero } from '@/lib/precios';
import { AVISO_SQL_04, faltaSql04 } from '@/lib/sql';
import { mensajeError } from '@/lib/util';

const CARPETA = 'logos';

// Datos del negocio para los presupuestos: logo, RUT, IVA, margen, validez y condiciones
export default function AjustesNegocio({ profesional, email }) {
  const { ajustes, cargando, faltaSql, guardar } = useAjustes(profesional.id);
  const [form, setForm] = useState(null);
  const [estado, setEstado] = useState({});
  const [subiendo, setSubiendo] = useState(false);
  const input = useRef(null);

  useEffect(() => {
    if (cargando) return;
    setForm({
      razon_social: ajustes.razon_social || '',
      rut: ajustes.rut || '',
      telefono: ajustes.telefono || profesional.whatsapp || '',
      email: ajustes.email || email || '',
      direccion: ajustes.direccion || '',
      iva_porcentaje: String(ajustes.iva_porcentaje ?? 22),
      margen_materiales: String(ajustes.margen_materiales ?? 30),
      validez_presupuesto: String(ajustes.validez_presupuesto ?? 15),
      condiciones_presupuesto: ajustes.condiciones_presupuesto || '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargando]);

  if (!form) return null;
  const cambiar = (campo, v) => setForm((f) => ({ ...f, [campo]: v }));

  async function guardarDatos() {
    setEstado({});
    const iva = numero(form.iva_porcentaje);
    const margen = numero(form.margen_materiales);
    const validez = Math.round(numero(form.validez_presupuesto) || 0);
    if (iva === null || iva < 0 || iva > 100) return setEstado({ error: 'El IVA tiene que estar entre 0 y 100.' });
    if (margen === null || margen < 0) return setEstado({ error: 'Poné un margen válido.' });
    if (validez < 1 || validez > 365) return setEstado({ error: 'La validez va de 1 a 365 días.' });
    const { error } = await guardar({
      razon_social: form.razon_social.trim() || null,
      rut: form.rut.trim() || null,
      telefono: form.telefono.trim() || null,
      email: form.email.trim() || null,
      direccion: form.direccion.trim() || null,
      iva_porcentaje: iva,
      margen_materiales: margen,
      validez_presupuesto: validez,
      condiciones_presupuesto: form.condiciones_presupuesto.trim() || null,
    });
    setEstado(error ? { error: faltaSql04(error) ? AVISO_SQL_04 : mensajeError(error) } : { ok: 'Datos guardados. Se usan en los presupuestos nuevos.' });
  }

  const rutaDe = (url) => (url && url.includes(`/${CARPETA}/`) ? decodeURIComponent(url.split(`/${CARPETA}/`)[1].split('?')[0]) : null);

  async function subirLogo(archivo) {
    if (!archivo) return;
    setEstado({});
    setSubiendo(true);
    try {
      const png = await prepararLogo(archivo);
      const ruta = `${profesional.id}/logo-${Date.now()}.png`;
      const { error } = await supabase.storage.from(CARPETA).upload(ruta, png, { contentType: 'image/png', upsert: false });
      if (error) throw error;
      const url = supabase.storage.from(CARPETA).getPublicUrl(ruta).data.publicUrl;
      const anterior = rutaDe(ajustes.logo_url);
      const r = await guardar({ logo_url: url });
      if (r.error) throw r.error;
      if (anterior) await supabase.storage.from(CARPETA).remove([anterior]);
      setEstado({ ok: 'Logo cargado.' });
    } catch (e) {
      setEstado({ error: faltaSql04(e) || /bucket/i.test(e?.message || '') ? AVISO_SQL_04 : mensajeError(e) });
    }
    setSubiendo(false);
    if (input.current) input.current.value = '';
  }

  async function quitarLogo() {
    if (!window.confirm('¿Quitar el logo de los presupuestos?')) return;
    const anterior = rutaDe(ajustes.logo_url);
    const { error } = await guardar({ logo_url: null });
    if (error) return setEstado({ error: mensajeError(error) });
    if (anterior) await supabase.storage.from(CARPETA).remove([anterior]);
  }

  return (
    <section>
      <h2 className="titulo-seccion mb-2">Presupuestos y datos del negocio</h2>
      <div className="tarjeta space-y-4 p-4">
        {faltaSql && <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">{AVISO_SQL_04}</p>}

        <div className="flex items-center gap-4">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-dashed border-navy-600 bg-white">
            {ajustes.logo_url ? (
              <img src={ajustes.logo_url} alt="Tu logo" className="h-full w-full object-contain p-1" />
            ) : (
              <Icon name="imagen" className="h-7 w-7 text-tinta-500" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm text-tinta-300">Tu logo sale arriba en cada presupuesto.</p>
            <div className="flex gap-2">
              <label className={`btn btn-sec cursor-pointer py-2 text-sm ${subiendo ? 'opacity-60' : ''}`}>
                <Icon name="imagen" className="h-4 w-4" /> {subiendo ? 'Subiendo…' : ajustes.logo_url ? 'Cambiar' : 'Subir logo'}
                <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={subiendo} onChange={(e) => subirLogo(e.target.files?.[0])} />
              </label>
              {ajustes.logo_url && (
                <button type="button" className="btn btn-sec px-3 py-2 text-sm" onClick={quitarLogo} aria-label="Quitar logo">
                  <Icon name="borrar" className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="n-razon">Razón social (opcional)</label>
            <input id="n-razon" className="campo" value={form.razon_social} onChange={(e) => cambiar('razon_social', e.target.value)} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="n-rut">RUT (opcional)</label>
            <input id="n-rut" className="campo" inputMode="numeric" value={form.rut} onChange={(e) => cambiar('rut', e.target.value)} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="n-tel">Teléfono</label>
            <input id="n-tel" type="tel" className="campo" value={form.telefono} onChange={(e) => cambiar('telefono', e.target.value)} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="n-email">Email</label>
            <input id="n-email" type="email" className="campo" value={form.email} onChange={(e) => cambiar('email', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="etiqueta" htmlFor="n-dir">Dirección o zona (opcional)</label>
          <input id="n-dir" className="campo" value={form.direccion} onChange={(e) => cambiar('direccion', e.target.value)} placeholder="Ej. Montevideo" />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="etiqueta" htmlFor="n-iva">IVA %</label>
            <input id="n-iva" type="number" inputMode="decimal" min="0" max="100" className="campo" value={form.iva_porcentaje} onChange={(e) => cambiar('iva_porcentaje', e.target.value)} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="n-margen">Margen %</label>
            <input id="n-margen" type="number" inputMode="decimal" min="0" className="campo" value={form.margen_materiales} onChange={(e) => cambiar('margen_materiales', e.target.value)} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="n-validez">Validez (días)</label>
            <input id="n-validez" type="number" inputMode="numeric" min="1" max="365" className="campo" value={form.validez_presupuesto} onChange={(e) => cambiar('validez_presupuesto', e.target.value)} />
          </div>
        </div>
        <p className="-mt-2 text-xs text-tinta-400">El margen es el que se pone solo a cada material nuevo; lo podés cambiar en cada ítem.</p>

        <div>
          <label className="etiqueta" htmlFor="n-cond">Condiciones (salen al pie del presupuesto)</label>
          <textarea
            id="n-cond"
            rows={3}
            className="campo"
            value={form.condiciones_presupuesto}
            onChange={(e) => cambiar('condiciones_presupuesto', e.target.value)}
            placeholder="Ej. Forma de pago: 50% al aceptar y 50% al terminar. Garantía de 6 meses en la mano de obra."
          />
        </div>

        {estado.error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{estado.error}</p>}
        {estado.ok && <p className="rounded-xl bg-menta-500/10 p-3 text-sm text-menta-300">{estado.ok}</p>}
        <button className="btn btn-menta w-full" onClick={guardarDatos}>Guardar datos</button>
      </div>
    </section>
  );
}
