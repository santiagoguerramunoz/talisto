// Lectura de listas de precios: Excel (.xlsx), CSV / TXT y JSON.
// Sin dependencias: funciona en el navegador y en el servidor (Node 18+).

// ------------------------------------------------------------- texto ---
const ENTIDADES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function desXml(t) {
  return String(t || '')
    .replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try {
          return String.fromCodePoint(n);
        } catch {
          return '';
        }
      }
      return ENTIDADES[e];
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function decodificar(bytes) {
  let b = bytes;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    // planillas guardadas por Excel en Windows
    try {
      return new TextDecoder('windows-1252').decode(b);
    } catch {
      return new TextDecoder('latin1').decode(b);
    }
  }
}

// --------------------------------------------------------------- ZIP ---
async function inflar(datos) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador no puede abrir planillas Excel. Actualizalo o guardá la planilla como CSV.');
  }
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

async function leerZip(bytes, quiero) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fin = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error('El archivo no es una planilla Excel válida.');
  const total = dv.getUint16(fin + 10, true);
  let p = dv.getUint32(fin + 16, true);
  const dec = new TextDecoder();
  const archivos = {};
  for (let k = 0; k < total && p + 46 <= bytes.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(p + 10, true);
    const comprimido = dv.getUint32(p + 20, true);
    const largoNombre = dv.getUint16(p + 28, true);
    const largoExtra = dv.getUint16(p + 30, true);
    const largoComentario = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const nombre = dec.decode(bytes.subarray(p + 46, p + 46 + largoNombre));
    p += 46 + largoNombre + largoExtra + largoComentario;
    if (!quiero(nombre)) continue;
    if (dv.getUint32(local, true) !== 0x04034b50) continue;
    const inicio = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const datos = bytes.subarray(inicio, inicio + comprimido);
    if (metodo === 0) archivos[nombre] = datos;
    else if (metodo === 8) archivos[nombre] = await inflar(datos);
  }
  return archivos;
}

// -------------------------------------------------------------- XLSX ---
const atributo = (attrs, nombre) => {
  const m = new RegExp(`(?:^|\\s)${nombre}="([^"]*)"`).exec(attrs);
  return m ? desXml(m[1]) : null;
};

function columnaDe(ref) {
  const letras = /^[A-Z]+/.exec(ref || '')?.[0];
  if (!letras) return null;
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const textoDe = (xml) =>
  [...String(xml).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => desXml(m[1])).join('');

export async function leerXlsx(bytes, { maxFilas = 100000 } = {}) {
  const dec = new TextDecoder();
  const archivos = await leerZip(bytes, (n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(n));
  const libro = archivos['xl/workbook.xml'] ? dec.decode(archivos['xl/workbook.xml']) : '';
  const rels = archivos['xl/_rels/workbook.xml.rels'] ? dec.decode(archivos['xl/_rels/workbook.xml.rels']) : '';
  const destino = {};
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = atributo(m[1], 'Id');
    let t = atributo(m[1], 'Target') || '';
    t = t.startsWith('/') ? t.slice(1) : `xl/${t}`;
    destino[id] = t;
  }
  const compartidos = archivos['xl/sharedStrings.xml']
    ? [...dec.decode(archivos['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1]))
    : [];

  const hojas = [];
  for (const m of libro.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const nombre = atributo(m[1], 'name') || `Hoja ${hojas.length + 1}`;
    const ruta = destino[atributo(m[1], 'r:id')];
    if (ruta && archivos[ruta]) hojas.push({ nombre, xml: dec.decode(archivos[ruta]) });
  }
  if (!hojas.length) {
    Object.keys(archivos)
      .filter((n) => n.startsWith('xl/worksheets/'))
      .sort()
      .forEach((n, i) => hojas.push({ nombre: `Hoja ${i + 1}`, xml: dec.decode(archivos[n]) }));
  }

  return hojas.map(({ nombre, xml }) => {
    const filas = [];
    const datos = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1] || '';
    for (const fm of datos.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (filas.length >= maxFilas) break;
      const numFila = Number(atributo(fm[1], 'r')) || filas.length + 1;
      const fila = [];
      let col = 0;
      for (const cm of (fm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1];
        const dentro = cm[2] || '';
        const c = columnaDe(atributo(attrs, 'r'));
        if (c !== null) col = c;
        const tipo = atributo(attrs, 't');
        const v = /<v>([\s\S]*?)<\/v>/.exec(dentro)?.[1];
        let valor = null;
        if (tipo === 's') valor = compartidos[Number(v)] ?? '';
        else if (tipo === 'inlineStr') valor = textoDe(dentro);
        else if (tipo === 'b') valor = v === '1';
        else if (tipo === 'str' || tipo === 'e' || tipo === 'd') valor = v !== undefined ? desXml(v) : '';
        else if (v !== undefined) {
          const n = Number(v);
          valor = Number.isFinite(n) ? n : desXml(v);
        }
        if (col < 200) fila[col] = valor;
        col += 1;
      }
      while (filas.length < numFila - 1 && filas.length < maxFilas) filas.push([]);
      filas.push(fila);
    }
    return { nombre, filas };
  });
}

// --------------------------------------------------------------- CSV ---
export function leerCsv(texto, { maxFilas = 100000 } = {}) {
  const t = String(texto).replace(/^﻿/, '');
  const primera = t.split(/\r?\n/).find((l) => l.trim()) || '';
  const sep = [';', ',', '\t', '|']
    .map((s) => ({ s, n: primera.replace(/"[^"]*"/g, '').split(s).length - 1 }))
    .sort((a, b) => b.n - a.n)[0];
  const separador = sep && sep.n > 0 ? sep.s : ',';
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (comillas) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else comillas = false;
      } else campo += ch;
    } else if (ch === '"' && campo === '') comillas = true;
    else if (ch === separador) {
      fila.push(campo);
      campo = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      fila.push(campo);
      filas.push(fila);
      if (filas.length >= maxFilas) return filas;
      fila = [];
      campo = '';
    } else campo += ch;
  }
  if (campo !== '' || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

// -------------------------------------------------------------- JSON ---
export function valorEn(obj, ruta) {
  if (obj === null || obj === undefined || !ruta) return undefined;
  if (typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, ruta)) return obj[ruta];
  return String(ruta)
    .split('.')
    .reduce((o, k) => (o !== null && o !== undefined && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined), obj);
}

// Busca la lista de productos dentro del JSON (o usa la ruta indicada)
export function listaDeJson(json, ruta) {
  if (ruta) {
    const v = valorEn(json, ruta);
    return Array.isArray(v) ? v : [];
  }
  if (Array.isArray(json)) return json;
  const cola = [{ v: json, d: 0 }];
  while (cola.length) {
    const { v, d } = cola.shift();
    if (!v || typeof v !== 'object' || d > 3) continue;
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (Array.isArray(x) && x.length && x.every((e) => e && typeof e === 'object' && !Array.isArray(e))) return x;
      if (x && typeof x === 'object' && !Array.isArray(x)) cola.push({ v: x, d: d + 1 });
    }
  }
  return [];
}

// Claves de los objetos (un nivel de anidado como "precio.lista")
export function camposDeObjetos(lista) {
  const campos = new Set();
  lista.slice(0, 30).forEach((o) => {
    Object.keys(o || {}).forEach((k) => {
      const v = o[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.keys(v).forEach((k2) => campos.add(`${k}.${k2}`));
      else campos.add(k);
    });
  });
  return [...campos].slice(0, 80);
}

// ---------------------------------------------------- campos y mapeo ---
export const normalizarTexto = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const CAMPOS = [
  { id: 'codigo', texto: 'Código', sinonimos: ['codigo', 'cod', 'sku', 'codigo articulo', 'cod articulo', 'articulo', 'ref', 'referencia', 'id', 'part number', 'codigo producto', 'cod producto', 'item'] },
  { id: 'nombre', texto: 'Descripción', obligatorio: true, sinonimos: ['descripcion', 'nombre', 'producto', 'detalle', 'description', 'name', 'desc', 'articulo descripcion', 'descripcion articulo', 'title', 'titulo'] },
  { id: 'precio', texto: 'Precio', obligatorio: true, sinonimos: ['precio', 'precio unitario', 'costo', 'price', 'p unit', 'pu', 'precio lista', 'lista', 'precio sin iva', 'precio neto', 'neto', 'valor', 'importe', 'precio venta', 'unit price', 'cost'] },
  { id: 'stock', texto: 'Stock', sinonimos: ['stock', 'existencia', 'existencias', 'disponible', 'disponibles', 'cantidad', 'qty', 'quantity', 'inventario', 'saldo', 'available', 'stock disponible'] },
  { id: 'unidad', texto: 'Unidad', sinonimos: ['unidad', 'un', 'um', 'u m', 'medida', 'unit', 'presentacion', 'unidad medida', 'uom'] },
  { id: 'marca', texto: 'Marca', sinonimos: ['marca', 'brand', 'fabricante'] },
  { id: 'categoria', texto: 'Categoría', sinonimos: ['categoria', 'rubro', 'familia', 'grupo', 'category', 'linea', 'seccion', 'subrubro'] },
];

// Adivina qué columna es cada campo
export function adivinarMapeo(campos = []) {
  const libres = campos.map((c) => ({ c, n: normalizarTexto(String(c).split('.').pop()), nc: normalizarTexto(c) }));
  const mapeo = {};
  const usadas = new Set();
  for (const pasada of ['exacto', 'contiene']) {
    for (const campo of CAMPOS) {
      if (mapeo[campo.id]) continue;
      for (const sin of campo.sinonimos) {
        const hallado = libres.find(
          (x) =>
            !usadas.has(x.c) &&
            (pasada === 'exacto'
              ? x.n === sin || x.nc === sin
              : sin.length > 2 && [x.n, x.nc].some((n) => ` ${n} `.includes(` ${sin} `) || n.startsWith(sin)))
        );
        if (hallado) {
          mapeo[campo.id] = hallado.c;
          usadas.add(hallado.c);
          break;
        }
      }
    }
  }
  return mapeo;
}

// Fila de encabezados: la que más se parece a una lista de precios (entre las primeras 15)
export function filaEncabezado(filas = []) {
  let mejor = -1;
  let puntos = 0;
  filas.slice(0, 15).forEach((f, i) => {
    const textos = (f || []).filter((v) => typeof v === 'string' && v.trim());
    if (textos.length < 2) return;
    const m = adivinarMapeo(textos);
    const p = Object.keys(m).length * 10 + textos.length;
    if (p > puntos) {
      puntos = p;
      mejor = i;
    }
  });
  if (mejor < 0) mejor = Math.max(0, filas.findIndex((f) => (f || []).filter((v) => v !== null && v !== '').length >= 2));
  return mejor;
}

// Tabla (filas de celdas) → objetos con el encabezado como clave
export function objetosDeTabla(filas = []) {
  const i = filaEncabezado(filas);
  const usados = {};
  const enc = (filas[i] || []).map((v, k) => {
    let n = String(v ?? '').trim() || `Columna ${k + 1}`;
    if (usados[n]) n = `${n} (${k + 1})`;
    usados[n] = true;
    return n;
  });
  const objetos = filas
    .slice(i + 1)
    .filter((f) => (f || []).some((v) => v !== null && v !== undefined && String(v).trim() !== ''))
    .map((f) => Object.fromEntries(enc.map((h, k) => [h, f[k] ?? null])));
  return { campos: enc, filas: objetos };
}

// "1.234,50" · "$ 1,234.50" · "52,5" · 52.5 → número
export function leerNumero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  let t = String(v).replace(/u\$s|us\$|usd|uyu|\$|\s/gi, '').replace(/[^0-9.,-]/g, '');
  if (!t || !/\d/.test(t)) return null;
  const coma = t.lastIndexOf(',');
  const punto = t.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) {
    t = coma > punto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (coma >= 0) {
    t = /^-?\d{1,3}(,\d{3}){2,}$/.test(t) ? t.replace(/,/g, '') : t.replace(/,/g, '.');
  } else if (punto >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const textoCelda = (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : String(v).trim());

// Objetos + mapeo → productos listos para importar
export function productosDe(filas = [], mapeo = {}) {
  const lista = [];
  for (const f of filas) {
    const nombre = textoCelda(valorEn(f, mapeo.nombre)).slice(0, 300);
    const precio = leerNumero(valorEn(f, mapeo.precio));
    if (!nombre || precio === null || precio < 0) continue;
    const prod = {
      codigo: textoCelda(valorEn(f, mapeo.codigo)).slice(0, 80) || null,
      nombre,
      precio: Math.round(precio * 100) / 100,
      unidad: textoCelda(valorEn(f, mapeo.unidad)).slice(0, 20) || 'u',
      marca: textoCelda(valorEn(f, mapeo.marca)).slice(0, 80) || null,
      categoria: textoCelda(valorEn(f, mapeo.categoria)).slice(0, 80) || null,
    };
    if (mapeo.stock) {
      const s = leerNumero(valorEn(f, mapeo.stock));
      if (s !== null) prod.stock = s;
    }
    lista.push(prod);
  }
  return lista;
}

// ------------------------------------------------- entrada principal ---
const esZip = (b) => b && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const esXlsViejo = (b) => b && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

/**
 * bytes (Uint8Array) de una planilla o respuesta → { campos, filas (objetos), hojas? }
 * formato: 'auto' | 'xlsx' | 'csv' | 'json'
 */
export async function leerTabla(bytes, { formato = 'auto', hoja = 0, rutaLista = '' } = {}) {
  if (esXlsViejo(bytes)) throw new Error('Es un Excel viejo (.xls). Abrilo y guardalo como .xlsx o .csv.');
  if (formato === 'xlsx' || (formato === 'auto' && esZip(bytes))) {
    const hojas = await leerXlsx(bytes);
    if (!hojas.length) throw new Error('La planilla no tiene hojas.');
    const elegida = hojas[Math.min(hoja, hojas.length - 1)];
    return { ...objetosDeTabla(elegida.filas), hojas: hojas.map((h) => h.nombre) };
  }
  const texto = decodificar(bytes);
  const pareceJson = /^\s*[[{]/.test(texto);
  if (formato === 'json' || (formato === 'auto' && pareceJson)) {
    let json;
    try {
      json = JSON.parse(texto);
    } catch {
      throw new Error('La respuesta no es un JSON válido.');
    }
    const lista = listaDeJson(json, rutaLista).filter((o) => o && typeof o === 'object').slice(0, 100000);
    return { campos: camposDeObjetos(lista), filas: lista };
  }
  return objetosDeTabla(leerCsv(texto));
}
