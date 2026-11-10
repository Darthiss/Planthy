// Archivos .ics con alarma para el Calendario del iPhone: la alternativa a las notificaciones que siempre funciona.

import { state, settings, today } from './store.js';
import { activePlants, displayName, agenda, GROUPS } from './rules.js';
import { addDays, dow, firstSunday, monthOf, parts, pad } from './dates.js';

const TZID = 'America/Argentina/Buenos_Aires';
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Líneas de hasta 75 bytes, como pide el formato.
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = []; let cur = '', len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0; }
    cur += ch; len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const stampDate = (date, time) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
const nowStamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const plus = (time, min) => { const [h, m] = time.split(':').map(Number); const t = Math.min(h * 60 + m + min, 23 * 60 + 59); return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; };

function vevent({ uid, date, summary, description, rrule }) {
  const time = settings().reminderTime || '09:00';
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@planthy`,
    `DTSTAMP:${nowStamp()}`,
    `DTSTART;TZID=${TZID}:${stampDate(date, time)}`,
    `DTEND;TZID=${TZID}:${stampDate(date, plus(time, 30))}`,
    rrule ? `RRULE:${rrule}` : null,
    `SUMMARY:${esc(summary)}`,
    description ? `DESCRIPTION:${esc(description)}` : null,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT',
  ].filter(Boolean);
}
function calendar(events) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Planthy//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Planthy',
    'BEGIN:VTIMEZONE', `TZID:${TZID}`, 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:-0300', 'TZOFFSETTO:-0300', 'TZNAME:-03', 'END:STANDARD', 'END:VTIMEZONE',
    ...events.flat(),
    'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n';
}

const names = (plants, group) => plants.filter(p => p.group === group).map(displayName).join(', ');

/** Recordatorios fijos: todos los domingos y el 1.er domingo de cada mes. */
export function fixedIcs() {
  const plants = activePlants(state.db), t = today();
  const sunday = addDays(t, (7 - dow(t)) % 7);
  let first = firstSunday(monthOf(t));
  if (first < t) { const [y, m] = parts(t); first = firstSunday(m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`); }
  const weekly = [
    names(plants, 'agua') && `Cambio de agua: ${names(plants, 'agua')}.`,
    names(plants, 'semanal') && `Palito: ${names(plants, 'semanal')}. ${GROUPS.semanal.when}`,
    'Abrí Planthy para ver qué toca hoy.',
  ].filter(Boolean).join('\n');
  const monthly = [
    names(plants, 'mensual') && `Palito del grupo mensual: ${names(plants, 'mensual')}.`,
    'De octubre a marzo, además: fertilización en el riego de hoy (regá con el agua ya mezclada).',
    'Foto del mes para ver el progreso.',
  ].filter(Boolean).join('\n');
  return calendar([
    vevent({ uid: 'domingo', date: sunday, summary: 'Plantas: revisión del domingo', description: weekly, rrule: 'FREQ=WEEKLY;BYDAY=SU' }),
    vevent({ uid: 'primer-domingo', date: first, summary: 'Plantas: 1.er domingo del mes', description: monthly, rrule: 'FREQ=MONTHLY;BYDAY=1SU' }),
  ]);
}

/** Recordatorios puntuales: re-chequeos ya programados y tareas con fecha. Devuelve { ics, count }. */
export function oneOffIcs() {
  const t = today(), events = [];
  for (const [date, items] of agenda(state.db, t, addDays(t, 120), state.weather)) {
    for (const it of items) {
      if (it.kind === 'recheck' && date >= t) events.push(vevent({ uid: `recheck-${it.plant.id}-${date}`, date, summary: `Plantas: re-chequeo de ${displayName(it.plant)}`, description: 'Dio húmedo la última vez. Pasale el palito hoy.' }));
      if (it.kind === 'tarea' && date > t) events.push(vevent({ uid: `tarea-${it.task.id}`, date, summary: `Plantas: ${it.task.title.length > 60 ? it.task.title.slice(0, 57) + '…' : it.task.title}`, description: it.task.title }));
    }
  }
  return { ics: calendar(events), count: events.length };
}
