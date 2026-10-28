'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Icon from './Icon';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/util';

// Cliente B2B: trabaja con sus propios clientes y se liquida por puestas y MOE.
export default function SeccionEmpresa({ cliente, onGuardado }) {
  const [esEmpresa, setEsEmpresa] = useState(!!cliente.es_empresa);
  const [precio, setPrecio] = useState(cliente.precio_acondicionamiento ?? '');
  const [factor, setFactor] = useState(cliente.factor_moe ?? 1.75);
  const [aviso, setAviso] = useState({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    setEsEmpresa(!!cliente.es_empresa);
    setPrecio(cliente.precio_acondicionamiento ?? '');
    setFactor(cliente.factor_moe ?? 1.75);
  }, [cliente.id, cliente.es_empresa, cliente.precio_acondicionamiento, cliente.factor_moe]);

  async function guardar(valorEmpresa = esEmpresa) {
    setAviso({});
    setGuardando(true);
    const { error } = await supabase
      .from('clientes')
      .update({
        es_empresa: valorEmpresa,
        precio_acondicionamiento: precio === '' ? null : Number(precio),
        factor_moe: Number(factor) || 1.75,
      })
      .eq('id', cliente.id);
    setGuardando(false);
    if (error) return setAviso({ error: mensajeError(error) });
    setAviso({ ok: 'Guardado.' });
    onGuardado?.();
  }

  return (
    <section className="tarjeta p-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0 accent-[#2cc79b]"
          checked={esEmpresa}
          onChange={(e) => {
            setEsEmpresa(e.target.checked);
            guardar(e.target.checked);
          }}
        />
        <span>
          <b>Cliente B2B</b>
          <span className="block text-sm text-tinta-400">
            Empresas que te pasan trabajos de sus propios clientes: cargás cada trabajo con nº de cliente y de ticket (sin sumarlos a tus clientes), lo iniciás y finalizás con el tiempo, y liquidás el mes por puestas y MOE.
          </span>
        </span>
      </label>

      {esEmpresa && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="etiqueta" htmlFor="e-precio">Precio por puesta (UYU)</label>
              <input id="e-precio" type="number" inputMode="decimal" min="0" className="campo" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="Ej. 1200" />
            </div>
            <div>
              <label className="etiqueta" htmlFor="e-factor">1 MOE equivale a (puestas)</label>
              <input id="e-factor" type="number" inputMode="decimal" min="0.25" step="0.25" className="campo" value={factor} onChange={(e) => setFactor(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-tinta-400">1 puesta = un dispositivo con hasta 15 m de cable. Se cargan de a media (0,5).</p>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-sec" onClick={() => guardar()} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar precio'}</button>
            <Link href={`/panel/ordenes?empresa=${cliente.id}`} className="btn btn-menta">
              <Icon name="maletin" /> Trabajos y liquidación
            </Link>
          </div>
        </div>
      )}
      {aviso.error && <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{aviso.error}</p>}
      {aviso.ok && <p className="mt-3 text-sm text-menta-300">{aviso.ok}</p>}
    </section>
  );
}
