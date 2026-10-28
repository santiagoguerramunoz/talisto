'use client';

import { useState } from 'react';
import Mapa from './Mapa';
import Icon from './Icon';

/**
 * Dirección escrita + punto en el mapa (buscar, tocar el mapa o "Estoy acá").
 * valor: { direccion, lat, lng }   onChange(nuevoValor)
 */
export default function SelectorUbicacion({ valor, onChange, alto = 220, placeholder = 'Ej. Rivera 2200, Montevideo' }) {
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState('');
  const tienePin = valor.lat !== null && valor.lat !== undefined && valor.lng !== null && valor.lng !== undefined;

  async function buscar() {
    if (!valor.direccion?.trim()) return;
    setBuscando(true);
    setError('');
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=uy&limit=5&accept-language=es&q=${encodeURIComponent(valor.direccion.trim())}`;
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      const datos = await r.json();
      if (!Array.isArray(datos) || datos.length === 0) {
        setError('No encontramos esa dirección. Agregá el barrio o la ciudad, o marcala tocando el mapa.');
        setResultados([]);
      } else if (datos.length === 1) {
        onChange({ ...valor, lat: Number(datos[0].lat), lng: Number(datos[0].lon) });
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
    if (!navigator.geolocation) return setError('Este dispositivo no permite obtener la ubicación.');
    navigator.geolocation.getCurrentPosition(
      (p) => onChange({ ...valor, lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setError('No pudimos obtener tu ubicación. Revisá los permisos.'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          className="campo"
          value={valor.direccion || ''}
          onChange={(e) => onChange({ ...valor, direccion: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              buscar();
            }
          }}
          placeholder={placeholder}
        />
        <button type="button" className="btn btn-sec shrink-0 px-3" onClick={buscar} disabled={buscando} aria-label="Buscar en el mapa">
          <Icon name="buscar" />
        </button>
      </div>
      {resultados.length > 0 && (
        <ul className="overflow-hidden rounded-xl border border-navy-700">
          {resultados.map((r) => (
            <li key={r.place_id}>
              <button
                type="button"
                className="w-full border-b border-navy-800 bg-navy-850 px-3 py-2.5 text-left text-sm last:border-0 hover:bg-navy-800"
                onClick={() => {
                  onChange({ ...valor, lat: Number(r.lat), lng: Number(r.lon) });
                  setResultados([]);
                }}
              >
                {r.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-tinta-400">{tienePin ? 'Tocá el mapa para corregir el punto.' : 'Buscá la dirección o tocá el mapa.'}</span>
        <button type="button" onClick={estoyAca} className="inline-flex items-center gap-1.5 text-sm font-semibold text-menta-400">
          <Icon name="ubicacion" className="h-4 w-4" /> Estoy acá
        </button>
      </div>
      <Mapa
        alto={alto}
        puntos={tienePin ? [{ lat: valor.lat, lng: valor.lng, color: '#ec8328', etiqueta: '' }] : []}
        onClickMapa={(lat, lng) => onChange({ ...valor, lat, lng })}
        encuadrarUbicacion={false}
      />
      {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
