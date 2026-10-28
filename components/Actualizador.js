'use client';

import { useEffect, useState } from 'react';

const VERSION = process.env.NEXT_PUBLIC_VERSION || 'dev';
const CADA_MS = 5 * 60 * 1000;

/**
 * Va en el layout raíz:
 * - registra el service worker (necesario para instalar la app),
 * - guarda el aviso de instalación del navegador para el botón "Descargar app",
 * - detecta cuando hay una versión nueva publicada y la carga sola.
 */
export default function Actualizador() {
  const [hayNueva, setHayNueva] = useState(false);

  useEffect(() => {
    const alPoderInstalar = (e) => {
      e.preventDefault();
      window.__talistoInstalar = e;
      window.dispatchEvent(new Event('talisto-instalable'));
    };
    const alInstalar = () => {
      window.__talistoInstalar = null;
      window.dispatchEvent(new Event('talisto-instalable'));
    };
    window.addEventListener('beforeinstallprompt', alPoderInstalar);
    window.addEventListener('appinstalled', alInstalar);

    let registro = null;
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((r) => {
          registro = r;
        })
        .catch(() => {});
    }

    let revisando = false;
    async function revisar(alVolver) {
      if (revisando || VERSION === 'dev') return;
      revisando = true;
      try {
        registro?.update().catch(() => {});
        const r = await fetch('/api/version', { cache: 'no-store' });
        const { version } = await r.json();
        if (version && version !== 'dev' && version !== VERSION) {
          // Al volver a la app se recarga sola, salvo que haya un formulario abierto
          const formularioAbierto = document.querySelector('[role="dialog"]');
          if (alVolver && !formularioAbierto) window.location.reload();
          else setHayNueva(true);
        }
      } catch {
        // sin conexión: se vuelve a intentar más tarde
      }
      revisando = false;
    }

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'visible') revisar(true);
    };
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    const intervalo = setInterval(() => {
      if (document.visibilityState === 'visible') revisar(false);
    }, CADA_MS);

    return () => {
      window.removeEventListener('beforeinstallprompt', alPoderInstalar);
      window.removeEventListener('appinstalled', alInstalar);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      clearInterval(intervalo);
    };
  }, []);

  if (!hayNueva) return null;

  return (
    <div className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[2000] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-menta-500/40 bg-navy-900 px-4 py-3 shadow-2xl">
      <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-menta-400" />
      <p className="flex-1 text-sm font-semibold">Hay una versión nueva de TaListo!</p>
      <button onClick={() => window.location.reload()} className="btn btn-menta px-3 py-1.5 text-sm">
        Actualizar
      </button>
    </div>
  );
}
