// Arranque: carga los datos del teléfono, pinta la pantalla y sincroniza en segundo plano.

import { init, state, cfg, subscribe, today, byId } from './store.js';
import { syncNow, syncOn } from './sync.js';
import { refreshWeather } from './weather.js';
import { refreshPush, clearBadge } from './push.js';
import { $, $$, on, bindActions, transition, closeSheet, refreshLiveSheets } from './ui/dom.js';
import { hydrate } from './photos.js';
import { displayName } from './rules.js';
import * as hoy from './ui/hoy.js';
import * as plantas from './ui/plantas.js';
import * as calendario from './ui/calendario.js';
import * as ajustes from './ui/ajustes.js';
import * as onboarding from './ui/onboarding.js';
import './ui/registro.js';
import './ui/fotos.js';
import './ui/tareas.js';

const VIEWS = { hoy, plantas, calendario, ajustes };

function route() {
  const [name, ...rest] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (name === 'planta' && rest.length) return { tab: 'plantas', view: plantas, arg: rest.join('/'), sub: true };
  return VIEWS[name] ? { tab: name, view: VIEWS[name] } : { tab: 'hoy', view: hoy };
}

let lastKey = '';
function render() {
  if (!state.ready) return;
  const r = route(), ob = onboarding.needed();
  document.body.classList.toggle('ob-mode', ob);
  document.body.classList.toggle('sub', !!r.sub && !ob);
  const view = $('#view');
  view.innerHTML = ob ? onboarding.render() : r.view.render(r.arg);
  hydrate(view);
  if (!ob) r.view.after?.(view, r.arg);
  const plant = r.sub ? byId('plants', r.arg) : null;
  $('#navtitle').textContent = ob ? '' : plant ? displayName(plant) : r.view.title;
  for (const b of $$('#tabs [data-tab]')) {
    const cur = b.dataset.tab === r.tab;
    b.classList.toggle('on', cur);
    if (cur) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  const dot = $('#tabs [data-tab=ajustes] .tdot');
  const bad = syncOn() && (cfg.syncState === 'token' || cfg.syncState === 'error');
  dot.className = `tdot${bad ? ' on' : ''}`;
  const key = ob ? `ob:${cfg.obStep}` : location.hash || '#hoy';
  if (key !== lastKey) { window.scrollTo(0, 0); lastKey = key; }
  onScroll();
}

// Varios cambios seguidos se pintan una sola vez.
let queued = false;
function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; render(); refreshLiveSheets(); });
}
subscribe(schedule);
window.addEventListener('planthy:render', render);

/* ---------- navegación ---------- */
let internal = false;
window.addEventListener('hashchange', () => { internal = true; closeSheet(true); transition(render); });
on('nav-back', () => { if (internal) history.back(); else location.hash = '#plantas'; });
document.addEventListener('click', e => {
  const a = e.target.closest('#tabs a[data-tab]');
  if (a && a.getAttribute('href') === (location.hash || '#hoy')) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
});
function onScroll() { document.body.classList.toggle('scrolled', window.scrollY > 36); }
window.addEventListener('scroll', onScroll, { passive: true });

/* ---------- ciclo de vida ---------- */
let day = null;
function wake() {
  if (today() !== day) { day = today(); render(); }
  clearBadge();
  refreshWeather();
  if (syncOn()) syncNow().then(ok => { if (ok) refreshPush(); });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
window.addEventListener('online', () => { if (syncOn()) syncNow(); });
// Si queda abierta: cambio de día a medianoche y novedades del otro teléfono cada tanto.
setInterval(() => { if (document.visibilityState === 'visible' && today() !== day) { day = today(); render(); } }, 60e3);
setInterval(() => { if (document.visibilityState === 'visible' && syncOn()) syncNow(); }, 120e3);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sin modo sin conexión */ });
  navigator.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'go' && e.data.hash) location.hash = e.data.hash; });
}

bindActions();
await init();
day = today();
render();
wake();
