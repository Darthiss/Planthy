// Exportar e importar todo: un .zip con planthy.json (plantas, registros, tareas, ajustes) y las fotos.
// Los datos siempre se pueden sacar, con o sin sincronización.

import { state, replaceDb, blobGet, blobSet, cfg } from './store.js';
import { normalize, merge } from './merge.js';
import { zip, unzip } from './zip.js';
import { fullPhoto, scheduleSync } from './sync.js';
import { localToday } from './dates.js';

/** Comparte un archivo con la hoja de iOS; si no se puede, lo descarga. */
export async function shareFile(name, data, type) {
  const file = new File([data], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; /* si falla, cae a la descarga */ }
  }
  const url = URL.createObjectURL(file), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

/** Arma el .zip. onProgress(hechas, total). Devuelve { blob, name, missing } (missing: fotos que no pude conseguir). */
export async function buildExport(onProgress = () => {}) {
  const doc = { ...state.db, subs: [], exported: new Date().toISOString(), exportedBy: cfg.who || '' };
  const files = [{ name: 'planthy.json', data: JSON.stringify(doc, null, 1) }];
  let done = 0, missing = 0;
  for (const p of state.db.photos) {
    const full = await fullPhoto(p.id).catch(() => null);
    if (full) files.push({ name: `fotos/${p.id}.jpg`, data: full }); else missing++;
    const thumb = await blobGet(`${p.id}:t`).catch(() => null);
    if (thumb) files.push({ name: `miniaturas/${p.id}.jpg`, data: thumb });
    onProgress(++done, state.db.photos.length);
  }
  return { blob: await zip(files), name: `planthy-${localToday()}.zip`, missing };
}

/** Importa un .zip exportado por la app (o un planthy.json suelto). Fusiona con lo que haya. */
export async function importFile(file) {
  let json, entries = [];
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) {
    entries = await unzip(file);
    const main = entries.find(e => /(^|\/)planthy\.json$/.test(e.name)) || entries.find(e => e.name.endsWith('.json'));
    if (!main) throw new Error('El ZIP no trae planthy.json.');
    json = new TextDecoder().decode(await main.read());
  } else json = await file.text();
  let incoming;
  try { incoming = normalize(JSON.parse(json)); } catch { incoming = null; }
  if (!incoming) throw new Error('Ese archivo no es una copia de Planthy.');
  incoming.subs = []; // las suscripciones son de cada teléfono

  let photos = 0;
  const known = new Set(state.db.photos.map(p => p.id));
  for (const e of entries) {
    const m = e.name.match(/(^|\/)(fotos|miniaturas)\/([^/]+)\.jpe?g$/i);
    if (!m) continue;
    const id = m[3], blob = new Blob([await e.read()], { type: 'image/jpeg' });
    await blobSet(m[2] === 'fotos' ? id : `${id}:t`, blob);
    if (m[2] === 'fotos') photos++;
  }
  // Las fotos que entran por acá se suben al repo de este teléfono (si ya estaban, GitHub lo dice y listo).
  for (const p of incoming.photos) if (!known.has(p.id)) p.up = false;
  const before = { plants: state.db.plants.length, events: state.db.events.length };
  replaceDb(merge(state.db, incoming));
  scheduleSync();
  return { plants: state.db.plants.length - before.plants, events: state.db.events.length - before.events, photos, total: state.db.plants.length };
}
