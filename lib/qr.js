// Generador de códigos QR (modelo 2, modo byte, corrección de errores M).
// Basado en el algoritmo estándar ISO/IEC 18004, sin dependencias.
// qrSvg(texto) devuelve un <svg> listo para mostrar; qrMatriz(texto) la matriz de módulos.

const ECC_POR_BLOQUE_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
const BLOQUES_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
const VERSION_MAX = 20;
const FORMATO_M = 0; // bits de formato del nivel M

function modulosDatos(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

const codewordsDatos = (ver) => Math.floor(modulosDatos(ver) / 8) - ECC_POR_BLOQUE_M[ver] * BLOQUES_M[ver];

function multGF(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function divisorRS(grado) {
  const r = new Array(grado).fill(0);
  r[grado - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grado; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = multGF(r[j], raiz);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    raiz = multGF(raiz, 0x02);
  }
  return r;
}

function restoRS(datos, divisor) {
  const r = new Array(divisor.length).fill(0);
  for (const b of datos) {
    const factor = b ^ r.shift();
    r.push(0);
    for (let i = 0; i < divisor.length; i++) r[i] ^= multGF(divisor[i], factor);
  }
  return r;
}

function posicionesAlineacion(ver, tam) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const paso = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = tam - 7; r.length < n; pos -= paso) r.splice(1, 0, pos);
  return r;
}

function bytesUtf8(texto) {
  return Array.from(new TextEncoder().encode(String(texto)));
}

export function qrMatriz(texto) {
  const datos = bytesUtf8(texto);
  let ver = 1;
  for (; ver <= VERSION_MAX; ver++) {
    const bitsConteo = ver < 10 ? 8 : 16;
    if (4 + bitsConteo + datos.length * 8 <= codewordsDatos(ver) * 8) break;
  }
  if (ver > VERSION_MAX) throw new Error('Texto demasiado largo para el QR');
  const tam = ver * 4 + 17;
  const capacidad = codewordsDatos(ver) * 8;

  // Bits de datos: modo byte, cantidad, datos, terminador y relleno
  const bits = [];
  const poner = (valor, largo) => {
    for (let i = largo - 1; i >= 0; i--) bits.push((valor >>> i) & 1);
  };
  poner(0b0100, 4);
  poner(datos.length, ver < 10 ? 8 : 16);
  for (const b of datos) poner(b, 8);
  poner(0, Math.min(4, capacidad - bits.length));
  poner(0, (8 - (bits.length % 8)) % 8);
  for (let relleno = 0xec; bits.length < capacidad; relleno ^= 0xec ^ 0x11) poner(relleno, 8);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) cw.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Corrección de errores e intercalado de bloques
  const nBloques = BLOQUES_M[ver];
  const largoEcc = ECC_POR_BLOQUE_M[ver];
  const totalCw = Math.floor(modulosDatos(ver) / 8);
  const nCortos = nBloques - (totalCw % nBloques);
  const largoCorto = Math.floor(totalCw / nBloques);
  const divisor = divisorRS(largoEcc);
  const bloques = [];
  for (let i = 0, k = 0; i < nBloques; i++) {
    const dat = cw.slice(k, k + largoCorto - largoEcc + (i < nCortos ? 0 : 1));
    k += dat.length;
    const ecc = restoRS(dat, divisor);
    if (i < nCortos) dat.push(0);
    bloques.push(dat.concat(ecc));
  }
  const final = [];
  for (let i = 0; i < bloques[0].length; i++) {
    bloques.forEach((b, j) => {
      if (i !== largoCorto - largoEcc || j >= nCortos) final.push(b[i]);
    });
  }

  // Matriz y patrones fijos
  const mod = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const fijo = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const fijar = (x, y, oscuro) => {
    mod[y][x] = oscuro;
    fijo[y][x] = true;
  };
  for (let i = 0; i < tam; i++) {
    fijar(6, i, i % 2 === 0);
    fijar(i, 6, i % 2 === 0);
  }
  const buscador = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < tam && y >= 0 && y < tam) fijar(x, y, d !== 2 && d !== 4);
      }
    }
  };
  buscador(3, 3);
  buscador(tam - 4, 3);
  buscador(3, tam - 4);
  const al = posicionesAlineacion(ver, tam);
  for (let i = 0; i < al.length; i++) {
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) fijar(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  const formato = (mascara) => {
    const d = (FORMATO_M << 3) | mascara;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    const bit = (i) => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) fijar(8, i, bit(i));
    fijar(8, 7, bit(6));
    fijar(8, 8, bit(7));
    fijar(7, 8, bit(8));
    for (let i = 9; i < 15; i++) fijar(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) fijar(tam - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) fijar(8, tam - 15 + i, bit(i));
    fijar(8, tam - 8, true);
  };
  formato(0); // reserva el lugar
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const oscuro = ((b >>> i) & 1) !== 0;
      const a = tam - 11 + (i % 3);
      const c = Math.floor(i / 3);
      fijar(a, c, oscuro);
      fijar(c, a, oscuro);
    }
  }

  // Ubicar los datos en zigzag
  let i = 0;
  for (let der = tam - 1; der >= 1; der -= 2) {
    if (der === 6) der = 5;
    for (let v = 0; v < tam; v++) {
      for (let j = 0; j < 2; j++) {
        const x = der - j;
        const subiendo = ((der + 1) & 2) === 0;
        const y = subiendo ? tam - 1 - v : v;
        if (!fijo[y][x] && i < final.length * 8) {
          mod[y][x] = ((final[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }

  // Máscara: se elige la de menor penalización
  const MASCARAS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const aplicar = (m) => {
    for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) if (!fijo[y][x] && MASCARAS[m](x, y)) mod[y][x] = !mod[y][x];
  };
  const penalidad = () => {
    let p = 0;
    for (let k = 0; k < 2; k++) {
      for (let a = 0; a < tam; a++) {
        let racha = 1;
        for (let b = 1; b < tam; b++) {
          const actual = k ? mod[b][a] : mod[a][b];
          const previo = k ? mod[b - 1][a] : mod[a][b - 1];
          if (actual === previo) {
            racha++;
            if (racha === 5) p += 3;
            else if (racha > 5) p++;
          } else racha = 1;
        }
      }
    }
    let oscuros = 0;
    for (let y = 0; y < tam; y++) {
      for (let x = 0; x < tam; x++) {
        if (mod[y][x]) oscuros++;
        if (x < tam - 1 && y < tam - 1 && mod[y][x] === mod[y][x + 1] && mod[y][x] === mod[y + 1][x] && mod[y][x] === mod[y + 1][x + 1]) p += 3;
      }
    }
    p += Math.floor(Math.abs(oscuros * 20 - tam * tam * 10) / (tam * tam)) * 10;
    return p;
  };
  let mejor = 0;
  let menor = Infinity;
  for (let m = 0; m < 8; m++) {
    aplicar(m);
    formato(m);
    const p = penalidad();
    if (p < menor) {
      menor = p;
      mejor = m;
    }
    aplicar(m); // deshace
  }
  aplicar(mejor);
  formato(mejor);
  return mod;
}

// SVG con margen de 4 módulos (zona silenciosa)
export function qrSvg(texto, { oscuro = '#06101f', claro = '#ffffff' } = {}) {
  const m = qrMatriz(texto);
  const tam = m.length;
  const borde = 4;
  let d = '';
  for (let y = 0; y < tam; y++) {
    for (let x = 0; x < tam; x++) if (m[y][x]) d += `M${x + borde},${y + borde}h1v1h-1z`;
  }
  const total = tam + borde * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${claro}"/><path d="${d}" fill="${oscuro}"/></svg>`;
}
