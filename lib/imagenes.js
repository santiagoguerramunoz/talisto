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
