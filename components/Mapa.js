'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { CENTRO_MONTEVIDEO, escapar } from '@/lib/util';

const valido = (p) => p && p.lat !== null && p.lng !== null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));

const PORTAPAPELES =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/></svg>';

function iconoPin(L, p) {
  if (p.forma === 'relevamiento') {
    const contenido = p.etiqueta ? `<span>${escapar(p.etiqueta)}</span>` : PORTAPAPELES;
    return L.divIcon({
      className: '',
      html: `<div class="pin-relev">${contenido}</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 40],
      popupAnchor: [0, -36],
    });
  }
  return L.divIcon({
    className: '',
    html: `<div class="pin-gota" style="background:${escapar(p.color || '#4fe0b6')}"><span>${escapar(p.etiqueta ?? '')}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 36],
    popupAnchor: [0, -32],
  });
}

/**
 * Mapa con OpenStreetMap (Leaflet).
 * puntos: [{ lat, lng, color, etiqueta, popup, forma }]  → pines tipo gota (clientes / paradas)
 *   forma: 'relevamiento' → pin cuadrado naranja con portapapeles (o el número de parada)
 *   fueraDeRuta: no se une con la línea punteada de la ruta
 * onClickMapa(lat, lng): para elegir una ubicación tocando el mapa
 * trazado: [[lat, lng], ...] ruta real por calles
 * ruta: si no hay trazado, une los puntos en orden con línea punteada
 * ubicacion: { lat, lng, precision } → tu punto azul
 * rumbo: grados (0 = norte) → cono de dirección sobre tu punto
 * botonUbicacion: botón para centrar en vos (y activar la brújula en iPhone)
 * encuadrarUbicacion: el zoom incluye tu ubicación junto con los puntos
 */
export default function Mapa({
  puntos = [],
  onClickMapa,
  alto = 300,
  ruta = false,
  trazado = null,
  ubicacion = null,
  rumbo = null,
  botonUbicacion = false,
  encuadrarUbicacion = true,
  onActivarBrujula,
  zoomInicial = 12,
}) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const LRef = useRef(null);
  const capasRef = useRef({});
  const yoRef = useRef({ marcador: null, circulo: null });
  const clickRef = useRef(onClickMapa);
  const puntosRef = useRef(puntos);
  const trazadoRef = useRef(trazado);
  const ubicacionRef = useRef(ubicacion);
  const [listo, setListo] = useState(false);

  clickRef.current = onClickMapa;
  puntosRef.current = puntos;
  trazadoRef.current = trazado;
  ubicacionRef.current = ubicacion;

  const clave =
    puntos.filter(valido).map((p) => `${p.lat},${p.lng},${p.color},${p.etiqueta},${p.popup},${p.forma || ''}`).join('|') +
    (ruta ? '|ruta' : '') +
    (trazado?.length ? `|t${trazado.length}:${trazado[0]}:${trazado[trazado.length - 1]}` : '');
  const hayUbicacion = valido(ubicacion);
  const claveUbicacion = hayUbicacion ? `${Number(ubicacion.lat).toFixed(6)},${Number(ubicacion.lng).toFixed(6)},${Math.round(ubicacion.precision || 0)}` : '';

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
        yoRef.current = { marcador: null, circulo: null };
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Puntos, ruta y encuadre (vos + clientes a la vista)
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
    } else if (ruta) {
      const paradas = lista.filter((p) => !p.fueraDeRuta);
      if (paradas.length > 1) {
        L.polyline(paradas.map((p) => [p.lat, p.lng]), { color: '#4fe0b6', weight: 3, opacity: 0.85, dashArray: '6 8' }).addTo(capas.ruta);
      }
    }

    lista.forEach((p) => {
      const marcador = L.marker([p.lat, p.lng], { icon: iconoPin(L, p), zIndexOffset: p.forma === 'relevamiento' ? 200 : 0 }).addTo(capas.puntos);
      if (p.popup) marcador.bindPopup(escapar(p.popup).replace(/\n/g, '<br>'));
    });

    const encuadre = linea ? [...linea] : lista.map((p) => [p.lat, p.lng]);
    const yo = ubicacionRef.current;
    if (encuadrarUbicacion && valido(yo)) encuadre.push([Number(yo.lat), Number(yo.lng)]);

    if (encuadre.length === 1) {
      map.setView(encuadre[0], Math.max(map.getZoom(), 15));
    } else if (encuadre.length > 1) {
      map.fitBounds(L.latLngBounds(encuadre), { padding: [40, 40], maxZoom: 16 });
    }
    // hayUbicacion: cuando aparece tu ubicación por primera vez, se reencuadra para verte junto a los clientes
  }, [listo, clave, ruta, encuadrarUbicacion, hayUbicacion]);

  // Tu marcador: se crea una vez y después solo se mueve
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!listo || !L || !map) return;
    const yo = ubicacionRef.current;
    const actual = yoRef.current;
    if (!valido(yo)) {
      actual.marcador?.remove();
      actual.circulo?.remove();
      yoRef.current = { marcador: null, circulo: null };
      return;
    }
    const centro = [Number(yo.lat), Number(yo.lng)];
    const radio = yo.precision && yo.precision < 1500 ? yo.precision : 0;
    if (!actual.marcador) {
      const icon = L.divIcon({
        className: '',
        html: '<div class="yo"><div class="yo-cono"></div><div class="yo-halo"></div><div class="yo-punto"></div></div>',
        iconSize: [96, 96],
        iconAnchor: [48, 48],
        popupAnchor: [0, -14],
      });
      actual.circulo = L.circle(centro, {
        pane: 'yo',
        radius: radio,
        color: '#0a84ff',
        weight: 1,
        opacity: 0.35,
        fillColor: '#0a84ff',
        fillOpacity: 0.1,
        interactive: false,
      }).addTo(map);
      actual.marcador = L.marker(centro, { icon, pane: 'yo', keyboard: false, zIndexOffset: 1000 }).bindPopup('Estás acá').addTo(map);
    } else {
      actual.marcador.setLatLng(centro);
      actual.circulo.setLatLng(centro);
      actual.circulo.setRadius(radio);
    }
  }, [listo, claveUbicacion]);

  // Dirección hacia donde apuntás
  useEffect(() => {
    const el = yoRef.current.marcador?.getElement?.();
    const caja = el?.querySelector('.yo');
    if (!caja) return;
    if (Number.isFinite(rumbo)) {
      caja.classList.add('yo-con-rumbo');
      caja.querySelector('.yo-cono').style.transform = `rotate(${rumbo}deg)`;
    } else {
      caja.classList.remove('yo-con-rumbo');
    }
  }, [rumbo, claveUbicacion, listo]);

  function centrarEnMi() {
    onActivarBrujula?.();
    const yo = ubicacionRef.current;
    if (mapRef.current && valido(yo)) mapRef.current.setView([Number(yo.lat), Number(yo.lng)], Math.max(mapRef.current.getZoom(), 16));
  }

  return (
    <div className="relative z-0 overflow-hidden rounded-2xl border border-navy-700" style={{ height: alto }}>
      <div ref={divRef} className="h-full w-full" />
      {botonUbicacion && (
        <button
          type="button"
          onClick={centrarEnMi}
          className={`absolute right-2.5 bottom-6 z-[1000] grid h-11 w-11 place-items-center rounded-full border border-navy-600 bg-navy-900 shadow-lg ${hayUbicacion ? 'text-[#0a84ff]' : 'text-tinta-500'}`}
          aria-label="Centrar el mapa en mi ubicación"
          title={hayUbicacion ? 'Ir a mi ubicación' : 'Buscando tu ubicación…'}
        >
          <Icon name="ubicacion" />
        </button>
      )}
    </div>
  );
}
