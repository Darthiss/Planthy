#!/usr/bin/env node
// Recordatorios: lo corre el workflow del repo privado de datos, cada hora de 7 a 22 (Argentina).
// Lee data.json, calcula qué toca hoy con las mismas reglas que la app (js/rules.js), mira el clima y manda
// un push a cada teléfono suscripto. Avisa una sola vez por día: cuando ya pasó la hora configurada.
//
// Variables: GITHUB_TOKEN, GITHUB_REPOSITORY (el repo de datos), VAPID_PRIVATE_KEY.
// Opcionales: FORCE=true (avisar ya), DRY_RUN=true (no envía ni guarda), TEST=true (manda un aviso de prueba),
//             VAPID_SUBJECT (mailto: o https:), APP_URL.

import { todayIn, timeIn } from '../js/dates.js';
import { TZ, cfgOf, notificationFor } from '../js/rules.js';
import { normalize } from '../js/merge.js';
import { fetchDailyMax } from '../js/meteo.js';
import { sendPush, publicFromPrivate } from './webpush.mjs';

const env = process.env;
const on = v => v === '1' || v === 'true';
const FORCE = on(env.FORCE), DRY = on(env.DRY_RUN), TEST = on(env.TEST);
const repo = env.DATA_REPO || env.GITHUB_REPOSITORY;
const log = (...a) => console.log(...a);

const API = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
async function gh(path, init = {}) {
  return fetch(`${API}/repos/${repo}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
}
async function readJson(path) {
  const res = await gh(`contents/${path}`);
  if (res.status === 404) return { json: null, sha: null };
  if (!res.ok) throw new Error(`GitHub respondió ${res.status} al leer ${path}`);
  const j = await res.json();
  let b64 = j.content;
  if (!b64) { // archivos de más de 1 MB: hay que pedir el blob
    const blob = await gh(`git/blobs/${j.sha}`);
    if (!blob.ok) throw new Error(`GitHub respondió ${blob.status} al leer ${path}`);
    b64 = (await blob.json()).content;
  }
  return { json: JSON.parse(Buffer.from(b64, 'base64').toString('utf8')), sha: j.sha };
}
async function writeJson(path, json, sha, message) {
  return gh(`contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: Buffer.from(JSON.stringify(json, null, 1) + '\n').toString('base64'), ...(sha ? { sha } : {}) }),
  });
}

/** Marca como borradas las suscripciones que el servicio de push dio por muertas. */
async function pruneSubs(ids) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { json, sha } = await readJson('data.json');
    const data = normalize(json);
    if (!data) return;
    const now = Date.now();
    for (const id of ids) data.deleted[id] = now;
    data.subs = data.subs.filter(s => !ids.includes(s.id));
    const res = await writeJson('data.json', data, sha, 'recordatorios: limpiar suscripciones vencidas');
    if (res.ok) return;
    if (res.status !== 409 && res.status !== 422) throw new Error(`GitHub respondió ${res.status} al limpiar suscripciones`);
  }
}

async function main() {
  if (!repo || !env.GITHUB_TOKEN) throw new Error('Faltan GITHUB_REPOSITORY o GITHUB_TOKEN');
  const today = todayIn(TZ), now = timeIn(TZ);

  const data = normalize((await readJson('data.json')).json);
  if (!data) return log('Todavía no hay data.json en el repo.');
  const s = cfgOf(data);
  const at = /^\d\d:\d\d$/.test(s.reminderTime || '') ? s.reminderTime : '09:00';
  if (!FORCE && !TEST && now < at) return log(`Son las ${now}. El aviso sale a partir de las ${at}.`);

  const state = await readJson('push/estado.json');
  if (!FORCE && !TEST && state.json?.day === today) return log('Hoy ya avisé.');

  let weather = null;
  try { weather = await fetchDailyMax(s.location, { past: 3, days: 3 }); } catch (e) { log(`Sin datos de clima (${e.message}): hoy no puedo evaluar el calor.`); }

  let note = notificationFor(data, today, weather);
  if (TEST) note = { title: 'Planthy', body: 'Las notificaciones funcionan. Así te voy a avisar.', count: 0 };
  const subs = data.subs.filter(x => x.endpoint && x.keys?.p256dh && x.keys?.auth);
  log(note ? `Aviso de hoy (${today}): ${note.title} — ${note.body}` : `Hoy (${today}) no toca nada: no aviso.`);
  log(`Teléfonos suscriptos: ${subs.length}`);

  let sent = 0, failed = 0;
  const gone = [];
  if (note && subs.length && !DRY) {
    const privateKey = env.VAPID_PRIVATE_KEY;
    if (!privateKey) throw new Error('Falta el secret VAPID_PRIVATE_KEY');
    if (s.vapidPublic && publicFromPrivate(privateKey) !== s.vapidPublic) log('Ojo: el secret VAPID_PRIVATE_KEY no corresponde a la clave pública de data.json. Los push van a ser rechazados.');
    for (const sub of subs) {
      const appUrl = (sub.appUrl || env.APP_URL || '').replace(/[#?].*$/, '');
      if (!appUrl) { failed++; log(`- ${sub.who || sub.id}: la suscripción no tiene la dirección de la app`); continue; }
      const payload = {
        web_push: 8030, // formato declarativo (iOS 18.4+); el service worker lo muestra en los que no lo soportan
        notification: { title: note.title, body: note.body, navigate: `${appUrl}#hoy`, lang: 'es-AR', dir: 'ltr', silent: false, app_badge: String(note.count || 0) },
      };
      try {
        const res = await sendPush(sub, payload, { privateKey, subject: env.VAPID_SUBJECT || appUrl, topic: `planthy-${today.replace(/-/g, '')}` });
        if (res.ok) sent++;
        else if (res.gone) gone.push(sub.id);
        else failed++;
        log(`- ${sub.who || sub.id}: ${res.ok ? 'enviado' : res.gone ? 'suscripción vencida, la borro' : `falló (${res.status}) ${res.detail}`}`);
      } catch (e) { failed++; log(`- ${sub.who || sub.id}: falló (${e.message})`); }
    }
  }
  if (DRY) return log('Modo prueba: no envié ni guardé nada.');
  if (gone.length) await pruneSubs(gone);
  if (TEST) return;
  // Si todo falló por algo pasajero, no marco el día: la corrida de la hora siguiente reintenta.
  if (note && subs.length && sent === 0 && failed > 0) { process.exitCode = 1; return log('No pude enviar ningún aviso. Reintento en la próxima corrida.'); }
  const res = await writeJson('push/estado.json', { day: today, at: new Date().toISOString(), aviso: note ? { title: note.title, body: note.body } : null, enviados: sent }, state.sha, `recordatorios: ${today}`);
  if (!res.ok && res.status !== 409 && res.status !== 422) throw new Error(`GitHub respondió ${res.status} al guardar el estado`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
