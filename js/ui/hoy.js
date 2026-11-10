// Pantalla "Hoy": lo que toca y lo atrasado, con el registro en la misma tarjeta.

import { state, cfg, saveCfg, settings, today, byId, patch, commit, emit, setSetting, put, remove } from '../store.js';
import { agenda, statusLabel, STICK_RULES, tasksDue, birthdaysOn, AIRE } from '../rules.js';
import { fmtLong, relDay, addDays, fmtShort } from '../dates.js';
import { newId } from '../merge.js';
import { esc, icon, on, avatar, plantTitle, cap, haptic, toast, celebrate, openSheet, closeSheet } from './dom.js';
import { potScale, waterButtons, fertNote, eventTitle, EVENT_ICON } from './registro.js';
import { syncOn, tokenDaysLeft } from '../sync.js';
import { summarize } from './calendario.js';

export const title = 'Hoy';
// El texto completo (con qué planta cuidar más) viene en los datos: settings.guide.aireTarea.
export const AIRE_TAREA = 'Fijate que el aire no le tire directo a ninguna planta. Orientá las aletas o corré las plantas';
const AIRE_ICON = { apagado: 'off', frio: 'snow', calor: 'flame' };

/* ---------- qué hay pendiente ---------- */
const dismissKey = (it, t) => it.kind === 'foto' ? `foto:${t.slice(0, 7)}` : it.kind === 'puntas' ? `puntas:${it.due}` : `${it.kind}:${it.plant?.id}:${t}`;
const isDismissed = (it, t) => !!cfg.dismissed?.[dismissKey(it, t)];

export function pendingToday(t = today()) {
  return (agenda(state.db, t, t, state.weather).get(t) || []).filter(it => !['tarea', 'cumple'].includes(it.kind) && !isDismissed(it, t));
}

on('dismiss', el => {
  const t = today();
  // Limpia las marcas viejas para que no crezcan para siempre.
  const keep = Object.fromEntries(Object.entries(cfg.dismissed || {}).filter(([, d]) => d >= addDays(t, -40)));
  keep[el.dataset.key] = t;
  cfg.dismissed = keep; saveCfg(); haptic(); emit();
  toast('Listo, por hoy no.', { undo: () => { delete cfg.dismissed[el.dataset.key]; saveCfg(); emit(); } });
});

/* ---------- tarjetas ---------- */
function head(plant, label, kind, overdue) {
  return `<header class="task-head">
    <a class="who" href="#planta/${esc(plant.id)}">${avatar(plant, 'sm')}<span><b>${plantTitle(plant)}</b><small>${esc(plant.location || '')}</small></span></a>
    <span class="pill k-${kind}${overdue ? ' late' : ''}">${esc(label)}</span></header>`;
}
const later = (it, t, text = 'Ahora no') => `<button class="link" data-act="dismiss" data-key="${esc(dismissKey(it, t))}">${text}</button>`;
const vt = id => `style="view-transition-name:c-${esc(id).replace(/[^a-z0-9-]/gi, '')}"`;

function plantCard(it, t) {
  const p = it.plant, s = settings();
  const label = statusLabel(it, t) + (it.kind === 'calor' && it.heatMax != null ? ` (${Math.round(it.heatMax)} °C)` : '');
  if (it.kind === 'agua') {
    const fert = it.fert;
    return `<article class="card task k-agua" ${vt(p.id)}>${head(p, label, 'agua', it.overdue)}
      ${p.waterNote ? `<p class="rule">${esc(p.waterNote)}</p>` : ''}
      ${fert ? `<p class="note fert">${icon('flask')}<span>Este mes van ${esc(fert.dose)}.</span></p>` : ''}
      ${fert
        ? `<div class="btns col"><button class="btn primary big two" data-act="agua" data-id="${esc(p.id)}" data-fert="1">${icon('glass')}<span><b>Cambié el agua, con Fertifox</b><small>${esc(fert.dose)}</small></span></button><button class="btn" data-act="agua" data-id="${esc(p.id)}">Cambié el agua, sin gotas</button></div>`
        : `<div class="btns"><button class="btn primary big" data-act="agua" data-id="${esc(p.id)}">${icon('glass')}Cambié el agua</button></div>`}
    </article>`;
  }
  if (it.kind === 'regar') {
    const how = s.guide?.comoRegar;
    return `<article class="card task k-regar" ${vt(p.id)}>${head(p, label, 'regar', it.overdue)}
      <p class="rule">Salió seca: toca regar.${how ? ` ${esc(how)}` : ''}</p>
      ${p.waterNote ? `<p class="note">${icon('note')}<span>${esc(p.waterNote)}</span></p>` : ''}
      ${waterButtons(p, t)}
      <div class="row-end">${later(it, t)}</div>
    </article>`;
  }
  // revisar · recheck · calor: el palito decide
  const rule = STICK_RULES[p.rule];
  return `<article class="card task k-${it.kind}" ${vt(p.id)}>${head(p, label, it.kind, it.overdue)}
    ${rule ? `<p class="rule">${esc(rule.label)}.${p.ruleNote ? ` ${esc(p.ruleNote)}` : ''}</p>` : ''}
    ${fertNote(it.fert)}
    <p class="ask">¿Hasta dónde salió seco?</p>
    ${potScale(p.id)}
  </article>`;
}

function puntasCard(it, t) {
  const s = settings();
  return `<article class="card task k-puntas" ${vt('puntas')}>
    <header class="task-head"><span class="who">${icon('wind', 'lead')}<span><b>Puntas secas</b><small>El aire está en ${esc(AIRE[s.aire]?.toLowerCase() || '')}</small></span></span><span class="pill k-puntas${it.overdue ? ' late' : ''}">${it.overdue ? 'Pendiente' : 'Esta semana'}</span></header>
    <p class="rule">Son las más sensibles al aire seco. Fijate si tienen puntas secas.</p>
    <ul class="mini">${it.plants.map(p => `<li>${avatar(p, 'xs')}<span>${plantTitle(p)}</span>
      <button class="chip" data-act="puntas" data-id="${esc(p.id)}" data-result="bien">${icon('check')}Bien</button>
      <button class="chip warn" data-act="puntas" data-id="${esc(p.id)}" data-result="secas">Puntas secas</button></li>`).join('')}</ul>
    <div class="row-end">${later(it, t)}</div>
  </article>`;
}

function fotoCard(it, t) {
  return `<article class="card task k-foto" ${vt('foto')}>
    <header class="task-head"><span class="who">${icon('camera', 'lead')}<span><b>Foto del mes</b><small>Para ver cómo crecen</small></span></span></header>
    <p class="rule">Sacales una foto con el mismo encuadre que la anterior.</p>
    <div class="strip">${it.plants.map(p => `<button class="strip-item" data-act="photo-new" data-id="${esc(p.id)}">${avatar(p, 'md')}<span>${plantTitle(p)}</span></button>`).join('')}</div>
    <div class="row-end">${later(it, t, 'Este mes no')}</div>
  </article>`;
}

/* ---------- avisos de arriba ---------- */
function banners(t) {
  const out = [];
  if (syncOn() && cfg.syncState === 'token') {
    out.push(`<div class="banner bad">${icon('key')}<span><b>La sincronización se cortó</b><small>${esc(cfg.syncMsg || 'Revisá el token.')}</small></span><a class="btn sm" href="#ajustes">Arreglar</a></div>`);
  } else if (syncOn() && cfg.syncState === 'error') {
    out.push(`<div class="banner warn">${icon('sync')}<span><b>No pude sincronizar</b><small>${esc(cfg.syncMsg)}</small></span><button class="btn sm" data-act="sync-now">Reintentar</button></div>`);
  }
  const left = tokenDaysLeft();
  if (left != null && left <= 14 && cfg.syncState !== 'token') {
    out.push(`<div class="banner warn">${icon('key')}<span><b>${left < 0 ? 'El token venció' : left === 0 ? 'El token vence hoy' : `El token vence en ${left} ${left === 1 ? 'día' : 'días'}`}</b><small>Generá uno nuevo en GitHub y pegalo en Ajustes, en los dos teléfonos.</small></span><a class="btn sm" href="#ajustes">Ir</a></div>`);
  }
  for (const b of birthdaysOn(state.db, t)) {
    out.push(`<div class="banner party">${icon('cake')}<span><b>¡${plantTitle(b.plant)} cumple ${b.years} ${b.years === 1 ? 'año' : 'años'} en casa!</b><small>Llegó el ${fmtShort(b.plant.birthday)}.</small></span></div>`);
  }
  const hum = cfg.humidity?.date === t ? cfg.humidity.value : null;
  if (hum != null && hum < 40) {
    out.push(`<div class="banner tip">${icon('drop')}<span><b>Humedad del ${hum} %</b><small>${esc(settings().guide?.humedadTip || 'Humedad baja: agrupá las plantas o usá un humidificador.')}</small></span></div>`);
  }
  return out.join('');
}

function chips(t) {
  const s = settings(), w = state.weather?.daily?.[t];
  const hum = cfg.humidity?.date === t ? cfg.humidity.value : null;
  return `<div class="chips">
    <button class="chip glass" data-act="aire-open">${icon(AIRE_ICON[s.aire] || 'off')}Aire: ${esc(AIRE[s.aire] || 'Apagado')}</button>
    <button class="chip glass" data-act="hum-open">${icon('drop')}${hum != null ? `${hum} %` : 'Humedad'}</button>
    ${typeof w === 'number' ? `<span class="chip glass static${w > Number(s.heat) ? ' hot' : ''}">${icon('thermo')}Máx. ${Math.round(w)} °C</span>` : ''}
  </div>`;
}

/* ---------- lo hecho hoy ---------- */
function doneToday(t) {
  const evs = state.db.events.filter(e => e.date === t).sort((a, b) => (b.t || 0) - (a.t || 0));
  const tasks = state.db.tasks.filter(k => k.done && k.doneAt === t);
  return { evs, tasks, count: evs.length + tasks.length };
}
function doneList(t) {
  const { evs, tasks, count } = doneToday(t);
  if (!count) return '';
  return `<h2 class="grp">Hecho hoy</h2><div class="card rows">
    ${evs.map(e => { const p = byId('plants', e.plantId); return `<button class="row" data-act="event-open" data-id="${esc(e.id)}">${icon(EVENT_ICON[e.type] || 'note', 'lead')}<span class="grow"><b>${esc(eventTitle(e))}</b><small>${p ? plantTitle(p) : ''}${e.by ? ` · ${esc(e.by)}` : ''}</small></span>${icon('chev', 'dim')}</button>`; }).join('')}
    ${tasks.map(k => `<button class="row" data-act="task-toggle" data-id="${esc(k.id)}">${icon('check', 'lead ok')}<span class="grow"><b class="strike">${esc(k.title)}</b><small>Tarea${k.doneBy ? ` · ${esc(k.doneBy)}` : ''}</small></span></button>`).join('')}
  </div>`;
}

/* ---------- tareas ---------- */
export function taskRow(k, t = today()) {
  const late = k.from && k.from < t && !k.done;
  return `<div class="task-row${k.done ? ' done' : ''}">
    <button class="tick${k.done ? ' on' : ''}" data-act="task-toggle" data-id="${esc(k.id)}" role="checkbox" aria-checked="${k.done}" aria-label="${esc(k.title)}">${icon('check')}</button>
    <button class="grow txt" data-act="task-edit" data-id="${esc(k.id)}"><b>${esc(k.title)}</b><small>${k.done ? `Hecha${k.doneAt ? ` el ${fmtShort(k.doneAt, t)}` : ''}${k.doneBy ? ` · ${esc(k.doneBy)}` : ''}` : k.optional ? 'Opcional' : k.from ? (k.from > t ? `Desde ${relDay(k.from, t)}` : late ? `Desde el ${fmtShort(k.from, t)}` : 'Desde hoy') : 'Sin fecha'}</small></button>
  </div>`;
}
on('task-toggle', el => {
  const k = byId('tasks', el.dataset.id);
  if (!k) return;
  const prev = { ...k };
  patch('tasks', k.id, k.done ? { done: false, doneAt: null, doneBy: null } : { done: true, doneAt: today(), doneBy: cfg.who || '' });
  commit(); haptic();
  toast(k.done ? 'Tarea pendiente otra vez.' : '¡Tarea hecha!', { undo: () => { put('tasks', prev); commit(); } });
});

/* ---------- modo aire ---------- */
export function setAire(value) {
  const s = settings(), prev = s.aire || 'apagado', prevSince = s.aireSince;
  if (value === prev) return;
  setSetting('aire', value);
  setSetting('aireSince', today());
  let task = null;
  if (value !== 'apagado' && prev === 'apagado') {
    task = put('tasks', { id: newId('k'), title: s.guide?.aireTarea || AIRE_TAREA, from: today(), optional: false, done: false, order: 0, auto: 'aire' });
  }
  commit(); haptic();
  toast(value === 'apagado' ? 'Aire apagado.' : `Aire en ${AIRE[value].toLowerCase()}.${task ? ' Te sumé una tarea.' : ''}`, {
    undo: () => { setSetting('aire', prev); setSetting('aireSince', prevSince ?? null); if (task) remove('tasks', task.id); commit(); },
  });
}
on('aire-open', () => {
  openSheet(() => {
    const s = settings();
    return `<h2 class="sheet-title">Modo aire</h2>
      <p class="muted">Cambialo cuando empieza o termina la temporada del aire. No hace falta tocarlo todos los días.</p>
      <div class="choice">${Object.entries(AIRE).map(([v, l]) => `<button class="opt${s.aire === v ? ' on' : ''}" data-act="aire-set" data-v="${v}">${icon(AIRE_ICON[v])}<span><b>${l}</b><small>${v === 'apagado' ? 'Sin cambios en las reglas.' : v === 'frio' ? 'Tarjeta semanal para mirar puntas secas.' : 'Puntas secas cada semana y, de abril a septiembre, el grupo semanal se revisa todos los domingos.'}</small></span></button>`).join('')}</div>`;
  }, { live: true });
});
on('aire-set', el => { setAire(el.dataset.v); closeSheet(); });

/* ---------- pantalla ---------- */
function nextUp(t) {
  const days = agenda(state.db, t, addDays(t, 21), state.weather);
  for (const [d, items] of [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (d <= t) continue;
    const line = summarize(items);
    if (line) return `<p class="next">${icon('calendar')}<span>Próximo: <b>${cap(relDay(d, t))}</b>. ${esc(line)}</span></p>`;
  }
  return '';
}

export function render() {
  const t = today();
  const items = pendingToday(t);
  const tasks = tasksDue(state.db, t).sort((a, b) => (a.from || '').localeCompare(b.from || '') || (a.order ?? 99) - (b.order ?? 99));
  const done = doneToday(t);
  const order = { agua: 0, recheck: 1, calor: 1, revisar: 1, regar: 1 };
  const plants = items.filter(i => i.plant).sort((a, b) => (order[a.kind] ?? 1) - (order[b.kind] ?? 1) || (a.plant.order ?? 99) - (b.plant.order ?? 99));
  const extras = items.filter(i => !i.plant);
  // Las tareas atrasadas quedan en la lista pero no frenan el "todo al día"; las que arrancan hoy, sí.
  const allDone = !items.length && !tasks.some(k => k.from === t);
  const totalTasks = state.db.tasks.length;

  let hero = '';
  if (allDone && done.count) hero = `<div class="card hero ok">${icon('sparkle', 'big')}<h2>¡Todo al día!</h2><p>Tus plantas te lo agradecen.</p></div>`;
  else if (allDone) hero = `<div class="card hero calm">${icon('leaf', 'big')}<h2>Hoy no toca nada</h2><p>Disfrutalas.</p></div>`;

  return `<header class="top"><p class="eyebrow">${esc(cap(fmtLong(t)))}</p><h1>Hoy</h1></header>
    ${chips(t)}
    ${banners(t)}
    ${hero}
    ${plants.length ? `<h2 class="grp">${plants.length === 1 ? 'Una planta' : `${plants.length} plantas`}</h2>` : ''}
    <div class="stack">${plants.map(it => plantCard(it, t)).join('')}</div>
    <div class="stack">${extras.map(it => (it.kind === 'puntas' ? puntasCard(it, t) : fotoCard(it, t))).join('')}</div>
    ${tasks.length ? `<h2 class="grp">Tareas</h2><div class="card tasks">${tasks.map(k => taskRow(k, t)).join('')}</div>` : ''}
    ${totalTasks ? `<button class="link block" data-act="tasks-open">${icon('list')}Ver todas las tareas (${totalTasks})</button>` : ''}
    ${allDone ? nextUp(t) : ''}
    ${doneList(t)}`;
}

export function after() {
  const t = today();
  if (cfg.celebrated === t) return;
  if (!pendingToday(t).length && !tasksDue(state.db, t).some(k => k.from === t) && doneToday(t).count) {
    cfg.celebrated = t; saveCfg();
    setTimeout(celebrate, 250);
  }
}
