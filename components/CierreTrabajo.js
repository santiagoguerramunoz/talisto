'use client';

import { useEffect, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import SemanaGrilla from './SemanaGrilla';
import { usePanel } from './PanelContext';
import { supabase } from '@/lib/supabase';
import { avisar } from '@/lib/avisos';
import { textoRecordatorio } from '@/lib/trabajos';
import { linkWhatsapp, mensajeError } from '@/lib/util';
import { ubicacionActual } from '@/lib/equipo';

const OPCIONES = [
  { v: 'finalizar', titulo: 'Finalizar', ayuda: 'Terminado o cancelado', icono: 'check', activo: 'border-menta-400 bg-menta-500/15 text-menta-200' },
  { v: 'suspendido', titulo: 'Suspender', ayuda: 'Vuelve a coordinación', icono: 'pausa', activo: 'border-amber-400 bg-amber-400/15 text-amber-200' },
  { v: 'multidia', titulo: 'Multi día', ayuda: 'Sigue otro día', icono: 'agenda', activo: 'border-[#5aa9e6] bg-[#176ba8]/25 text-[#a9d4f5]' },
];

const MOTIVOS_CANCELADO = ['No hay gente en el sitio', 'El cliente canceló', 'Dirección equivocada', 'No hay acceso al lugar'];
const MOTIVOS_SUSPENDER = ['Falta material', 'Hace falta otro técnico', 'Hay que cotizar antes', 'El cliente pidió otro día', 'Por el clima'];
const DURACIONES = [
  [30, '30 min'],
  [60, '1 h'],
  [90, '1 h 30'],
  [120, '2 h'],
  [180, '3 h'],
  [240, '4 h'],
  [480, 'Día entero'],
];

function Contador({ etiqueta, valor, onChange }) {
  const v = Number(valor) || 0;
  const fijar = (n) => onChange(Math.max(0, Math.round(n * 2) / 2));
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-850 p-3">
      <p className="text-sm font-bold">{etiqueta}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button type="button" onClick={() => fijar(v - 0.5)} className="grid h-10 w-10 place-items-center rounded-xl bg-navy-700 text-xl font-bold" aria-label={`Restar media ${etiqueta}`}>−</button>
        <span className="min-w-10 text-center text-2xl font-extrabold tabular-nums">{v.toLocaleString('es-UY', { minimumFractionDigits: v % 1 ? 1 : 0 })}</span>
        <button type="button" onClick={() => fijar(v + 0.5)} className="grid h-10 w-10 place-items-center rounded-xl bg-menta-500 text-xl font-bold text-navy-950" aria-label={`Sumar media ${etiqueta}`}>+</button>
      </div>
    </div>
  );
}

function Chips({ opciones, valor, onElegir }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opciones.map((m) => (
        <button key={m} type="button" onClick={() => onElegir(m)} className={`chip text-xs ${valor === m ? 'chip-activo' : ''}`}>
          {m}
        </button>
      ))}
    </div>
  );
}

export function BotonesCierre({ onCerrarCon, className = '' }) {
  return (
    <div className={`grid grid-cols-3 gap-2 ${className}`}>
      <button type="button" className="btn flex-col gap-0.5 bg-menta-500 px-1 py-2 text-sm font-extrabold text-navy-950 hover:bg-menta-400" onClick={() => onCerrarCon('finalizar')}>
        <Icon name="check" className="h-5 w-5" /> Finalizar
      </button>
      <button type="button" className="btn flex-col gap-0.5 bg-amber-400 px-1 py-2 text-sm font-extrabold text-navy-950 hover:bg-amber-300" onClick={() => onCerrarCon('suspendido')}>
        <Icon name="pausa" className="h-5 w-5" /> Suspender
      </button>
      <button type="button" className="btn flex-col gap-0.5 bg-[#5aa9e6] px-1 py-2 text-sm font-extrabold text-navy-950 hover:bg-[#7dbbec]" onClick={() => onCerrarCon('multidia')}>
        <Icon name="agenda" className="h-5 w-5" /> Multi día
      </button>
    </div>
  );
}

const diaTexto = (iso) => {
  if (!iso) return '';
  const [a, m, d] = iso.split('-').map(Number);
  const f = new Date(a, m - 1, d);
  return `${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][f.getDay()]} ${d}/${m}`;
};

/**
 * Cierre del trabajo por quien lo hace:
 *   Finalizar (terminado con lo que se hizo, o cancelado con el detalle)
 *   Suspender (vuelve a coordinación sin asignar, para reagendar o pasárselo a otro)
 *   Multi día (sigue otro día: se elige en la semana)
 */
export default function CierreTrabajo({ item, cuenta, opcionInicial = 'finalizar', onCerrar, onListo, onMateriales }) {
  const { empresa } = usePanel();
  const [opcion, setOpcion] = useState('finalizar');
  const [cancelado, setCancelado] = useState(false);
  const [texto, setTexto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [puestas, setPuestas] = useState(0);
  const [moes, setMoes] = useState(0);
  const [cuando, setCuando] = useState({ fecha: '', hora: '' });
  const [duracion, setDuracion] = useState(60);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [hecho, setHecho] = useState(null);

  useEffect(() => {
    if (!item) return;
    setOpcion(opcionInicial || 'finalizar');
    setCancelado(false);
    setTexto(item.resolucion || '');
    setMotivo('');
    setPuestas(item.puestas || (item.tipo === 'ticket' ? 1 : 0));
    setMoes(item.moes || 0);
    setCuando({ fecha: '', hora: '' });
    const d = Number(item.duracion) || 60;
    setDuracion(DURACIONES.reduce((a, [m]) => (Math.abs(m - d) < Math.abs(a - d) ? m : a), 60));
    setError('');
    setHecho(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.key, opcionInicial]);

  if (!item) return null;
  const esTurno = item.rpc === 'turno';
  const resultado = opcion === 'finalizar' ? (cancelado ? 'cancelado' : 'finalizado') : opcion;

  async function guardar() {
    setError('');
    if (resultado === 'finalizado' && !texto.trim()) return setError('Contá qué hiciste y cómo quedó.');
    if (resultado === 'cancelado' && !motivo.trim()) return setError('Contá por qué no se pudo hacer.');
    if (resultado === 'suspendido' && !motivo.trim()) return setError('Poné el motivo de la suspensión.');
    if (resultado === 'multidia' && !cuando.fecha) return setError('Elegí en la semana qué día seguís.');
    if (resultado === 'multidia' && esTurno && !cuando.hora) return setError('Elegí también la hora (tocá un casillero de la grilla).');
    setGuardando(true);
    const pos = await ubicacionActual();
    const { error: err } = await supabase.rpc('terminar_trabajo', {
      p_tipo: item.rpc,
      p_id: item.id,
      p_resultado: resultado,
      p_resolucion: resultado === 'finalizado' || resultado === 'multidia' ? texto.trim() || null : null,
      p_puestas: item.tipo === 'ticket' && resultado === 'finalizado' ? puestas : null,
      p_moes: item.tipo === 'ticket' && resultado === 'finalizado' ? moes : null,
      p_nota: resultado === 'cancelado' || resultado === 'suspendido' ? motivo.trim() : null,
      p_lat: pos?.lat ?? null,
      p_lng: pos?.lng ?? null,
      p_fecha: resultado === 'multidia' ? cuando.fecha : null,
      p_hora: resultado === 'multidia' && cuando.hora ? cuando.hora : null,
      p_minutos: resultado === 'multidia' && cuando.hora ? duracion : null,
    });
    setGuardando(false);
    if (err) return setError(mensajeError(err));
    avisar();
    if (resultado === 'multidia') return setHecho({ ...cuando });
    onListo(resultado);
  }

  // Después de pasarlo a otro día: avisarle al cliente con un toque
  if (hecho) {
    const wa = linkWhatsapp(
      item.telefono,
      textoRecordatorio({ negocio: empresa?.nombre, cliente: item.contacto, fechaIso: hecho.fecha, hora: hecho.hora, sigue: true })
    );
    return (
      <Modal
        abierto
        onCerrar={() => onListo('multidia')}
        titulo="Listo, quedó agendado"
        pie={
          <button type="button" className="btn btn-sec w-full" onClick={() => onListo('multidia')}>
            Cerrar
          </button>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl border border-[#5aa9e6]/50 bg-[#176ba8]/20 p-4">
            <Icon name="agenda" className="h-6 w-6 shrink-0 text-[#a9d4f5]" />
            <p className="text-sm text-tinta-100">
              Seguís <b>{item.titulo}</b> el <b>{diaTexto(hecho.fecha)}</b>
              {hecho.hora ? (
                <>
                  {' '}a las <b>{hecho.hora}</b>
                </>
              ) : (
                ' (sin hora fija)'
              )}
              . Coordinación ya recibió el aviso.
            </p>
          </div>
          {wa ? (
            <a href={wa} target="_blank" rel="noreferrer" className="btn w-full bg-[#25d366] py-3 font-extrabold text-navy-950 hover:bg-[#3ee07a]">
              <Icon name="whatsapp" /> Avisarle al cliente por WhatsApp
            </a>
          ) : (
            <p className="rounded-xl bg-navy-850 p-3 text-sm text-tinta-400">
              No hay teléfono del cliente cargado: coordinación le puede avisar desde la pantalla de Equipo.
            </p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      abierto={!!item}
      onCerrar={() => !guardando && onCerrar()}
      titulo="¿Cómo queda el trabajo?"
      pie={
        <button
          type="button"
          className={`btn w-full py-3 font-extrabold ${resultado === 'suspendido' ? 'bg-amber-400 text-navy-950 hover:bg-amber-300' : resultado === 'cancelado' ? 'bg-red-500 text-white hover:bg-red-400' : resultado === 'multidia' ? 'bg-[#5aa9e6] text-navy-950 hover:bg-[#7dbbec]' : 'btn-menta'}`}
          onClick={guardar}
          disabled={guardando}
        >
          {guardando
            ? 'Guardando…'
            : resultado === 'finalizado'
              ? 'Cerrar como terminado'
              : resultado === 'cancelado'
                ? 'Cerrar como cancelado'
                : resultado === 'suspendido'
                  ? 'Suspender y devolver a coordinación'
                  : cuando.fecha
                    ? `Seguir el ${diaTexto(cuando.fecha)}${cuando.hora ? ` a las ${cuando.hora}` : ''}`
                    : 'Elegí el día'}
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm font-semibold text-tinta-200">{item.titulo}</p>

        <div className="grid grid-cols-3 gap-2">
          {OPCIONES.map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => {
                setOpcion(o.v);
                setError('');
              }}
              aria-pressed={opcion === o.v}
              className={`flex flex-col items-center gap-1 rounded-2xl border px-1 py-3 text-center ${opcion === o.v ? o.activo : 'border-navy-700 bg-navy-850 text-tinta-300'}`}
            >
              <Icon name={o.icono} className="h-6 w-6" />
              <span className="text-sm font-extrabold leading-tight">{o.titulo}</span>
              <span className="text-[10.5px] leading-tight opacity-80">{o.ayuda}</span>
            </button>
          ))}
        </div>

        {opcion === 'finalizar' && (
          <>
            <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-navy-850 p-1.5">
              {[
                [false, 'Terminado'],
                [true, 'Cancelado'],
              ].map(([v, t]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setCancelado(v)}
                  className={`rounded-xl py-2 text-sm font-bold ${cancelado === v ? (v ? 'bg-red-500/20 text-red-200' : 'bg-navy-700 text-tinta-100') : 'text-tinta-400'}`}
                >
                  {t}
                </button>
              ))}
            </div>
            {!cancelado ? (
              <>
                <div>
                  <label className="etiqueta" htmlFor="ct-res">¿Qué hiciste y cómo quedó?</label>
                  <textarea
                    id="ct-res"
                    rows={4}
                    className="campo"
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    maxLength={2000}
                    placeholder={item.tipo === 'relevamiento' ? 'Medidas, qué hay que hacer, materiales que van a hacer falta…' : 'Ej. Se cambió el router y se probó la conexión: anda bien.'}
                  />
                </div>
                {item.tipo === 'ticket' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Contador etiqueta="Puestas" valor={puestas} onChange={setPuestas} />
                    <Contador etiqueta="MOE" valor={moes} onChange={setMoes} />
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <p className="etiqueta">¿Por qué no se pudo hacer?</p>
                <Chips opciones={MOTIVOS_CANCELADO} valor={motivo} onElegir={setMotivo} />
                <textarea
                  rows={2}
                  className="campo"
                  aria-label="Detalle"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  maxLength={500}
                  placeholder="Escribí el detalle. Ej. No hay gente en el sitio, toqué timbre 2 veces."
                />
              </div>
            )}
          </>
        )}

        {opcion === 'suspendido' && (
          <div className="space-y-2">
            <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">
              El trabajo deja de estar a tu nombre y vuelve a coordinación, para que lo reagenden o se lo pasen a otra persona.
            </p>
            <p className="etiqueta">Motivo</p>
            <Chips opciones={MOTIVOS_SUSPENDER} valor={motivo} onElegir={setMotivo} />
            <textarea
              rows={2}
              className="campo"
              aria-label="Motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={500}
              placeholder="Contá qué pasó para que coordinación sepa cómo seguir."
            />
          </div>
        )}

        {opcion === 'multidia' && (
          <div className="space-y-3">
            <div>
              <p className="etiqueta">¿Qué día y a qué hora seguís?</p>
              <SemanaGrilla cuenta={cuenta} valor={cuando} onElegir={setCuando} duracion={esTurno || cuando.hora ? duracion : 60} excluir={`${item.rpc}:${item.id}`} />
            </div>
            {(esTurno || cuando.hora) && (
              <div>
                <label className="etiqueta" htmlFor="ct-dur">¿Cuánto te va a llevar?</label>
                <select id="ct-dur" className="campo" value={duracion} onChange={(e) => setDuracion(Number(e.target.value))}>
                  {DURACIONES.map(([m, t]) => (
                    <option key={m} value={m}>{t}</option>
                  ))}
                </select>
              </div>
            )}
            {!esTurno && cuando.fecha && cuando.hora && (
              <button type="button" className="text-xs font-semibold text-tinta-400 underline" onClick={() => setCuando((c) => ({ ...c, hora: '' }))}>
                Dejarlo sin hora fija
              </button>
            )}
            <div>
              <label className="etiqueta" htmlFor="ct-av">¿Qué avanzaste hoy? (opcional)</label>
              <textarea id="ct-av" rows={2} className="campo" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={2000} placeholder="Ej. Quedó cableado el primer piso; falta el tablero." />
            </div>
            <p className="text-xs text-tinta-400">El tiempo trabajado se va sumando. Después te ofrecemos avisarle al cliente por WhatsApp.</p>
          </div>
        )}

        {onMateriales && resultado !== 'cancelado' && resultado !== 'suspendido' && (
          <button type="button" onClick={onMateriales} className="flex w-full items-center gap-3 rounded-xl border border-navy-700 bg-navy-850 p-3 text-left text-sm hover:bg-navy-800">
            <Icon name="caja" className="h-5 w-5 shrink-0 text-menta-300" />
            <span className="min-w-0 flex-1">
              <b className="block">¿Usaste materiales?</b>
              <span className="text-xs text-tinta-400">Cargá lo que usaste de tu stock y devolvé lo que sobró.</span>
            </span>
            <Icon name="der" className="h-4 w-4 shrink-0 text-tinta-400" />
          </button>
        )}

        <p className="text-xs text-tinta-500">Se guarda la hora y el lugar donde estás. Coordinación recibe el aviso.</p>
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}
