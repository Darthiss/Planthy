// Documento de datos y fusión entre dispositivos. Sin DOM: lo usan la app, la importación y el script de recordatorios.
// Patrón: cada registro tiene un `t` (milisegundos de la última edición). Al fusionar gana el más nuevo,
// y los borrados quedan como lápidas en `deleted` para que no revivan desde otro teléfono.

export const COLLECTIONS = ['plants', 'events', 'tasks', 'photos', 'subs'];

export const emptyDoc = () => ({ app: 'planthy', v: 1, plants: [], events: [], tasks: [], photos: [], subs: [], settings: {}, st: {}, deleted: {} });

export function normalize(d) {
  if (!d || typeof d !== 'object' || d.app !== 'planthy') return null;
  const out = emptyDoc();
  for (const c of COLLECTIONS) out[c] = Array.isArray(d[c]) ? d[c].filter(r => r && typeof r.id === 'string') : [];
  out.settings = d.settings && typeof d.settings === 'object' ? d.settings : {};
  out.st = d.st && typeof d.st === 'object' ? d.st : {};
  out.deleted = d.deleted && typeof d.deleted === 'object' ? d.deleted : {};
  return out;
}

/** Texto canónico (claves ordenadas) para comparar dos documentos. */
export function canon(x) {
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().filter(k => x[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
  return JSON.stringify(x === undefined ? null : x);
}

// Ante el mismo `t`, desempata por contenido para que los dos teléfonos elijan lo mismo.
const newer = (a, b) => (a.t || 0) !== (b.t || 0) ? (a.t || 0) > (b.t || 0) : canon(a) > canon(b);

export function merge(a, b) {
  const deleted = { ...(a.deleted || {}) };
  for (const [id, t] of Object.entries(b.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, t);
  const out = { app: 'planthy', v: 1 };
  for (const c of COLLECTIONS) {
    const m = new Map();
    for (const r of [...(a[c] || []), ...(b[c] || [])]) { const cur = m.get(r.id); if (!cur || newer(r, cur)) m.set(r.id, r); }
    // Orden fijo por id: si no, dos teléfonos se pisarían el archivo solo por el orden.
    out[c] = [...m.values()].filter(r => !(deleted[r.id] >= (r.t || 0))).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  }
  // Ajustes: gana el más nuevo, clave por clave.
  out.settings = {}; out.st = {};
  const sa = a.settings || {}, sb = b.settings || {}, ta = a.st || {}, tb = b.st || {};
  for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
    const pickB = !(k in sa) || (k in sb && ((tb[k] || 0) > (ta[k] || 0) || ((tb[k] || 0) === (ta[k] || 0) && canon(sb[k]) > canon(sa[k]))));
    out.settings[k] = pickB ? sb[k] : sa[k];
    const t = pickB ? tb[k] : ta[k];
    if (t) out.st[k] = t;
  }
  out.deleted = deleted;
  return out;
}

let seq = 0;
/** Id único y ordenable por fecha de creación: "e-20261109-lk3f9a2b". */
export function newId(prefix, date) {
  const d = (date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  const rnd = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
  return `${prefix}-${d}-${Date.now().toString(36).slice(-5)}${(seq++ % 36).toString(36)}${rnd}`;
}
