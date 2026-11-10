#!/usr/bin/env node
// Genera un par de claves VAPID para las notificaciones.
//   node scripts/vapid.mjs
// La pública va en data.json del repo privado (settings.vapidPublic). La privada va SOLO como secret
// VAPID_PRIVATE_KEY del repo privado: no la subas a ningún repo.
import { generateVapidKeys } from './webpush.mjs';

const { publicKey, privateKey } = generateVapidKeys();
console.log('Pública  (settings.vapidPublic en data.json):');
console.log(publicKey);
console.log('\nPrivada  (secret VAPID_PRIVATE_KEY en planthy-data):');
console.log(privateKey);
