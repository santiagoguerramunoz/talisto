'use client';

import { useEffect, useState } from 'react';
import Icon from './Icon';
import { esVideo, urlsArchivos } from '@/lib/match';

/** Fotos y videos privados de una solicitud o reclamo (con enlace temporal) */
export default function ArchivosMatch({ rutas = [], tam = 'h-20 w-20' }) {
  const [urls, setUrls] = useState({});
  const clave = (rutas || []).join('|');
  useEffect(() => {
    if (!clave) return;
    urlsArchivos(clave.split('|')).then(setUrls).catch(() => setUrls({}));
  }, [clave]);
  if (!rutas?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {rutas.map((r) => (
        <a
          key={r}
          href={urls[r] || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className={`relative grid ${tam} place-items-center overflow-hidden rounded-xl border border-navy-700 bg-navy-850`}
          aria-label={esVideo(r) ? 'Ver video' : 'Ver foto'}
        >
          {esVideo(r) ? (
            <Icon name="video" className="h-6 w-6 text-tinta-300" />
          ) : urls[r] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urls[r]} alt="" className="h-full w-full object-cover" />
          ) : (
            <Icon name="foto" className="h-6 w-6 text-tinta-500" />
          )}
        </a>
      ))}
    </div>
  );
}
