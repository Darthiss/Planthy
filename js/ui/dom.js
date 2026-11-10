// Utilidades de interfaz: plantillas, acciones por delegación, hojas, avisos con "Deshacer" y pequeños dibujos.

import { DEPTHS, displayName } from '../rules.js';
import { hydrate } from '../photos.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** Cambia la pantalla con una transición suave si el sistema lo permite. */
export function transition(fn) {
  if (document.startViewTransition && !reduced()) document.startViewTransition(fn); else fn();
}

/* ---------- acciones: <button data-act="nombre"> ---------- */
const actions = {};
export const on = (name, fn) => { actions[name] = fn; };
export function bindActions() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el, e);
  });
  for (const type of ['change', 'input', 'submit']) {
    document.addEventListener(type, e => {
      const el = e.target.closest(`[data-${type}]`);
      if (!el) return;
      if (type === 'submit') e.preventDefault();
      const fn = actions[el.dataset[type]];
      if (fn) fn(el, e);
    });
  }
}

/* ---------- respuesta táctil ---------- */
// Android: vibración. iOS 18+: alternar un <input switch> oculto hace sonar el háptico del sistema.
let hapticEl;
export function haptic() {
  try {
    if (navigator.vibrate) { navigator.vibrate(8); return; }
    if (!hapticEl) {
      hapticEl = document.createElement('label');
      hapticEl.setAttribute('aria-hidden', 'true'); hapticEl.style.display = 'none';
      hapticEl.innerHTML = '<input type="checkbox" switch>';
      document.head.appendChild(hapticEl);
    }
    hapticEl.click();
  } catch { /* sin háptico */ }
}

/* ---------- aviso con Deshacer ---------- */
let toastTimer;
export function toast(message, { undo, ms } = {}) {
  const el = $('#toast');
  clearTimeout(toastTimer);
  el.innerHTML = `<span>${esc(message)}</span>${undo ? '<button type="button" data-act="toast-undo">Deshacer</button>' : ''}`;
  on('toast-undo', () => { hideToast(); undo?.(); });
  el.classList.add('show');
  toastTimer = setTimeout(hideToast, ms || (undo ? 5000 : 2600));
}
export function hideToast() { clearTimeout(toastTimer); $('#toast').classList.remove('show'); }

/* ---------- hojas (modales desde abajo) y pantallas completas ---------- */
const stack = [];
function paintSheet(entry) {
  const body = $('.sheet-body', entry.el);
  const top = body.scrollTop;
  body.innerHTML = entry.render();
  body.scrollTop = top;
  hydrate(body);
  entry.opts.onPaint?.(body);
}
/** Abre una hoja. render() devuelve el HTML; opts: { full, onPaint, onClose, cls } */
export function openSheet(render, opts = {}) {
  const el = document.createElement('div');
  el.className = `sheet-wrap${opts.full ? ' full' : ''}`;
  el.innerHTML = `<div class="scrim" data-act="sheet-close"></div>
    <section class="sheet ${opts.cls || ''}" role="dialog" aria-modal="true" tabindex="-1">${opts.full ? '' : '<button class="grab" data-act="sheet-close" aria-label="Cerrar"></button>'}<div class="sheet-body"></div></section>`;
  $('#sheets').appendChild(el);
  const entry = { el, render, opts, focus: document.activeElement };
  stack.push(entry);
  paintSheet(entry);
  document.body.classList.add('has-sheet');
  requestAnimationFrame(() => { el.classList.add('open'); $('.sheet', el).focus({ preventScroll: true }); });
  return entry;
}
export function updateSheet() { const top = stack[stack.length - 1]; if (top) paintSheet(top); }
/** Repinta las hojas marcadas `live` cuando cambian los datos, salvo que se esté escribiendo en ellas. */
export function refreshLiveSheets() {
  for (const entry of stack) {
    if (!entry.opts.live) continue;
    const typing = entry.el.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (!typing) paintSheet(entry);
  }
}
export const sheetOpen = () => stack.length > 0;
export function closeSheet(all = false) {
  do {
    const entry = stack.pop();
    if (!entry) break;
    entry.el.classList.remove('open'); entry.el.classList.add('closing');
    entry.opts.onClose?.();
    setTimeout(() => entry.el.remove(), reduced() ? 0 : 320);
    try { entry.focus?.focus?.({ preventScroll: true }); } catch { /* el elemento ya no está */ }
  } while (all && stack.length);
  if (!stack.length) document.body.classList.remove('has-sheet');
}
on('sheet-close', () => closeSheet());
document.addEventListener('keydown', e => { if (e.key === 'Escape' && stack.length) closeSheet(); });

/** Pregunta de sí o no, como hoja. Devuelve una promesa con true/false. */
export function confirmSheet({ title, text, ok = 'Sí', cancel = 'Cancelar', danger = false }) {
  return new Promise(resolve => {
    let answer = false;
    on('confirm-yes', () => { answer = true; closeSheet(); });
    openSheet(() => `<h2 class="sheet-title">${esc(title)}</h2>${text ? `<p class="muted">${esc(text)}</p>` : ''}
      <div class="btns col"><button class="btn ${danger ? 'danger' : 'primary'}" data-act="confirm-yes">${esc(ok)}</button><button class="btn" data-act="sheet-close">${esc(cancel)}</button></div>`,
    { onClose: () => resolve(answer) });
  });
}

/* ---------- dibujos ---------- */
const POT = 'M8 14h32l-3.6 30.4a3.4 3.4 0 0 1-3.4 3H15a3.4 3.4 0 0 1-3.4-3z';
/** Maceta en corte con la franja seca arriba. dry: 0 a 1. */
export function potSvg(dry) {
  const y = 14 + 33.4 * dry;
  return `<svg class="potsvg" viewBox="0 0 48 52" aria-hidden="true"><g clip-path="url(#pot-clip)"><rect class="wet" width="48" height="52"/><rect class="dry" width="48" height="${y.toFixed(1)}"/>${dry > 0 && dry < 1 ? `<path class="edge" d="M6 ${y.toFixed(1)}h36"/>` : ''}</g><path class="wall" d="${POT}"/><rect class="rim" x="5" y="8" width="38" height="7" rx="3.5"/></svg>`;
}
export const depthLabel = id => DEPTHS.find(d => d.id === id)?.label || id;

const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
/** Foto de perfil de la planta, o una hojita de color si todavía no tiene. */
export function avatar(plant, cls = '') {
  if (plant.avatar) return `<span class="avatar ${cls}" data-photo-wrap><img data-photo="${esc(plant.avatar)}" alt="" loading="lazy">${icon('leaf')}</span>`;
  return `<span class="avatar ${cls} empty tone-${hash(plant.id) % 5}">${icon('leaf')}</span>`;
}
export const plantTitle = p => esc(displayName(p));
/** El nombre común debajo del nombre propio, si lo tiene. */
export const plantKind = p => (p.nick && p.nick.trim() ? esc(p.name) : '');

/* ---------- celebración ---------- */
export function celebrate() {
  if (reduced()) return;
  const fx = $('#fx');
  const colors = ['var(--lime)', 'var(--pink)', 'var(--leaf)', 'var(--sun)'];
  fx.innerHTML = Array.from({ length: 26 }, (_, i) => {
    const x = 8 + Math.random() * 84, d = Math.random() * 0.35, r = Math.random() * 360, s = 0.7 + Math.random() * 0.8, drift = (Math.random() - 0.5) * 120;
    return `<i style="left:${x}%;--d:${d}s;--r:${r}deg;--s:${s};--x:${drift}px;background:${colors[i % colors.length]}"></i>`;
  }).join('');
  fx.classList.add('go');
  setTimeout(() => { fx.classList.remove('go'); fx.innerHTML = ''; }, 2400);
}

/* ---------- formularios ---------- */
/** Lee los campos con name de un contenedor: { nombre: valor } */
export function readForm(root) {
  const out = {};
  for (const el of $$('[name]', root)) {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value.trim();
  }
  return out;
}
export const field = (label, control, hint = '') => `<label class="field"><span class="label">${esc(label)}</span>${control}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>`;
export const seg = (name, options, value) => `<div class="seg" role="radiogroup">${options.map(([v, l]) => `<label><input type="radio" name="${name}" value="${esc(v)}" ${v === value ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>`;
