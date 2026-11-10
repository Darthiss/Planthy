// Estado de la app. Los datos compartidos (plantas, registros, tareas, fotos, ajustes) viven en un documento que
// se guarda en IndexedDB y se sincroniza con el repo privado. Lo propio de este teléfono (token, nombre, estado de
// sincronización) queda en localStorage y nunca sale del dispositivo.

import { emptyDoc, normalize, newId } from './merge.js';
import { cfgOf } from './rules.js';
import { localToday } from './dates.js';

/* ---------- IndexedDB ---------- */
let idbPromise;
function idb() {
  idbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('planthy', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('kv'); req.result.createObjectStore('blobs'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idbPromise;
}
async function tx(store, mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}
export const kvGet = k => tx('kv', 'readonly', s => s.get(k));
export const kvSet = (k, v) => tx('kv', 'readwrite', s => s.put(v, k));
// Fotos: clave "<id>" para la grande y "<id>:t" para la miniatura.
export const blobGet = k => tx('blobs', 'readonly', s => s.get(k));
export const blobSet = (k, v) => tx('blobs', 'readwrite', s => s.put(v, k));
export const blobDel = k => tx('blobs', 'readwrite', s => s.delete(k));
export const blobKeys = () => tx('blobs', 'readonly', s => s.getAllKeys());

/* ---------- lo propio de este teléfono ---------- */
const CFG_KEY = 'planthy-cfg';
function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
export const cfg = Object.assign({
  who: '', // nombre de quien usa este teléfono
  deviceId: '',
  sync: null, // { owner, repo, token, savedAt, expires }
  syncState: '', // '' | 'ok' | 'pending' | 'offline' | 'token' | 'error'
  syncMsg: '',
  lastSync: 0,
  onboarded: false,
  pushOn: false,
  humidity: null, // { date, value }: humedad ambiente anotada hoy
  dismissed: {}, // tarjetas que cerré: { clave: fecha }
  photoDeletes: [], // fotos borradas que falta sacar del repo
  ghost: 35, // opacidad de la foto anterior sobre la cámara
}, lsGet(CFG_KEY) || {});
if (!cfg.deviceId) { cfg.deviceId = newId('s'); lsSet(CFG_KEY, cfg); }
export const saveCfg = () => lsSet(CFG_KEY, cfg);
export const cacheGet = k => lsGet(`planthy-${k}`);
export const cacheSet = (k, v) => lsSet(`planthy-${k}`, v);

/* ---------- documento compartido ---------- */
export const state = { db: emptyDoc(), ready: false, weather: null };
export const settings = () => cfgOf(state.db);
export const today = () => localToday();

const listeners = new Set();
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = () => { for (const fn of listeners) fn(); };

let afterCommit = () => {};
export const onCommit = fn => { afterCommit = fn; };

export async function init() {
  try { state.db = normalize(await kvGet('db')) || emptyDoc(); } catch { state.db = emptyDoc(); }
  state.ready = true;
  try { navigator.storage?.persist?.(); } catch { /* no pasa nada */ }
}
let saving = Promise.resolve();
export function persist() {
  saving = saving.then(() => kvSet('db', state.db)).catch(() => {});
  return saving;
}
/** Guarda, avisa a la interfaz y agenda la sincronización. */
export function commit() { persist(); afterCommit(); emit(); }

let lastT = 0;
export const stamp = () => (lastT = Math.max(Date.now(), lastT + 1));

export const byId = (coll, id) => state.db[coll].find(r => r.id === id);
export function put(coll, rec) {
  rec.t = stamp();
  const arr = state.db[coll], i = arr.findIndex(r => r.id === rec.id);
  if (i >= 0) arr[i] = rec; else arr.push(rec);
  return rec;
}
export function patch(coll, id, fields) {
  const cur = byId(coll, id);
  return cur ? put(coll, { ...cur, ...fields }) : null;
}
export function remove(coll, id) {
  state.db[coll] = state.db[coll].filter(r => r.id !== id);
  state.db.deleted[id] = stamp();
}
export function setSetting(key, value) {
  state.db.settings[key] = value;
  state.db.st[key] = stamp();
}
/** Reemplaza el documento entero (sincronización, importación). */
export function replaceDb(db) { state.db = db; persist(); emit(); }

/* ---------- registros ---------- */
/**
 * Crea uno o varios registros de una planta con lo que se guarda solo: quién, y el modo aire vigente.
 * list: [{ type, ...campos }]. Devuelve los registros creados.
 */
export function logEvents(plantId, date, list) {
  const s = settings();
  const hum = cfg.humidity && cfg.humidity.date === date ? cfg.humidity.value : undefined;
  const made = list.map(fields => put('events', {
    id: newId('e', date), plantId, date,
    by: cfg.who || '', aire: s.aire || 'apagado',
    ...(fields.type === 'palito' && hum != null && fields.hum == null ? { hum } : {}),
    ...fields,
  }));
  commit();
  return made;
}
export function undoEvents(events) {
  for (const e of events) remove('events', e.id);
  commit();
}
