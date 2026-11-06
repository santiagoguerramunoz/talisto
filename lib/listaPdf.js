// Parte un PDF en tandas de pocas páginas para leerlo con IA de a una (en el navegador).
// pdf-lib se carga solo cuando hace falta.

export async function abrirPdf(archivo) {
  const { PDFDocument } = await import('pdf-lib');
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return { doc, paginas: doc.getPageCount() };
  } catch {
    throw new Error('No pudimos abrir este PDF. Si tiene contraseña, sacásela o mandá fotos de la lista.');
  }
}

// Un PDF nuevo con las páginas desde..hasta (contando desde 1)
export async function pdfDePaginas(doc, desde, hasta) {
  const { PDFDocument } = await import('pdf-lib');
  const nuevo = await PDFDocument.create();
  const indices = Array.from({ length: hasta - desde + 1 }, (_, i) => desde - 1 + i);
  const copias = await nuevo.copyPages(doc, indices);
  copias.forEach((p) => nuevo.addPage(p));
  return nuevo.save({ useObjectStreams: true });
}

// Tandas de porTanda páginas: [{ desde, hasta }]
export function tandasDe(paginas, porTanda = 2) {
  const lista = [];
  for (let i = 1; i <= paginas; i += porTanda) lista.push({ desde: i, hasta: Math.min(paginas, i + porTanda - 1) });
  return lista;
}

export function aBase64(datos) {
  const blob = datos instanceof Blob ? datos : new Blob([datos]);
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = mal;
    r.readAsDataURL(blob);
  });
}
