// Web Push sin dependencias: cifrado aes128gcm (RFC 8291 / RFC 8188) y firma VAPID (RFC 8292) con node:crypto.
// Va sin paquetes de npm a propósito: este código corre en GitHub Actions con la clave privada a mano.

import { createECDH, createPrivateKey, sign, randomBytes, createCipheriv, hkdfSync } from 'node:crypto';

export const b64u = buf => Buffer.from(buf).toString('base64url');
export const unb64u = s => Buffer.from(String(s), 'base64url');
const pad32 = buf => (buf.length >= 32 ? buf : Buffer.concat([Buffer.alloc(32 - buf.length), buf]));

/** Par de claves VAPID: pública (65 bytes, sin comprimir) y privada (32 bytes), en base64url. */
export function generateVapidKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(pad32(ecdh.getPrivateKey())) };
}

export function publicFromPrivate(privateKey) {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(unb64u(privateKey));
  return b64u(ecdh.getPublicKey());
}

/** Cabecera Authorization de VAPID para el servicio de push de ese endpoint. */
export function vapidAuth(endpoint, subject, privateKey, now = Date.now()) {
  const pub = unb64u(publicFromPrivate(privateKey));
  const key = createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', d: b64u(pad32(unb64u(privateKey))), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
  });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${b64u(pub)}`;
}

/** Cifra el mensaje para una suscripción (claves p256dh y auth del navegador). Devuelve el cuerpo del POST. */
export function encrypt(payload, p256dh, auth, { salt = randomBytes(16), localPrivateKey } = {}) {
  const ua = unb64u(p256dh), authSecret = unb64u(auth);
  if (ua.length !== 65 || authSecret.length !== 16) throw new Error('Suscripción con claves inválidas');
  const ecdh = createECDH('prime256v1');
  if (localPrivateKey) ecdh.setPrivateKey(localPrivateKey); else ecdh.generateKeys();
  const as = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(ua);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]); // 0x02 = último registro
  if (plain.length + 16 > 4096) throw new Error('Mensaje demasiado largo para un push');
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = as.length;
  return Buffer.concat([header, as, body]);
}

/**
 * Envía un push. `sub` = { endpoint, keys: { p256dh, auth } }.
 * Devuelve { ok, status, gone, detail }. `gone`: la suscripción ya no existe y hay que borrarla.
 */
export async function sendPush(sub, payload, { privateKey, subject, ttl = 12 * 3600, topic, urgency = 'normal' }) {
  const url = new URL(sub.endpoint);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('Endpoint de push inválido');
  const body = encrypt(typeof payload === 'string' ? payload : JSON.stringify(payload), sub.keys.p256dh, sub.keys.auth);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: vapidAuth(sub.endpoint, subject, privateKey),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: urgency,
      ...(topic ? { Topic: topic } : {}),
    },
    body,
  });
  const ok = res.status >= 200 && res.status < 300;
  return { ok, status: res.status, gone: res.status === 404 || res.status === 410, detail: ok ? '' : (await res.text().catch(() => '')).slice(0, 200) };
}
