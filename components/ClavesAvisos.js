'use client';

import { useState } from 'react';
import Icon from './Icon';

const b64u = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * Genera en este navegador las claves de las notificaciones push (VAPID).
 * No se guardan ni se mandan a ningún lado: se copian y se pegan en Vercel.
 */
export default function ClavesAvisos() {
  const [claves, setClaves] = useState(null);
  const [copiado, setCopiado] = useState('');
  const activas = !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  async function generar() {
    const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publica = await crypto.subtle.exportKey('raw', par.publicKey);
    const jwk = await crypto.subtle.exportKey('jwk', par.privateKey);
    setClaves({ publica: b64u(publica), privada: jwk.d });
    setCopiado('');
  }
  async function copiar(nombre, valor) {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(nombre);
    } catch {
      setCopiado('');
    }
  }

  return (
    <div className="tarjeta space-y-3 p-4">
      <p className="flex items-center gap-2 font-bold">
        <Icon name="campana" className="h-5 w-5 text-menta-300" /> Avisos al celular (push)
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${activas ? 'bg-menta-500/15 text-menta-300' : 'bg-amber-400/15 text-amber-300'}`}>
          {activas ? 'Activos' : 'Sin configurar'}
        </span>
      </p>
      <p className="text-sm text-tinta-300">
        Para que los avisos lleguen al celular con la app cerrada hacen falta dos claves. Se generan acá, en tu navegador (no se guardan en ningún lado), y las pegás en Vercel.
      </p>
      {activas && <p className="text-xs text-tinta-400">Ya están cargadas. Si generás claves nuevas, cada persona tiene que volver a activar los avisos en su celular.</p>}
      <button type="button" className="btn btn-sec w-full" onClick={generar}>
        <Icon name="ajustes" /> Generar claves
      </button>
      {claves && (
        <div className="space-y-2 text-sm">
          {[
            ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', claves.publica],
            ['VAPID_PRIVATE_KEY', claves.privada],
          ].map(([nombre, valor]) => (
            <div key={nombre} className="rounded-xl bg-navy-850 p-2.5">
              <p className="flex items-center justify-between gap-2">
                <b className="text-xs">{nombre}</b>
                <button type="button" className="chip" onClick={() => copiar(nombre, valor)}>
                  {copiado === nombre ? 'Copiada' : 'Copiar'}
                </button>
              </p>
              <p className="mt-1 break-all font-mono text-[11px] text-tinta-300">{valor}</p>
            </div>
          ))}
          <ol className="list-decimal space-y-1 pl-5 text-xs text-tinta-300">
            <li>En Vercel: proyecto talisto → Settings → Environment Variables.</li>
            <li>Agregá las dos con esos nombres (la privada no la compartas con nadie).</li>
            <li>Volvé a publicar (Deployments → Redeploy) o avisame y lo publico yo.</li>
            <li>Cada persona toca <b>Activar</b> en Avisos, en su celular.</li>
          </ol>
        </div>
      )}
    </div>
  );
}
