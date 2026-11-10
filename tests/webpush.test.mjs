// El cifrado del push y la firma VAPID, verificados desde el lado del que recibe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createDecipheriv, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { encrypt, vapidAuth, generateVapidKeys, publicFromPrivate, b64u, unb64u } from '../scripts/webpush.mjs';

/** Lo que hace el navegador al recibir el mensaje (RFC 8291). */
function decrypt(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20];
  const as = body.subarray(21, 21 + idlen), cipherText = body.subarray(21 + idlen);
  const ua = uaEcdh.getPublicKey();
  const shared = uaEcdh.computeSecret(as);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipherText.subarray(cipherText.length - 16));
  const plain = Buffer.concat([d.update(cipherText.subarray(0, cipherText.length - 16)), d.final()]);
  assert.equal(rs, 4096);
  assert.equal(plain[plain.length - 1], 2);
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

test('cifrado aes128gcm: el receptor recupera el mensaje', () => {
  const ua = createECDH('prime256v1'); ua.generateKeys();
  const auth = randomBytes(16);
  const msg = JSON.stringify({ web_push: 8030, notification: { title: 'Domingo de plantas', body: '5 para revisar, cambio de agua y 1 con Fertifox.', navigate: 'https://ejemplo.github.io/planthy/#hoy' } });
  const body = encrypt(msg, b64u(ua.getPublicKey()), b64u(auth));
  assert.equal(body[20], 65);
  assert.equal(decrypt(body, ua, auth), msg);
  assert.notDeepEqual(encrypt(msg, b64u(ua.getPublicKey()), b64u(auth)), body); // sal y clave efímera nuevas cada vez
  assert.throws(() => encrypt('x'.repeat(5000), b64u(ua.getPublicKey()), b64u(auth)), /largo/);
  assert.throws(() => encrypt('x', 'AAAA', b64u(auth)), /inválidas/);
});

test('VAPID: JWT ES256 válido para el origen del endpoint', () => {
  const { publicKey, privateKey } = generateVapidKeys();
  assert.equal(unb64u(publicKey).length, 65);
  assert.equal(unb64u(privateKey).length, 32);
  assert.equal(publicFromPrivate(privateKey), publicKey);
  const header = vapidAuth('https://web.push.apple.com/QAbc123', 'https://ejemplo.github.io/planthy/', privateKey, Date.UTC(2026, 10, 15, 12));
  const m = header.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  assert.ok(m);
  assert.equal(m[4], publicKey);
  assert.deepEqual(JSON.parse(unb64u(m[1])), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(unb64u(m[2]));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'https://ejemplo.github.io/planthy/');
  assert.equal(claims.exp, Date.UTC(2026, 10, 16, 0) / 1000);
  const pub = unb64u(publicKey);
  const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  assert.ok(verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, unb64u(m[3])));
});
