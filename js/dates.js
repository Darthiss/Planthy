// Fechas como texto 'AAAA-MM-DD'. Las cuentas se hacen en UTC para que no dependan del huso del dispositivo.
// Este módulo no toca el DOM: lo usan la app y el script de recordatorios (Node).

export const pad = n => String(n).padStart(2, '0');
export const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export const parts = s => s.split('-').map(Number);

const utc = s => { const [y, m, d] = parts(s); return Date.UTC(y, m - 1, d); };
const fromUtc = ms => { const d = new Date(ms); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };

export const addDays = (s, n) => fromUtc(utc(s) + n * 864e5);
export const diffDays = (a, b) => Math.round((utc(a) - utc(b)) / 864e5);
export const dow = s => new Date(utc(s)).getUTCDay(); // 0 = domingo
export const monthOf = s => s.slice(0, 7);
export const monthNum = s => parts(s)[1];
export const daysInMonth = ym => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${pad(i % 12 + 1)}`;
};

export const firstSunday = ym => { const f = `${ym}-01`; return addDays(f, (7 - dow(f)) % 7); };
export const nthSunday = (ym, n) => addDays(firstSunday(ym), 7 * (n - 1));
/** 1 si es el 1.er domingo del mes, 2 si es el 2.º… y 0 si no es domingo. */
export const sundayIndex = s => (dow(s) === 0 ? Math.ceil(parts(s)[2] / 7) : 0);
/** Temporada de crecimiento: octubre a marzo. */
export const isGrowing = s => { const m = monthNum(s); return m >= 10 || m <= 3; };

export const localToday = () => { const d = new Date(); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
export const todayIn = tz => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const timeIn = tz => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());

/* ---------- textos ---------- */
export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const dayName = s => DIAS[dow(s)];
export const monthName = s => MESES[monthNum(s) - 1];
/** "15 de noviembre" */
export const fmtDay = s => `${parts(s)[2]} de ${monthName(s)}`;
/** "domingo 15 de noviembre" */
export const fmtLong = s => `${dayName(s)} ${fmtDay(s)}`;
/** "15/11" o "15/11/2026" si es de otro año que la referencia */
export const fmtShort = (s, ref) => { const [y, m, d] = parts(s); return ref && parts(ref)[0] === y ? `${d}/${m}` : `${d}/${m}/${y}`; };
/** "hoy", "mañana", "el miércoles", "el domingo 22", "el 6 de diciembre" */
export function relDay(s, today) {
  const n = diffDays(s, today);
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n === -1) return 'ayer';
  if (n > 1 && n < 7) return `el ${dayName(s)}`;
  if (n < -1 && n > -7) return `el ${dayName(s)} pasado`;
  if (Math.abs(n) < 28 && monthOf(s) === monthOf(today)) return `el ${dayName(s)} ${parts(s)[2]}`;
  return `el ${fmtDay(s)}${parts(s)[0] !== parts(today)[0] ? ' de ' + parts(s)[0] : ''}`;
}
