// Reglas de cuidado, tal cual el informe. Módulo puro (sin DOM ni red): lo usan la app y el script de
// recordatorios de GitHub Actions, así los dos calculan siempre lo mismo.
//
// Qué plantas hay, en qué grupo están y cuáles tienen reglas especiales (calor, aire) viene en los datos.
// Acá solo vive la lógica.

import { addDays, addMonths, diffDays, dow, monthOf, firstSunday, nthSunday, sundayIndex, isGrowing, relDay, dayName, parts } from './dates.js';

export const TZ = 'America/Argentina/Buenos_Aires';
export const PRODUCT = 'Fertifox Potenciado';

export const GROUPS = {
  semanal: { label: 'Semanal', when: 'Todos los domingos de octubre a marzo. De abril a septiembre, el 1.er y el 3.er domingo.' },
  mensual: { label: 'Mensual', when: 'El 1.er domingo de cada mes.' },
  agua: { label: 'En agua', when: 'Cambio de agua todos los domingos.' },
};

// "¿Hasta dónde salió seco?" — `dry` es la parte de la maceta que se dibuja seca.
export const DEPTHS = [
  { id: 'nada', label: 'Nada', dry: 0 },
  { id: '2cm', label: '2 cm', dry: 0.14 },
  { id: '3-5cm', label: '3–5 cm', dry: 0.3 },
  { id: 'mitad', label: 'Mitad', dry: 0.5 },
  { id: 'todo', label: 'Todo', dry: 1 },
];

// Las cuatro reglas del palito que existen en el informe. `min` = desde qué opción de DEPTHS toca regar.
export const STICK_RULES = {
  '2cm': { min: 1, label: 'Regar si los primeros 2 cm están secos' },
  '3-5cm': { min: 2, label: 'Regar si los primeros 3–5 cm salen secos' },
  mitad: { min: 3, label: 'Regar solo si está seca hasta la mitad de la maceta' },
  fondo: { min: 4, label: 'Regar solo si el palito sale seco hasta el fondo' },
};

export const AIRE = { apagado: 'Apagado', frio: 'Frío', calor: 'Calor' };

export const DEFAULTS = {
  start: null, // la app no marca como atrasado nada anterior a esta fecha
  labelDose: null, // ml por litro, de la etiqueta
  heat: 32,
  location: { name: 'Buenos Aires', lat: -34.6037, lon: -58.3816 },
  reminderTime: '09:00',
  aire: 'apagado',
  aireSince: null,
};
export const cfgOf = data => ({ ...DEFAULTS, ...(data.settings || {}) });

export const displayName = p => (p.nick && p.nick.trim()) || p.name;
export const activePlants = data => data.plants.filter(p => !p.archived).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, 'es'));

/* ---------- palito ---------- */
export const depthIndex = id => DEPTHS.findIndex(d => d.id === id);
/** 'seco' (toca regar) o 'humedo', según la regla de esa planta. */
export function stickResult(plant, depth) {
  const rule = STICK_RULES[plant.rule];
  return rule && depthIndex(depth) >= rule.min ? 'seco' : 'humedo';
}

/* ---------- calendario fijo ---------- */
const sinceOf = (plant, s) => { const a = plant.since || '', b = s.start || ''; return a > b ? a : b; };

export function isRegularDay(plant, date, s) {
  if (dow(date) !== 0) return false;
  if (plant.group === 'agua') return true;
  if (plant.group === 'mensual') return sundayIndex(date) === 1;
  if (isGrowing(date)) return true;
  if (s.aire === 'calor') return true; // modo aire en Calor: todos los domingos también de abril a septiembre
  const n = sundayIndex(date);
  return n === 1 || n === 3;
}

/** Última revisión fija en `date` o antes (sin pasarse del inicio del seguimiento). */
export function lastRegular(plant, date, s) {
  const min = sinceOf(plant, s);
  for (let d = addDays(date, -dow(date)), i = 0; i < 7; i++, d = addDays(d, -7)) {
    if (min && d < min) return null;
    if (isRegularDay(plant, d, s)) return d;
  }
  return null;
}

/** Próxima revisión fija estrictamente después de `date`. */
export function nextRegular(plant, date, s) {
  const min = sinceOf(plant, s);
  for (let d = addDays(date, 7 - dow(date)), i = 0; i < 8; i++, d = addDays(d, 7)) {
    if ((!min || d >= min) && isRegularDay(plant, d, s)) return d;
  }
  return null;
}

/** Re-chequeo de una planta que dio húmedo en `date`. null si antes le toca una revisión fija. */
export function recheckDate(plant, date, s) {
  if (plant.group === 'semanal') {
    const wed = addDays(date, (3 - dow(date) + 7) % 7 || 7);
    const reg = nextRegular(plant, date, s);
    return reg && reg < wed ? null : wed;
  }
  if (plant.group === 'mensual') {
    const third = nthSunday(monthOf(date), 3);
    return date < third ? third : null;
  }
  return null;
}

/* ---------- calor ---------- */
/** De miércoles a sábado, el miércoles de esa semana. Si no, null. */
export const heatWednesday = date => (dow(date) >= 3 ? addDays(date, 3 - dow(date)) : null);
/** Máxima de lunes, martes y miércoles (registrada o pronosticada). `weather.daily` = { 'AAAA-MM-DD': máxima }. */
export function heatMax(weather, wed) {
  const v = [addDays(wed, -2), addDays(wed, -1), wed].map(d => weather?.daily?.[d]).filter(x => typeof x === 'number');
  return v.length ? Math.max(...v) : null;
}
export const isHot = (weather, wed, s) => { const m = heatMax(weather, wed); return m != null && m > Number(s.heat ?? 32); };

/* ---------- fertilización ---------- */
const fmtNum = n => String(Math.round(n * 100) / 100).replace('.', ',');
/** Media dosis de la etiqueta. Las plantas en agua llevan 5 gotas. */
export function doseText(plant, s) {
  if (plant.group === 'agua') return '5 gotas en el vaso';
  const label = Number(s.labelDose);
  return label > 0 ? `${fmtNum(label / 2)} ml por litro` : 'media dosis';
}

/**
 * ¿Hay una dosis esperando el próximo riego? Reglas:
 * - De abril a septiembre no se fertiliza. Antes de la fecha de inicio de la planta, tampoco. "nunca" es nunca.
 * - La dosis del mes arranca el 1.er domingo y vale hasta fin de mes: si ese día dio húmedo, va en el próximo riego
 *   del mismo mes. Una sola por mes; no se arrastra al mes siguiente.
 * - `firstDose`: primera dosis pendiente, en el próximo riego, el día que sea.
 */
export function fertPending(plant, evs, date, s, opts = {}) {
  const from = plant.fertFrom;
  if (!from || from === 'nunca' || !isGrowing(date) || date < from) return null;
  const ferts = evs.filter(e => e.type === 'fert');
  const dose = doseText(plant, s);
  if (plant.firstDose && !ferts.length && !opts.firstDone) return { kind: 'primera', dose };
  const ym = monthOf(date), first = firstSunday(ym);
  if (date < first || first < from) return null;
  if (ferts.some(e => monthOf(e.date) === ym) || opts.doneMonths?.has(ym)) return null;
  return { kind: 'mensual', dose };
}

/** Próxima dosis: { date, kind, dose, now } (now = va en el próximo riego). null si no fertiliza. */
export function nextFert(plant, evs, today, s) {
  if (!plant.fertFrom || plant.fertFrom === 'nunca') return null;
  const now = fertPending(plant, evs, today, s);
  if (now) return { ...now, date: today, now: true };
  for (let ym = monthOf(today), i = 0; i < 14; i++, ym = addMonths(ym, 1)) {
    const d = firstSunday(ym);
    if (d <= today) continue;
    const f = fertPending(plant, evs, d, s);
    if (f) return { ...f, date: d, now: false };
  }
  return null;
}

/* ---------- estado de cada planta ---------- */
const after = (a, b) => !!a && (!b || a.date > b.date || (a.date === b.date && (a.t || 0) > (b.t || 0)));
const last = (evs, type) => { let r = null; for (const e of evs) if (e.type === type && after(e, r)) r = e; return r; };
export const eventsOf = (data, plantId) => data.events.filter(e => e.plantId === plantId);

/**
 * Qué necesita la planta hoy.
 * kind: 'ok' | 'revisar' | 'recheck' | 'calor' | 'regar' | 'agua'
 * due: desde cuándo está pendiente · overdue: viene de un día anterior · recheck: re-chequeo futuro
 * next: próxima fecha en la que le toca algo · fert: dosis que va en el próximo riego
 */
export function plantStatus(data, plant, today, weather) {
  const s = cfgOf(data);
  const evs = eventsOf(data, plant.id);
  const fert = fertPending(plant, evs, today, s);
  const next = nextRegular(plant, today, s);
  const reg = lastRegular(plant, today, s);

  if (plant.group === 'agua') {
    const change = last(evs, 'agua');
    if (reg && (!change || change.date < reg)) return { kind: 'agua', due: reg, overdue: reg < today, fert, next };
    return { kind: 'ok', fert, next, recheck: null };
  }

  const stick = last(evs, 'palito'), water = last(evs, 'riego');
  const open = after(stick, water) ? stick : null; // lectura del palito sin riego posterior
  const care = open || water;
  const recheck = open && open.result === 'humedo' ? recheckDate(plant, open.date, s) : null;
  const wed = plant.heatCheck ? heatWednesday(today) : null;
  const hot = wed && wed >= sinceOf(plant, s) && isHot(weather, wed, s) ? wed : null;

  let due = null;
  const cand = (date, kind) => { if (date && date <= today && (!due || date > due.date || (date === due.date && kind === 'recheck'))) due = { date, kind }; };
  cand(reg, 'revisar'); cand(hot, 'calor'); cand(recheck, 'recheck');

  if (due && (!care || care.date < due.date)) {
    return { kind: due.kind, due: due.date, overdue: due.date < today, fert, next, heatMax: hot ? heatMax(weather, hot) : null };
  }
  if (open && open.result === 'seco') return { kind: 'regar', due: open.date, overdue: open.date < today, fert, next };
  const future = recheck && recheck > today ? recheck : null;
  return { kind: 'ok', fert, recheck: future, next: future && (!next || future < next) ? future : next };
}

export function statusLabel(st, today) {
  switch (st.kind) {
    case 'revisar': return st.overdue ? `Revisión pendiente desde ${relDay(st.due, today)}` : 'Toca revisar hoy';
    case 'recheck': return st.overdue ? `Re-chequeo pendiente desde ${relDay(st.due, today)}` : 'Re-chequeo hoy';
    case 'calor': return st.overdue ? 'Revisión por calor pendiente' : 'Revisar hoy por el calor';
    case 'regar': return 'Regar';
    case 'agua': return st.overdue ? `Cambio de agua pendiente desde ${relDay(st.due, today)}` : 'Cambiar el agua hoy';
    default: return st.recheck ? `Re-chequeo ${relDay(st.recheck, today)}` : 'Al día';
  }
}

/** Frase de confirmación cuando el palito dio húmedo. */
export function humidPhrase(plant, date, s) {
  const re = recheckDate(plant, date, s);
  if (re) return plant.group === 'semanal' && diffDays(re, date) < 7 ? `Dale, te aviso el ${dayName(re)}.` : `Dale, te aviso ${relDay(re, date)}.`;
  const next = nextRegular(plant, date, s);
  return next ? `Dale, la volvemos a mirar ${relDay(next, date)}.` : 'Dale, anotado.';
}

/* ---------- tarjetas semanales y mensuales ---------- */
/** Modo aire en Frío o Calor: revisión semanal de puntas secas en las plantas sensibles. */
export function airePending(data, today) {
  const s = cfgOf(data);
  if (!s.aire || s.aire === 'apagado') return null;
  const sun = addDays(today, -dow(today));
  if ((s.aireSince && sun < s.aireSince) || (s.start && sun < s.start)) return null;
  const plants = activePlants(data).filter(p => p.aireSensible && !data.events.some(e => e.plantId === p.id && e.type === 'puntas' && e.date >= sun));
  return plants.length ? { kind: 'puntas', due: sun, overdue: sun < today, plants } : null;
}

/** Foto de progreso: se sugiere el 1.er domingo de cada mes (y queda esa semana). */
export function fotoPending(data, today) {
  const s = cfgOf(data);
  const first = firstSunday(monthOf(today));
  if (today < first || diffDays(today, first) > 6 || (s.start && first < s.start)) return null;
  const plants = activePlants(data).filter(p => !data.photos.some(f => f.plantId === p.id && f.date >= first));
  return plants.length ? { kind: 'foto', due: first, overdue: first < today, plants } : null;
}

export function birthdaysOn(data, date) {
  return activePlants(data)
    .filter(p => p.birthday && p.birthday < date && p.birthday.slice(5) === date.slice(5))
    .map(p => ({ plant: p, years: parts(date)[0] - parts(p.birthday)[0] }));
}

export const tasksDue = (data, today) => data.tasks.filter(t => !t.done && !t.optional && t.from && t.from <= today);

/* ---------- lo de hoy ---------- */
/** Plantas con algo pendiente hoy (incluye lo atrasado). */
export function todayItems(data, today, weather) {
  const items = [];
  for (const plant of activePlants(data)) {
    const st = plantStatus(data, plant, today, weather);
    if (st.kind !== 'ok') items.push({ ...st, plant });
  }
  return items;
}

/* ---------- agenda: hoy + proyección ---------- */
/**
 * Mapa fecha → items entre `today` y `until`. Hoy lleva lo pendiente; los días que siguen, lo que marca el
 * calendario fijo, los re-chequeos ya programados, el calor pronosticado y las tareas con fecha.
 * item: { kind, plant?, plants?, task?, fert?, due, overdue? }
 */
export function agenda(data, today, until, weather) {
  const s = cfgOf(data), out = new Map();
  const add = (d, it) => { if (!out.has(d)) out.set(d, []); out.get(d).push(it); };

  for (const plant of activePlants(data)) {
    const evs = eventsOf(data, plant.id);
    const st = plantStatus(data, plant, today, weather);
    // En la proyección, cada dosis se cuenta una sola vez: en la primera fecha en que la planta tiene riego posible.
    const doneMonths = new Set(); let firstDone = false;
    const fertOn = d => {
      const f = fertPending(plant, evs, d, s, { firstDone, doneMonths });
      if (!f) return null;
      if (f.kind === 'primera') firstDone = true;
      doneMonths.add(monthOf(d));
      return f;
    };
    if (st.kind !== 'ok') add(today, { kind: st.kind, plant, due: st.due, overdue: st.overdue, fert: fertOn(today), heatMax: st.heatMax });
    for (let d = addDays(today, 1); d <= until; d = addDays(d, 1)) {
      let kind = null;
      if (isRegularDay(plant, d, s) && d >= sinceOf(plant, s)) kind = plant.group === 'agua' ? 'agua' : 'revisar';
      else if (st.kind === 'ok' && st.recheck === d) kind = 'recheck';
      else if (plant.group !== 'agua' && plant.heatCheck && dow(d) === 3 && isHot(weather, d, s)) kind = 'calor';
      if (kind) add(d, { kind, plant, due: d, fert: fertOn(d), heatMax: kind === 'calor' ? heatMax(weather, d) : null });
    }
  }

  const aire = airePending(data, today); if (aire) add(today, aire);
  const foto = fotoPending(data, today); if (foto) add(today, foto);
  const aireOn = s.aire && s.aire !== 'apagado';
  const sensitive = activePlants(data).filter(p => p.aireSensible);
  for (let d = today; d <= until; d = addDays(d, 1)) {
    for (const task of data.tasks) if (!task.done && task.from === d) add(d, { kind: 'tarea', task, due: d });
    for (const b of birthdaysOn(data, d)) add(d, { kind: 'cumple', plant: b.plant, years: b.years, due: d });
    if (d === today) continue;
    if (aireOn && sensitive.length && dow(d) === 0) add(d, { kind: 'puntas', plants: sensitive, due: d });
    if (d === firstSunday(monthOf(d)) && activePlants(data).length) add(d, { kind: 'foto', plants: activePlants(data), due: d });
  }
  return out;
}

/* ---------- notificación del día ---------- */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const list = names => (names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' y ' + names[names.length - 1]);

/**
 * Resumen accionable de lo que vence hoy. null si no toca nada.
 * Ej.: { title: 'Domingo de plantas', body: '5 para revisar, cambio de agua y 1 con Fertifox.' }
 */
export function notificationFor(data, today, weather) {
  const items = (agenda(data, today, today, weather).get(today) || []).filter(i => i.due === today);
  if (!items.length) return null;
  const checks = items.filter(i => ['revisar', 'recheck', 'calor'].includes(i.kind));
  const rechecks = checks.filter(i => i.kind === 'recheck');
  const heat = checks.filter(i => i.kind === 'calor');
  const water = items.filter(i => i.kind === 'agua');
  const fert = items.filter(i => i.fert);
  const tasks = items.filter(i => i.kind === 'tarea');
  const others = items.filter(i => ['puntas', 'foto', 'cumple'].includes(i.kind));
  const sunday = dow(today) === 0;
  const names = arr => list(arr.map(i => displayName(i.plant).toLowerCase()));

  let title;
  if (sunday && (checks.length || water.length)) title = sundayIndex(today) === 1 ? 'Primer domingo del mes' : 'Domingo de plantas';
  else if (heat.length) title = `Hace calor${heat[0].heatMax != null ? `: máxima de ${Math.round(heat[0].heatMax)} °C` : ''}`;
  else if (rechecks.length) title = rechecks.length === 1 ? `Re-chequeo: ${displayName(rechecks[0].plant)}` : 'Re-chequeos de hoy';
  else if (tasks.length) title = tasks.length === 1 ? 'Tarea de plantas' : 'Tareas de plantas';
  else if (others.some(i => i.kind === 'cumple')) title = 'Cumpleaños en casa';
  else title = 'Plantas';

  const bits = [];
  if (sunday && checks.length) bits.push(`${checks.length} para revisar`);
  else {
    if (heat.length) bits.push(`revisá ${names(heat)}`);
    if (rechecks.length) bits.push(heat.length || rechecks.length > 1 ? `re-chequeo de ${names(rechecks)}` : 'dio húmedo: pasale el palito hoy');
    const plain = checks.filter(i => i.kind === 'revisar');
    if (plain.length) bits.push(`${plain.length} para revisar`);
  }
  if (water.length) bits.push('cambio de agua');
  if (fert.length) bits.push(`${fert.length} con Fertifox`);
  if (tasks.length) bits.push(tasks.length === 1 ? tasks[0].task.title : plural(tasks.length, 'tarea', 'tareas'));
  for (const o of others) {
    if (o.kind === 'puntas') bits.push('mirar puntas secas');
    if (o.kind === 'foto') bits.push('foto del mes');
    if (o.kind === 'cumple') bits.push(`${displayName(o.plant)} cumple ${plural(o.years, 'año', 'años')} en casa`);
  }
  let body = bits.length > 1 ? bits.slice(0, -1).join(', ') + ' y ' + bits[bits.length - 1] : bits[0] || '';
  body = body.charAt(0).toUpperCase() + body.slice(1);
  if (body && !/[.!?]$/.test(body)) body += '.';
  const count = checks.length + water.length + tasks.length;
  return { title, body, count };
}
