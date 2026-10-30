// PDF de la orden de compra para el proveedor.
import { numero } from './precios';
import { fechaUY } from './presupuestos';
import { importe, numeroOrden } from './proveedores';

const A4 = [595.28, 841.89];
const M = 42;
const hex = (rgb, h) => {
  const n = parseInt(h.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const esPng = (b) => b && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const esJpg = (b) => b && b[0] === 0xff && b[1] === 0xd8;

/** orden: fila de ordenes_compra · negocio: { nombre, razon_social, rut, telefono, email, direccion } · logo: bytes */
export async function crearPdfOrdenCompra({ orden, negocio, logo }) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  const C = {
    navy: hex(rgb, '#0b1730'),
    naranja: hex(rgb, '#ec8328'),
    texto: hex(rgb, '#1d2633'),
    gris: hex(rgb, '#6b7684'),
    linea: hex(rgb, '#d9dfe6'),
    fondo: hex(rgb, '#f3f6f9'),
    blanco: rgb(1, 1, 1),
  };

  const cache = new Map();
  const limpiar = (t, font = normal) =>
    Array.from(String(t ?? '').replace(/\t/g, ' ').replace(/\r/g, ''))
      .map((ch) => {
        if (ch === '\n') return ch;
        const k = `${font === negrita ? 'b' : 'n'}${ch}`;
        if (!cache.has(k)) {
          try {
            font.widthOfTextAtSize(ch, 10);
            cache.set(k, ch);
          } catch {
            cache.set(k, ch === '–' || ch === '—' ? '-' : ch === '“' || ch === '”' ? '"' : '');
          }
        }
        return cache.get(k);
      })
      .join('');
  const ancho = (t, f, s) => f.widthOfTextAtSize(t, s);
  function partir(t, font, size, max) {
    const lineas = [];
    limpiar(t, font)
      .split('\n')
      .forEach((par) => {
        let actual = '';
        par.split(/\s+/).forEach((pal) => {
          if (!pal) return;
          let p = pal;
          while (ancho(p, font, size) > max) {
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
          } else actual = prueba;
        });
        lineas.push(actual);
      });
    while (lineas.length > 1 && lineas[lineas.length - 1] === '') lineas.pop();
    return lineas.length ? lineas : [''];
  }

  const [W, H] = A4;
  let page = pdf.addPage(A4);
  const paginas = [page];
  let y = H - M;
  const texto = (t, x, yy, { font = normal, size = 10, color = C.texto, derecha = false } = {}) => {
    const l = limpiar(t, font);
    page.drawText(l, { x: derecha ? x - ancho(l, font, size) : x, y: yy, size, font, color });
  };
  const nuevaPagina = () => {
    page = pdf.addPage(A4);
    paginas.push(page);
    y = H - M;
  };

  // Encabezado: logo y datos del negocio
  let altoLogo = 0;
  if (logo && (esPng(logo) || esJpg(logo))) {
    try {
      const img = esPng(logo) ? await pdf.embedPng(logo) : await pdf.embedJpg(logo);
      const e = Math.min(150 / img.width, 64 / img.height, 1);
      page.drawImage(img, { x: M, y: y - img.height * e, width: img.width * e, height: img.height * e });
      altoLogo = img.height * e;
    } catch {
      altoLogo = 0;
    }
  }
  const datos = [negocio.razon_social, negocio.rut ? `RUT ${negocio.rut}` : '', negocio.telefono, negocio.email, negocio.direccion].filter(Boolean);
  let yn = y - 12;
  texto(negocio.nombre || '', W - M, yn, { font: negrita, size: 13, color: C.navy, derecha: true });
  datos.forEach((l) => {
    yn -= 12;
    texto(l, W - M, yn, { size: 9, color: C.gris, derecha: true });
  });
  y = Math.min(y - altoLogo, yn) - 16;
  page.drawRectangle({ x: M, y, width: W - 2 * M, height: 1, color: C.linea });
  page.drawRectangle({ x: M, y: y - 0.5, width: 60, height: 2.5, color: C.naranja });
  y -= 30;

  const num = `Nº ${numeroOrden(orden.numero)}`;
  texto('ORDEN DE COMPRA', M, y, { font: negrita, size: 20, color: C.navy });
  texto(num, W - M, y + 6, { font: negrita, size: 12, color: C.navy, derecha: true });
  texto(`Fecha: ${fechaUY(orden.fecha)}`, W - M, y - 8, { size: 9, color: C.gris, derecha: true });
  y -= 26;

  // Proveedor y entrega
  const pd = orden.proveedor_datos || {};
  const lineasProv = [pd.rut ? `RUT ${pd.rut}` : '', pd.contacto ? `Contacto: ${pd.contacto}` : '', [pd.telefono, pd.email].filter(Boolean).join(' · ')].filter(Boolean);
  const lineasEntrega = orden.entrega ? partir(`Entrega: ${orden.entrega}`, normal, 9.5, W - 2 * M - 24) : [];
  const alto = 34 + (lineasProv.length + lineasEntrega.length) * 13;
  page.drawRectangle({ x: M, y: y - alto, width: W - 2 * M, height: alto, color: C.fondo });
  texto('PROVEEDOR', M + 12, y - 14, { font: negrita, size: 7.5, color: C.gris });
  texto(orden.proveedor_nombre || '—', M + 12, y - 28, { font: negrita, size: 11.5, color: C.navy });
  [...lineasProv, ...lineasEntrega].forEach((l, i) => texto(l, M + 12, y - 42 - i * 13, { size: 9.5 }));
  y -= alto + 20;

  // Tabla
  const col = { cod: M + 10, cant: W - M - 200, unit: W - M - 95, imp: W - M - 10 };
  const xDesc = M + 90;
  const anchoDesc = col.cant - xDesc - 40;
  const encabezado = () => {
    page.drawRectangle({ x: M, y: y - 22, width: W - 2 * M, height: 22, color: C.navy });
    texto('Código', col.cod, y - 15, { font: negrita, size: 9, color: C.blanco });
    texto('Descripción', xDesc, y - 15, { font: negrita, size: 9, color: C.blanco });
    texto('Cant.', col.cant, y - 15, { font: negrita, size: 9, color: C.blanco, derecha: true });
    texto('Precio unit.', col.unit, y - 15, { font: negrita, size: 9, color: C.blanco, derecha: true });
    texto('Importe', col.imp, y - 15, { font: negrita, size: 9, color: C.blanco, derecha: true });
    y -= 22;
  };
  encabezado();
  const filas = (orden.items || []).filter((i) => String(i.item || '').trim());
  filas.forEach((f, i) => {
    const desc = f.unidad && f.unidad !== 'u' ? `${f.item} (${f.unidad})` : f.item;
    const lineas = partir(desc, normal, 9.5, anchoDesc);
    const altoFila = lineas.length * 12 + 10;
    if (y - altoFila < M + 30) {
      nuevaPagina();
      encabezado();
    }
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - altoFila, width: W - 2 * M, height: altoFila, color: C.fondo });
    const cant = numero(f.cantidad) ?? 0;
    const unit = numero(f.precio) ?? 0;
    texto(String(f.codigo || '').slice(0, 14), col.cod, y - 15, { size: 8.5, color: C.gris });
    lineas.forEach((l, k) => texto(l, xDesc, y - 15 - k * 12, { size: 9.5 }));
    texto(cant.toLocaleString('es-UY', { maximumFractionDigits: 2 }), col.cant, y - 15, { size: 9.5, derecha: true });
    texto(importe(unit, orden.moneda), col.unit, y - 15, { size: 9.5, derecha: true });
    texto(importe(Math.round(cant * unit * 100) / 100, orden.moneda), col.imp, y - 15, { font: negrita, size: 9.5, derecha: true });
    y -= altoFila;
  });
  page.drawRectangle({ x: M, y, width: W - 2 * M, height: 1, color: C.linea });
  y -= 26;

  if (y < M + 80) nuevaPagina();
  const xEt = W - M - 230;
  page.drawRectangle({ x: xEt - 10, y: y - 10, width: W - M - xEt + 10, height: 28, color: C.navy });
  texto(orden.iva_incluido ? 'TOTAL (IVA incluido)' : 'TOTAL (sin IVA)', xEt, y, { font: negrita, size: 10.5, color: C.blanco });
  texto(importe(orden.subtotal, orden.moneda), col.imp, y, { font: negrita, size: 12, color: C.blanco, derecha: true });
  y -= 40;

  if (orden.notas) {
    const lineas = partir(orden.notas, normal, 9, W - 2 * M);
    if (y - lineas.length * 12 - 20 < M + 20) nuevaPagina();
    texto('NOTAS', M, y, { font: negrita, size: 7.5, color: C.gris });
    y -= 14;
    lineas.forEach((l) => {
      if (y < M + 24) nuevaPagina();
      texto(l, M, y, { size: 9 });
      y -= 12;
    });
    y -= 6;
  }
  if (y < M + 40) nuevaPagina();
  texto('Por favor confirmen disponibilidad, precio y fecha de entrega.', M, y, { size: 9, color: C.gris });

  paginas.forEach((pg, i) => {
    page = pg;
    page.drawRectangle({ x: M, y: M - 6, width: W - 2 * M, height: 0.6, color: C.linea });
    texto(`Orden de compra ${num}${negocio.nombre ? ` · ${negocio.nombre}` : ''}`, M, M - 20, { size: 8, color: C.gris });
    texto(`Página ${i + 1} de ${paginas.length} · Hecho con TaListo!`, W - M, M - 20, { size: 8, color: C.gris, derecha: true });
  });
  pdf.setTitle(`Orden de compra ${num}`);
  pdf.setAuthor(negocio.nombre || 'TaListo!');
  pdf.setCreator('TaListo!');
  pdf.setProducer('TaListo!');
  return pdf.save();
}

export function nombreArchivoOrden(o) {
  const prov = String(o.proveedor_nombre || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `Orden-de-compra-${numeroOrden(o.numero)}${prov ? `-${prov}` : ''}.pdf`;
}
