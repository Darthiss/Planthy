// Calendario: mes con puntitos por tipo, detalle del día, "Próximos" y archivos para el Calendario del iPhone.

import { state, today, byId } from '../store.js';
import { agenda, displayName } from '../rules.js';
import { addDays, addMonths, monthOf, daysInMonth, dow, sundayIndex, relDay, fmtShort, fmtDay, MESES, parts, pad } from '../dates.js';
import { esc, icon, on, avatar, plantTitle, cap, haptic, openSheet, transition } from './dom.js';
import { eventTitle, EVENT_ICON } from './registro.js';
import { fixedIcs, oneOffIcs } from '../ics.js';
import { shareFile } from '../backup.js';
import { taskRow } from './hoy.js';

export const title = 'Calendario';

export const TYPES = [
  ['revision', 'Revisión'],
  ['riego', 'Riego'],
  ['fert', 'Fertilización'],
  ['trasplante', 'Trasplante'],
  ['tarea', 'Tareas'],
];
const EVENT_TYPE = { palito: 'revision', puntas: 'revision', riego: 'riego', agua: 'riego', fert: 'fert', trasplante: 'trasplante', recalce: 'trasplante' };
const ITEM_TYPE = { revisar: 'revision', recheck: 'revision', calor: 'revision', puntas: 'revision', regar: 'riego', agua: 'riego' };

let month = null, selected = null;

/* ---------- resumen de un día ---------- */
const join = arr => (arr.length < 2 ? arr.join('') : `${arr.slice(0, -1).join(', ')} y ${arr[arr.length - 1]}`);
const names = items => { const n = items.map(i => displayName(i.plant)); return n.length <= 3 ? join(n) : `${n.slice(0, 2).join(', ')} y ${n.length - 2} más`; };

/** Líneas de un día: [{ icon, text, type }] */
export function dayLines(items) {
  const of = k => items.filter(i => i.kind === k);
  const lines = [];
  const checks = of('revisar'), re = of('recheck'), heat = of('calor'), regar = of('regar'), agua = of('agua');
  const fert = items.filter(i => i.fert), tasks = of('tarea');
  if (checks.length) lines.push({ icon: 'stick', type: 'revision', text: `Palito: ${names(checks)}` });
  if (re.length) lines.push({ icon: 'stick', type: 'revision', text: `Re-chequeo: ${names(re)}` });
  if (heat.length) lines.push({ icon: 'thermo', type: 'revision', text: `Calor: revisar ${names(heat)}` });
  if (regar.length) lines.push({ icon: 'drop', type: 'riego', text: `Regar: ${names(regar)}` });
  if (agua.length) lines.push({ icon: 'glass', type: 'riego', text: `Cambio de agua: ${names(agua)}` });
  if (fert.length) lines.push({ icon: 'flask', type: 'fert', text: `Fertifox: ${names(fert)}` });
  for (const k of tasks) lines.push({ icon: k.task.type === 'trasplante' ? 'pot' : 'list', type: k.task.type === 'trasplante' ? 'trasplante' : 'tarea', text: k.task.title });
  for (const p of of('puntas')) lines.push({ icon: 'wind', type: 'revision', text: `Puntas secas: ${p.plants.map(displayName).join(', ')}` });
  if (of('foto').length) lines.push({ icon: 'camera', type: '', text: 'Foto del mes' });
  for (const c of of('cumple')) lines.push({ icon: 'cake', type: '', text: `${displayName(c.plant)} cumple ${c.years} ${c.years === 1 ? 'año' : 'años'} en casa` });
  return lines;
}
export const summarize = items => dayLines(items).map(l => l.text).join(' · ');

/* ---------- marcas del mes ---------- */
function monthMarks(ym) {
  const t = today(), first = `${ym}-01`, last = `${ym}-${pad(daysInMonth(ym))}`;
  const marks = new Map();
  const add = (d, type) => { if (!type) return; if (!marks.has(d)) marks.set(d, new Set()); marks.get(d).add(type); };
  for (const e of state.db.events) if (e.date >= first && e.date <= last) add(e.date, EVENT_TYPE[e.type]);
  for (const k of state.db.tasks) if (k.done && k.doneAt >= first && k.doneAt <= last) add(k.doneAt, k.type === 'trasplante' ? 'trasplante' : 'tarea');
  let plan = new Map();
  if (last >= t) {
    plan = agenda(state.db, t, last, state.weather);
    for (const [d, items] of plan) {
      if (d < first) continue;
      for (const it of items) {
        add(d, it.kind === 'tarea' ? (it.task.type === 'trasplante' ? 'trasplante' : 'tarea') : ITEM_TYPE[it.kind]);
        if (it.fert) add(d, 'fert');
      }
    }
  }
  return { marks, plan };
}

function grid(ym, marks) {
  const t = today(), first = `${ym}-01`, n = daysInMonth(ym);
  const lead = (dow(first) + 6) % 7; // semana de lunes a domingo
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="cal-cell blank"></span>');
  for (let d = 1; d <= n; d++) {
    const date = `${ym}-${pad(d)}`, m = marks.get(date);
    const cls = ['cal-cell', date === t ? 'today' : '', date === selected ? 'sel' : '', date < t ? 'past' : '', dow(date) === 0 ? 'sun' : ''].filter(Boolean).join(' ');
    const dots = m ? TYPES.filter(([k]) => m.has(k)).map(([k]) => `<i class="dot t-${k}"></i>`).join('') : '';
    cells.push(`<button class="${cls}" data-act="cal-day" data-date="${date}" aria-label="${fmtDay(date)}${m ? ': ' + TYPES.filter(([k]) => m.has(k)).map(([, l]) => l.toLowerCase()).join(', ') : ''}"><span class="n">${d}</span><span class="dots">${dots}</span></button>`);
  }
  return cells.join('');
}

function dayDetail(date, plan) {
  const t = today();
  const evs = state.db.events.filter(e => e.date === date).sort((a, b) => (a.t || 0) - (b.t || 0));
  const tasksDone = state.db.tasks.filter(k => k.done && k.doneAt === date);
  const planned = date >= t ? (plan.get(date) || []) : [];
  const lines = dayLines(planned.filter(i => i.kind !== 'tarea'));
  const tasks = planned.filter(i => i.kind === 'tarea').map(i => i.task);
  let html = `<h2 class="grp">${esc(cap(relDay(date, t)))} <small>${fmtShort(date, t)}</small></h2>`;
  if (!evs.length && !lines.length && !tasks.length && !tasksDone.length) return html + `<p class="empty">${date < t ? 'Ese día no se anotó nada.' : 'Ese día no toca nada.'}</p>`;
  if (lines.length || tasks.length) html += `<div class="card rows plan">${lines.map(l => `<div class="row static">${icon(l.icon, `lead t-${l.type}`)}<span class="grow">${esc(l.text)}</span></div>`).join('')}${tasks.map(k => taskRow(k, t)).join('')}</div>`;
  if (evs.length || tasksDone.length) {
    html += `<div class="card rows">${evs.map(e => { const p = byId('plants', e.plantId); return `<button class="row" data-act="event-open" data-id="${esc(e.id)}">${p ? avatar(p, 'xs') : ''}<span class="grow"><b>${esc(eventTitle(e))}</b><small>${p ? plantTitle(p) : ''}${e.by ? ` · ${esc(e.by)}` : ''}</small></span>${icon(EVENT_ICON[e.type] || 'note', 'dim')}</button>`; }).join('')}
      ${tasksDone.map(k => `<div class="row static">${icon('check', 'lead ok')}<span class="grow"><b>${esc(k.title)}</b><small>Tarea hecha${k.doneBy ? ` · ${esc(k.doneBy)}` : ''}</small></span></div>`).join('')}</div>`;
  }
  return html;
}

/* ---------- próximos ---------- */
function upcoming() {
  const t = today(), until = addDays(t, 35);
  const plan = agenda(state.db, t, until, state.weather);
  const days = [...plan.keys()].filter(d => d > t).sort();
  if (!days.length) return '<p class="empty">Nada en las próximas semanas.</p>';
  return days.map(d => {
    const lines = dayLines(plan.get(d));
    if (!lines.length) return '';
    const n = sundayIndex(d);
    const tag = n === 1 ? `1.er domingo de ${MESES[parts(d)[1] - 1]}` : '';
    const when = cap(relDay(d, t).replace(/^el /, ''));
    return `<section class="up"><header><b>${esc(when)}</b>${tag && !when.includes(MESES[parts(d)[1] - 1]) ? `<span class="tag">${esc(tag)}</span>` : ''}<small>${fmtShort(d, t)}</small></header>
      ${lines.map(l => `<p>${icon(l.icon, `t-${l.type}`)}<span>${esc(l.text)}</span></p>`).join('')}</section>`;
  }).join('');
}

/* ---------- pantalla ---------- */
export function render() {
  const t = today();
  month ||= monthOf(t);
  selected ||= t;
  const { marks, plan } = monthMarks(month);
  const [y, m] = month.split('-').map(Number);
  return `<header class="top"><h1>Calendario</h1></header>
    <div class="card cal">
      <div class="cal-head">
        <button class="icon-btn" data-act="cal-move" data-n="-1" aria-label="Mes anterior">${icon('back')}</button>
        <button class="cal-title" data-act="cal-today">${cap(MESES[m - 1])} ${y}</button>
        <button class="icon-btn" data-act="cal-move" data-n="1" aria-label="Mes siguiente">${icon('chev')}</button>
      </div>
      <div class="cal-dow">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">${grid(month, marks)}</div>
      <div class="legend">${TYPES.map(([k, l]) => `<span><i class="dot t-${k}"></i>${l}</span>`).join('')}</div>
    </div>
    ${monthOf(selected) === month ? dayDetail(selected, plan) : ''}
    <h2 class="grp">Próximos</h2>
    <div class="card upcoming">${upcoming()}</div>
    <button class="btn big wide" data-act="ics-open">${icon('calendar')}Agregar al Calendario del iPhone</button>`;
}

on('cal-move', el => { month = addMonths(month, Number(el.dataset.n)); haptic(); transition(() => window.dispatchEvent(new Event('planthy:render'))); });
on('cal-today', () => { month = monthOf(today()); selected = today(); haptic(); window.dispatchEvent(new Event('planthy:render')); });
on('cal-day', el => { selected = el.dataset.date; haptic(); window.dispatchEvent(new Event('planthy:render')); });

/* ---------- .ics ---------- */
on('ics-open', () => {
  openSheet(() => {
    const { count } = oneOffIcs();
    return `<h2 class="sheet-title">Agregar al Calendario</h2>
      <p class="muted">Es la alternativa que siempre funciona: el Calendario del iPhone te avisa aunque no lleguen las notificaciones. Tocá un botón y elegí “Calendario” o “Guardar en Archivos”.</p>
      <div class="choice">
        <button class="opt" data-act="ics-fixed">${icon('calendar')}<span><b>Recordatorios fijos</b><small>Todos los domingos y el 1.er domingo de cada mes, con alarma a las ${esc(state.db.settings.reminderTime || '09:00')}. Se agregan una sola vez.</small></span></button>
        <button class="opt" data-act="ics-oneoff" ${count ? '' : 'disabled'}>${icon('stick')}<span><b>Re-chequeos y tareas con fecha</b><small>${count ? `${count} ${count === 1 ? 'recordatorio puntual' : 'recordatorios puntuales'}. Volvé a agregarlos cuando haya nuevos.` : 'Ahora no hay ninguno programado.'}</small></span></button>
      </div>`;
  });
});
on('ics-fixed', () => shareFile('planthy-domingos.ics', fixedIcs(), 'text/calendar'));
on('ics-oneoff', () => { const { ics } = oneOffIcs(); shareFile(`planthy-${today()}.ics`, ics, 'text/calendar'); });
