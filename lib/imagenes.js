'use client';

// Achica las fotos del celular (que pueden pesar 5-10 MB) antes de subirlas:
// lado mayor 1600 px, JPEG calidad 0,8 → suelen quedar en 200-500 KB.
export async function comprimirImagen(archivo, ladoMaximo = 1600, calidad = 0.8) {
  try {
    const bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);
    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    lienzo.getContext('2d').drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close?.();
    const blob = await new Promise((resolver) => lienzo.toBlob(resolver, 'image/jpeg', calidad));
    return blob || archivo;
  } catch {
    // Si el navegador no puede procesarla, se sube tal cual
    return archivo;
  }
}

// Logo para los presupuestos: PNG (mantiene la transparencia), máximo 600 px
export async function prepararLogo(archivo, maximo = 600) {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = mal;
      i.src = url;
    });
    const escala = Math.min(1, maximo / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((ok) => canvas.toBlob((b) => ok(b), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
