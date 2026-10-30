// Solo para el servidor: notificaciones push (Web Push con claves VAPID, cifrado aes128gcm, RFC 8291 y 8292).
// No usa librerías externas: todo con el módulo crypto de Node.
import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const desdeB64u = (s) => Buffer.from(String(s || '').trim().replace(/=+$/, ''), 'base64url');

// Solo se mandan avisos a los servicios de push de los navegadores (Google, Apple, Mozilla, Microsoft)
export const ENDPOINT_PUSH =
  /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)\//;

/**
 * Claves cargadas en Vercel:
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY (la pública, 65 bytes en base64url)
 *   VAPID_PRIVATE_KEY (la privada, 32 bytes en base64url)
 * Se generan desde /admin → Avisos al celular.
 */
export function clavesVapid() {
  const pub = desdeB64u(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  const d = desdeB64u(process.env.VAPID_PRIVATE_KEY);
  if (pub.length !== 65 || pub[0] !== 4 || d.length !== 32) return null;
  try {
    const key = crypto.createPrivateKey({
      key: { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
      format: 'jwk',
    });
    return { publica: b64u(pub), key, sujeto: process.env.VAPID_SUBJECT || 'https://talisto-ashen.vercel.app' };
  } catch {
    return null;
  }
}

/** Firma VAPID para el servicio de push (válida 12 horas) */
export function jwtVapid(audiencia, vapid) {
  const parte = (o) => b64u(Buffer.from(JSON.stringify(o)));
  const datos = `${parte({ typ: 'JWT', alg: 'ES256' })}.${parte({ aud: audiencia, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: vapid.sujeto })}`;
  const firma = crypto.sign('sha256', Buffer.from(datos), { key: vapid.key, dsaEncoding: 'ieee-p1363' });
  return `${datos}.${b64u(firma)}`;
}

/** Cifra el contenido para un dispositivo (aes128gcm, un solo registro) */
export function cifrar(texto, p256dh, authSecreto) {
  const uaPublica = desdeB64u(p256dh);
  const auth = desdeB64u(authSecreto);
  if (uaPublica.length !== 65 || auth.length < 16) throw new Error('Suscripción no válida');
  const ecdh = crypto.createECDH('prime256v1');
  const asPublica = ecdh.generateKeys();
  const secreto = ecdh.computeSecret(uaPublica);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublica, asPublica]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secreto, auth, info, 32));
  const sal = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, sal, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, sal, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cifrador = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const plano = Buffer.concat([Buffer.from(texto, 'utf8'), Buffer.from([2])]);
  const cifrado = Buffer.concat([cifrador.update(plano), cifrador.final(), cifrador.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([sal, rs, Buffer.from([asPublica.length]), asPublica, cifrado]);
}

/** Manda un aviso a un dispositivo. borrar: el dispositivo ya no existe (hay que quitarlo) */
export async function enviarPush(sub, datos, vapid) {
  if (!ENDPOINT_PUSH.test(String(sub?.endpoint || ''))) return { ok: false, status: 0, borrar: true };
  const destino = new URL(sub.endpoint);
  let cuerpo;
  try {
    cuerpo = cifrar(JSON.stringify(datos).slice(0, 3000), sub.p256dh, sub.auth);
  } catch {
    return { ok: false, status: 0, borrar: true };
  }
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'high',
        Authorization: `vapid t=${jwtVapid(destino.origin, vapid)}, k=${vapid.publica}`,
      },
      body: cuerpo,
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, borrar: r.status === 404 || r.status === 410 };
  } catch {
    return { ok: false, status: 0, borrar: false };
  }
}
