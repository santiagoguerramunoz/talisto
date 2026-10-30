// PDF del presupuesto para el cliente: solo precios finales, subtotal, IVA y total.
// Costos, márgenes y proveedores nunca salen acá.
import { dinero, importeLinea, monedaLinea, numero, totalesMonedas } from './precios';
import { fechaUY, numeroPresupuesto, sumarDiasISO } from './presupuestos';

const A4 = [595.28, 841.89];
const M = 42;

const hex = (rgb, h) => {
  const n = parseInt(h.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const esPng = (b) => b && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const esJpg = (b) => b && b[0] === 0xff && b[1] === 0xd8;

/**
 * presupuesto: fila (o formulario) con items, mano_obra, iva_porcentaje, etc.
 * negocio: { nombre, razon_social, rut, telefono, email, direccion }
 * logo: Uint8Array (PNG o JPG) opcional
 */
export async function crearPdfPresupuesto({ presupuesto, negocio, logo }) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);

  const C = {
    navy: hex(rgb, '#0b1730'),
    azul: hex(rgb, '#176ba8'),
    naranja: hex(rgb, '#ec8328'),
    texto: hex(rgb, '#1d2633'),
    gris: hex(rgb, '#6b7684'),
    linea: hex(rgb, '#d9dfe6'),
    fondo: hex(rgb, '#f3f6f9'),
    blanco: rgb(1, 1, 1),
  };

  // La fuente estándar no tiene todos los caracteres: se reemplazan los que no puede escribir
  const cache = new Map();
  const limpiar = (texto, font = normal) =>
    Array.from(String(texto ?? '').replace(/\t/g, ' ').replace(/\r/g, ''))
      .map((ch) => {
        if (ch === '\n') return ch;
        const clave = `${font === negrita ? 'b' : 'n'}${ch}`;
        if (!cache.has(clave)) {
          try {
            font.widthOfTextAtSize(ch, 10);
            cache.set(clave, ch);
          } catch {
            cache.set(clave, ch === '–' || ch === '—' ? '-' : ch === '“' || ch === '”' ? '"' : ch === '²' ? '2' : ch === '³' ? '3' : '');
          }
        }
        return cache.get(clave);
      })
      .join('');

  const ancho = (t, font, size) => font.widthOfTextAtSize(t, size);

  function partir(texto, font, size, max) {
    const lineas = [];
    limpiar(texto, font)
      .split('\n')
      .forEach((parrafo) => {
        let actual = '';
        parrafo.split(/\s+/).forEach((palabra) => {
          if (!palabra) return;
          let p = palabra;
          while (ancho(p, font, size) > max) {
            // palabra muy larga: se corta
            let i = p.length;
            while (i > 1 && ancho(p.slice(0, i), font, size) > max) i -= 1;
            if (actual) {
              lineas.push(actual);
              actual = '';
            }
            lineas.push(p.slice(0, i));
            p = p.slice(i);
          }
          const prueba = actual ? `${actual} ${p}` : p;
          if (ancho(prueba, font, size) > max && actual) {
            lineas.push(actual);
            actual = p;
          } else {
            actual = prueba;
          }
        });
        lineas.push(actual);
      });
    while (lineas.length > 1 && lineas[lineas.length - 1] === '') lineas.pop();
    return lineas.length ? lineas : [''];
  }

  const [W, H] = A4;
  let page = pdf.addPage(A4);
  let y = H - M;
  const paginas = [page];

  const texto = (t, x, yy, { font = normal, size = 10, color = C.texto, derecha = false } = {}) => {
    const limpio = limpiar(t, font);
    const xx = derecha ? x - ancho(limpio, font, size) : x;
    page.drawText(limpio, { x: xx, y: yy, size, font, color });
  };

  function nuevaPagina() {
    page = pdf.addPage(A4);
    paginas.push(page);
    y = H - M;
  }

  // ---------------- Encabezado: logo + datos del negocio
  const p = presupuesto;
  const numeroTxt = `Nº ${numeroPresupuesto(p.numero)}`;
  let altoLogo = 0;
  if (logo && (esPng(logo) || esJpg(logo))) {
    try {
      const img = esPng(logo) ? await pdf.embedPng(logo) : await pdf.embedJpg(logo);
      const escala = Math.min(150 / img.width, 64 / img.height, 1);
      const w = img.width * escala;
      const h = img.height * escala;
      page.drawImage(img, { x: M, y: y - h, width: w, height: h });
      altoLogo = h;
    } catch {
      altoLogo = 0;
    }
  }
  const lineasNegocio = [negocio.razon_social, negocio.rut ? `RUT ${negocio.rut}` : '', negocio.telefono, negocio.email, negocio.direccion].filter(Boolean);
  let yn = y - 12;
  texto(negocio.nombre || '', W - M, yn, { font: negrita, size: 13, color: C.navy, derecha: true });
  lineasNegocio.forEach((l) => {
    yn -= 12;
    texto(l, W - M, yn, { size: 9, color: C.gris, derecha: true });
  });
  y = Math.min(y - altoLogo, yn) - 16;
  page.drawRectangle({ x: M, y, width: W - 2 * M, height: 1, color: C.linea });
  page.drawRectangle({ x: M, y: y - 0.5, width: 60, height: 2.5, color: C.naranja });
  y -= 30;

  // ---------------- Título
  texto('PRESUPUESTO', M, y, { font: negrita, size: 20, color: C.navy });
  texto(numeroTxt, W - M, y + 6, { font: negrita, size: 12, color: C.navy, derecha: true });
  const hasta = sumarDiasISO(p.fecha, p.validez_dias);
  texto(`Fecha: ${fechaUY(p.fecha)}   ·   Válido hasta: ${fechaUY(hasta)}`, W - M, y - 8, { size: 9, color: C.gris, derecha: true });
  y -= 26;

  // ---------------- Cliente
  const lineasCliente = [];
  if (p.cliente_direccion) lineasCliente.push(...partir(`Dirección: ${p.cliente_direccion}`, normal, 9.5, W - 2 * M - 24));
  if (p.titulo) lineasCliente.push(...partir(`Trabajo: ${p.titulo}`, normal, 9.5, W - 2 * M - 24));
  const altoCliente = 34 + lineasCliente.length * 13;
  page.drawRectangle({ x: M, y: y - altoCliente, width: W - 2 * M, height: altoCliente, color: C.fondo });
  texto('CLIENTE', M + 12, y - 14, { font: negrita, size: 7.5, color: C.gris });
  texto(p.cliente_nombre || '—', M + 12, y - 28, { font: negrita, size: 11.5, color: C.navy });
  lineasCliente.forEach((l, i) => texto(l, M + 12, y - 42 - i * 13, { size: 9.5 }));
  y -= altoCliente + 20;

  // ---------------- Tabla (en los mixtos: una columna de importes en dólares y otra en pesos)
  const moneda = p.moneda || 'UYU';
  const tm = totalesMonedas(p);
  const dos = tm.usaUSD && tm.usaUYU;
  const monedas = dos ? ['USD', 'UYU'] : [tm.usaUSD ? 'USD' : 'UYU'];
  const col = dos
    ? { cant: W - M - 270, unit: W - M - 185, USD: W - M - 95, UYU: W - M - 10, imp: W - M - 10 }
    : { cant: W - M - 230, unit: W - M - 105, imp: W - M - 10 };
  if (!dos) col[monedas[0]] = col.imp;
  const anchoDesc = col.cant - M - 50;
  const encabezadoTabla = () => {
    page.drawRectangle({ x: M, y: y - 22, width: W - 2 * M, height: 22, color: C.navy });
    texto('Descripción', M + 10, y - 15, { font: negrita, size: 9, color: C.blanco });
    texto('Cant.', col.cant, y - 15, { font: negrita, size: 9, color: C.blanco, derecha: true });
    texto('Precio unit.', col.unit, y - 15, { font: negrita, size: 9, color: C.blanco, derecha: true });
    if (dos) {
      texto('Importe US$', col.USD, y - 15, { font: negrita, size: 9, color: C.blanco, derecha: true });
      texto('Importe $', col.UYU, y - 15, { font: negrita, size: 9, color: C.blanco, derecha: true });
    } else texto(`Importe${monedas[0] === 'USD' ? ' US$' : ''}`, col.imp, y - 15, { font: negrita, size: 9, color: C.blanco, derecha: true });
    y -= 22;
  };
  encabezadoTabla();

  const filas = (p.items || [])
    .filter((m) => String(m.item || '').trim())
    .map((m) => ({
      desc: m.unidad && m.unidad !== 'u' ? `${m.item} (${m.unidad})` : m.item,
      cant: numero(m.cantidad) ?? 0,
      unit: numero(m.precio) ?? 0,
      imp: importeLinea(m),
      mon: monedaLinea(m, moneda),
    }));
  const monedaMO = moneda === 'mixto' ? (p.mano_obra_moneda === 'USD' ? 'USD' : 'UYU') : moneda === 'USD' ? 'USD' : 'UYU';
  const manoObra = numero(p.mano_obra) ?? 0;
  if (manoObra > 0) filas.push({ desc: p.mano_obra_texto || 'Mano de obra', cant: 1, unit: manoObra, imp: manoObra, mon: monedaMO });

  filas.forEach((f, i) => {
    const lineas = partir(f.desc, normal, 9.5, anchoDesc);
    const alto = lineas.length * 12 + 10;
    if (y - alto < M + 30) {
      nuevaPagina();
      encabezadoTabla();
    }
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - alto, width: W - 2 * M, height: alto, color: C.fondo });
    lineas.forEach((l, k) => texto(l, M + 10, y - 15 - k * 12, { size: 9.5 }));
    texto(Number(f.cant).toLocaleString('es-UY', { maximumFractionDigits: 2 }), col.cant, y - 15, { size: 9.5, derecha: true });
    texto(dinero(f.unit, f.mon), col.unit, y - 15, { size: 9.5, derecha: true });
    texto(dinero(f.imp, f.mon), col[f.mon] ?? col.imp, y - 15, { font: negrita, size: 9.5, derecha: true });
    y -= alto;
  });
  if (!filas.length) {
    texto('Sin ítems', M + 10, y - 15, { size: 9.5, color: C.gris });
    y -= 24;
  }
  page.drawRectangle({ x: M, y, width: W - 2 * M, height: 1, color: C.linea });
  y -= 18;

  // ---------------- Totales
  if (y < M + 130) nuevaPagina();
  const xEtiqueta = dos ? W - M - 300 : W - M - 230;
  const filaTotal = (etiqueta, campo) => {
    texto(etiqueta, xEtiqueta, y, { size: 10, color: C.gris });
    monedas.forEach((k) => texto(dinero(tm[k][campo], k), col[k], y, { size: 10, derecha: true }));
    y -= 16;
  };
  filaTotal('Subtotal', 'subtotal');
  filaTotal(`IVA ${Number(p.iva_porcentaje ?? 0).toLocaleString('es-UY')}%`, 'iva');
  y -= 4;
  page.drawRectangle({ x: xEtiqueta - 10, y: y - 10, width: W - M - xEtiqueta + 10, height: 28, color: C.navy });
  texto('TOTAL (IVA incluido)', xEtiqueta, y, { font: negrita, size: 10.5, color: C.blanco });
  monedas.forEach((k) => texto(dinero(tm[k].total, k), col[k], y, { font: negrita, size: 12, color: C.blanco, derecha: true }));
  y -= 26;
  if (moneda !== 'UYU' && tm.cotizacion > 0) {
    const eq = `${dos ? 'Se cobran los dos importes. Todo junto equivale' : 'Equivale'} a ${dinero(tm.equivalente.total, 'UYU')} con el dólar a ${dinero(tm.cotizacion, 'UYU')}.`;
    texto(eq, W - M, y, { size: 8.5, color: C.gris, derecha: true });
    y -= 14;
  }
  y -= 14;

  // ---------------- Condiciones
  if (p.notas) {
    const lineas = partir(p.notas, normal, 9, W - 2 * M);
    if (y - lineas.length * 12 - 20 < M + 20) nuevaPagina();
    texto('CONDICIONES', M, y, { font: negrita, size: 7.5, color: C.gris });
    y -= 14;
    lineas.forEach((l) => {
      if (y < M + 24) nuevaPagina();
      texto(l, M, y, { size: 9 });
      y -= 12;
    });
  }

  // ---------------- Pie en cada página
  paginas.forEach((pg, i) => {
    page = pg;
    page.drawRectangle({ x: M, y: M - 6, width: W - 2 * M, height: 0.6, color: C.linea });
    texto(`Presupuesto ${numeroTxt}${negocio.nombre ? ` · ${negocio.nombre}` : ''}`, M, M - 20, { size: 8, color: C.gris });
    texto(`Página ${i + 1} de ${paginas.length} · Hecho con TaListo!`, W - M, M - 20, { size: 8, color: C.gris, derecha: true });
  });

  pdf.setTitle(`Presupuesto ${numeroTxt}`);
  pdf.setAuthor(negocio.nombre || 'TaListo!');
  pdf.setCreator('TaListo!');
  pdf.setProducer('TaListo!');
  return pdf.save();
}

export function nombreArchivoPresupuesto(p) {
  const cliente = String(p.cliente_nombre || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `Presupuesto-${numeroPresupuesto(p.numero)}${cliente ? `-${cliente}` : ''}.pdf`;
}
