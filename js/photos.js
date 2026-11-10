// Fotos: se achican en el teléfono antes de guardarlas (lado largo de 1600 px, JPEG) y se guarda además una
// miniatura para las listas. Los archivos viven en IndexedDB; el documento solo lleva los datos de cada foto.

import { state, cfg, saveCfg, put, patch, remove, commit, blobGet, blobSet, blobDel } from './store.js';
import { newId } from './merge.js';
import { fullPhoto } from './sync.js';

const MAX = 1600, THUMB = 480;

function toBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No pude generar la imagen'))), 'image/jpeg', quality));
}
function draw(source, sx, sy, cw, ch, max) {
  const scale = Math.min(1, max / Math.max(cw, ch));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cw * scale); canvas.height = Math.round(ch * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
  return canvas;
}
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No pude abrir esa imagen')); };
    img.src = url;
  });
}

/**
 * Comprime una imagen. `source`: archivo de la galería, o un <video>/<canvas> con `crop` opcional { sx, sy, sw, sh }.
 * Devuelve { full, thumb, w, h }.
 */
export async function compress(source, crop) {
  const el = source instanceof Blob ? await loadImage(source) : source;
  const sw = el.videoWidth || el.naturalWidth || el.width, sh = el.videoHeight || el.naturalHeight || el.height;
  const c = crop || { sx: 0, sy: 0, sw, sh };
  const big = draw(el, c.sx, c.sy, c.sw, c.sh, MAX);
  const small = draw(big, 0, 0, big.width, big.height, THUMB);
  return { full: await toBlob(big, 0.82), thumb: await toBlob(small, 0.72), w: big.width, h: big.height };
}

/** Guarda una foto ya comprimida en la línea de tiempo de la planta. */
export async function addPhoto(plantId, { full, thumb, w, h }, { date, asAvatar = false } = {}) {
  const id = newId('f', date);
  await blobSet(id, full);
  await blobSet(`${id}:t`, thumb);
  const photo = put('photos', { id, plantId, date, w, h, by: cfg.who || '', up: false });
  const plant = state.db.plants.find(p => p.id === plantId);
  if (plant && (asAvatar || !plant.avatar)) patch('plants', plantId, { avatar: id });
  commit();
  return photo;
}

export async function deletePhoto(id) {
  const photo = state.db.photos.find(p => p.id === id);
  if (!photo) return;
  remove('photos', id);
  for (const plant of state.db.plants.filter(p => p.avatar === id)) {
    const next = photosOf(plant.id)[0];
    patch('plants', plant.id, { avatar: next ? next.id : null });
  }
  if (photo.up) { cfg.photoDeletes = [...(cfg.photoDeletes || []), id]; saveCfg(); }
  release(id);
  await blobDel(id); await blobDel(`${id}:t`);
  commit();
}

/** Fotos de una planta, de la más nueva a la más vieja. */
export const photosOf = plantId => state.db.photos.filter(p => p.plantId === plantId).sort((a, b) => (a.date === b.date ? (b.t || 0) - (a.t || 0) : a.date < b.date ? 1 : -1));

/* ---------- mostrar ---------- */
const urls = new Map(); // "id" | "id:t" → object URL
const pending = new Map();
function release(id) {
  for (const k of [id, `${id}:t`]) { const u = urls.get(k); if (u) { URL.revokeObjectURL(u); urls.delete(k); } }
}

/** URL para mostrar la foto. size: 'thumb' | 'full'. null si todavía no está en este teléfono. */
export function photoUrl(id, size = 'thumb') {
  const key = size === 'thumb' ? `${id}:t` : id;
  if (urls.has(key)) return Promise.resolve(urls.get(key));
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    let blob = await blobGet(key).catch(() => null);
    if (!blob && size === 'thumb') blob = await blobGet(id).catch(() => null);
    if (!blob && size === 'full') blob = await fullPhoto(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.set(key, url);
    return url;
  })().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}
export const cachedUrl = (id, size = 'thumb') => urls.get(size === 'thumb' ? `${id}:t` : id) || '';

/** Completa los <img data-photo="id" data-size="thumb|full"> de un contenedor. */
export function hydrate(root = document) {
  for (const img of root.querySelectorAll('img[data-photo]:not([src])')) {
    const id = img.dataset.photo, size = img.dataset.size || 'thumb';
    const ready = cachedUrl(id, size);
    if (ready) { img.src = ready; continue; }
    if (size === 'full') { const t = cachedUrl(id, 'thumb'); if (t) img.src = t; } // mientras baja la grande
    photoUrl(id, size).then(url => {
      if (url && img.isConnected) { img.src = url; img.classList.add('in'); }
      else if (!url && img.isConnected) img.closest('[data-photo-wrap]')?.classList.add('missing');
    });
  }
}

/** Espacio que ocupan las fotos en este teléfono, en bytes. */
export async function photoBytes() {
  let total = 0;
  for (const p of state.db.photos) for (const k of [p.id, `${p.id}:t`]) { const b = await blobGet(k).catch(() => null); if (b) total += b.size; }
  return total;
}
