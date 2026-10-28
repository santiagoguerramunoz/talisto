'use client';

import { useEffect, useMemo, useState } from 'react';

// ---------------------------------------------------------------------
// Distancias y tiempos entre todos los puntos (vos + paradas)
// ---------------------------------------------------------------------
const TABLA = 'https://router.project-osrm.org/table/v1/driving/';

export function metrosEntre(a, b) {
  const R = 6371000;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Aproximación sin internet: línea recta × 1,35 a 30 km/h promedio
export function matrizAproximada(puntos) {
  const dist = puntos.map((a) => puntos.map((b) => metrosEntre(a, b) * 1.35));
  const dur = dist.map((fila) => fila.map((m) => m / (30000 / 3600)));
  return { dur, dist, aproximada: true };
}

/**
 * Tiempos reales de manejo entre todos los puntos (OSRM).
 * redondearPrimero: el primer punto es tu ubicación → se redondea (~100 m) para no recalcular con cada paso.
 */
export function useMatriz(puntos, redondearPrimero = false) {
  const clave = puntos
    .map((p, i) => {
      const dec = redondearPrimero && i === 0 ? 3 : 5;
      return `${Number(p.lng).toFixed(dec)},${Number(p.lat).toFixed(dec)}`;
    })
    .join(';');

  // Mientras llegan los tiempos reales (o si no hay internet) se usa una aproximación
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const aprox = useMemo(() => (puntos.length >= 2 ? { ...matrizAproximada(puntos), clave } : null), [clave]);
  const [real, setReal] = useState(null);

  useEffect(() => {
    if (puntos.length < 2) return undefined;
    const control = new AbortController();
    fetch(`${TABLA}${clave}?annotations=duration,distance`, { signal: control.signal })
      .then((r) => r.json())
      .then((d) => {
        if (d.code !== 'Ok' || !d.durations || !aprox) return;
        // Si algún tramo no tiene ruta, se usa la aproximación para ese tramo
        const dur = d.durations.map((fila, i) => fila.map((v, j) => (Number.isFinite(v) ? v : aprox.dur[i][j])));
        const dist = (d.distances || aprox.dist).map((fila, i) => fila.map((v, j) => (Number.isFinite(v) ? v : aprox.dist[i][j])));
        setReal({ dur, dist, aproximada: false, clave });
      })
      .catch(() => {});
    return () => control.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  // Solo se usa la matriz que corresponde a los puntos actuales
  return real && real.clave === clave ? real : aprox;
}

// ---------------------------------------------------------------------
// Ordenar paradas
// paradas: [{ key, ini, fin }]  (ini/fin en minutos del día)
// costo(a, b): tiempo entre índices de la matriz
// inicio: índice de la matriz donde arrancás (tu ubicación) o null
// desplazamiento: índice de la matriz de la primera parada (1 si la matriz empieza con vos)
// ---------------------------------------------------------------------
export const MODOS_ORDEN = {
  horario: 'Horario',
  mixto: 'Cerca + horario',
  cerca: 'Más cerca',
  manual: 'Manual',
};

export function ordenPorHorario(paradas) {
  return paradas.map((_, i) => i).sort((a, b) => paradas[a].ini - paradas[b].ini || paradas[a].fin - paradas[b].fin);
}

// El camino más corto pasando por todas (exacto hasta 8 paradas; aproximado si hay más)
export function ordenMasCerca(paradas, costo, inicio, desplazamiento) {
  const n = paradas.length;
  if (n <= 1) return paradas.map((_, i) => i);
  const m = (i) => i + desplazamiento;
  const total = (orden) => {
    let c = inicio === null ? 0 : costo(inicio, m(orden[0]));
    for (let k = 0; k < orden.length - 1; k++) c += costo(m(orden[k]), m(orden[k + 1]));
    return c;
  };

  if (n <= 8) {
    let mejor = null;
    let mejorCosto = Infinity;
    const usado = new Array(n).fill(false);
    const camino = [];
    const probar = (costoParcial) => {
      if (costoParcial >= mejorCosto) return;
      if (camino.length === n) {
        mejorCosto = costoParcial;
        mejor = [...camino];
        return;
      }
      for (let i = 0; i < n; i++) {
        if (usado[i]) continue;
        const previo = camino.length ? m(camino[camino.length - 1]) : inicio;
        const paso = previo === null ? 0 : costo(previo, m(i));
        usado[i] = true;
        camino.push(i);
        probar(costoParcial + paso);
        camino.pop();
        usado[i] = false;
      }
    };
    probar(0);
    return mejor;
  }

  // Vecino más cercano + mejora 2-opt
  const restantes = new Set(paradas.map((_, i) => i));
  const orden = [];
  let actual = inicio;
  if (actual === null) {
    const primera = ordenPorHorario(paradas)[0];
    orden.push(primera);
    restantes.delete(primera);
    actual = m(primera);
  }
  while (restantes.size) {
    let elegida = null;
    for (const i of restantes) if (elegida === null || costo(actual, m(i)) < costo(actual, m(elegida))) elegida = i;
    orden.push(elegida);
    restantes.delete(elegida);
    actual = m(elegida);
  }
  let mejoro = true;
  let mejorCosto = total(orden);
  while (mejoro) {
    mejoro = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const prueba = [...orden.slice(0, i), ...orden.slice(i, j + 1).reverse(), ...orden.slice(j + 1)];
        const c = total(prueba);
        if (c + 1 < mejorCosto) {
          orden.splice(0, n, ...prueba);
          mejorCosto = c;
          mejoro = true;
        }
      }
    }
  }
  return orden;
}

// Cercanía respetando horarios: en cada paso va a la más cercana entre las que
// se superponen con el horario que vence primero (no adelanta a quien es más tarde).
export function ordenMixto(paradas, costo, inicio, desplazamiento) {
  const m = (i) => i + desplazamiento;
  const restantes = paradas.map((_, i) => i);
  const orden = [];
  let actual = inicio;
  while (restantes.length) {
    const venceAntes = Math.min(...restantes.map((i) => paradas[i].fin));
    const candidatas = restantes.filter((i) => paradas[i].ini < venceAntes);
    let elegida;
    if (actual === null) {
      // sin punto de partida: la que empieza antes (y si empatan, la que vence antes)
      elegida = candidatas.reduce((a, b) =>
        paradas[a].ini < paradas[b].ini || (paradas[a].ini === paradas[b].ini && paradas[a].fin <= paradas[b].fin) ? a : b
      );
    } else {
      elegida = candidatas.reduce((a, b) => {
        const ca = costo(actual, m(a));
        const cb = costo(actual, m(b));
        return ca < cb || (ca === cb && paradas[a].ini <= paradas[b].ini) ? a : b;
      });
    }
    orden.push(elegida);
    restantes.splice(restantes.indexOf(elegida), 1);
    actual = m(elegida);
  }
  return orden;
}

// Orden elegido a mano (lista de keys); las paradas nuevas van al final por horario
export function ordenManual(paradas, keys = []) {
  const porKey = new Map(paradas.map((p, i) => [p.key, i]));
  const orden = keys.filter((k) => porKey.has(k)).map((k) => porKey.get(k));
  const vistos = new Set(orden);
  ordenPorHorario(paradas).forEach((i) => {
    if (!vistos.has(i)) orden.push(i);
  });
  return orden;
}

export function ordenar({ modo, paradas, matriz, inicio, desplazamiento, keysManual }) {
  if (paradas.length <= 1) return paradas.map((_, i) => i);
  if (modo === 'manual') return ordenManual(paradas, keysManual);
  if (modo === 'horario' || !matriz) return ordenPorHorario(paradas);
  if (matriz.dur.length !== paradas.length + desplazamiento) return ordenPorHorario(paradas);
  const costo = (a, b) => {
    const v = matriz.dur[a]?.[b];
    return Number.isFinite(v) ? v : Number.MAX_SAFE_INTEGER;
  };
  if (modo === 'cerca') return ordenMasCerca(paradas, costo, inicio, desplazamiento);
  return ordenMixto(paradas, costo, inicio, desplazamiento);
}
