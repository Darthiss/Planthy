// Ajustes: vos, la casa, el Fertifox, los avisos, la sincronización y tus datos.

import { state, cfg, saveCfg, settings, setSetting, commit, emit, today } from '../store.js';
import { AIRE, doseText } from '../rules.js';
import { addDays, fmtShort } from '../dates.js';
import { esc, icon, on, haptic, toast, openSheet, closeSheet, updateSheet, field, readForm } from './dom.js';
import { syncOn, syncNow, testConnection, tokenDaysLeft } from '../sync.js';
import { pushStatus, enablePush, disablePush, testNotification, refreshPush, isStandalone, isIOS } from '../push.js';
import { buildExport, importFile, shareFile } from '../backup.js';
import { photoBytes } from '../photos.js';
import { searchPlace } from '../meteo.js';
import { refreshWeather } from '../weather.js';
import { setAire } from './hoy.js';

export const title = 'Ajustes';
export const VERSION = '1.0.0';
const AIRE_ICON = { apagado: 'off', frio: 'snow', calor: 'flame' };

const row = (act, ic, label, value = '', extra = '') => `<button class="row" data-act="${act}" ${extra}>${icon(ic, 'lead')}<span class="grow">${label}</span><span class="val">${value}</span>${icon('chev', 'dim')}</button>`;
const ago = ms => { if (!ms) return 'nunca'; const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`; };

/* ---------- estado de la sincronización, para mostrar ---------- */
export function syncSummary() {
  if (!syncOn()) return { cls: 'off', text: 'Sin conectar: los datos quedan solo en este teléfono.' };
  const left = tokenDaysLeft();
  if (cfg.syncState === 'token') return { cls: 'bad', text: cfg.syncMsg };
  if (cfg.syncState === 'error') return { cls: 'warn', text: cfg.syncMsg };
  if (cfg.syncState === 'offline') return { cls: 'warn', text: 'Sin conexión. Sincronizo cuando vuelva.' };
  if (cfg.syncState === 'pending') return { cls: 'pending', text: 'Sincronizando…' };
  if (left != null && left <= 14) return { cls: 'warn', text: left < 0 ? 'El token venció. Generá uno nuevo.' : `Sincronizado ${ago(cfg.lastSync)}. El token vence en ${left} ${left === 1 ? 'día' : 'días'}.` };
  return { cls: 'ok', text: `Sincronizado ${ago(cfg.lastSync)}.` };
}

function pushBlock() {
  const st = pushStatus();
  const subs = state.db.subs;
  const t = settings().reminderTime || '09:00';
  const msg = {
    on: `Activadas en este teléfono. Te aviso una vez por día, desde las ${t}, si toca algo.`,
    off: 'Activalas para que te avise qué hacer y cuándo.',
    denied: 'Las bloqueaste. Activalas en Ajustes del iPhone → Notificaciones → Planthy.',
    install: 'En el iPhone, las notificaciones solo funcionan con la app instalada: Compartir → Agregar a inicio, y abrila desde el ícono.',
    unsupported: 'Este navegador no soporta notificaciones push. Usá el Calendario.',
    nokey: syncOn() ? 'Falta la clave de notificaciones en data.json (ver README).' : 'Primero conectá la sincronización.',
  }[st];
  return `<div class="card rows">
    <div class="row static">${icon('bell', 'lead')}<span class="grow"><b>Notificaciones</b><small>${esc(msg)}</small></span></div>
    ${st === 'off' ? `<div class="row static"><button class="btn primary wide" data-act="push-on">Activar notificaciones</button></div>` : ''}
    ${st === 'on' ? `<button class="row" data-act="push-test">${icon('sparkle', 'lead')}<span class="grow">Probar en este teléfono</span></button><button class="row" data-act="push-off">${icon('x', 'lead')}<span class="grow">Desactivar en este teléfono</span></button>` : ''}
    ${subs.length ? `<div class="row static">${icon('user', 'lead')}<span class="grow"><small>Reciben avisos</small><span>${subs.map(s => esc(`${s.who || 'Sin nombre'} (${s.device || 'teléfono'})`)).join(', ')}</span></span></div>` : ''}
    ${row('ics-open', 'calendar', 'Agregar al Calendario', '', '')}
  </div>
  <p class="foot">El aviso lo manda GitHub cada día y puede llegar unos minutos tarde. El Calendario avisa siempre a horario.</p>`;
}

export function render() {
  const s = settings();
  const sum = syncSummary();
  const label = Number(s.labelDose);
  return `<header class="top"><h1>Ajustes</h1></header>
    <h2 class="grp">Vos</h2>
    <div class="card rows">${row('who-open', 'user', 'Tu nombre', esc(cfg.who || 'Sin nombre'))}</div>
    <p class="foot">Queda guardado en cada registro, para saber quién regó.</p>

    <h2 class="grp">Casa</h2>
    <div class="card rows">
      <div class="row static col">${icon('wind', 'lead')}<span class="grow"><b>Modo aire</b><small>Lo cambiás cuando empieza o termina la temporada.</small></span></div>
      <div class="row static"><div class="seg solo full">${Object.entries(AIRE).map(([v, l]) => `<button class="${s.aire === v ? 'on' : ''}" data-act="aire-quick" data-v="${v}">${icon(AIRE_ICON[v])}${l}</button>`).join('')}</div></div>
      ${row('heat-open', 'thermo', 'Umbral de calor', `${esc(s.heat)} °C`)}
      ${row('place-open', 'pin', 'Ubicación para el clima', esc(s.location?.name || 'Buenos Aires'))}
      ${row('time-open', 'clock', 'Hora de los recordatorios', esc(s.reminderTime || '09:00'))}
    </div>

    <h2 class="grp">Fertifox Potenciado</h2>
    <div class="card rows">${row('dose-open', 'flask', 'Dosis de la etiqueta', label > 0 ? `${String(label).replace('.', ',')} ml por litro` : '<span class="need">Cargala</span>')}</div>
    <p class="foot">${label > 0 ? `La app usa la mitad: ${esc(doseText({ group: 'semanal' }, s))}. Las plantas en agua llevan 5 gotas.` : 'Leela en el envase. La app usa la mitad para todo, salvo las plantas en agua, que llevan 5 gotas.'}</p>

    <h2 class="grp">Avisos</h2>
    ${pushBlock()}

    <h2 class="grp">Sincronización</h2>
    <div class="card rows">
      <div class="row static">${icon('sync', `lead sync-${sum.cls}`)}<span class="grow"><b>${syncOn() ? esc(`${cfg.sync.owner}/${cfg.sync.repo}`) : 'Repo privado de GitHub'}</b><small class="sync-${sum.cls}">${esc(sum.text)}</small></span></div>
      ${syncOn() ? `<button class="row" data-act="sync-now">${icon('sync', 'lead')}<span class="grow">Sincronizar ahora</span></button>` : ''}
      ${row('sync-open', 'key', syncOn() ? 'Cambiar token o repo' : 'Conectar', syncOn() && cfg.sync.expires ? `vence ${fmtShort(new Date(cfg.sync.expires).toISOString().slice(0, 10))}` : '')}
    </div>
    <p class="foot">El token queda solo en este teléfono. Con el mismo token, tu pareja ve y anota lo mismo desde el suyo.</p>

    <h2 class="grp">Tus datos</h2>
    <div class="card rows">
      <button class="row" data-act="export">${icon('download', 'lead')}<span class="grow">Exportar todo</span><span class="val">.zip con fotos</span></button>
      <label class="row">${icon('upload', 'lead')}<span class="grow">Importar</span><span class="val">.zip o .json</span><input type="file" accept=".zip,.json,application/zip,application/json" data-change="import" hidden></label>
      <div class="row static">${icon('image', 'lead')}<span class="grow">Fotos en este teléfono</span><span class="val" id="photo-bytes">${state.db.photos.length}</span></div>
    </div>
    <p class="foot">Importar suma lo que trae el archivo a lo que ya hay, sin borrar nada.</p>

    ${s.guide?.general?.length ? `<h2 class="grp">Para tener en cuenta</h2><div class="card prose"><ul>${s.guide.general.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}

    <h2 class="grp">Acerca</h2>
    <div class="card rows">
      ${row('install-open', 'home', 'Instalar en el iPhone', isStandalone() ? 'Instalada' : '')}
      <div class="row static">${icon('leaf', 'lead')}<span class="grow">Planthy</span><span class="val">versión ${VERSION}</span></div>
    </div>`;
}

export async function after(root) {
  const el = root.querySelector('#photo-bytes');
  if (!el || !state.db.photos.length) return;
  const bytes = await photoBytes();
  if (el.isConnected) el.textContent = `${state.db.photos.length} · ${bytes > 1e6 ? `${(bytes / 1e6).toFixed(1).replace('.', ',')} MB` : `${Math.round(bytes / 1e3)} KB`}`;
}

/* ---------- vos ---------- */
on('who-open', () => openSheet(() => `<h2 class="sheet-title">Tu nombre</h2>
  <form class="form" data-submit="who-save">${field('Nombre', `<input name="who" value="${esc(cfg.who)}" placeholder="Ej.: Lucas" autocomplete="given-name" autofocus>`)}<button class="btn primary big">Guardar</button></form>`));
on('who-save', form => { cfg.who = readForm(form).who; saveCfg(); refreshPush(); closeSheet(); emit(); toast('Listo.'); });

/* ---------- casa ---------- */
on('aire-quick', el => setAire(el.dataset.v));
on('heat-open', () => openSheet(() => `<h2 class="sheet-title">Umbral de calor</h2>
  <p class="muted">Si la máxima del lunes, el martes o el miércoles supera este número, el miércoles te pido revisar las plantas que lo necesitan.</p>
  <form class="form" data-submit="heat-save">${field('Grados', `<input name="heat" type="number" inputmode="decimal" step="0.5" min="20" max="45" value="${esc(settings().heat)}" required>`)}<button class="btn primary big">Guardar</button></form>`));
on('heat-save', form => {
  const n = Number(readForm(form).heat.replace(',', '.'));
  if (!(n >= 20 && n <= 45)) return toast('Poné un número entre 20 y 45.');
  setSetting('heat', n); commit(); closeSheet(); toast(`Umbral: ${n} °C.`);
});

let places = null;
on('place-open', () => { places = null; openSheet(() => `<h2 class="sheet-title">Ubicación para el clima</h2>
  <p class="muted">Ahora: ${esc(settings().location?.name || 'Buenos Aires')}. El pronóstico sale de Open-Meteo.</p>
  <form class="form" data-submit="place-search">${field('Ciudad', '<input name="q" placeholder="Ej.: Rosario" autocomplete="off" required>')}<button class="btn big">Buscar</button></form>
  ${places ? (places.length ? `<div class="card rows">${places.map((p, i) => `<button class="row" data-act="place-pick" data-i="${i}">${icon('pin', 'lead')}<span class="grow">${esc(p.name)}</span></button>`).join('')}</div>` : '<p class="empty">No encontré esa ciudad.</p>') : ''}`); });
on('place-search', async form => {
  try { places = await searchPlace(readForm(form).q); updateSheet(); }
  catch { toast('No pude buscar. ¿Hay conexión?'); }
});
on('place-pick', el => {
  const p = places?.[Number(el.dataset.i)];
  if (!p) return;
  setSetting('location', p); commit(); closeSheet(); refreshWeather(true); toast(`Clima de ${p.name.split(',')[0]}.`);
});

on('time-open', () => openSheet(() => `<h2 class="sheet-title">Hora de los recordatorios</h2>
  <p class="muted">GitHub revisa cada hora, de 7 a 22. El aviso sale en la primera vuelta después de esta hora.</p>
  <form class="form" data-submit="time-save">${field('Hora', `<input name="time" type="time" min="07:00" max="22:00" value="${esc(settings().reminderTime || '09:00')}" required>`)}<button class="btn primary big">Guardar</button></form>`));
on('time-save', form => {
  const v = readForm(form).time;
  if (!/^\d\d:\d\d$/.test(v) || v < '07:00' || v > '22:00') return toast('Elegí una hora entre las 7 y las 22.');
  setSetting('reminderTime', v); commit(); closeSheet(); toast(`Te aviso desde las ${v}.`);
});

on('dose-open', () => openSheet(() => `<h2 class="sheet-title">Dosis de la etiqueta</h2>
  <p class="muted">Buscá en el envase del Fertifox Potenciado cuántos ml por litro de agua indica. La app usa la mitad.</p>
  <form class="form" data-submit="dose-save">${field('ml por litro', `<input name="dose" type="number" inputmode="decimal" step="0.1" min="0.1" max="100" value="${esc(settings().labelDose ?? '')}" placeholder="Lo que dice la etiqueta" required>`)}<button class="btn primary big">Guardar</button></form>`));
on('dose-save', form => {
  const n = Number(readForm(form).dose.replace(',', '.'));
  if (!(n > 0 && n <= 100)) return toast('Poné los ml por litro de la etiqueta.');
  setSetting('labelDose', n); commit(); closeSheet(); toast(`Media dosis: ${doseText({ group: 'semanal' }, settings())}.`);
});

/* ---------- avisos ---------- */
on('push-on', async el => {
  el.disabled = true;
  try { await enablePush(); haptic(); toast('¡Listo! Te voy a avisar.'); }
  catch (e) { toast(e.message || 'No pude activarlas.', { ms: 6000 }); }
  emit();
});
on('push-off', async () => { await disablePush(); toast('Notificaciones desactivadas en este teléfono.'); emit(); });
on('push-test', async () => { try { await testNotification(); } catch { toast('No pude mostrar la prueba.'); } });

/* ---------- sincronización ---------- */
const nextYear = () => addDays(today(), 365);
export function syncForm(prefix = 'sync') {
  const s = cfg.sync || {};
  const expires = s.expires ? new Date(s.expires).toISOString().slice(0, 10) : nextYear();
  return `<form class="form" data-submit="${prefix}-save">
    ${field('Usuario de GitHub', `<input name="owner" value="${esc(s.owner || '')}" placeholder="Ej.: Darthiss" autocapitalize="none" autocorrect="off" spellcheck="false" required>`)}
    ${field('Repo privado de datos', `<input name="repo" value="${esc(s.repo || 'planthy-data')}" autocapitalize="none" autocorrect="off" spellcheck="false" required>`)}
    ${field('Token', `<input name="token" type="password" value="${esc(s.token || '')}" placeholder="github_pat_…" autocapitalize="none" autocorrect="off" spellcheck="false" required>`)}
    ${field('Vence el', `<input name="expires" type="date" value="${expires}">`, 'La fecha que elegiste al crear el token. Te aviso dos semanas antes.')}
    <button class="btn primary big">Conectar y sincronizar</button>
  </form>
  <details class="help"><summary>¿Cómo saco el token?</summary><ol>
    <li>En GitHub: Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token.</li>
    <li>Expiration: 1 año. Repository access: <b>Only select repositories</b> → planthy-data.</li>
    <li>Permissions → Repository → <b>Contents: Read and write</b>. Nada más.</li>
    <li>Copialo y pegalo acá. Usá el mismo en los dos teléfonos.</li></ol></details>`;
}
export function readSync(form) {
  const f = readForm(form);
  return { owner: f.owner.replace(/^@/, '').trim(), repo: f.repo.trim(), token: f.token.trim(), expires: f.expires ? Date.parse(`${f.expires}T12:00:00-03:00`) : null };
}

/** Conecta y sincroniza. allowCreate: si el repo está vacío, crea data.json con lo de este teléfono. */
export async function connect(sync, { allowCreate = true } = {}) {
  const test = await testConnection(sync);
  if (!test.ok) return { ok: false, message: test.message };
  if (!test.hasData && !allowCreate) return { ok: false, empty: true, message: 'El repo existe pero no tiene data.json.' };
  cfg.sync = { ...sync, savedAt: Date.now() }; cfg.syncState = 'pending'; saveCfg();
  const ok = await syncNow();
  if (ok) refreshPush();
  return { ok, message: ok ? '' : cfg.syncMsg };
}

on('sync-open', () => openSheet(() => `<h2 class="sheet-title">${syncOn() ? 'Sincronización' : 'Conectar'}</h2>
  <p class="muted">Tus datos se guardan en tu repo privado de GitHub. Así los dos teléfonos ven lo mismo y siempre tenés una copia.</p>
  ${syncForm('sync')}
  ${syncOn() ? '<div class="btns col"><button class="btn danger ghost" data-act="sync-off">Desconectar este teléfono</button></div>' : ''}`));
on('sync-save', async form => {
  const sync = readSync(form);
  if (!sync.owner || !sync.repo || !sync.token) return toast('Completá usuario, repo y token.');
  const btn = form.querySelector('button.primary'); btn.disabled = true; btn.textContent = 'Conectando…';
  const res = await connect(sync);
  if (res.ok) { closeSheet(); haptic(); toast(`¡Conectado! ${state.db.plants.length} plantas sincronizadas.`); }
  else { btn.disabled = false; btn.textContent = 'Conectar y sincronizar'; toast(res.message || 'No pude conectar.', { ms: 6000 }); }
  emit();
});
on('sync-now', async () => { toast('Sincronizando…'); const ok = await syncNow(); toast(ok ? 'Todo sincronizado.' : cfg.syncMsg || 'No pude sincronizar.', { ms: ok ? 2000 : 6000 }); });
on('sync-off', async () => {
  cfg.sync = null; cfg.syncState = ''; cfg.syncMsg = ''; saveCfg();
  closeSheet(); emit(); toast('Este teléfono ya no sincroniza. Los datos siguen acá.');
});

/* ---------- tus datos ---------- */
on('export', async el => {
  el.disabled = true;
  try {
    toast('Preparando la copia…', { ms: 60000 });
    const { blob, name, missing } = await buildExport((n, total) => toast(`Juntando fotos… ${n} de ${total}`, { ms: 60000 }));
    toast(missing ? `Copia lista. Faltaron ${missing} fotos que no están en este teléfono ni en el repo.` : 'Copia lista.', { ms: 4000 });
    await shareFile(name, blob, 'application/zip');
  } catch (e) { toast(e.message || 'No pude exportar.'); }
  el.disabled = false;
});
on('import', async el => {
  const file = el.files?.[0];
  el.value = '';
  if (!file) return;
  try {
    const r = await importFile(file);
    haptic();
    toast(`Importado: ${r.total} plantas${r.events > 0 ? `, ${r.events} registros nuevos` : ''}${r.photos ? `, ${r.photos} fotos` : ''}.`, { ms: 5000 });
  } catch (e) { toast(e.message || 'No pude importar ese archivo.', { ms: 5000 }); }
});

/* ---------- instalar ---------- */
on('install-open', () => openSheet(() => `<h2 class="sheet-title">Instalar en el iPhone</h2>
  <ol class="steps">
    <li>Abrí esta página en <b>Safari</b>.</li>
    <li>Tocá <b>Compartir</b> ${icon('share')} y elegí <b>Agregar a inicio</b>.</li>
    <li>Abrí Planthy desde el ícono. Así anda sin conexión y puede mandarte notificaciones (iOS 16.4 o más nuevo).</li>
  </ol>
  <p class="muted">${isStandalone() ? '¡Ya la estás usando instalada!' : isIOS() ? 'Ahora la estás viendo en el navegador.' : 'En la computadora también funciona, pero las notificaciones del iPhone necesitan la app instalada.'}</p>
  <p class="muted small">La app instalada guarda sus datos aparte de Safari. Si borrás el ícono, se borran los datos de este teléfono (los sincronizados siguen en el repo).</p>`));
