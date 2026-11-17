'use client';

import Icon from './Icon';
import { pesos } from '@/lib/match';

/**
 * Las formas de contratar en TaListo! Match, explicadas antes de contratar.
 * La garantía TaListo! solo se ofrece cuando el trabajo se contrata y se paga dentro de TaListo!.
 */
export default function ComoFuncionaMatch({ config, garantiaActiva = false, compacto = false }) {
  const filas = [
    {
      icono: 'match',
      titulo: 'Visita técnica',
      tag: config ? pesos(config.precio_visita) : null,
      clase: 'border-menta-500/40 bg-menta-500/5',
      texto:
        'Publicás lo que necesitás, los profesionales de tu zona responden y elegís a uno con su horario. Pagás la visita por Mercado Pago: TaListo! la retiene hasta que confirmás que se hizo.',
      puntos: [
        'Profesionales con valoraciones verificadas',
        ...(config?.precio_urgencia !== undefined && config?.urgencia_activa ? [`Urgencias y fuera de horario: ${pesos(config.precio_urgencia)}`] : []),
        'Si se cancela a tiempo, te devolvemos el pago',
        'Podés reclamar si la visita no se hizo',
      ],
      gestionada: true,
    },
    {
      icono: 'escudo',
      titulo: 'Trabajo con garantía TaListo!',
      tag: garantiaActiva ? `${config?.garantia_dias ?? 90} días` : 'Muy pronto',
      clase: 'border-[#0a84ff]/40 bg-[#0a84ff]/5',
      texto:
        'Después de la visita, el profesional te presupuesta dentro de TaListo!. Si aceptás y pagás acá, el trabajo queda protegido: TaListo! le paga al profesional cuando confirmás que terminó.',
      puntos: ['Presupuesto con mano de obra y materiales', 'Garantía y reclamos con mediación de TaListo!', 'Calificás el trabajo terminado'],
      gestionada: true,
    },
    {
      icono: 'ir',
      titulo: 'Contratar por fuera',
      tag: 'Sin garantía',
      clase: 'border-navy-700 bg-navy-850',
      texto:
        'Si después de la visita arreglás directamente con el profesional, TaListo! no cobra comisión, pero tampoco administra el presupuesto ni el pago, y no hay garantía TaListo!.',
      puntos: ['Queda registrada la visita técnica', 'Podés calificar solo la visita, no el trabajo'],
      gestionada: false,
    },
  ];
  return (
    <section aria-labelledby="como-funciona">
      <h2 id="como-funciona" className="titulo-seccion mb-2">
        Cómo funciona
      </h2>
      <div className={`grid gap-2 ${compacto ? '' : 'md:grid-cols-3'}`}>
        {filas.map((f) => (
          <article key={f.titulo} className={`rounded-2xl border p-3.5 ${f.clase}`}>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-navy-900 text-menta-300">
                <Icon name={f.icono} className="h-4 w-4" />
              </span>
              <b className="min-w-0 flex-1 text-sm">{f.titulo}</b>
              {f.tag && <span className="rounded-full bg-navy-900 px-2 py-0.5 text-[11px] font-bold text-tinta-200">{f.tag}</span>}
            </div>
            <p className="mt-2 text-xs text-tinta-300">{f.texto}</p>
            {!compacto && (
              <ul className="mt-2 space-y-1 text-xs text-tinta-200">
                {f.puntos.map((p) => (
                  <li key={p} className="flex gap-1.5">
                    <Icon name={f.gestionada ? 'check' : 'der'} className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${f.gestionada ? 'text-menta-300' : 'text-tinta-500'}`} />
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
