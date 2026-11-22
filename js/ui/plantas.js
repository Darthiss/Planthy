// Plantas: lista en tarjetas, ficha de cada una y alta/edición/archivo.

import { state, cfg, settings, today, byId, put, patch, commit } from '../store.js';
import { activePlants, plantStatus, statusLabel, GROUPS, STICK_RULES, eventsOf, nextFert, displayName, ruleId, ruleShort, ruleText, stickTooShort, STICK_CM } from '../rules.js';
import { fmtShort, fmtDay, relDay, diffDays, parts, MESES, monthOf } from '../dates.js';
import { newId } from '../merge.js';
import { $, esc, icon, on, avatar, plantTitle, plantKind, cap, haptic, toast, openSheet, closeSheet, updateSheet, field, seg, readForm } from './dom.js';
import { eventTitle, eventDetail, eventMeta, EVENT_ICON } from './registro.js';
import { photosOf, addPhoto, compress } from '../photos.js';

export const title = 'Plantas';

/* ---------- lista ---------- */
function card(p, t) {
  const st = plantStatus(state.db, p, t, state.weather);
  return `<a class="pcard" href="#planta/${esc(p.id)}" style="view-transition-name:p-${esc(p.id).replace(/[^a-z0-9-]/gi, '')}">
    <span class="pphoto">${avatar(p, 'fill')}${p.toxic ? `<span class="badge-cat" title="Tóxica para la gata">${icon('cat')}</span>` : ''}</span>
    <span class="pbody"><b>${plantTitle(p)}</b>${plantKind(p) ? `<small class="kind">${plantKind(p)}</small>` : ''}<small>${esc(p.location || '')}</small>
    <span class="pill k-${st.kind}${st.overdue ? ' late' : ''}">${esc(statusLabel(st, t))}</span></span></a>`;
}

export function render(arg) {
  if (arg) return renderFicha(arg);
  const t = today();
  const plants = activePlants(state.db);
  const archived = state.db.plants.filter(p => p.archived);
  return `<header class="top row-top"><h1>Plantas</h1><button class="icon-btn glass" data-act="plant-new" aria-label="Agregar planta">${icon('plus')}</button></header>
    ${plants.length ? `<div class="pgrid">${plants.map(p => card(p, t)).join('')}</div>`
      : `<div class="card hero calm">${icon('leaf', 'big')}<h2>Todavía no hay plantas</h2><p>${cfg.sync ? 'Sincronizá para traer las tuyas, o agregá una.' : 'Conectá la sincronización en Ajustes para traer las tuyas, o agregá una.'}</p><button class="btn primary" data-act="plant-new">${icon('plus')}Agregar planta</button></div>`}
    ${archived.length ? `<details class="archived"><summary>Archivadas (${archived.length})</summary><div class="card rows">${archived.map(p => `<div class="row">${avatar(p, 'xs')}<span class="grow"><b>${plantTitle(p)}</b><small>${esc(p.location || '')}</small></span><button class="btn sm" data-act="plant-unarchive" data-id="${esc(p.id)}">Volver a casa</button></div>`).join('')}</div></details>` : ''}`;
}

/* ---------- ficha ---------- */
const age = (from, t) => {
  const days = diffDays(t, from);
  if (days < 1) return 'desde hoy';
  if (days < 31) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  const [y1, m1] = parts(from), [y2, m2] = parts(t);
  const months = (y2 - y1) * 12 + (m2 - m1) - (parts(t)[2] < parts(from)[2] ? 1 : 0);
  if (months < 12) return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
  const years = Math.floor(months / 12);
  return `hace ${years} ${years === 1 ? 'año' : 'años'}${months % 12 ? ` y ${months % 12} ${months % 12 === 1 ? 'mes' : 'meses'}` : ''}`;
};
// "El miércoles · 18/11", pero "El 3 de enero de 2027" sin repetir la fecha.
const when = (d, t) => { const r = cap(relDay(d, t)); return /\d/.test(r) ? r : `${r} · ${fmtShort(d, t)}`; };
const row = (label, value, ic) => (value ? `<div class="row static info">${ic ? icon(ic, 'lead') : ''}<span class="grow"><small>${esc(label)}</small><span>${value}</span></span></div>` : '');

// Próximo: una línea por cosa, etiqueta a la izquierda y fecha a la derecha. El estado de ahora ya está en el chip.
const kv = (ic, label, value) => `<div class="row static kv">${icon(ic, 'lead')}<span class="grow">${esc(label)}</span><span class="val">${value}</span></div>`;
function upcomingRows(p, t) {
  const s = settings(), st = plantStatus(state.db, p, t, state.weather);
  const out = [];
  if (st.recheck) out.push(kv('stick', 'Re-chequeo', esc(when(st.recheck, t))));
  if (st.next && st.next !== st.recheck) out.push(kv(p.group === 'agua' ? 'glass' : 'calendar', p.group === 'agua' ? 'Cambio de agua' : 'Revisión', esc(when(st.next, t))));
  const f = nextFert(p, eventsOf(state.db, p.id), t, s);
  if (f) out.push(kv('flask', 'Fertifox', f.now ? `Próximo ${p.group === 'agua' ? 'cambio' : 'riego'}` : esc(when(f.date, t))));
  if (p.birthday) {
    const [y] = parts(t); let next = `${y}${p.birthday.slice(4)}`; if (next < t) next = `${y + 1}${p.birthday.slice(4)}`;
    if (next !== p.birthday) out.push(kv('cake', `Cumple ${parts(next)[0] - parts(p.birthday)[0]} en casa`, esc(cap(relDay(next, t)))));
  }
  return out.join('');
}

const num = n => String(n).replace('.', ',');
/** "Ø 25 · 22 cm de alto", o lo que haya. */
export function potSize(p) {
  const h = Number(p.potH) > 0 ? Number(p.potH) : null, d = Number(p.potD) > 0 ? Number(p.potD) : null;
  if (h && d) return `Ø ${num(d)} · ${num(h)} de alto`;
  if (h) return `${num(h)} cm de alto`;
  if (d) return `Ø ${num(d)} cm`;
  return '';
}

// Cuatro datos clave. Lo largo queda en "Más sobre…".
function facts(p, t) {
  const tile = (label, value, ic, extra = '') => `<div class="fact${extra}">${icon(ic)}<small>${esc(label)}</small><b>${value}</b></div>`;
  const size = potSize(p);
  const out = [size
    ? tile('Maceta', esc(size), 'pot')
    : `<button class="fact need" data-act="plant-edit" data-id="${esc(p.id)}">${icon('pot')}<small>Maceta</small><b>Cargá las medidas</b></button>`];
  out.push(p.group === 'agua' ? tile('Agua', 'Cambio semanal', 'glass') : tile('Palito', esc(ruleShort(p) || '—'), 'stick'));
  out.push(tile('Lugar', esc(p.location || '—'), 'pin'));
  if (p.birthday) out.push(tile('En casa', esc(cap(age(p.birthday, t))), 'home'));
  else out.push(tile('Fertifox', esc(p.fertFrom === 'nunca' ? 'Nunca' : p.fertFrom ? (p.firstDose ? 'Ya' : `Desde el ${fmtShort(p.fertFrom)}`) : '—'), 'flask'));
  return `<div class="facts">${out.join('')}</div>`;
}

// Lo que se abrió en la ficha queda abierto aunque la pantalla se vuelva a pintar (sincronización, etc.).
const openMore = new Set();
on('more-toggle', el => { const id = el.dataset.id; if (el.parentElement.open) openMore.delete(id); else openMore.add(id); });
const HISTORY_SHORT = 5;
const fullHistory = new Set();
on('history-all', el => { fullHistory.add(el.dataset.id); window.dispatchEvent(new Event('planthy:render')); });

function history(p, t) {
  const all = eventsOf(state.db, p.id).sort((a, b) => (a.date === b.date ? (b.t || 0) - (a.t || 0) : a.date < b.date ? 1 : -1));
  if (!all.length) return '<p class="empty">Todavía no hay registros.</p>';
  const evs = fullHistory.has(p.id) ? all : all.slice(0, HISTORY_SHORT);
  let html = '', cur = '';
  for (const e of evs) {
    const ym = monthOf(e.date);
    if (ym !== cur) { html += `${cur ? '</div>' : ''}<h3 class="month">${cap(MESES[parts(e.date)[1] - 1])} ${parts(e.date)[0]}</h3><div class="card rows">`; cur = ym; }
    const detail = eventDetail(e);
    html += `<button class="row" data-act="event-open" data-id="${esc(e.id)}">${icon(EVENT_ICON[e.type] || 'note', `lead ev-${e.type}`)}<span class="grow"><b>${esc(eventTitle(e))}</b>${detail ? `<span class="detail">${esc(detail)}</span>` : ''}<small>${esc(eventMeta(e, t))}</small></span></button>`;
  }
  html += '</div>';
  if (evs.length < all.length) html += `<button class="link block" data-act="history-all" data-id="${esc(p.id)}">${icon('list')}Ver todo el historial (${all.length})</button>`;
  return html;
}

function photoStrip(p) {
  const photos = photosOf(p.id);
  return `<div class="strip photos">
    <button class="strip-add" data-act="photo-new" data-id="${esc(p.id)}" aria-label="Sacar foto">${icon('camera')}</button>
    ${photos.slice(0, 12).map(f => `<button class="thumb" data-act="photo-view" data-id="${esc(f.id)}" data-photo-wrap><img data-photo="${esc(f.id)}" alt="Foto del ${fmtShort(f.date)}" loading="lazy"><small>${fmtShort(f.date)}</small></button>`).join('')}
  </div>`;
}

export function renderFicha(id) {
  const p = byId('plants', id), t = today();
  if (!p) return `<header class="top"><h1>No la encuentro</h1></header><p class="empty">Esa planta no existe o se borró.</p><a class="btn" href="#plantas">Volver a Plantas</a>`;
  const st = plantStatus(state.db, p, t, state.weather);
  const photos = photosOf(p.id);
  const s = settings();
  const fert = p.fertFrom === 'nunca' ? 'Nunca' : p.fertFrom ? (p.firstDose ? `Ya (primera dosis en su próximo riego)` : fmtShort(p.fertFrom)) : '—';
  const next = upcomingRows(p, t);
  const more = [
    p.group !== 'agua' && ruleText(p) ? row('Regla del palito', `${esc(ruleText(p))}.${p.ruleNote ? ` ${esc(p.ruleNote)}` : ''}`, 'stick') : '',
    row('Maceta y sustrato', esc(p.pot), 'pot'),
    row('Grupo de riego', `${esc(GROUPS[p.group]?.label || '')}. ${esc(GROUPS[p.group]?.when || '')}`, 'calendar'),
    p.group !== 'agua' && s.guide?.comoRegar ? row('Cómo regar', esc(s.guide.comoRegar), 'drop') : '',
    row('Fertiliza desde', esc(fert), 'flask'),
    p.birthday ? row('En casa', `Desde el ${fmtDay(p.birthday)} de ${parts(p.birthday)[0]} (${age(p.birthday, t)})`, 'home') : '',
  ].join('');
  return `<div class="ficha-hero${p.avatar ? '' : ' empty'}">${p.avatar ? `<img data-photo="${esc(p.avatar)}" data-size="full" alt="">` : avatar(p, 'fill')}</div>
    <header class="top ficha-top"><h1>${plantTitle(p)}</h1><p class="sub">${plantKind(p) ? `${plantKind(p)} · ` : ''}${esc(p.species || '')}</p></header>
    <div class="chips">
      <span class="pill k-${st.kind}${st.overdue ? ' late' : ''}">${esc(statusLabel(st, t))}</span>
      <span class="chip static">${icon(p.group === 'agua' ? 'glass' : 'calendar')}${esc(GROUPS[p.group]?.label || '')}</span>
      ${p.toxic ? `<span class="chip static warn">${icon('cat')}Tóxica para la gata</span>` : `<span class="chip static">${icon('cat')}Segura para la gata</span>`}
    </div>
    <div class="quick">
      ${p.group === 'agua'
        ? `<button data-act="log-open" data-id="${esc(p.id)}" data-mode="agua">${icon('glass')}<span>Agua</span></button>`
        : `<button data-act="log-open" data-id="${esc(p.id)}" data-mode="palito">${icon('stick')}<span>Palito</span></button><button data-act="log-open" data-id="${esc(p.id)}" data-mode="riego">${icon('drop')}<span>Regué</span></button>`}
      <button data-act="photo-new" data-id="${esc(p.id)}">${icon('camera')}<span>Foto</span></button>
      <button data-act="log-open" data-id="${esc(p.id)}">${icon('plus')}<span>Más</span></button>
    </div>
    ${next ? `<h2 class="grp">Próximo</h2><div class="card rows">${next}</div>` : ''}
    <h2 class="grp row-top">Ficha <button class="link" data-act="plant-edit" data-id="${esc(p.id)}">Editar</button></h2>
    ${facts(p, t)}
    ${p.waterNote ? `<p class="note">${icon(p.group === 'agua' ? 'glass' : 'drop')}<span>${esc(p.waterNote)}</span></p>` : ''}
    ${stickTooShort(p) ? `<p class="note">${icon('stick')}<span>El palito tiene que llegar a ${esc(num(p.potH))} cm. Si el de brochette (${STICK_CM} cm) no llega al fondo, usá una varilla más larga.</span></p>` : ''}
    <details class="more card"${openMore.has(p.id) ? ' open' : ''}>
      <summary data-act="more-toggle" data-id="${esc(p.id)}">Más sobre ${plantTitle(p)}${icon('chev', 'dim')}</summary>
      <div class="rows">${more}</div>
      ${p.notes ? `<div class="prose"><h3>Notas</h3><p>${esc(p.notes)}</p></div>` : ''}
      ${p.signals?.length ? `<div class="prose"><h3>Para tener en cuenta</h3><ul>${p.signals.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    </details>
    <h2 class="grp row-top">Fotos ${photos.length ? `<span class="links">${photos.length > 1 ? `<button class="link" data-act="compare-open" data-id="${esc(p.id)}">Comparar</button>` : ''}<button class="link" data-act="photos-open" data-id="${esc(p.id)}">Ver todas</button></span>` : ''}</h2>
    ${photoStrip(p)}
    <h2 class="grp">Historial</h2>
    ${history(p, t)}
    <div class="btns col end">${p.archived
      ? `<button class="btn" data-act="plant-unarchive" data-id="${esc(p.id)}">Volver a casa</button>`
      : `<button class="btn ghost" data-act="plant-archive" data-id="${esc(p.id)}">${icon('archive')}Archivar planta</button>`}</div>`;
}

/* ---------- archivar ---------- */
on('plant-archive', el => {
  const p = byId('plants', el.dataset.id);
  if (!p) return;
  patch('plants', p.id, { archived: true }); commit(); haptic();
  location.hash = '#plantas';
  toast(`${displayName(p)} quedó archivada.`, { undo: () => { patch('plants', p.id, { archived: false }); commit(); } });
});
on('plant-unarchive', el => {
  const p = byId('plants', el.dataset.id);
  if (!p) return;
  patch('plants', p.id, { archived: false, since: today() }); commit(); haptic();
  toast(`${displayName(p)} volvió a la lista.`);
});

/* ---------- alta y edición ---------- */
let draft = null;
const DEFAULT_RULE = { semanal: 'cuarto', mensual: 'fondo' };
const cmOf = v => { const n = Number(String(v ?? '').replace(',', '.')); return n > 0 && n <= 200 ? Math.round(n * 10) / 10 : null; };

function openForm(plant) {
  const t = today();
  draft = plant
    ? { ...plant, rule: plant.rule ? ruleId(plant) : plant.rule, fertMode: plant.fertFrom === 'nunca' ? 'nunca' : 'fecha', fertDate: plant.fertFrom && plant.fertFrom !== 'nunca' ? plant.fertFrom : t, isNew: false }
    : { id: null, name: '', nick: '', species: '', location: '', pot: '', potH: '', potD: '', group: 'semanal', rule: DEFAULT_RULE.semanal, fertMode: 'fecha', fertDate: t, toxic: false, birthday: t, notes: '', isNew: true };
  openSheet(renderForm, { full: true, cls: 'form-sheet', onClose: () => { if (draft?.photoUrl) URL.revokeObjectURL(draft.photoUrl); draft = null; } });
}
on('plant-new', () => openForm(null));
on('plant-edit', el => openForm(byId('plants', el.dataset.id)));

function renderForm() {
  const d = draft;
  const pic = d.photoUrl ? `<img src="${d.photoUrl}" alt="">` : d.avatar ? `<img data-photo="${esc(d.avatar)}" alt="">` : icon('camera');
  return `<div class="sheet-nav"><button class="link" data-act="sheet-close">Cancelar</button><b>${d.isNew ? 'Nueva planta' : 'Editar'}</b><button class="link strong" data-act="pf-save">Guardar</button></div>
  <form class="form" data-input="pf-sync" data-submit="pf-save">
    <label class="avatar-pick${d.photoUrl || d.avatar ? ' has' : ''}" data-photo-wrap>${pic}<input type="file" accept="image/*" data-change="pf-photo" hidden><span>${d.photoUrl || d.avatar ? 'Cambiar foto' : 'Foto de perfil'}</span></label>
    ${field('Nombre', `<input name="name" value="${esc(d.name)}" placeholder="Ej.: Monstera" required autocomplete="off">`)}
    ${field('Nombre propio', `<input name="nick" value="${esc(d.nick || '')}" placeholder="Opcional. Ej.: Rulo" autocomplete="off">`, 'Si le ponés nombre, la app la llama así.')}
    ${field('Especie', `<input name="species" value="${esc(d.species || '')}" placeholder="Opcional" autocomplete="off">`)}
    ${field('Ubicación', `<input name="location" value="${esc(d.location || '')}" placeholder="Ej.: Mesada de la cocina" autocomplete="off">`)}
    ${field('Maceta y sustrato', `<input name="pot" value="${esc(d.pot || '')}" placeholder="Opcional" autocomplete="off">`)}
    ${d.group === 'agua' ? '' : `<div class="field"><div class="pair">
        ${field('Alto de la tierra (cm)', `<input name="potH" type="text" inputmode="decimal" value="${esc(d.potH ?? '')}" placeholder="Ej.: 18" autocomplete="off" data-change="pf-redraw">`)}
        ${field('Diámetro (cm)', `<input name="potD" type="text" inputmode="decimal" value="${esc(d.potD ?? '')}" placeholder="Ej.: 20" autocomplete="off">`)}
      </div><span class="hint">Medí por dentro la maceta donde vive: si está en una de vivero dentro de una decorativa, la de vivero. El alto va de la superficie de la tierra al fondo.</span></div>`}
    <div class="field" data-change="pf-group"><span class="label">Grupo de riego</span>${seg('group', Object.entries(GROUPS).map(([k, g]) => [k, g.label]), d.group)}<span class="hint">${esc(GROUPS[d.group]?.when || '')}</span></div>
    ${d.group === 'agua' ? '' : field('Regla del palito: regar cuando se secó…', `<select name="rule" data-change="pf-redraw">${Object.entries(STICK_RULES).map(([k, r]) => `<option value="${k}" ${k === d.rule ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>`, ruleHint(d))}
    <div class="field" data-change="pf-fert"><span class="label">Fertiliza desde</span>${seg('fertMode', [['fecha', 'Una fecha'], ['nunca', 'Nunca']], d.fertMode)}
      ${d.fertMode === 'fecha' ? `<input type="date" name="fertDate" value="${esc(d.fertDate || '')}">` : ''}<span class="hint">${d.group === 'agua' ? 'Plantas en agua: 5 gotas.' : 'Media dosis de la etiqueta.'} El 1.er domingo de cada mes, de octubre a marzo.</span></div>
    ${field('En casa desde (cumpleaños)', `<input type="date" name="birthday" value="${esc(d.birthday || '')}" max="${today()}">`, 'El día que llegó a casa.')}
    <label class="check switch-row"><span>Tóxica para la gata</span><input type="checkbox" switch name="toxic" ${d.toxic ? 'checked' : ''}></label>
    ${field('Notas', `<textarea name="notes" rows="3" placeholder="Opcional">${esc(d.notes || '')}</textarea>`)}
    <button class="btn primary big">${d.isNew ? 'Agregar planta' : 'Guardar cambios'}</button>
  </form>`;
}

function syncDraft() {
  const form = $('.form-sheet form');
  if (!form || !draft) return;
  const f = readForm(form);
  Object.assign(draft, { ...f, toxic: !!f.toxic });
}
/** Qué significa la regla elegida en esa maceta. */
function ruleHint(d) {
  const p = { rule: d.rule, potH: cmOf(d.potH) };
  if (!p.potH) return 'Con el alto de la tierra cargado, te lo digo en cm.';
  return `Con ${num(p.potH)} cm de alto: ${ruleText(p).charAt(0).toLowerCase()}${ruleText(p).slice(1)}.`;
}
on('pf-sync', () => syncDraft());
on('pf-redraw', () => { syncDraft(); updateSheet(); });
on('pf-group', () => { syncDraft(); if (draft.group !== 'agua' && !STICK_RULES[draft.rule]) draft.rule = DEFAULT_RULE[draft.group]; updateSheet(); });
on('pf-fert', () => { syncDraft(); updateSheet(); });
on('pf-photo', async el => {
  const file = el.files?.[0];
  if (!file) return;
  syncDraft();
  try {
    const shot = await compress(file);
    if (draft.photoUrl) URL.revokeObjectURL(draft.photoUrl);
    draft.photo = shot; draft.photoUrl = URL.createObjectURL(shot.thumb);
    updateSheet();
  } catch (e) { toast(e.message || 'No pude abrir esa foto.'); }
});
on('pf-save', async () => {
  syncDraft();
  const d = draft;
  if (!d.name.trim()) { toast('Ponele un nombre.'); $('.form-sheet [name=name]')?.focus(); return; }
  if (d.fertMode === 'fecha' && !d.fertDate) { toast('Elegí desde cuándo se fertiliza.'); return; }
  const t = today();
  if (d.group !== 'agua' && (String(d.potH ?? '').trim() && !cmOf(d.potH) || String(d.potD ?? '').trim() && !cmOf(d.potD))) { toast('Las medidas van en cm, entre 1 y 200.'); return; }
  const fields = {
    name: d.name.trim(), nick: (d.nick || '').trim(), species: d.species, location: d.location, pot: d.pot,
    potH: d.group === 'agua' ? null : cmOf(d.potH), potD: d.group === 'agua' ? null : cmOf(d.potD),
    group: d.group, rule: d.group === 'agua' ? null : d.rule, toxic: !!d.toxic, birthday: d.birthday || null, notes: d.notes,
    fertFrom: d.fertMode === 'nunca' ? 'nunca' : d.fertDate,
  };
  let plant;
  if (d.isNew) {
    const order = Math.max(0, ...state.db.plants.map(p => p.order || 0)) + 1;
    plant = put('plants', { id: newId('p'), order, signals: [], since: t, ...fields });
    put('events', { id: newId('e', fields.birthday || t), plantId: plant.id, date: fields.birthday || t, type: 'alta', note: '', by: cfg.who || '', aire: settings().aire || 'apagado' });
  } else {
    const prev = byId('plants', d.id);
    // Si cambia la fecha de fertilización a mano, deja de valer la "primera dosis" del informe.
    plant = patch('plants', d.id, { ...fields, ...(prev.fertFrom !== fields.fertFrom ? { firstDose: false } : {}) });
  }
  commit();
  if (d.photo) await addPhoto(plant.id, d.photo, { date: t, asAvatar: true });
  closeSheet(); haptic();
  if (d.isNew) { location.hash = `#planta/${plant.id}`; toast(`¡Bienvenida, ${displayName(plant)}!`); } else toast('Cambios guardados.');
});
