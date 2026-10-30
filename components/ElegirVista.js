'use client';

import Icon from './Icon';
import BloqueoPlan from './BloqueoPlan';
import { usePanel } from './PanelContext';
import { OPCIONES_VISTA, vistaPcHabilitada } from '@/lib/vista';

/** Perfil: elegir entre vista PC y celular (Pro, Business y admin) */
export default function ElegirVista() {
  const panel = usePanel();
  if (!vistaPcHabilitada(panel)) {
    return (
      <section>
        <h2 className="titulo-seccion mb-2">Vista para PC</h2>
        <BloqueoPlan compacto titulo="Vista para PC" texto="Barra lateral, agenda y listas a lo ancho para trabajar desde la computadora" />
      </section>
    );
  }
  const actual = panel.vistaPreferida || 'auto';
  return (
    <section>
      <h2 className="titulo-seccion mb-2">Vista</h2>
      <div className="tarjeta p-3">
        <div className="grid grid-cols-3 gap-2">
          {OPCIONES_VISTA.map(([v, t]) => (
            <button
              key={v}
              type="button"
              onClick={() => panel.elegirVista?.(v)}
              aria-pressed={actual === v}
              className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-sm font-bold ${
                actual === v ? 'border-menta-400 bg-menta-500/15 text-menta-200' : 'border-navy-700 bg-navy-850 text-tinta-300'
              }`}
            >
              <Icon name={v === 'celular' ? 'celular' : 'pc'} className="h-6 w-6" />
              {t}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-tinta-400">{OPCIONES_VISTA.find(([v]) => v === actual)?.[2]}. Se guarda en este navegador.</p>
        {actual === 'pc' && !panel.vistaPc && <p className="mt-1 text-xs text-amber-300">En una pantalla tan angosta se sigue viendo como celular.</p>}
      </div>
    </section>
  );
}
