// Remito de stock (entregas, materiales a trabajos y devoluciones): PDF con número único para imprimir, bajar o mandar.
import { cant, numeroMov, textoRenglon, tituloMov } from './stock';

const A4 = [595.28, 841.89];
const M = 42;
const hex = (rgb, h) => {
  const n = parseInt(h.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const esPng = (b) => b && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const esJpg = (b) => b && b[0] === 0xff && b[1] === 0xd8;

export const numeroRemito = (n) => String(n || 0).padStart(6, '0');
export const TIENE_REMITO = ['transferencia', 'a_trabajo', 'devolucion', 'devolucion_proveedor'];

const fechaLarga = (iso) =>
  iso ? new Date(iso).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

const LUGAR = { deposito: 'Depósito', operario: 'Persona del equipo', trabajo: 'Trabajo', proveedor: 'Proveedor' };

/** Baja el logo del negocio (si no se puede, el remito sale igual sin logo) */
export async function bajarLogo(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** mov: comprobante (stock_comprobante) · negocio: { nombre, razon_social, rut, telefono, email, direccion } · logo: bytes */
export async function crearPdfRemito({ mov, negocio = {}, logo }) {
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
    rojo: hex(rgb, '#c0392b'),
    ambar: hex(rgb, '#b7791f'),
    verde: hex(rgb, '#1f8a5b'),
    blanco: rgb(1, 1, 1),
  };

  const cache = new Map();
  const limpiar = (t, font = normal) =>
    Array.from(String(t ?? '').replace(/\t/g, ' ').replace(/\r/g, '').replace(/→/g, '>'))
      .map((ch) => {
        if (ch === '\n') return ch;
        const k = `${font === negrita ? 'b' : 'n'}${ch}`;
        if (!cache.has(k)) {
          try {
            font.widthOfTextAtSize(ch, 10);
            cache.set(k, ch);
          } catch {
            cache.set(k, ch === '–' || ch === '—' ? '-' : ch === '“' || ch === '”' ? '"' : ch === '×' ? 'x' : ch === '²' ? '2' : ch === '³' ? '3' : '');
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

  const num = `Nº ${numeroRemito(mov.remito)}`;
  texto('REMITO', M, y, { font: negrita, size: 22, color: C.navy });
  texto(tituloMov(mov), M, y - 16, { size: 10, color: C.gris });
  texto(num, W - M, y + 6, { font: negrita, size: 14, color: C.navy, derecha: true });
  texto(`Fecha: ${fechaLarga(mov.creado_en)}`, W - M, y - 9, { size: 9, color: C.gris, derecha: true });
  texto(`Comprobante interno ${numeroMov(mov.numero)}`, W - M, y - 21, { size: 9, color: C.gris, derecha: true });
  y -= 40;

  // Estado (si no está cerrado normalmente, se avisa bien grande)
  const anulado = !!mov.anulado_por;
  const estadoTxt = anulado
    ? `ANULADO por el comprobante ${numeroMov(mov.anulado_numero)}`
    : mov.estado === 'pendiente'
      ? 'EN CAMINO: falta que quien recibe lo confirme'
      : mov.estado === 'rechazado'
        ? 'RECHAZADO: volvió al origen'
        : mov.estado === 'cancelado'
          ? 'CANCELADO: volvió al origen'
          : '';
  if (estadoTxt) {
    const col = anulado || mov.estado === 'rechazado' || mov.estado === 'cancelado' ? C.rojo : C.ambar;
    page.drawRectangle({ x: M, y: y - 8, width: W - 2 * M, height: 24, borderColor: col, borderWidth: 1.2, color: C.blanco });
    texto(estadoTxt, M + 10, y, { font: negrita, size: 10.5, color: col });
    y -= 34;
  }

  // Desde / hacia
  const caja = (titulo, nombre, tipo, x, ancho2) => {
    page.drawRectangle({ x, y: y - 52, width: ancho2, height: 52, color: C.fondo });
    texto(titulo, x + 12, y - 14, { font: negrita, size: 7.5, color: C.gris });
    const lineas = partir(nombre || '-', negrita, 11, ancho2 - 24).slice(0, 1);
    texto(lineas[0], x + 12, y - 29, { font: negrita, size: 11, color: C.navy });
    if (tipo) texto(tipo, x + 12, y - 43, { size: 8.5, color: C.gris });
  };
  const mitad = (W - 2 * M - 12) / 2;
  const hacia = mov.tipo === 'devolucion_proveedor' ? mov.proveedor || 'Proveedor' : mov.destino;
  const haciaTipo = mov.tipo === 'devolucion_proveedor' ? LUGAR.proveedor : LUGAR[mov.destino_tipo];
  caja('SALE DE', mov.origen, LUGAR[mov.origen_tipo], M, mitad);
  caja('VA A', hacia, haciaTipo, M + mitad + 12, mitad);
  y -= 66;

  const extras = [
    mov.motivo && (mov.tipo === 'devolucion' || mov.tipo === 'devolucion_proveedor') ? `Motivo: ${mov.motivoTexto || mov.motivo}` : '',
    mov.referencia ? `Referencia: ${mov.referencia}` : '',
    mov.por ? `Emitido por: ${mov.por}` : '',
  ].filter(Boolean);
  extras.forEach((l) => {
    texto(l, M, y, { size: 9.5 });
    y -= 13;
  });
  if (extras.length) y -= 6;

  // Tabla de materiales
  const items = mov.items || [];
  const conRecibido = items.some((i) => i.recibido !== null && i.recibido !== undefined && Number(i.recibido) !== Number(i.cantidad));
  const col = { n: M + 10, cod: M + 32, desc: M + 112, cant: conRecibido ? W - M - 110 : W - M - 10, rec: W - M - 10 };
  const anchoDesc = col.cant - col.desc - 150;
  const encabezado = () => {
    page.drawRectangle({ x: M, y: y - 22, width: W - 2 * M, height: 22, color: C.navy });
    texto('#', col.n, y - 15, { font: negrita, size: 9, color: C.blanco });
    texto('Código', col.cod, y - 15, { font: negrita, size: 9, color: C.blanco });
    texto('Material', col.desc, y - 15, { font: negrita, size: 9, color: C.blanco });
    texto('Cantidad', col.cant, y - 15, { font: negrita, size: 9, color: C.blanco, derecha: true });
    if (conRecibido) texto('Recibido', col.rec, y - 15, { font: negrita, size: 9, color: C.blanco, derecha: true });
    y -= 22;
  };
  encabezado();
  items.forEach((i, k) => {
    const desc = [i.nombre, i.marca].filter(Boolean).join(' · ');
    const lineas = partir(desc, normal, 9.5, anchoDesc);
    const altoFila = lineas.length * 12 + 10;
    if (y - altoFila < M + 40) {
      nuevaPagina();
      encabezado();
    }
    if (k % 2 === 1) page.drawRectangle({ x: M, y: y - altoFila, width: W - 2 * M, height: altoFila, color: C.fondo });
    texto(String(k + 1), col.n, y - 15, { size: 8.5, color: C.gris });
    texto(String(i.codigo || '').slice(0, 14), col.cod, y - 15, { size: 8.5, color: C.gris });
    lineas.forEach((l, j) => texto(l, col.desc, y - 15 - j * 12, { size: 9.5 }));
    texto(textoRenglon(i), col.cant, y - 15, { font: negrita, size: 9.5, derecha: true });
    if (conRecibido) {
      const r = i.recibido !== null && i.recibido !== undefined ? `${cant(i.recibido, i.decimales ?? 3)} ${i.unidad || 'u'}` : '-';
      texto(r, col.rec, y - 15, { size: 9.5, derecha: true, color: Number(i.recibido) !== Number(i.cantidad) ? C.ambar : C.texto });
    }
    y -= altoFila;
  });
  page.drawRectangle({ x: M, y, width: W - 2 * M, height: 1, color: C.linea });
  y -= 16;
  texto(`${items.length} ${items.length === 1 ? 'renglón' : 'renglones'}`, M, y, { size: 8.5, color: C.gris });
  y -= 22;

  const notas = [mov.nota ? `Nota: ${mov.nota}` : '', mov.respuesta ? `Respuesta de quien recibió: ${mov.respuesta}` : ''].filter(Boolean);
  notas.forEach((n) => {
    const lineas = partir(n, normal, 9, W - 2 * M);
    if (y - lineas.length * 12 < M + 120) nuevaPagina();
    lineas.forEach((l) => {
      texto(l, M, y, { size: 9 });
      y -= 12;
    });
    y -= 4;
  });

  // Firmas
  if (y < M + 120) nuevaPagina();
  y -= 30;
  const firma = (titulo, nombre, cuando, x) => {
    page.drawRectangle({ x, y, width: mitad, height: 0.8, color: C.texto });
    texto(titulo, x, y - 13, { font: negrita, size: 9 });
    texto(nombre ? `Aclaración: ${nombre}` : 'Aclaración:', x, y - 26, { size: 8.5, color: C.gris });
    if (cuando) texto(cuando, x, y - 38, { size: 8.5, color: C.gris });
  };
  const confirmado = mov.estado === 'hecho' && mov.respondido_por;
  firma('Entregó', mov.por || '', '', M);
  firma('Recibió', confirmado ? mov.respondido_por : '', confirmado && mov.respondido_en ? `Confirmado en TaListo! el ${fechaLarga(mov.respondido_en)}` : '', M + mitad + 12);
  y -= 56;

  if (mov.huella) {
    if (y < M + 30) nuevaPagina();
    texto(`Sello de integridad: ${mov.huella.slice(0, 32)}`, M, y, { size: 7.5, color: C.gris });
    y -= 11;
    texto('Este remito sale del registro de stock de la empresa: no se puede modificar, solo anular con otro comprobante.', M, y, { size: 7.5, color: C.gris });
  }

  paginas.forEach((pg, i) => {
    page = pg;
    page.drawRectangle({ x: M, y: M - 6, width: W - 2 * M, height: 0.6, color: C.linea });
    texto(`Remito ${num}${negocio.nombre ? ` · ${negocio.nombre} · Sector stock` : ''}`, M, M - 20, { size: 8, color: C.gris });
    texto(`Página ${i + 1} de ${paginas.length} · Hecho con TaListo!`, W - M, M - 20, { size: 8, color: C.gris, derecha: true });
  });
  pdf.setTitle(`Remito ${num}`);
  pdf.setAuthor(negocio.nombre || 'TaListo!');
  pdf.setCreator('TaListo!');
  pdf.setProducer('TaListo!');
  return pdf.save();
}

export const nombreArchivoRemito = (mov) => `Remito-${numeroRemito(mov.remito)}.pdf`;
