'use strict';
/**
 * Driving-distance lookup from the base address to the customer's address.
 *
 * Providers (env DISTANCE_PROVIDER):
 *  - "google": Google Distance Matrix API (needs GOOGLE_MAPS_API_KEY). Recommended for launch.
 *  - "osrm":   free OpenStreetMap services (Nominatim geocoding + OSRM demo router).
 *              Fine for trying the site out; their public servers have strict usage
 *              policies and no uptime guarantee, so do not rely on them in production.
 *  - "stub":   fixed table for tests/demos (DISTANCE_STUB='{"plano":{"miles":14,"city":"Plano"}}').
 * Default: "google" when GOOGLE_MAPS_API_KEY is set, otherwise "osrm".
 */

const METERS_PER_MILE = 1609.344;

class DistanceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // "not_found" | "unavailable"
  }
}

function cityFromFormatted(formatted) {
  // "123 Main St, Carrollton, TX 75006, USA" -> "Carrollton"; "Carrollton, TX, USA" -> "Carrollton"
  const parts = String(formatted || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 3];
  return null;
}

async function getJson(fetchImpl, url, init) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw new DistanceError('unavailable', `Distance service unreachable: ${e.message}`);
  }
  if (!res.ok) throw new DistanceError('unavailable', `Distance service HTTP ${res.status}`);
  return res.json();
}

function googleProvider({ apiKey, fetchImpl }) {
  return async (origin, destination) => {
    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    url.searchParams.set('origins', origin);
    url.searchParams.set('destinations', destination);
    url.searchParams.set('units', 'imperial');
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('region', 'us');
    url.searchParams.set('key', apiKey);
    const data = await getJson(fetchImpl, url);
    if (data.status !== 'OK') throw new DistanceError('unavailable', `Google status ${data.status}`);
    const el = data.rows?.[0]?.elements?.[0];
    if (!el || el.status !== 'OK') throw new DistanceError('not_found', `Google element status ${el?.status}`);
    const formatted = data.destination_addresses?.[0] || '';
    return { miles: el.distance.value / METERS_PER_MILE, formattedAddress: formatted, city: cityFromFormatted(formatted) };
  };
}

function osrmProvider({ fetchImpl }) {
  // Generic app identifier only (Nominatim requires a User-Agent); no personal details.
  const headers = { 'User-Agent': 'LocalServiceQuoteSite/1.0', 'Accept-Language': 'en' };
  async function geocode(q) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'us');
    url.searchParams.set('q', q);
    const data = await getJson(fetchImpl, url, { headers });
    if (!Array.isArray(data) || !data[0]) throw new DistanceError('not_found', 'Address not found');
    const a = data[0].address || {};
    return { lat: data[0].lat, lon: data[0].lon, city: a.city || a.town || a.village || null, formatted: data[0].display_name };
  }
  return async (origin, destination) => {
    const [o, d] = await Promise.all([geocode(origin), geocode(destination)]);
    const url = `https://router.project-osrm.org/route/v1/driving/${o.lon},${o.lat};${d.lon},${d.lat}?overview=false`;
    const data = await getJson(fetchImpl, url, { headers });
    const meters = data.routes?.[0]?.distance;
    if (data.code !== 'Ok' || typeof meters !== 'number') throw new DistanceError('not_found', 'No driving route');
    return { miles: meters / METERS_PER_MILE, formattedAddress: d.formatted, city: d.city };
  };
}

function stubProvider(table) {
  return async (_origin, destination) => {
    const key = Object.keys(table).find((k) => destination.toLowerCase().includes(k.toLowerCase()));
    if (!key) throw new DistanceError('not_found', 'Address not in stub table');
    return { miles: table[key].miles, city: table[key].city || null, formattedAddress: destination };
  };
}

function createDistanceService(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const name = opts.provider || (opts.googleKey ? 'google' : 'osrm');
  let lookup;
  if (name === 'google') {
    if (!opts.googleKey) throw new Error('DISTANCE_PROVIDER=google requires GOOGLE_MAPS_API_KEY');
    // If Google rejects the key or is down, fall back to the free OpenStreetMap services
    // instead of failing the customer's estimate. Addresses Google can't find stay "not found".
    const google = googleProvider({ apiKey: opts.googleKey, fetchImpl });
    const backup = osrmProvider({ fetchImpl });
    const log = opts.log || console;
    let warned = false;
    lookup = async (origin, destination) => {
      try {
        return await google(origin, destination);
      } catch (e) {
        if (!(e instanceof DistanceError) || e.code !== 'unavailable') throw e;
        if (!warned) { log.error(`Google Maps failed (${e.message}); using free OpenStreetMap instead. Check the Google key: Distance Matrix API enabled, billing on, no website-only restriction.`); warned = true; }
        return backup(origin, destination);
      }
    };
  } else if (name === 'osrm') lookup = osrmProvider({ fetchImpl });
  else if (name === 'stub') lookup = stubProvider(opts.stubTable || {});
  else throw new Error(`Unknown DISTANCE_PROVIDER "${name}"`);

  const cache = new Map();
  return {
    provider: name,
    async measure(origin, destination) {
      const key = `${origin.toLowerCase().trim()}|${destination.toLowerCase().replace(/\s+/g, ' ').trim()}`;
      if (cache.has(key)) return cache.get(key);
      const result = await lookup(origin, destination);
      if (cache.size > 2000) cache.clear();
      cache.set(key, result);
      return result;
    },
  };
}

module.exports = { createDistanceService, DistanceError, cityFromFormatted };
