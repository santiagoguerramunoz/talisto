'use client';

import { useEffect } from 'react';
import Icon from './Icon';

export default function Modal({ abierto, onCerrar, titulo, children, pie }) {
  useEffect(() => {
    if (!abierto) return undefined;
    const tecla = (e) => {
      if (e.key === 'Escape') onCerrar?.();
    };
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', tecla);
    return () => {
      document.body.style.overflow = anterior;
      window.removeEventListener('keydown', tecla);
    };
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-[1500] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Cerrar" className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onCerrar} />
      <div className="relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl border border-navy-700 bg-navy-900 shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-navy-800 px-5 py-4">
          <h2 className="text-lg font-bold">{titulo}</h2>
          <button type="button" onClick={onCerrar} className="rounded-full p-2 text-tinta-400 hover:bg-navy-800 hover:text-tinta-100" aria-label="Cerrar">
            <Icon name="cerrar" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {pie && (
          <div className="border-t border-navy-800 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{pie}</div>
        )}
      </div>
    </div>
  );
}
