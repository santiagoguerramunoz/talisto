// Solo para el servidor (rutas /api/proveedores). Nunca importar desde una página.
// Consulta a los proveedores (lista de precios, stock y pedidos) con protecciones:
// solo https, nunca direcciones internas, tiempo y tamaño máximos.
import dns from 'node:dns/promises';
import net from 'node:net';

function ipv4Privada(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && p[2] === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

// IPv6 → 8 grupos de 16 bits (acepta "::" y la parte final en formato IPv4)
function gruposIpv6(ip) {
  let t = ip.toLowerCase().split('%')[0];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(t);
  if (v4) {
    const p = v4[1].split('.').map(Number);
    t = t.slice(0, -v4[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const [izq, der] = t.split('::');
  const a = izq ? izq.split(':') : [];
  const b = der !== undefined && der ? der.split(':') : [];
  const medio = t.includes('::') ? Array(8 - a.length - b.length).fill('0') : [];
  return [...a, ...medio, ...b].map((g) => parseInt(g || '0', 16));
}

export function ipPrivada(ip) {
  if (net.isIPv4(ip)) return ipv4Privada(ip);
  if (net.isIPv6(ip)) {
    const g = gruposIpv6(ip);
    if (g.length !== 8 || g.some((n) => !Number.isInteger(n))) return true;
    // IPv4 escondida adentro de una IPv6 (::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d)
    const ceros5 = g.slice(0, 5).every((n) => n === 0);
    if ((ceros5 && (g[5] === 0xffff || g[5] === 0)) || (g[0] === 0x64 && g[1] === 0xff9b)) {
      return ipv4Privada(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
    }
    return (
      g.every((n) => n === 0) ||
      (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) ||
      (g[0] & 0xfe00) === 0xfc00 || // fc00::/7
      (g[0] & 0xffc0) === 0xfe80 || // fe80::/10
      (g[0] & 0xff00) === 0xff00 || // multicast
      g[0] === 0x2001 && g[1] === 0x0db8
    );
  }
  return true;
}

// Revisa que el link sea público y seguro antes de consultarlo
export async function urlSegura(texto) {
  let u;
  try {
    u = new URL(String(texto || '').trim());
  } catch {
    throw new Error('El link no es válido.');
  }
  if (u.protocol !== 'https:') throw new Error('El link tiene que empezar con https://');
  if (u.username || u.password) throw new Error('El link no puede llevar usuario ni contraseña: usá la clave de la API.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Ese link no está permitido.');
  }
  let direcciones;
  if (net.isIP(host)) direcciones = [host];
  else {
    try {
      direcciones = (await dns.lookup(host, { all: true, verbatim: true })).map((d) => d.address);
    } catch {
      throw new Error('No encontramos ese sitio. Revisá el link.');
    }
  }
  if (!direcciones.length || direcciones.some(ipPrivada)) throw new Error('Ese link no está permitido.');
  return u;
}

/**
 * Consulta un link del proveedor. Devuelve { status, tipo, bytes }.
 * Sigue hasta 3 redirecciones (revisando cada una) y corta si la respuesta es muy grande o tarda mucho.
 */
export async function traer(url, { metodo = 'GET', headers = {}, cuerpo, max = 15 * 1024 * 1024, espera = 15000 } = {}) {
  let actual = await urlSegura(url);
  for (let salto = 0; salto < 4; salto++) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), espera);
    let r;
    try {
      r = await fetch(actual, {
        method: metodo,
        headers: { 'User-Agent': 'TaListo/1.0 (+https://talisto-ashen.vercel.app)', ...headers },
        body: cuerpo,
        redirect: 'manual',
        signal: control.signal,
        cache: 'no-store',
      });
    } catch (e) {
      clearTimeout(reloj);
      throw new Error(e?.name === 'AbortError' ? 'El proveedor tardó demasiado en responder.' : 'No pudimos conectarnos con el proveedor.');
    }
    if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.get('location')) {
      clearTimeout(reloj);
      if (metodo !== 'GET') throw new Error('El proveedor respondió con una redirección.');
      actual = await urlSegura(new URL(r.headers.get('location'), actual).toString());
      continue;
    }
    const largo = Number(r.headers.get('content-length') || 0);
    if (largo > max) {
      clearTimeout(reloj);
      throw new Error('La lista del proveedor es demasiado grande.');
    }
    const partes = [];
    let total = 0;
    try {
      if (r.body) {
        const lector = r.body.getReader();
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          total += value.length;
          if (total > max) {
            control.abort();
            throw new Error('La lista del proveedor es demasiado grande.');
          }
          partes.push(value);
        }
      }
    } catch (e) {
      clearTimeout(reloj);
      throw new Error(e?.message?.includes('grande') ? e.message : 'Se cortó la conexión con el proveedor.');
    }
    clearTimeout(reloj);
    const bytes = new Uint8Array(total);
    let p = 0;
    partes.forEach((x) => {
      bytes.set(x, p);
      p += x.length;
    });
    return { status: r.status, tipo: r.headers.get('content-type') || '', bytes };
  }
  throw new Error('El link redirige demasiadas veces.');
}

// Encabezado con la clave de la API ("Authorization: Bearer …" o el que diga el proveedor)
export function encabezadoClave(header, clave) {
  const nombre = header || 'Authorization';
  const valor = String(clave || '').trim();
  if (!valor) return {};
  if (nombre.toLowerCase() === 'authorization' && !/^(bearer|basic|token)\s/i.test(valor)) return { [nombre]: `Bearer ${valor}` };
  return { [nombre]: valor };
}

const PALABRAS_STOCK = ['stock', 'existencia', 'existencias', 'disponible', 'available', 'qty', 'quantity', 'cantidad', 'inventory', 'saldo'];

// Busca el stock dentro de la respuesta de la API (o en la ruta indicada)
export function stockDeRespuesta(json, ruta, valorEn, leerNumero) {
  if (typeof json === 'number') return json;
  if (ruta) {
    const v = leerNumero(valorEn(json, ruta));
    if (v !== null) return v;
  }
  const cola = [{ v: Array.isArray(json) ? json[0] : json, d: 0 }];
  while (cola.length) {
    const { v, d } = cola.shift();
    if (!v || typeof v !== 'object' || d > 3) continue;
    for (const k of Object.keys(v)) {
      const n = k.toLowerCase();
      if (PALABRAS_STOCK.some((p) => n === p || n.startsWith(p))) {
        const x = leerNumero(v[k]);
        if (x !== null) return x;
      }
    }
    Object.values(v).forEach((x) => x && typeof x === 'object' && cola.push({ v: Array.isArray(x) ? x[0] : x, d: d + 1 }));
  }
  return null;
}

export const esUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
