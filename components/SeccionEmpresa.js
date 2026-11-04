'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Icon from './Icon';
import { OpcionesDiaCierre } from './CierrePlanilla';
import { supabase } from '@/lib/supabase';
import { fechaISO } from '@/lib/fechas';
import { conDia, diaDeCierre, fechaCierre, leerCierres, nombrePlanilla, planillaDeFecha, problemaCierre } from '@/lib/periodos';
import { mensajeError } from '@/lib/util';

// Día de cierre que rige hoy ('' = fin de mes) y la planilla abierta
function cierreDe(cliente) {
  const cierres = leerCierres(cliente.cierre_planilla);
  const periodo = planillaDeFecha(cierres, fechaISO(new Date()));
  return { cierres, periodo, dia: diaDeCierre(cierres, periodo) ?? '' };
}

// Cliente B2B: trabaja con sus propios clientes y se liquida por puestas y MOE.
export default function SeccionEmpresa({ cliente, onGuardado }) {
  const [esEmpresa, setEsEmpresa] = useState(!!cliente.es_empresa);
  const [precio, setPrecio] = useState(cliente.precio_acondicionamiento ?? '');
  const [factor, setFactor] = useState(cliente.factor_moe ?? 1.75);
  const [diaCierre, setDiaCierre] = useState(() => cierreDe(cliente).dia);
  const [aviso, setAviso] = useState({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    setEsEmpresa(!!cliente.es_empresa);
    setPrecio(cliente.precio_acondicionamiento ?? '');
    setFactor(cliente.factor_moe ?? 1.75);
    setDiaCierre(cierreDe(cliente).dia);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente.id, cliente.es_empresa, cliente.precio_acondicionamiento, cliente.factor_moe, cliente.cierre_planilla]);

  const conCierre = 'cierre_planilla' in cliente; // SQL 16
  const cierre = cierreDe(cliente);

  async function guardar(valorEmpresa = esEmpresa) {
    setAviso({});
    const fila = {
      es_empresa: valorEmpresa,
      precio_acondicionamiento: precio === '' ? null : Number(precio),
      factor_moe: Number(factor) || 1.75,
    };
    if (conCierre && String(diaCierre) !== String(cierre.dia)) {
      const nuevo = conDia(cierre.cierres, cierre.periodo, diaCierre === '' ? null : Number(diaCierre));
      const problema = problemaCierre(nuevo, cierre.periodo, fechaCierre(nuevo, cierre.periodo));
      if (problema) return setAviso({ error: problema });
      fila.cierre_planilla = nuevo;
    }
    setGuardando(true);
    const { error } = await supabase.from('clientes').update(fila).eq('id', cliente.id);
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
          {conCierre && (
            <div>
              <label className="etiqueta" htmlFor="e-cierre">La planilla cierra</label>
              <select id="e-cierre" className="campo" value={diaCierre} onChange={(e) => setDiaCierre(e.target.value)}>
                <OpcionesDiaCierre />
              </select>
              <p className="mt-1 text-xs text-tinta-400">Rige desde la planilla de {nombrePlanilla(cierre.periodo)}; las anteriores no cambian. Al día siguiente del cierre abre la nueva.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-sec" onClick={() => guardar()} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
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
