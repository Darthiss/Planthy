// Notificaciones push. En iOS solo funcionan con la app instalada en la pantalla de inicio (iOS 16.4+) y el
// permiso hay que pedirlo desde un toque. La suscripción de cada teléfono se guarda en el repo privado;
// el envío lo hace el workflow de GitHub Actions.

import { state, cfg, saveCfg, settings, put, remove, commit, byId } from './store.js';

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** 'on' | 'off' | 'denied' | 'install' (iOS sin instalar) | 'unsupported' | 'nokey' */
export function pushStatus() {
  if (!pushSupported()) return isIOS() && !isStandalone() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (!settings().vapidPublic) return 'nokey';
  return cfg.pushOn && Notification.permission === 'granted' && byId('subs', cfg.deviceId) ? 'on' : 'off';
}

const keyBytes = b64u => Uint8Array.from(atob(b64u.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64u.length / 4) * 4, '=')), c => c.charCodeAt(0));
const sameKey = (buf, b64u) => { if (!buf) return false; const a = new Uint8Array(buf), b = keyBytes(b64u); return a.length === b.length && a.every((v, i) => v === b[i]); };
const device = () => (isIOS() ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'Computadora');

async function subscribe() {
  const key = settings().vapidPublic;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) { await sub.unsubscribe(); sub = null; }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  return sub.toJSON();
}
function save(json) {
  const cur = byId('subs', cfg.deviceId);
  const appUrl = location.origin + location.pathname;
  if (cur && cur.endpoint === json.endpoint && cur.who === (cfg.who || '') && cur.appUrl === appUrl && cur.keys?.auth === json.keys?.auth) return;
  put('subs', { id: cfg.deviceId, who: cfg.who || '', device: device(), endpoint: json.endpoint, keys: json.keys, appUrl });
  commit();
}

/** Pide permiso y suscribe este teléfono. Llamar desde un toque. */
export async function enablePush() {
  const status = pushStatus();
  if (status === 'install') throw new Error('Primero instalá la app en la pantalla de inicio y abrila desde el ícono.');
  if (status === 'unsupported') throw new Error('Este navegador no soporta notificaciones push.');
  if (status === 'nokey') throw new Error('Falta la clave de notificaciones en los datos. Sincronizá primero.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Sin permiso no puedo avisarte. Activalo en Ajustes del iPhone → Notificaciones → Planthy.');
  save(await subscribe());
  cfg.pushOn = true; saveCfg();
}

export async function disablePush() {
  cfg.pushOn = false; saveCfg();
  try { const reg = await navigator.serviceWorker.ready; await (await reg.pushManager.getSubscription())?.unsubscribe(); } catch { /* ya no estaba */ }
  if (byId('subs', cfg.deviceId)) { remove('subs', cfg.deviceId); commit(); }
}

/** Al abrir la app: si la suscripción cambió o venció, la renueva sola. */
export async function refreshPush() {
  if (!cfg.pushOn || !pushSupported() || Notification.permission !== 'granted' || !settings().vapidPublic) return;
  if (!state.db.plants.length) return;
  try { save(await subscribe()); } catch { /* se reintenta la próxima vez */ }
}

/** Muestra una notificación local para probar permiso y aspecto (no pasa por el servidor). */
export async function testNotification() {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('Planthy', { body: 'Así te voy a avisar. Tocá para abrir Hoy.', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: location.origin + location.pathname + '#hoy' }, tag: 'planthy-prueba' });
}

export function clearBadge() { try { navigator.clearAppBadge?.(); } catch { /* no soportado */ } }
