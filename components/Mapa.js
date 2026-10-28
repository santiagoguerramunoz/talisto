'use client';

import { useEffect, useRef, useState } from 'react';
import { CENTRO_MONTEVIDEO, escapar } from '@/lib/util';

/**
 * Mapa con OpenStreetMap (Leaflet).
 * puntos: [{ lat, lng, color, etiqueta, popup }]  (popup es texto; \n = salto de línea)
 * onClickMapa(lat, lng): para elegir una ubicación tocando el mapa
 * ruta: dibuja una línea uniendo los puntos en orden
 */
export default function Mapa({ puntos = [], onClickMapa, alto = 300, ruta = false, zoomInicial = 12 }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const LRef = useRef(null);
  const capaRef = useRef(null);
  const clickRef = useRef(onClickMapa);
  const puntosRef = useRef(puntos);
  const [listo, setListo] = useState(false);

  clickRef.current = onClickMapa;
  puntosRef.current = puntos;

  const validos = puntos.filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && p.lat !== null && p.lng !== null);
  const clave = validos.map((p) => `${p.lat},${p.lng},${p.color},${p.etiqueta},${p.popup}`).join('|') + (ruta ? '|ruta' : '');

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
      capaRef.current = L.layerGroup().addTo(map);
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

  // Dibujar los puntos cada vez que cambian
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const capa = capaRef.current;
    if (!listo || !L || !map || !capa) return;
    capa.clearLayers();

    const lista = puntosRef.current
      .filter((p) => p.lat !== null && p.lng !== null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
      .map((p) => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) }));

    if (ruta && lista.length > 1) {
      L.polyline(lista.map((p) => [p.lat, p.lng]), { color: '#4fe0b6', weight: 3, opacity: 0.85, dashArray: '6 8' }).addTo(capa);
    }

    lista.forEach((p) => {
      const icon = L.divIcon({
        className: '',
        html: `<div class="pin-talisto" style="background:${escapar(p.color || '#4fe0b6')}">${escapar(p.etiqueta ?? '')}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -14],
      });
      const marcador = L.marker([p.lat, p.lng], { icon }).addTo(capa);
      if (p.popup) marcador.bindPopup(escapar(p.popup).replace(/\n/g, '<br>'));
    });

    if (lista.length === 1) {
      map.setView([lista[0].lat, lista[0].lng], Math.max(map.getZoom(), 15));
    } else if (lista.length > 1) {
      map.fitBounds(L.latLngBounds(lista.map((p) => [p.lat, p.lng])), { padding: [36, 36], maxZoom: 16 });
    }
  }, [listo, clave, ruta]);

  return (
    <div className="relative z-0 overflow-hidden rounded-2xl border border-navy-700" style={{ height: alto }}>
      <div ref={divRef} className="h-full w-full" />
    </div>
  );
}
