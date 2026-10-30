'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fechaISO, sumarDias, inicioDia } from '@/lib/fechas';

const DIA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const HORAS = Array.from({ length: 14 }, (_, i) => 7 + i); // 7 a 20
const aMin = (hhmm) => (hhmm ? Number(String(hhmm).slice(0, 2)) * 60 + Number(String(hhmm).slice(3, 5)) : null);
const dos = (n) => String(n).padStart(2, '0');

/**
 * Mi semana desde mañana, en grilla: lo ocupado y lo libre, para elegir el día y la hora en que sigo.
 * valor: { fecha: 'YYYY-MM-DD', hora: 'HH:MM' } · onElegir(valor)
 */
export default function SemanaGrilla({ cuenta, valor, onElegir, duracion = 60, excluir = '' }) {
  const desde = useMemo(() => sumarDias(inicioDia(new Date()), 1), []);
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(desde, i)), [desde]);
  const [ocupado, setOcupado] = useState(null);

  useEffect(() => {
    let vivo = true;
    supabase
      .rpc('mis_trabajos', { p_cuenta: cuenta, p_desde: fechaISO(dias[0]), p_hasta: fechaISO(dias[6]) })
      .then(({ data }) => {
        if (!vivo) return;
        const porDia = Object.fromEntries(dias.map((d) => [fechaISO(d), { bloques: [], sinHora: 0 }]));
        (data?.tickets || []).forEach((o) => {
          if (`ticket:${o.id}` === excluir || !porDia[o.fecha]) return;
          const ini = aMin(o.hora_inicio);
          if (ini === null) porDia[o.fecha].sinHora += 1;
          else porDia[o.fecha].bloques.push([ini, aMin(o.hora_fin) ?? ini + 60]);
        });
        (data?.turnos || []).forEach((t) => {
          if (`turno:${t.id}` === excluir) return;
          const i = new Date(t.inicio);
          const f = new Date(t.fin);
          const k = fechaISO(i);
          if (porDia[k]) porDia[k].bloques.push([i.getHours() * 60 + i.getMinutes(), f.getHours() * 60 + f.getMinutes()]);
        });
        setOcupado(porDia);
      });
    return () => {
      vivo = false;
    };
  }, [cuenta, dias, excluir]);

  const libre = (k, inicio) => !(ocupado?.[k]?.bloques || []).some(([a, b]) => inicio < b && inicio + duracion > a);
  const celdaOcupada = (k, h) => (ocupado?.[k]?.bloques || []).some(([a, b]) => h * 60 < b && h * 60 + 60 > a);
  const elegidoMin = aMin(valor?.hora);

  return (
    <div>
      <div className="grid grid-cols-[2rem_repeat(7,minmax(0,1fr))] gap-px overflow-hidden rounded-xl border border-navy-700 bg-navy-800 text-[10.5px]">
        <span className="bg-navy-900" />
        {dias.map((d) => {
          const k = fechaISO(d);
          const sel = valor?.fecha === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onElegir({ fecha: k, hora: valor?.fecha === k ? valor.hora : '' })}
              className={`px-0.5 py-1.5 text-center font-bold leading-tight ${sel ? 'bg-menta-500 text-navy-950' : 'bg-navy-900 text-tinta-200'}`}
            >
              {DIA[d.getDay()]}
              <span className="block text-[12px]">{d.getDate()}</span>
              {ocupado?.[k]?.sinHora > 0 && (
                <span className={`block text-[9px] font-semibold ${sel ? 'text-navy-900' : 'text-amber-300'}`}>+{ocupado[k].sinHora} s/h</span>
              )}
            </button>
          );
        })}
        {HORAS.map((h) => (
          <div key={h} className="contents">
            <span className="bg-navy-900 pr-1 pt-0.5 text-right text-tinta-500">{h}</span>
            {dias.map((d) => {
              const k = fechaISO(d);
              const ocup = celdaOcupada(k, h);
              const sel = valor?.fecha === k && elegidoMin !== null && elegidoMin >= h * 60 && elegidoMin < h * 60 + 60;
              return (
                <button
                  key={k}
                  type="button"
                  aria-label={`${DIA[d.getDay()]} ${d.getDate()} a las ${h}:00${ocup ? ', ocupado' : ''}`}
                  onClick={() => onElegir({ fecha: k, hora: `${dos(h)}:00` })}
                  className={`h-6 ${sel ? 'bg-menta-400' : ocup ? 'bg-[#0a84ff]/35' : 'bg-navy-950 hover:bg-navy-850'}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-tinta-400">
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#0a84ff]/50" /> Ya tenés algo</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-menta-400" /> Elegido</span>
        <span>s/h = tickets sin hora</span>
        {!ocupado && <span>Cargando tu semana…</span>}
      </p>
      {valor?.fecha && valor?.hora && !libre(valor.fecha, aMin(valor.hora)) && (
        <p className="mt-1 text-xs font-semibold text-amber-300">Ojo: a esa hora ya tenés otro trabajo.</p>
      )}
    </div>
  );
}
