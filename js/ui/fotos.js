// Fotos de progreso: cámara con la foto anterior semitransparente encima (para encuadrar igual),
// línea de tiempo, visor y comparación antes/después (lado a lado o con deslizador).

import { cfg, saveCfg, today, byId, patch, commit } from '../store.js';
import { displayName } from '../rules.js';
import { fmtShort, fmtDay, parts, MESES, monthOf } from '../dates.js';
import { $, esc, icon, on, haptic, toast, openSheet, closeSheet, updateSheet, confirmSheet, cap, plantTitle } from './dom.js';
import { compress, addPhoto, deletePhoto, photosOf, photoUrl } from '../photos.js';

/* ---------- cámara ---------- */
let cam = null; // { plantId, stream, facing, ghostId, error }

function stopStream() { cam?.stream?.getTracks().forEach(t => t.stop()); if (cam) cam.stream = null; }

async function startStream() {
  stopStream();
  const video = $('.cam video');
  if (!video || !cam) return;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('sin cámara');
    cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: cam.facing }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false });
    video.srcObject = cam.stream;
    await video.play().catch(() => {});
    cam.error = null;
  } catch {
    cam.error = 'No pude abrir la cámara acá. Usá el botón de abajo para sacarla con la cámara del iPhone o elegirla de la galería.';
    updateSheet();
  }
}

export function openCamera(plantId) {
  const plant = byId('plants', plantId);
  if (!plant) return;
  const prev = photosOf(plantId)[0];
  cam = { plantId, stream: null, facing: 'environment', ghostId: prev?.id || null, error: null, first: true };
  openSheet(renderCamera, {
    full: true, cls: 'cam-sheet',
    onPaint: body => {
      const ghost = $('.ghost', body);
      if (ghost && cam?.ghostId) photoUrl(cam.ghostId, 'full').then(u => { if (u && ghost.isConnected) ghost.src = u; });
      if (cam?.first) { cam.first = false; startStream(); }
      else if (cam?.stream) { const v = $('.cam video', body); if (v && v.srcObject !== cam.stream) { v.srcObject = cam.stream; v.play().catch(() => {}); } }
    },
    onClose: () => { stopStream(); cam = null; },
  });
}
on('photo-new', el => openCamera(el.dataset.id));

function renderCamera() {
  const plant = byId('plants', cam.plantId);
  return `<div class="cam">
    <div class="cam-top"><button class="icon-btn dark" data-act="sheet-close" aria-label="Cerrar">${icon('x')}</button><b>${plant ? plantTitle(plant) : ''}</b><button class="icon-btn dark" data-act="cam-flip" aria-label="Cambiar de cámara">${icon('sync')}</button></div>
    <div class="viewfinder">
      ${cam.error ? `<p class="cam-error">${esc(cam.error)}</p>` : '<video playsinline muted autoplay></video>'}
      ${cam.ghostId && !cam.error ? `<img class="ghost" alt="" style="opacity:${(cfg.ghost ?? 35) / 100}">` : ''}
      <span class="thirds" aria-hidden="true"></span>
    </div>
    <div class="cam-ui">
      ${cam.ghostId && !cam.error ? `<label class="ghost-ctl">${icon('image')}<span>Foto anterior</span><input type="range" min="0" max="80" value="${cfg.ghost ?? 35}" data-input="cam-ghost" aria-label="Transparencia de la foto anterior"></label>` : `<p class="muted small center">${cam.ghostId ? '' : 'Es la primera foto: la próxima vez vas a ver esta encima para encuadrar igual.'}</p>`}
      <div class="cam-row">
        <label class="icon-btn dark big" aria-label="Elegir de la galería">${icon('image')}<input type="file" accept="image/*" data-change="cam-file" hidden></label>
        ${cam.error ? `<label class="shutter file" aria-label="Sacar foto"><input type="file" accept="image/*" capture="environment" data-change="cam-file" hidden></label>` : '<button class="shutter" data-act="cam-shoot" aria-label="Sacar foto"></button>'}
        <span class="icon-btn spacer"></span>
      </div>
    </div>
  </div>`;
}

on('cam-ghost', el => { cfg.ghost = Number(el.value); saveCfg(); const g = $('.cam .ghost'); if (g) g.style.opacity = cfg.ghost / 100; });
on('cam-flip', () => { if (!cam) return; cam.facing = cam.facing === 'environment' ? 'user' : 'environment'; startStream(); });

async function savePhoto(shot) {
  const plantId = cam.plantId, plant = byId('plants', plantId);
  const photo = await addPhoto(plantId, shot, { date: today() });
  haptic(); closeSheet();
  toast(`Foto guardada${plant ? ` para ${displayName(plant)}` : ''}.`, { undo: () => deletePhoto(photo.id) });
}

on('cam-shoot', async el => {
  const video = $('.cam video');
  if (!video || !video.videoWidth) return toast('La cámara todavía no arrancó.');
  el.disabled = true;
  $('.viewfinder')?.classList.add('flash');
  // Recorta el cuadro al mismo 3:4 que se ve en pantalla.
  const vw = video.videoWidth, vh = video.videoHeight, ratio = 3 / 4;
  let sw = vw, sh = vh;
  if (vw / vh > ratio) sw = Math.round(vh * ratio); else sh = Math.round(vw / ratio);
  try { await savePhoto(await compress(video, { sx: Math.round((vw - sw) / 2), sy: Math.round((vh - sh) / 2), sw, sh })); }
  catch (e) { el.disabled = false; toast(e.message || 'No pude guardar la foto.'); }
});
on('cam-file', async el => {
  const file = el.files?.[0];
  if (!file || !cam) return;
  try { await savePhoto(await compress(file)); } catch (e) { toast(e.message || 'No pude abrir esa foto.'); }
});

/* ---------- línea de tiempo ---------- */
on('photos-open', el => {
  const plantId = el.dataset.id;
  openSheet(() => {
    const plant = byId('plants', plantId), photos = photosOf(plantId);
    let html = `<h2 class="sheet-title">Fotos · ${plant ? plantTitle(plant) : ''}</h2>
      <div class="btns">${photos.length > 1 ? `<button class="btn" data-act="compare-open" data-id="${esc(plantId)}">${icon('compare')}Comparar</button>` : ''}<button class="btn primary" data-act="photo-new" data-id="${esc(plantId)}">${icon('camera')}Sacar foto</button></div>`;
    if (!photos.length) return html + '<p class="empty">Todavía no hay fotos.</p>';
    let cur = '';
    for (const f of photos) {
      const ym = monthOf(f.date);
      if (ym !== cur) { html += `${cur ? '</div>' : ''}<h3 class="month">${cap(MESES[parts(f.date)[1] - 1])} ${parts(f.date)[0]}</h3><div class="pgallery">`; cur = ym; }
      html += `<button class="thumb big" data-act="photo-view" data-id="${esc(f.id)}" data-photo-wrap><img data-photo="${esc(f.id)}" alt="Foto del ${fmtShort(f.date)}" loading="lazy"><small>${fmtShort(f.date)}</small>${plant?.avatar === f.id ? `<span class="star">${icon('user')}</span>` : ''}</button>`;
    }
    return html + '</div>';
  }, { live: true });
});

/* ---------- visor ---------- */
on('photo-view', el => {
  const id = el.dataset.id;
  openSheet(() => {
    const f = byId('photos', id);
    if (!f) return '<p class="empty">Esta foto ya no está.</p>';
    const plant = byId('plants', f.plantId);
    return `<div class="viewer" data-photo-wrap><img data-photo="${esc(f.id)}" data-size="full" alt=""></div>
      <p class="muted center">${cap(fmtDay(f.date))} de ${parts(f.date)[0]}${f.by ? ` · ${esc(f.by)}` : ''}</p>
      <form class="form" data-change="photo-date" data-id="${esc(f.id)}"><label class="field"><span class="label">Fecha</span><input type="date" name="date" value="${f.date}" max="${today()}"></label></form>
      <div class="btns col">
        ${plant && plant.avatar !== f.id ? `<button class="btn" data-act="photo-avatar" data-id="${esc(f.id)}">${icon('user')}Usar de foto de perfil</button>` : ''}
        ${photosOf(f.plantId).length > 1 ? `<button class="btn" data-act="compare-open" data-id="${esc(f.plantId)}" data-b="${esc(f.id)}">${icon('compare')}Comparar</button>` : ''}
        <button class="btn danger ghost" data-act="photo-delete" data-id="${esc(f.id)}">${icon('trash')}Borrar foto</button>
      </div>`;
  }, { live: true });
});
on('photo-date', form => {
  const date = form.querySelector('[name=date]').value, id = form.dataset.id;
  if (!id || !date) return;
  patch('photos', id, { date }); commit(); toast('Fecha cambiada.');
});
on('photo-avatar', el => {
  const f = byId('photos', el.dataset.id);
  if (!f) return;
  const prev = byId('plants', f.plantId)?.avatar;
  patch('plants', f.plantId, { avatar: f.id }); commit(); haptic();
  toast('Nueva foto de perfil.', { undo: () => { patch('plants', f.plantId, { avatar: prev || null }); commit(); } });
});
on('photo-delete', async el => {
  if (!(await confirmSheet({ title: '¿Borrar esta foto?', text: 'Se borra de los dos teléfonos y del repo. No se puede deshacer.', ok: 'Borrar', danger: true }))) return;
  await deletePhoto(el.dataset.id);
  closeSheet(); toast('Foto borrada.');
});

/* ---------- comparar ---------- */
let cmp = null; // { plantId, a, b, mode, pick, pos }
on('compare-open', el => {
  const photos = photosOf(el.dataset.id);
  if (photos.length < 2) return toast('Hacen falta dos fotos para comparar.');
  const b = el.dataset.b || photos[0].id;
  const a = photos[photos.length - 1].id === b ? photos[photos.length - 2].id : photos[photos.length - 1].id;
  cmp = { plantId: el.dataset.id, a, b, mode: 'slider', pick: 'a', pos: 50 };
  openSheet(renderCompare, { full: true, cls: 'cmp-sheet', onClose: () => { cmp = null; } });
});

function renderCompare() {
  const plant = byId('plants', cmp.plantId), photos = photosOf(cmp.plantId).slice().reverse();
  const A = byId('photos', cmp.a), B = byId('photos', cmp.b);
  const label = (f, l) => (f ? `<span class="cmp-label">${l} · ${fmtShort(f.date)}</span>` : '');
  const view = cmp.mode === 'slider'
    ? `<div class="cmp slider" style="--pos:${cmp.pos}%">
        <img data-photo="${esc(cmp.b)}" data-size="full" alt="Después">
        <div class="cmp-top"><img data-photo="${esc(cmp.a)}" data-size="full" alt="Antes"></div>
        <span class="cmp-handle" aria-hidden="true"></span>
        ${label(A, 'Antes')}${label(B, 'Después').replace('cmp-label', 'cmp-label right')}
        <input type="range" min="0" max="100" value="${cmp.pos}" data-input="cmp-pos" aria-label="Deslizá para comparar">
      </div>`
    : `<div class="cmp side"><figure><img data-photo="${esc(cmp.a)}" data-size="full" alt="Antes">${label(A, 'Antes')}</figure><figure><img data-photo="${esc(cmp.b)}" data-size="full" alt="Después">${label(B, 'Después')}</figure></div>`;
  return `<div class="sheet-nav"><button class="link" data-act="sheet-close">Listo</button><b>${plant ? plantTitle(plant) : ''}</b><span></span></div>
    <div class="seg solo"><button class="${cmp.mode === 'slider' ? 'on' : ''}" data-act="cmp-mode" data-mode="slider">Deslizador</button><button class="${cmp.mode === 'side' ? 'on' : ''}" data-act="cmp-mode" data-mode="side">Lado a lado</button></div>
    ${view}
    <div class="seg solo pick"><button class="${cmp.pick === 'a' ? 'on' : ''}" data-act="cmp-pick" data-slot="a">Elegir “antes”</button><button class="${cmp.pick === 'b' ? 'on' : ''}" data-act="cmp-pick" data-slot="b">Elegir “después”</button></div>
    <div class="strip photos">${photos.map(f => `<button class="thumb${f.id === cmp.a ? ' sel-a' : ''}${f.id === cmp.b ? ' sel-b' : ''}" data-act="cmp-set" data-id="${esc(f.id)}" data-photo-wrap><img data-photo="${esc(f.id)}" alt=""><small>${fmtShort(f.date)}</small></button>`).join('')}</div>`;
}
on('cmp-mode', el => { cmp.mode = el.dataset.mode; haptic(); updateSheet(); });
on('cmp-pick', el => { cmp.pick = el.dataset.slot; updateSheet(); });
on('cmp-set', el => {
  const id = el.dataset.id;
  if (cmp.pick === 'a') { if (id === cmp.b) cmp.b = cmp.a; cmp.a = id; cmp.pick = 'b'; }
  else { if (id === cmp.a) cmp.a = cmp.b; cmp.b = id; cmp.pick = 'a'; }
  haptic(); updateSheet();
});
on('cmp-pos', el => { cmp.pos = Number(el.value); el.closest('.cmp').style.setProperty('--pos', `${cmp.pos}%`); });
