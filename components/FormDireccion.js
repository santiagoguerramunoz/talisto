'use client';

import { useEffect, useState } from 'react';
import Modal from './Modal';
import Mapa from './Mapa';
import Icon from './Icon';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/util';

const ETIQUETAS = ['Casa', 'Oficina', 'Obra', 'Local', 'Depósito', 'Chacra'];

const VACIO = { etiqueta: 'Casa', direccion: '', referencia: '', lat: null, lng: null };

export default function FormDireccion({ abierto, onCerrar, onGuardado, clienteId, direccion }) {
  const [form, setForm] = useState(VACIO);
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setForm(direccion ? { ...VACIO, ...direccion, referencia: direccion.referencia || '' } : VACIO);
    setResultados([]);
    setError('');
  }, [abierto, direccion]);

  const cambiar = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));

  async function buscar() {
    if (!form.direccion.trim()) return;
    setBuscando(true);
    setError('');
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=uy&limit=5&accept-language=es&q=${encodeURIComponent(form.direccion.trim())}`;
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      const datos = await r.json();
      if (!Array.isArray(datos) || datos.length === 0) {
        setError('No encontramos esa dirección. Probá agregando el barrio o la ciudad, o marcala tocando el mapa.');
        setResultados([]);
      } else if (datos.length === 1) {
        cambiar('lat', Number(datos[0].lat));
        cambiar('lng', Number(datos[0].lon));
        setResultados([]);
      } else {
        setResultados(datos);
      }
    } catch {
      setError('No se pudo buscar la dirección. Marcala tocando el mapa.');
    }
    setBuscando(false);
  }

  function estoyAca() {
    if (!navigator.geolocation) {
      setError('Tu dispositivo no permite obtener la ubicación.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setForm((f) => ({ ...f, lat: pos.coords.latitude, lng: pos.coords.longitude })),
      () => setError('No pudimos obtener tu ubicación. Revisá los permisos del navegador.'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function guardar() {
    if (!form.direccion.trim()) {
      setError('Escribí la dirección.');
      return;
    }
    setGuardando(true);
    setError('');
    const fila = {
      cliente_id: clienteId,
      etiqueta: form.etiqueta.trim() || 'Principal',
      direccion: form.direccion.trim(),
      referencia: form.referencia.trim() || null,
      lat: form.lat,
      lng: form.lng,
    };
    const consulta = direccion?.id
      ? supabase.from('direcciones').update(fila).eq('id', direccion.id)
      : supabase.from('direcciones').insert(fila);
    const { error: err } = await consulta;
    setGuardando(false);
    if (err) setError(mensajeError(err));
    else {
      onGuardado?.();
      onCerrar();
    }
  }

  const tienePin = form.lat !== null && form.lng !== null;

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={direccion?.id ? 'Editar dirección' : 'Nueva dirección'}
      pie={
        <button className="btn btn-menta w-full" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar dirección'}
        </button>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="etiqueta">Nombre del lugar</span>
          <div className="mb-2 flex flex-wrap gap-2">
            {ETIQUETAS.map((e) => (
              <button key={e} type="button" className={`chip ${form.etiqueta === e ? 'chip-activo' : ''}`} onClick={() => cambiar('etiqueta', e)}>
                {e}
              </button>
            ))}
          </div>
          <input className="campo" value={form.etiqueta} onChange={(e) => cambiar('etiqueta', e.target.value)} placeholder="O escribí otro nombre" />
        </div>

        <div>
          <label className="etiqueta" htmlFor="dir">Dirección</label>
          <div className="flex gap-2">
            <input
              id="dir"
              className="campo"
              value={form.direccion}
              onChange={(e) => cambiar('direccion', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  buscar();
                }
              }}
              placeholder="Ej. Ellauri 400, Montevideo"
            />
            <button type="button" className="btn btn-sec shrink-0 px-3" onClick={buscar} disabled={buscando} aria-label="Buscar en el mapa">
              <Icon name="buscar" />
            </button>
          </div>
          {resultados.length > 0 && (
            <ul className="mt-2 overflow-hidden rounded-xl border border-navy-700">
              {resultados.map((r) => (
                <li key={r.place_id}>
                  <button
                    type="button"
                    className="w-full border-b border-navy-800 bg-navy-850 px-3 py-2.5 text-left text-sm last:border-0 hover:bg-navy-800"
                    onClick={() => {
                      setForm((f) => ({ ...f, lat: Number(r.lat), lng: Number(r.lon) }));
                      setResultados([]);
                    }}
                  >
                    {r.display_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <label className="etiqueta" htmlFor="ref">Referencia (opcional)</label>
          <input id="ref" className="campo" value={form.referencia} onChange={(e) => cambiar('referencia', e.target.value)} placeholder="Portón verde, timbre 2, apto 501…" />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="etiqueta mb-0">Ubicación en el mapa</span>
            <button type="button" onClick={estoyAca} className="inline-flex items-center gap-1.5 text-sm font-semibold text-menta-400">
              <Icon name="ubicacion" className="h-4 w-4" /> Estoy acá
            </button>
          </div>
          <Mapa
            alto={240}
            puntos={tienePin ? [{ lat: form.lat, lng: form.lng, color: '#4fe0b6', etiqueta: '' }] : []}
            onClickMapa={(lat, lng) => setForm((f) => ({ ...f, lat, lng }))}
          />
          <p className="mt-1.5 text-xs text-tinta-400">
            {tienePin ? 'Tocá el mapa para corregir el punto.' : 'Buscá la dirección o tocá el mapa para marcarla.'}
          </p>
        </div>

        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  );
}
