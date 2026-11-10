// Sincronización con el repo privado de GitHub (mismo patrón que habits): los datos se guardan primero en el
// teléfono; después se baja data.json, se fusiona registro por registro y se sube con el `sha` que se leyó.
// Si otro teléfono subió en el medio, GitHub rechaza la subida y se reintenta.
// Las fotos van aparte, una sola vez cada una: photos/<id>.jpg y thumbs/<id>.jpg.

import { state, cfg, saveCfg, persist, emit, onCommit, put, blobGet, blobSet, blobDel, blobKeys } from './store.js';
import { normalize, merge, canon } from './merge.js';

const API = 'https://api.github.com';
const enc = encodeURIComponent;
export const syncOn = () => !!(cfg.sync && cfg.sync.owner && cfg.sync.repo && cfg.sync.token);

class SyncError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

function gh(path, { method = 'GET', body, raw = false, sync = cfg.sync } = {}) {
  return fetch(`${API}/repos/${enc(sync.owner)}/${enc(sync.repo)}${path ? '/' + path : ''}`, {
    method, cache: 'no-store',
    headers: {
      Authorization: `Bearer ${sync.token}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function fail(res, what) {
  let msg = '';
  try { msg = (await res.json()).message || ''; } catch { /* sin cuerpo */ }
  if (res.status === 401) return new SyncError('token', 'El token venció o es incorrecto. Generá uno nuevo y pegalo en Ajustes.');
  if (res.status === 403 && /rate limit/i.test(msg)) return new SyncError('error', 'GitHub pidió esperar un rato. Reintento solo.');
  if (res.status === 403) return new SyncError('token', 'El token no tiene permiso de lectura y escritura (Contents) sobre el repo.');
  if (res.status === 404) return new SyncError('token', 'No encuentro el repo. Revisá el usuario, el nombre y que el token tenga acceso.');
  return new SyncError('error', `GitHub respondió ${res.status} al ${what}. ${msg}`.trim());
}

const b64e = s => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(bin); };
const b64d = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
const blobB64 = blob => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result).split(',')[1]);
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(blob);
});

function noteExpiry(res) {
  // GitHub manda el vencimiento del token en esta cabecera. Si el navegador la deja leer, la uso para avisar antes.
  try {
    const h = res.headers.get('github-authentication-token-expiration');
    const t = h ? Date.parse(h.replace(' UTC', 'Z').replace(' ', 'T')) : NaN;
    if (t && cfg.sync && cfg.sync.expires !== t) { cfg.sync.expires = t; saveCfg(); }
  } catch { /* cabecera no expuesta */ }
}

/** Días que le quedan al token (puede ser negativo). null si no se sabe. */
export function tokenDaysLeft() {
  if (!syncOn() || !cfg.sync.expires) return null;
  return Math.floor((cfg.sync.expires - Date.now()) / 864e5);
}

/* ---------- data.json ---------- */
async function readRemote() {
  const res = await gh('contents/data.json');
  noteExpiry(res);
  if (res.status === 404) {
    const probe = await gh('');
    if (!probe.ok) throw await fail(probe, 'abrir el repo');
    return { remote: null, sha: null };
  }
  if (!res.ok) throw await fail(res, 'leer los datos');
  const j = await res.json();
  let content = j.content;
  if (!content) { // más de 1 MB: se pide el blob
    const blob = await gh(`git/blobs/${j.sha}`);
    if (!blob.ok) throw await fail(blob, 'leer los datos');
    content = (await blob.json()).content;
  }
  let remote = null;
  try { remote = normalize(JSON.parse(b64d(content))); } catch { /* cae abajo */ }
  if (!remote) throw new SyncError('error', 'El data.json del repo no es de Planthy. No lo toco.');
  return { remote, sha: j.sha };
}

let syncing = false, again = false, timer = null;

export function scheduleSync() {
  if (!syncOn()) return;
  setState('pending');
  clearTimeout(timer);
  timer = setTimeout(syncNow, 1500);
}
onCommit(scheduleSync);

function setState(status, msg = '') {
  if (cfg.syncState === status && cfg.syncMsg === msg) return;
  cfg.syncState = status; cfg.syncMsg = msg; saveCfg();
}

/** Devuelve true si quedó sincronizado. */
export async function syncNow() {
  if (!syncOn()) return false;
  if (syncing) { again = true; return false; }
  syncing = true; clearTimeout(timer);
  let ok = false;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { remote, sha } = await readRemote();
      const merged = remote ? merge(state.db, remote) : merge(state.db, state.db);
      if (canon(merged) !== canon(state.db)) { state.db = merged; persist(); }
      if (remote && canon(remote) === canon(merged)) break;
      const res = await gh('contents/data.json', { method: 'PUT', body: { message: `planthy ${new Date().toISOString().slice(0, 16)}`, content: b64e(JSON.stringify(merged, null, 1) + '\n'), ...(sha ? { sha } : {}) } });
      if (res.ok) break;
      if ((res.status === 409 || res.status === 422) && attempt < 3) continue;
      throw await fail(res, 'guardar los datos');
    }
    const more = await syncPhotos();
    cfg.lastSync = Date.now();
    setState('ok');
    ok = true;
    if (more) again = true;
  } catch (e) {
    if (e instanceof SyncError) setState(e.kind, e.message);
    else if (navigator.onLine === false || e instanceof TypeError) setState('offline', 'Sin conexión. Sincronizo cuando vuelva.');
    else setState('error', String(e.message || e));
  }
  saveCfg(); syncing = false; emit();
  if (again) { again = false; return syncNow(); }
  return ok;
}

/** Prueba usuario, repo y token sin guardar nada. Devuelve { ok, message, hasData }. */
export async function testConnection(sync) {
  try {
    const res = await gh('contents/data.json', { sync });
    if (res.ok) return { ok: true, hasData: true };
    if (res.status === 404) {
      const probe = await gh('', { sync });
      if (probe.ok) return { ok: true, hasData: false };
      return { ok: false, message: (await fail(probe, 'abrir el repo')).message };
    }
    return { ok: false, message: (await fail(res, 'leer los datos')).message };
  } catch {
    return { ok: false, message: 'No pude conectarme a GitHub. Revisá la conexión.' };
  }
}

/* ---------- fotos ---------- */
async function putFile(path, blob) {
  const res = await gh(`contents/${path}`, { method: 'PUT', body: { message: `foto ${path.split('/').pop()}`, content: await blobB64(blob) } });
  if (res.ok || res.status === 422) return; // 422: ya estaba subida
  if (res.status === 409) { // otro commit en el medio: una vez más
    const retry = await gh(`contents/${path}`, { method: 'PUT', body: { message: `foto ${path.split('/').pop()}`, content: await blobB64(blob) } });
    if (retry.ok || retry.status === 422) return;
    throw await fail(retry, 'subir una foto');
  }
  throw await fail(res, 'subir una foto');
}
async function getFile(path) {
  const res = await gh(`contents/${path}`, { raw: true });
  if (res.status === 404) return null;
  if (!res.ok) throw await fail(res, 'bajar una foto');
  return new Blob([await res.arrayBuffer()], { type: 'image/jpeg' });
}
async function deleteFile(path) {
  const res = await gh(`contents/${path}`);
  if (res.status === 404) return;
  if (!res.ok) throw await fail(res, 'borrar una foto');
  const del = await gh(`contents/${path}`, { method: 'DELETE', body: { message: `borrar ${path.split('/').pop()}`, sha: (await res.json()).sha } });
  if (!del.ok && del.status !== 404) throw await fail(del, 'borrar una foto');
}

/** Sube las fotos nuevas, baja las miniaturas que faltan y limpia lo borrado. true si cambió el documento. */
async function syncPhotos() {
  let changed = false; // cambió el documento: hace falta otra vuelta para subirlo
  const keys = new Set(await blobKeys());
  const missing = new Set(cfg.photoMissing || []);
  for (const photo of [...state.db.photos]) {
    const current = () => state.db.photos.find(p => p.id === photo.id);
    if (!photo.up) {
      if (!keys.has(photo.id)) continue; // la foto la tiene otro teléfono, que todavía no la subió
      const thumb = await blobGet(`${photo.id}:t`);
      if (thumb) await putFile(`thumbs/${photo.id}.jpg`, thumb);
      await putFile(`photos/${photo.id}.jpg`, await blobGet(photo.id));
      if (current()) { put('photos', { ...current(), up: true }); changed = true; }
    } else if (!keys.has(`${photo.id}:t`) && !missing.has(photo.id)) {
      const thumb = await getFile(`thumbs/${photo.id}.jpg`) || await getFile(`photos/${photo.id}.jpg`);
      if (thumb) await blobSet(`${photo.id}:t`, thumb);
      else if (keys.has(photo.id) && current()) { put('photos', { ...current(), up: false }); changed = true; } // no está en el repo pero la tengo: se vuelve a subir
      else missing.add(photo.id);
    }
  }
  if (missing.size !== (cfg.photoMissing || []).length) cfg.photoMissing = [...missing];
  // Borradas: fuera del repo y del teléfono.
  for (const id of [...(cfg.photoDeletes || [])]) {
    await deleteFile(`photos/${id}.jpg`);
    await deleteFile(`thumbs/${id}.jpg`);
    cfg.photoDeletes = cfg.photoDeletes.filter(x => x !== id); saveCfg();
  }
  const alive = new Set(state.db.photos.map(p => p.id));
  for (const key of keys) if (!alive.has(key.split(':')[0]) && state.db.deleted[key.split(':')[0]]) await blobDel(key);
  if (changed) persist();
  return changed;
}

const fullWaiters = new Map();
/** La foto grande: del teléfono o, si es de otro teléfono, bajándola del repo (y queda guardada). */
export function fullPhoto(id) {
  if (fullWaiters.has(id)) return fullWaiters.get(id);
  const p = (async () => {
    const local = await blobGet(id);
    if (local) return local;
    if (!syncOn()) return null;
    const blob = await getFile(`photos/${id}.jpg`).catch(() => null);
    if (blob) await blobSet(id, blob);
    return blob;
  })().finally(() => fullWaiters.delete(id));
  fullWaiters.set(id, p);
  return p;
}
