// Clima en la app: pide las máximas a Open-Meteo y las guarda unas horas para que funcione sin conexión.

import { state, settings, emit, cacheGet, cacheSet } from './store.js';
import { fetchDailyMax } from './meteo.js';

const key = loc => `${loc.lat},${loc.lon}`;
const FRESH = 3 * 3600e3;

export async function refreshWeather(force = false) {
  const loc = settings().location;
  if (!loc || typeof loc.lat !== 'number') return;
  const cached = cacheGet('weather');
  if (cached && cached.key === key(loc)) {
    if (!state.weather || state.weather.at !== cached.at) { state.weather = cached; emit(); }
    if (!force && Date.now() - cached.at < FRESH) return;
  } else if (state.weather) { state.weather = null; emit(); }
  try {
    const fresh = { ...(await fetchDailyMax(loc)), key: key(loc) };
    // Conserva las máximas ya registradas de días anteriores que el pronóstico nuevo no trae.
    if (cached && cached.key === fresh.key) fresh.daily = { ...cached.daily, ...fresh.daily };
    for (const d of Object.keys(fresh.daily).sort().slice(0, -40)) delete fresh.daily[d];
    cacheSet('weather', fresh);
    state.weather = fresh;
    emit();
  } catch { /* sin conexión: queda lo guardado */ }
}
