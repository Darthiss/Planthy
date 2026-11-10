// Clima con Open-Meteo (sin clave). Sin DOM: lo usan la app y el script de recordatorios.

/** Máximas diarias, registradas y pronosticadas: { daily: { 'AAAA-MM-DD': °C }, at } */
export async function fetchDailyMax({ lat, lon }, { past = 7, days = 8 } = {}) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&timezone=auto&past_days=${past}&forecast_days=${days}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status}`);
  const j = await res.json();
  const daily = {};
  (j.daily?.time || []).forEach((d, i) => { const v = j.daily.temperature_2m_max[i]; if (typeof v === 'number') daily[d] = v; });
  return { daily, at: Date.now() };
}

/** Busca una ciudad: [{ name, lat, lon }] */
export async function searchPlace(q) {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=es&format=json`);
  if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status}`);
  const j = await res.json();
  return (j.results || []).map(r => ({ name: [r.name, r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude }));
}
