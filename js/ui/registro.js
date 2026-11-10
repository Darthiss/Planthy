// Registro: lo más importante de la app. Anotar tiene que salir en dos o tres toques, siempre se puede
// deshacer (aviso de 5 segundos) y a cada registro se le puede cambiar la fecha después.

import { state, cfg, saveCfg, settings, today, byId, logEvents, undoEvents, put, patch, remove, commit, emit } from '../store.js';
import { stickResult, humidPhrase, fertPending, eventsOf, doseText, displayName, DEPTHS, STICK_RULES, PRODUCT, AIRE } from '../rules.js';
import { fmtDay, fmtShort, relDay } from '../dates.js';
import { $, esc, icon, on, toast, haptic, openSheet, updateSheet, closeSheet, potSvg, depthLabel, field, readForm, cap, plantTitle } from './dom.js';

const plantOf = id => byId('plants', id);
const pendingFert = (plant, date) => fertPending(plant, eventsOf(state.db, plant.id), date, settings());

/* ---------- textos de cada registro ---------- */
export const EVENT_ICON = { palito: 'stick', riego: 'drop', fert: 'flask', agua: 'glass', trasplante: 'pot', recalce: 'pot', alta: 'home', nota: 'note', puntas: 'wind' };
export function eventTitle(e) {
  switch (e.type) {
    case 'palito': return `Palito: ${e.depth === 'nada' ? 'nada seco' : e.depth === 'todo' ? 'todo seco' : `seco hasta ${depthLabel(e.depth).toLowerCase()}`}`;
    case 'riego': return 'Riego';
    case 'fert': return 'Fertilización';
    case 'agua': return 'Cambio de agua';
    case 'trasplante': return 'Trasplante';
    case 'recalce': return 'Recalce';
    case 'alta': return 'Llegó a casa';
    case 'puntas': return e.result === 'secas' ? 'Puntas secas' : 'Puntas: todo bien';
    default: return 'Nota';
  }
}
export function eventDetail(e) {
  const bits = [];
  if (e.type === 'palito') bits.push(e.result === 'seco' ? 'Seca: tocaba regar' : 'Húmeda: no se regó');
  if (e.type === 'fert') bits.push([e.product, e.dose].filter(Boolean).join(', '));
  if (e.substrate) bits.push(e.substrate);
  if (e.note) bits.push(e.note);
  return bits.join('. ');
}
export function eventMeta(e, ref) {
  const bits = [fmtShort(e.date, ref)];
  if (e.by) bits.push(e.by);
  if (e.aire && e.aire !== 'apagado') bits.push(`aire en ${AIRE[e.aire].toLowerCase()}`);
  if (e.hum != null) bits.push(`humedad ${e.hum} %`);
  return bits.join(' · ');
}

/* ---------- registrar ---------- */
function done(message, events) {
  haptic();
  toast(message, { undo: () => undoEvents(events) });
}

export function logStick(plantId, depth, date = today(), extra = {}) {
  const plant = plantOf(plantId);
  if (!plant) return;
  const result = stickResult(plant, depth);
  const events = logEvents(plantId, date, [{ type: 'palito', depth, result, ...extra }]);
  done(result === 'seco' ? `${displayName(plant)}: toca regar.` : humidPhrase(plant, date, settings()), events);
  return result;
}

export function logWater(plantId, withFert, date = today()) {
  const plant = plantOf(plantId);
  if (!plant) return;
  const list = [{ type: 'riego' }];
  if (withFert) list.push({ type: 'fert', product: PRODUCT, dose: doseText(plant, settings()) });
  done(withFert ? `Regada con ${PRODUCT.split(' ')[0]}. ¡Bien ahí!` : 'Regada. ¡Bien ahí!', logEvents(plantId, date, list));
}

export function logWaterChange(plantId, withFert, date = today()) {
  const plant = plantOf(plantId);
  if (!plant) return;
  const list = [{ type: 'agua' }];
  if (withFert) list.push({ type: 'fert', product: PRODUCT, dose: doseText(plant, settings()) });
  done(withFert ? 'Agua nueva, con sus 5 gotas.' : 'Agua nueva. ¡Listo!', logEvents(plantId, date, list));
}

on('stick', el => logStick(el.dataset.id, el.dataset.depth));
on('water', el => logWater(el.dataset.id, el.dataset.fert === '1'));
on('agua', el => logWaterChange(el.dataset.id, el.dataset.fert === '1'));
on('puntas', el => {
  const plant = plantOf(el.dataset.id);
  if (!plant) return;
  done(el.dataset.result === 'secas' ? `Anotado: puntas secas en ${displayName(plant)}.` : `${displayName(plant)}: sin puntas secas.`, logEvents(plant.id, today(), [{ type: 'puntas', result: el.dataset.result }]));
});

/* ---------- pedazos reutilizables ---------- */
/** La escala del palito: cinco macetas con la franja seca. */
export function potScale(plantId, attrs = '') {
  return `<div class="pots" role="group" aria-label="¿Hasta dónde salió seco?">${DEPTHS.map(d => `<button type="button" class="pot" data-act="stick" data-id="${esc(plantId)}" data-depth="${d.id}" ${attrs}>${potSvg(d.dry)}<span>${d.label}</span></button>`).join('')}</div>`;
}
/** Botones de "Regué", con la opción de Fertifox si hay una dosis esperando. */
export function waterButtons(plant, date = today(), act = 'water') {
  const fert = pendingFert(plant, date);
  const id = esc(plant.id);
  if (!fert) return `<div class="btns"><button class="btn primary big" data-act="${act}" data-id="${id}">${icon('drop')}Regué</button></div>`;
  return `<div class="btns col">
    <button class="btn primary big two" data-act="${act}" data-id="${id}" data-fert="1">${icon('flask')}<span><b>Regué con Fertifox</b><small>${esc(fert.dose)} · regá con el agua ya mezclada</small></span></button>
    <button class="btn" data-act="${act}" data-id="${id}">Regué solo con agua</button>
  </div>`;
}
const missingDose = dose => dose === 'media dosis' ? ' <a class="inline" href="#ajustes">Cargá la dosis de la etiqueta</a> y te la calculo.' : '';
export function fertNote(fert) {
  if (!fert) return '';
  const why = fert.kind === 'primera' ? 'Le toca su primera dosis' : 'Este mes le toca Fertifox';
  return `<p class="note fert">${icon('flask')}<span>${why}: si regás, que sea con ${esc(fert.dose)}.${missingDose(fert.dose)}</span></p>`;
}

/* ---------- hoja "Registrar" (desde la ficha) ---------- */
let draft = null;
export function openLogSheet(plantId, mode = null) {
  draft = { plantId, date: today(), mode };
  openSheet(renderLog);
}
on('log-open', el => openLogSheet(el.dataset.id, el.dataset.mode || null));
on('log-mode', el => { keepDate(); draft.mode = el.dataset.mode; updateSheet(); });
on('log-date', el => { if (el.value) { draft.date = el.value; updateSheet(); } });
const keepDate = () => { const v = $('#log-date')?.value; if (v) draft.date = v; };

function renderLog() {
  const plant = plantOf(draft.plantId);
  if (!plant) return '';
  const id = esc(plant.id), s = settings(), fert = pendingFert(plant, draft.date);
  const soil = plant.group !== 'agua';
  const tile = (mode, ic, label) => `<button class="tile ${draft.mode === mode ? 'on' : ''}" data-act="log-mode" data-mode="${mode}">${icon(ic)}<span>${label}</span></button>`;
  let body = '';
  if (draft.mode === 'palito') {
    body = `<p class="ask">¿Hasta dónde salió seco?</p>
      <p class="muted small">${esc(STICK_RULES[plant.rule]?.label || '')}</p>
      <div class="pots">${DEPTHS.map(d => `<button type="button" class="pot" data-act="log-stick" data-depth="${d.id}">${potSvg(d.dry)}<span>${d.label}</span></button>`).join('')}</div>
      ${field('Humedad ambiente (%), opcional', `<input id="log-hum" type="number" inputmode="numeric" min="0" max="100" placeholder="Del termohigrómetro" value="${cfg.humidity?.date === draft.date ? cfg.humidity.value : ''}">`)}`;
  } else if (draft.mode === 'riego') {
    body = `${fertNote(fert)}${waterButtons(plant, draft.date, soil ? 'log-water' : 'log-agua')}`;
  } else if (draft.mode === 'agua') {
    body = fert
      ? `<div class="btns col"><button class="btn primary big two" data-act="log-agua" data-fert="1">${icon('flask')}<span><b>Cambié el agua, con Fertifox</b><small>${esc(fert.dose)}</small></span></button><button class="btn" data-act="log-agua">Cambié el agua, sin gotas</button></div>`
      : `<div class="btns"><button class="btn primary big" data-act="log-agua">${icon('glass')}Cambié el agua</button></div>`;
  } else if (draft.mode === 'fert') {
    body = `<form data-submit="log-save" class="form">
      ${field('Producto', `<input name="product" value="${esc(PRODUCT)}" required>`)}
      ${field('Dosis', `<input name="dose" value="${esc(doseText(plant, s))}" required>`, soil ? 'Regá con el agua ya mezclada. Nunca con la tierra seca.' : '')}
      ${field('Nota', '<input name="note" placeholder="Opcional">')}
      <button class="btn primary big">Guardar fertilización</button></form>`;
  } else if (draft.mode === 'trasplante' || draft.mode === 'recalce') {
    body = `<form data-submit="log-save" class="form">
      ${field('Sustrato usado', '<input name="substrate" placeholder="Ej.: 70 % GrowMix + 30 % corteza" required>')}
      ${field('Nota', '<input name="note" placeholder="Opcional">')}
      <label class="check"><input type="checkbox" name="updatePot"><span>Actualizar “maceta y sustrato” en la ficha</span></label>
      <button class="btn primary big">Guardar ${draft.mode}</button></form>`;
  } else if (draft.mode === 'nota') {
    body = `<form data-submit="log-save" class="form">
      ${field('Nota', '<textarea name="note" rows="3" placeholder="¿Qué viste?" required></textarea>')}
      <button class="btn primary big">Guardar nota</button></form>`;
  }
  return `<h2 class="sheet-title">Registrar · ${plantTitle(plant)}</h2>
    ${field('Fecha', `<input id="log-date" type="date" value="${draft.date}" max="${today()}" data-change="log-date">`)}
    <div class="tiles">
      ${soil ? tile('palito', 'stick', 'Palito') + tile('riego', 'drop', 'Regué') : tile('agua', 'glass', 'Cambié el agua')}
      ${plant.fertFrom !== 'nunca' ? tile('fert', 'flask', 'Fertilicé') : ''}
      ${soil ? tile('trasplante', 'pot', 'Trasplante') + tile('recalce', 'pot', 'Recalce') : ''}
      ${tile('nota', 'note', 'Nota')}
      <button class="tile" data-act="photo-new" data-id="${id}">${icon('camera')}<span>Foto</span></button>
    </div>
    ${body}`;
}

on('log-stick', el => {
  keepDate();
  const hum = parseInt($('#log-hum')?.value, 10);
  const extra = hum >= 0 && hum <= 100 ? { hum } : {};
  if (extra.hum != null && draft.date === today()) { cfg.humidity = { date: draft.date, value: hum }; saveCfg(); }
  const result = logStick(draft.plantId, el.dataset.depth, draft.date, extra);
  if (result === 'seco') { draft.mode = 'riego'; updateSheet(); } else closeSheet();
});
on('log-water', el => { keepDate(); logWater(draft.plantId, el.dataset.fert === '1', draft.date); closeSheet(); });
on('log-agua', el => { keepDate(); logWaterChange(draft.plantId, el.dataset.fert === '1', draft.date); closeSheet(); });
on('log-save', form => {
  keepDate();
  const plant = plantOf(draft.plantId), f = readForm(form);
  let fields, message;
  if (draft.mode === 'fert') { fields = { type: 'fert', product: f.product, dose: f.dose, note: f.note }; message = 'Fertilización anotada.'; }
  else if (draft.mode === 'nota') { fields = { type: 'nota', note: f.note }; message = 'Nota guardada.'; }
  else { fields = { type: draft.mode, substrate: f.substrate, note: f.note }; message = `${cap(draft.mode)} anotado.`; }
  const prevPot = plant.pot;
  const events = logEvents(plant.id, draft.date, [fields]);
  if (f.updatePot) { patch('plants', plant.id, { pot: `${f.substrate} (${draft.mode} ${fmtShort(draft.date)})` }); commit(); }
  haptic();
  toast(message, { undo: () => { if (f.updatePot) patch('plants', plant.id, { pot: prevPot }); undoEvents(events); } });
  closeSheet();
});

/* ---------- editar un registro: fecha, nota, borrar ---------- */
let editing = null;
on('event-open', el => {
  editing = byId('events', el.dataset.id);
  if (!editing) return;
  openSheet(() => {
    const e = editing, plant = plantOf(e.plantId);
    return `<h2 class="sheet-title">${esc(eventTitle(e))}</h2>
      <p class="muted">${plant ? plantTitle(plant) + ' · ' : ''}${cap(relDay(e.date, today()))}, ${fmtDay(e.date)}${e.by ? ` · lo anotó ${esc(e.by)}` : ''}</p>
      <form data-submit="event-save" class="form">
        ${field('Fecha', `<input type="date" name="date" value="${e.date}" max="${today()}" required>`)}
        ${e.type === 'palito' ? field('¿Hasta dónde salió seco?', `<select name="depth">${DEPTHS.map(d => `<option value="${d.id}" ${d.id === e.depth ? 'selected' : ''}>${d.label}</option>`).join('')}</select>`) : ''}
        ${e.type === 'palito' ? field('Humedad ambiente (%)', `<input type="number" name="hum" inputmode="numeric" min="0" max="100" value="${e.hum ?? ''}" placeholder="Opcional">`) : ''}
        ${e.type === 'fert' ? field('Producto', `<input name="product" value="${esc(e.product || '')}">`) + field('Dosis', `<input name="dose" value="${esc(e.dose || '')}">`) : ''}
        ${e.type === 'trasplante' || e.type === 'recalce' ? field('Sustrato usado', `<input name="substrate" value="${esc(e.substrate || '')}">`) : ''}
        ${field('Nota', `<textarea name="note" rows="2" placeholder="Opcional">${esc(e.note || '')}</textarea>`)}
        <div class="btns col"><button class="btn primary big">Guardar</button><button type="button" class="btn danger ghost" data-act="event-delete">Borrar este registro</button></div>
      </form>`;
  });
});
on('event-save', form => {
  const f = readForm(form), e = editing, plant = plantOf(e.plantId);
  const next = { ...e, date: f.date || e.date, note: f.note };
  if (e.type === 'palito') {
    next.depth = f.depth; if (plant) next.result = stickResult(plant, f.depth);
    const hum = parseInt(f.hum, 10);
    if (hum >= 0 && hum <= 100) next.hum = hum; else delete next.hum;
  }
  if (e.type === 'fert') { next.product = f.product; next.dose = f.dose; }
  if ('substrate' in f) next.substrate = f.substrate;
  put('events', next); commit(); closeSheet();
  toast('Registro actualizado.', { undo: () => { put('events', { ...e }); commit(); } });
});
on('event-delete', () => {
  const e = editing;
  remove('events', e.id); commit(); closeSheet();
  toast('Registro borrado.', { undo: () => { put('events', { ...e }); commit(); } });
});

/* ---------- humedad ambiente ---------- */
on('hum-open', () => {
  openSheet(() => `<h2 class="sheet-title">Humedad ambiente</h2>
    <p class="muted">Si tenés un termohigrómetro, anotá lo que marca. Queda guardada con los palitos que registres hoy.</p>
    <form data-submit="hum-save" class="form">
      ${field('Humedad (%)', `<input name="hum" type="number" inputmode="numeric" min="0" max="100" value="${cfg.humidity?.date === today() ? cfg.humidity.value : ''}" placeholder="Ej.: 45" autofocus>`)}
      <div class="btns col"><button class="btn primary big">Guardar</button>${cfg.humidity?.date === today() ? '<button type="button" class="btn ghost" data-act="hum-clear">Quitar</button>' : ''}</div>
    </form>`);
});
on('hum-save', form => {
  const hum = parseInt(readForm(form).hum, 10);
  if (!(hum >= 0 && hum <= 100)) return toast('Poné un número entre 0 y 100.');
  cfg.humidity = { date: today(), value: hum }; saveCfg();
  // También queda en los palitos de hoy que no la tenían.
  let touched = false;
  for (const e of state.db.events.filter(x => x.type === 'palito' && x.date === today() && x.hum == null)) { put('events', { ...e, hum }); touched = true; }
  if (touched) commit(); else emit();
  closeSheet();
});
on('hum-clear', () => { cfg.humidity = null; saveCfg(); emit(); closeSheet(); });
