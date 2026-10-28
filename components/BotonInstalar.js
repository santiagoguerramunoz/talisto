'use client';

import { useEffect, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';

/**
 * Botón "Descargar app".
 * - Android / PC (Chrome, Edge): abre el instalador del navegador.
 * - iPhone / iPad: muestra cómo agregarla a la pantalla de inicio.
 * - Si ya está instalada, no se muestra.
 */
export default function BotonInstalar({ variante = 'boton', className = '' }) {
  const [estado, setEstado] = useState('cargando');
  const [ayuda, setAyuda] = useState(false);

  useEffect(() => {
    const instalada = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (instalada) {
      setEstado('instalada');
      return undefined;
    }
    const esIOS =
      /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
    const actualizar = () => setEstado(window.__talistoInstalar ? 'directo' : esIOS ? 'ios' : 'manual');
    actualizar();
    window.addEventListener('talisto-instalable', actualizar);
    return () => window.removeEventListener('talisto-instalable', actualizar);
  }, []);

  if (estado === 'cargando' || estado === 'instalada') return null;

  async function instalar() {
    const aviso = window.__talistoInstalar;
    if (!aviso) {
      setAyuda(true);
      return;
    }
    aviso.prompt();
    try {
      await aviso.userChoice;
    } catch {
      // el usuario cerró el aviso
    }
    window.__talistoInstalar = null;
    window.dispatchEvent(new Event('talisto-instalable'));
  }

  const boton = (
    <button type="button" onClick={instalar} className={`btn ${variante === 'tarjeta' ? 'btn-menta w-full' : 'btn-sec'} ${className}`}>
      <Icon name="descargar" /> Descargar app
    </button>
  );

  return (
    <>
      {variante === 'tarjeta' ? (
        <div className="tarjeta flex flex-col gap-3 p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-menta-500/15 text-menta-400">
              <Icon name="celular" />
            </span>
            <div>
              <p className="font-bold">TaListo! en tu celular</p>
              <p className="text-sm text-tinta-300">Se instala como una app, con ícono propio, y se actualiza sola.</p>
            </div>
          </div>
          {boton}
        </div>
      ) : (
        boton
      )}

      <Modal abierto={ayuda} onCerrar={() => setAyuda(false)} titulo="Instalar TaListo!">
        {estado === 'ios' ? (
          <ol className="space-y-3 text-sm text-tinta-300">
            <li><b className="text-tinta-100">1.</b> Abrí esta página en <b className="text-tinta-100">Safari</b>.</li>
            <li><b className="text-tinta-100">2.</b> Tocá el botón <b className="text-tinta-100">Compartir</b> (el cuadrado con la flecha hacia arriba).</li>
            <li><b className="text-tinta-100">3.</b> Elegí <b className="text-tinta-100">Agregar a inicio</b> y después <b className="text-tinta-100">Agregar</b>.</li>
          </ol>
        ) : (
          <ol className="space-y-3 text-sm text-tinta-300">
            <li><b className="text-tinta-100">1.</b> Abrí esta página en <b className="text-tinta-100">Chrome</b> o <b className="text-tinta-100">Edge</b>.</li>
            <li><b className="text-tinta-100">2.</b> Tocá el menú <b className="text-tinta-100">⋮</b> (arriba a la derecha).</li>
            <li><b className="text-tinta-100">3.</b> Elegí <b className="text-tinta-100">Instalar app</b> o <b className="text-tinta-100">Agregar a pantalla principal</b>.</li>
          </ol>
        )}
        <p className="mt-4 text-xs text-tinta-400">Queda con el ícono de TaListo! y abre sin la barra del navegador.</p>
      </Modal>
    </>
  );
}
