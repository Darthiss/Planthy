// Primer uso: instalar, tu nombre, pegar el token y sincronizar, activar notificaciones.
// La precarga (plantas, historial y tareas) no está en el repo público: llega con la primera sincronización.

import { state, cfg, saveCfg, emit } from '../store.js';
import { esc, icon, on, haptic, toast, field, readForm } from './dom.js';
import { syncForm, readSync, connect } from './ajustes.js';
import { pushStatus, enablePush, isStandalone, isIOS } from '../push.js';
import { syncOn } from '../sync.js';

const STEPS = ['hola', 'instalar', 'nombre', 'conectar', 'avisos'];
export const needed = () => !cfg.onboarded;
const step = () => (STEPS.includes(cfg.obStep) ? cfg.obStep : 'hola');
let empty = false; // el repo existe pero no tiene data.json

function go(next) { cfg.obStep = next; saveCfg(); haptic(); emit(); window.scrollTo(0, 0); }
function finish() { cfg.onboarded = true; cfg.obStep = null; saveCfg(); location.hash = '#hoy'; emit(); }

function frame(art, title, body, foot = '') {
  const i = STEPS.indexOf(step());
  return `<div class="ob">
    <div class="ob-dots" aria-hidden="true">${STEPS.map((_, j) => `<i class="${j === i ? 'on' : j < i ? 'done' : ''}"></i>`).join('')}</div>
    <div class="ob-art">${art}</div>
    <h1>${title}</h1>
    ${body}
    ${foot ? `<div class="ob-foot">${foot}</div>` : ''}
  </div>`;
}

export function render() {
  switch (step()) {
    case 'hola': return frame(`<img src="icons/icon.svg" alt="" class="ob-logo">`, 'Hola, soy Planthy',
      `<p class="lead">Te aviso cuándo pasarles el palito, regar y fertilizar, y guardo cómo van creciendo tus plantas.</p>`,
      `<button class="btn primary big wide" data-act="ob-go" data-to="instalar">Empezar</button>`);

    case 'instalar': {
      if (isStandalone()) return frame(icon('check', 'huge ok'), '¡Ya está instalada!', `<p class="lead">Abrís Planthy desde el ícono, anda sin conexión y puede mandarte avisos.</p>`,
        `<button class="btn primary big wide" data-act="ob-go" data-to="nombre">Seguir</button>`);
      return frame(icon('home', 'huge'), 'Instalala en tu iPhone',
        `<ol class="steps"><li>Abrí esta página en <b>Safari</b>.</li><li>Tocá <b>Compartir</b> ${icon('share')} → <b>Agregar a inicio</b>.</li><li>Abrí Planthy desde el ícono y seguí desde ahí.</li></ol>
         <p class="muted small">${isIOS() ? 'Lo que cargues acá, en Safari, no pasa a la app instalada: conviene instalarla primero.' : 'En la computadora podés usarla así, en el navegador.'}</p>`,
        `<button class="btn ${isIOS() ? '' : 'primary '}big wide" data-act="ob-go" data-to="nombre">${isIOS() ? 'Seguir en Safari igual' : 'Seguir'}</button>`);
    }

    case 'nombre': return frame(icon('user', 'huge'), '¿Cómo te llamás?',
      `<p class="lead">Lo guardo en cada registro, así sabemos quién regó.</p>
       <form class="form" data-submit="ob-name">${field('Tu nombre', `<input name="who" value="${esc(cfg.who)}" placeholder="Ej.: Lucas" autocomplete="given-name" required>`)}<button class="btn primary big wide">Seguir</button></form>`);

    case 'conectar': {
      if (syncOn() && state.db.plants.length) {
        const n = state.db.plants.filter(p => !p.archived).length;
        return frame(icon('leaf', 'huge ok'), `¡Llegaron tus ${n} plantas!`,
          `<p class="lead">También el historial y las tareas. Todo lo que anotes se sincroniza con el otro teléfono.</p>`,
          `<button class="btn primary big wide" data-act="ob-go" data-to="avisos">Seguir</button>`);
      }
      return frame(icon('key', 'huge'), 'Conectá tus datos',
        `<p class="lead">Tus plantas viven en tu repo privado de GitHub. Pegá el token y las traigo.</p>
         ${empty ? `<div class="banner warn">${icon('note')}<span><b>El repo está vacío</b><small>No encontré data.json. Subí el de la precarga (ver README) y probá de nuevo, o empezá de cero.</small></span></div>
           <div class="btns col"><button class="btn" data-act="ob-create">Empezar de cero en ese repo</button></div>` : ''}
         ${syncForm('ob-sync')}`,
        `<button class="link" data-act="ob-skip-sync">Seguir sin sincronizar</button>`);
    }

    case 'avisos': {
      const st = pushStatus();
      const body = {
        off: '<p class="lead">Te aviso una vez por día, solo si toca algo. Por ejemplo: “Domingo de plantas: 5 para revisar, 1 con Fertifox”.</p>',
        on: '<p class="lead">¡Listo! Las notificaciones están activadas en este teléfono.</p>',
        denied: '<p class="lead">Las notificaciones están bloqueadas. Podés activarlas en Ajustes del iPhone → Notificaciones → Planthy.</p>',
        install: '<p class="lead">En el iPhone, los avisos funcionan con la app instalada en la pantalla de inicio. Mientras tanto, podés usar el Calendario.</p>',
        unsupported: '<p class="lead">Este navegador no tiene notificaciones. Podés usar el Calendario.</p>',
        nokey: `<p class="lead">${syncOn() ? 'Falta la clave de notificaciones en tus datos (ver README).' : 'Sin sincronizar no puedo mandarte avisos.'} Podés usar el Calendario.</p>`,
      }[st];
      return frame(icon('bell', 'huge'), 'Avisos', `${body}
        <button class="btn big wide" data-act="ics-open">${icon('calendar')}Agregar al Calendario</button>`,
        st === 'off'
          ? `<button class="btn primary big wide" data-act="ob-push">Activar notificaciones</button><button class="link" data-act="ob-done">Ahora no</button>`
          : `<button class="btn primary big wide" data-act="ob-done">Empezar</button>`);
    }
  }
  return '';
}

on('ob-go', el => go(el.dataset.to));
on('ob-name', form => {
  const who = readForm(form).who;
  if (!who) return toast('Poné tu nombre.');
  cfg.who = who; saveCfg(); go('conectar');
});

async function doConnect(form, allowCreate) {
  const sync = readSync(form);
  if (!sync.owner || !sync.repo || !sync.token) return toast('Completá usuario, repo y token.');
  const btn = form.querySelector('button.primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Conectando…'; }
  const res = await connect(sync, { allowCreate });
  if (res.ok) { empty = false; haptic(); emit(); return; }
  if (btn) { btn.disabled = false; btn.textContent = 'Conectar y sincronizar'; }
  if (res.empty) { empty = true; emit(); return; }
  toast(res.message || 'No pude conectar.', { ms: 6000 });
}
on('ob-sync-save', form => doConnect(form, false));
on('ob-create', () => { const form = document.querySelector('.ob form[data-submit="ob-sync-save"]'); if (form) doConnect(form, true); });
on('ob-skip-sync', () => go('avisos'));
on('ob-push', async el => {
  el.disabled = true;
  try { await enablePush(); toast('¡Listo! Te voy a avisar.'); finish(); }
  catch (e) { el.disabled = false; toast(e.message || 'No pude activarlas.', { ms: 6000 }); emit(); }
});
on('ob-done', () => finish());
