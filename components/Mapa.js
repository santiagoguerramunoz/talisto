'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { CENTRO_MONTEVIDEO, escapar } from '@/lib/util';

const valido = (p) => p && p.lat !== null && p.lng !== null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));

/**
 * Mapa con OpenStreetMap (Leaflet).
 * puntos: [{ lat, lng, color, etiqueta, popup }]  (popup es texto; \n = salto de línea)
 * onClickMapa(lat, lng): para elegir una ubicación tocando el mapa
 * trazado: [[lat, lng], ...] ruta real por calles (línea continua)
 * ruta: si no hay trazado, une los puntos en orden con una línea punteada
 * ubicacion: { lat, lng, precision } → punto azul de "estás acá"
 * botonUbicacion: muestra el botón para centrar el mapa en tu ubicación
 * encuadrarUbicacion: incluye tu ubicación al ajustar el zoom a los puntos
 */
export default function Mapa({
  puntos = [],
  onClickMapa,
  alto = 300,
  ruta = false,
  trazado = null,
  ubicacion = null,
  botonUbicacion = false,
  encuadrarUbicacion = false,
  zoomInicial = 12,
}) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const LRef = useRef(null);
  const capasRef = useRef({});
  const clickRef = useRef(onClickMapa);
  const puntosRef = useRef(puntos);
  const trazadoRef = useRef(trazado);
  const ubicacionRef = useRef(ubicacion);
  const yaCentroEnMi = useRef(false);
  const [listo, setListo] = useState(false);

  clickRef.current = onClickMapa;
  puntosRef.current = puntos;
  trazadoRef.current = trazado;
  ubicacionRef.current = ubicacion;

  const clave =
    puntos.filter(valido).map((p) => `${p.lat},${p.lng},${p.color},${p.etiqueta},${p.popup}`).join('|') +
    (ruta ? '|ruta' : '') +
    (trazado?.length ? `|t${trazado.length}:${trazado[0]}:${trazado[trazado.length - 1]}` : '');
  const claveUbicacion = valido(ubicacion) ? `${ubicacion.lat.toFixed(5)},${ubicacion.lng.toFixed(5)},${Math.round(ubicacion.precision || 0)}` : '';
  const hayUbicacion = claveUbicacion !== '';

  // Crear el mapa una sola vez
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelado || !divRef.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(divRef.current, { zoomControl: true }).setView(CENTRO_MONTEVIDEO, zoomInicial);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);
      map.createPane('yo');
      map.getPane('yo').style.zIndex = 650;
      capasRef.current = {
        ruta: L.layerGroup().addTo(map),
        puntos: L.layerGroup().addTo(map),
        yo: L.layerGroup().addTo(map),
      };
      map.on('click', (e) => clickRef.current?.(e.latlng.lat, e.latlng.lng));
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 250);
      setListo(true);
    })();
    return () => {
      cancelado = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Puntos y ruta
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const capas = capasRef.current;
    if (!listo || !L || !map || !capas.puntos) return;
    capas.puntos.clearLayers();
    capas.ruta.clearLayers();

    const lista = puntosRef.current.filter(valido).map((p) => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) }));
    const linea = trazadoRef.current?.length > 1 ? trazadoRef.current : null;

    if (linea) {
      L.polyline(linea, { color: '#0b1730', weight: 8, opacity: 0.55 }).addTo(capas.ruta);
      L.polyline(linea, { color: '#4fe0b6', weight: 5, opacity: 0.95 }).addTo(capas.ruta);
    } else if (ruta && lista.length > 1) {
      L.polyline(lista.map((p) => [p.lat, p.lng]), { color: '#4fe0b6', weight: 3, opacity: 0.85, dashArray: '6 8' }).addTo(capas.ruta);
    }

    lista.forEach((p) => {
      const icon = L.divIcon({
        className: '',
        html: `<div class="pin-talisto" style="background:${escapar(p.color || '#4fe0b6')}">${escapar(p.etiqueta ?? '')}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -14],
      });
      const marcador = L.marker([p.lat, p.lng], { icon }).addTo(capas.puntos);
      if (p.popup) marcador.bindPopup(escapar(p.popup).replace(/\n/g, '<br>'));
    });

    const encuadre = linea ? [...linea] : lista.map((p) => [p.lat, p.lng]);
    const yo = ubicacionRef.current;
    if (encuadrarUbicacion && valido(yo)) encuadre.push([yo.lat, yo.lng]);

    if (encuadre.length === 1) {
      map.setView(encuadre[0], Math.max(map.getZoom(), 15));
    } else if (encuadre.length > 1) {
      map.fitBounds(L.latLngBounds(encuadre), { padding: [36, 36], maxZoom: 16 });
    }
  }, [listo, clave, ruta, encuadrarUbicacion]);

  // Punto azul de tu ubicación
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const capas = capasRef.current;
    if (!listo || !L || !map || !capas.yo) return;
    capas.yo.clearLayers();
    const yo = ubicacionRef.current;
    if (!valido(yo)) return;
    const centro = [yo.lat, yo.lng];
    if (yo.precision && yo.precision < 1500) {
      L.circle(centro, { pane: 'yo', radius: yo.precision, color: '#3b82f6', weight: 1, opacity: 0.4, fillColor: '#3b82f6', fillOpacity: 0.12, interactive: false }).addTo(capas.yo);
    }
    L.circleMarker(centro, { pane: 'yo', radius: 8, color: '#ffffff', weight: 3, fillColor: '#3b82f6', fillOpacity: 1 })
      .bindPopup('Estás acá')
      .addTo(capas.yo);

    // Si el mapa no tiene otros puntos, la primera vez se centra en vos
    if (!yaCentroEnMi.current && puntosRef.current.filter(valido).length === 0 && !trazadoRef.current) {
      map.setView(centro, 15);
    }
    yaCentroEnMi.current = true;
  }, [listo, claveUbicacion]);

  function centrarEnMi() {
    const yo = ubicacionRef.current;
    if (mapRef.current && valido(yo)) mapRef.current.setView([yo.lat, yo.lng], Math.max(mapRef.current.getZoom(), 16));
  }

  return (
    <div className="relative z-0 overflow-hidden rounded-2xl border border-navy-700" style={{ height: alto }}>
      <div ref={divRef} className="h-full w-full" />
      {botonUbicacion && (
        <button
          type="button"
          onClick={centrarEnMi}
          disabled={!hayUbicacion}
          className="absolute right-2.5 bottom-6 z-[1000] grid h-11 w-11 place-items-center rounded-full border border-navy-600 bg-navy-900 text-[#60a5fa] shadow-lg disabled:text-tinta-500"
          aria-label="Centrar el mapa en mi ubicación"
          title={hayUbicacion ? 'Ir a mi ubicación' : 'Buscando tu ubicación…'}
        >
          <Icon name="ubicacion" />
        </button>
      )}
    </div>
  );
}
