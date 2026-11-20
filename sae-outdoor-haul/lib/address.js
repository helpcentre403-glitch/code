'use strict';
/**
 * Address suggestions as the customer types (server-side, so no key is exposed in the page).
 *
 *  - Google Places Autocomplete (New) when GOOGLE_MAPS_API_KEY is set (enable "Places API (New)").
 *  - Otherwise Photon (photon.komoot.io), a free OpenStreetMap search that allows reasonable use.
 *    Nominatim is not used here: its policy forbids search-as-you-type.
 * Results are biased to the area around Carrollton, TX, limited to the US, and cached.
 */

const CENTER = { lat: 32.9537, lon: -96.8903 }; // Carrollton, TX (approximate city center)
const BBOX = [-97.4, 32.6, -96.38, 33.31]; // about 30 miles around Carrollton (minLon, minLat, maxLon, maxLat)
const STATES = { Texas: 'TX', Oklahoma: 'OK' };

function photonLabel(p) {
  const street = [p.housenumber, p.street || p.name].filter(Boolean).join(' ');
  const state = STATES[p.state] || p.state;
  const tail = [state, p.postcode].filter(Boolean).join(' ');
  return [street, p.city || p.locality || p.district, tail].filter(Boolean).join(', ');
}

function createAddressSuggester({ googleKey, fetchImpl = globalThis.fetch, log = console } = {}) {
  const cache = new Map();
  const provider = googleKey ? 'google' : 'photon';

  async function fromGoogle(q) {
    const res = await fetchImpl('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': googleKey },
      body: JSON.stringify({
        input: q,
        includedRegionCodes: ['us'],
        locationBias: { circle: { center: { latitude: CENTER.lat, longitude: CENTER.lon }, radius: 50000 } },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Google Places HTTP ${res.status}`);
    const data = await res.json();
    return (data.suggestions || []).filter((s) => s.placePrediction).slice(0, 5).map((s) => {
      const pp = s.placePrediction;
      const label = String(pp.text && pp.text.text || '').replace(/, USA$/, '');
      const secondary = pp.structuredFormat && pp.structuredFormat.secondaryText ? pp.structuredFormat.secondaryText.text : '';
      return { label, city: (secondary.split(',')[0] || '').trim() || null };
    }).filter((s) => s.label);
  }

  async function fromPhoton(q) {
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '6');
    url.searchParams.set('lat', String(CENTER.lat));
    url.searchParams.set('lon', String(CENTER.lon));
    url.searchParams.set('bbox', BBOX.join(','));
    url.searchParams.set('countrycode', 'US');
    url.searchParams.append('layer', 'house');
    url.searchParams.append('layer', 'street');
    url.searchParams.set('lang', 'en');
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'LocalServiceQuoteSite/1.0' }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
    const data = await res.json();
    const seen = new Set();
    return (data.features || []).map((f) => f.properties || {}).filter((p) => p.street || p.name)
      .map((p) => ({ label: photonLabel(p), city: p.city || p.locality || null }))
      .filter((s) => (seen.has(s.label) ? false : seen.add(s.label)))
      .slice(0, 5);
  }

  return {
    provider,
    async suggest(raw) {
      const q = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (q.length < 4) return [];
      const key = q.toLowerCase();
      if (cache.has(key)) return cache.get(key);
      let out = [];
      try {
        out = provider === 'google' ? await fromGoogle(q) : await fromPhoton(q);
      } catch (e) {
        log.error('Address suggestions failed:', e.message);
        return []; // typing still works; suggestions just don't show
      }
      if (cache.size > 3000) cache.clear();
      cache.set(key, out);
      return out;
    },
  };
}

module.exports = { createAddressSuggester, photonLabel, CENTER, BBOX };
