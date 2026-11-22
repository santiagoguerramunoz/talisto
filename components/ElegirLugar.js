'use client';

import { useEffect, useRef, useState } from 'react';
import { buscarLocalidades, cargarPaises, cargarRegiones, claveLugar } from '@/lib/lugares';

// País → departamento/provincia/estado → localidad o barrio.
// value: { pais, region_id, localidad_id, localidad_nombre, localidad_nueva }
// Si la localidad no está en la lista, se puede escribir y queda para revisar.
export default function ElegirLugar({ value, onChange, onPais, id = 'lugar' }) {
  const v = value || {};
  const [paises, setPaises] = useState(null);
  const [regiones, setRegiones] = useState([]);
  const [texto, setTexto] = useState(v.localidad_nombre || v.localidad_nueva || '');
  const [opciones, setOpciones] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const caja = useRef(null);

  useEffect(() => {
    cargarPaises().then((ps) => {
      setPaises(ps || []);
      if (ps?.length && !v.pais) onChange({ ...v, pais: ps.find((p) => p.activo)?.codigo || ps[0].codigo });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pais = (paises || []).find((p) => p.codigo === v.pais);
  useEffect(() => {
    if (pais && onPais) onPais(pais);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pais?.codigo]);

  useEffect(() => {
    let vivo = true;
    cargarRegiones(v.pais).then((rs) => vivo && setRegiones(rs));
    return () => {
      vivo = false;
    };
  }, [v.pais]);

  useEffect(() => {
    if (!v.region_id) return setOpciones([]);
    let vivo = true;
    setBuscando(true);
    const t = setTimeout(async () => {
      const r = await buscarLocalidades(v.region_id, v.localidad_id ? '' : texto);
      if (vivo) {
        setOpciones(r);
        setBuscando(false);
      }
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [v.region_id, texto, v.localidad_id]);

  useEffect(() => {
    const cerrar = (e) => caja.current && !caja.current.contains(e.target) && setAbierto(false);
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, []);

  if (paises === null) return <p className="text-sm text-tinta-400">Cargando lugares…</p>;
  if (!paises.length) return null;

  const exacta = opciones.find((o) => claveLugar(o.nombre) === claveLugar(texto));
  const etiquetaRegion = pais?.nombre_region || 'Departamento';
  const etiquetaLocalidad = pais?.nombre_localidad || 'Localidad';

  function elegir(o) {
    setTexto(o.nombre);
    setAbierto(false);
    onChange({ ...v, localidad_id: o.id, localidad_nombre: o.nombre, localidad_nueva: '' });
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="etiqueta" htmlFor={`${id}-pais`}>País</label>
        <select
          id={`${id}-pais`}
          className="campo"
          value={v.pais || ''}
          onChange={(e) => {
            setTexto('');
            onChange({ pais: e.target.value, region_id: null, localidad_id: null, localidad_nombre: '', localidad_nueva: '' });
          }}
          required
        >
          {paises.map((p) => (
            <option key={p.codigo} value={p.codigo} disabled={!p.activo}>
              {p.nombre}
              {p.activo ? '' : ' (muy pronto)'}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="etiqueta" htmlFor={`${id}-region`}>{etiquetaRegion}</label>
        <select
          id={`${id}-region`}
          className="campo"
          value={v.region_id || ''}
          onChange={(e) => {
            setTexto('');
            onChange({ ...v, region_id: e.target.value ? Number(e.target.value) : null, localidad_id: null, localidad_nombre: '', localidad_nueva: '' });
          }}
          required
        >
          <option value="">Elegí tu {etiquetaRegion.toLowerCase()}</option>
          {regiones.map((r) => (
            <option key={r.id} value={r.id}>{r.nombre}</option>
          ))}
        </select>
      </div>
      <div ref={caja} className="relative">
        <label className="etiqueta" htmlFor={`${id}-localidad`}>{etiquetaLocalidad}</label>
        <input
          id={`${id}-localidad`}
          className="campo"
          value={texto}
          disabled={!v.region_id}
          autoComplete="off"
          placeholder={v.region_id ? 'Escribí y elegí de la lista' : `Primero elegí tu ${etiquetaRegion.toLowerCase()}`}
          onFocus={() => setAbierto(true)}
          onChange={(e) => {
            setTexto(e.target.value);
            setAbierto(true);
            onChange({ ...v, localidad_id: null, localidad_nombre: '', localidad_nueva: e.target.value });
          }}
          required
        />
        {abierto && v.region_id && (
          <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-navy-700 bg-navy-900 py-1 shadow-xl">
            {opciones.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => elegir(o)}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-navy-800 ${o.id === v.localidad_id ? 'text-menta-400' : ''}`}
                >
                  {o.nombre}
                  {o.pendiente && <span className="ml-2 text-xs text-tinta-400">(en revisión)</span>}
                </button>
              </li>
            ))}
            {!buscando && texto.trim().length >= 2 && !exacta && (
              <li>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setAbierto(false);
                    onChange({ ...v, localidad_id: null, localidad_nombre: '', localidad_nueva: texto.trim() });
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-menta-400 hover:bg-navy-800"
                >
                  + Agregar &laquo;{texto.trim()}&raquo;
                </button>
              </li>
            )}
            {!buscando && !opciones.length && texto.trim().length < 2 && (
              <li className="px-3 py-2 text-sm text-tinta-400">Escribí el nombre para buscar</li>
            )}
          </ul>
        )}
        {!v.localidad_id && (v.localidad_nueva || '').trim().length >= 2 && !exacta && !abierto && (
          <p className="mt-1.5 text-xs text-tinta-400">No está en la lista: la agregamos y la revisamos. Mientras tanto queda guardada así.</p>
        )}
      </div>
    </div>
  );
}
