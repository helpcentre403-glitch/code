'use strict';
/**
 * Privacy-light site analytics for the admin page.
 *
 * - Counts page views on the public pages and "active now" visitors (a small heartbeat from the page).
 * - Never stores IP addresses or full user agents. A visitor is a daily hash of IP + user agent + a
 *   secret that stays on the server, so repeat visits on the same day count once and the hash
 *   cannot be reversed or followed from one day to the next.
 * - Traffic source comes from the utm_source link tag first, then the referrer website.
 * - Data lives in analytics.json next to the leads file. Daily totals are kept for 120 days.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TRACKED_PAGES = new Set(['/', '/prices', '/privacy', '/terms']);
const KEEP_DAYS = 120;
const RECENT_MAX = 300;
const ACTIVE_WINDOW_MS = 3 * 60 * 1000;
const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|headless|curl|wget|python-requests|axios/i;

function dayKey(date, tz = 'America/Chicago') {
  // YYYY-MM-DD in the business time zone.
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Groups a referrer host (or utm_source value) into a readable source name. */
function classifySource({ utm, referrer, ownHost }) {
  const u = String(utm || '').trim().toLowerCase().slice(0, 40);
  if (u) {
    if (/^(fb|facebook|meta|ig|instagram)/.test(u)) return /^(ig|instagram)/.test(u) ? 'Instagram' : 'Facebook';
    if (/google/.test(u)) return 'Google';
    return u;
  }
  if (!referrer) return 'Direct';
  let host;
  try { host = new URL(referrer).hostname.toLowerCase(); } catch (e) { return 'Other'; }
  if (!host || host === ownHost || host.endsWith('.' + ownHost)) return null; // internal navigation, not a new source
  if (/(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.me$/.test(host)) return 'Facebook';
  if (/(^|\.)instagram\.com$/.test(host)) return 'Instagram';
  if (/(^|\.)google\./.test(host)) return 'Google';
  if (/(^|\.)bing\.com$|(^|\.)duckduckgo\.com$|(^|\.)yahoo\.com$/.test(host)) return 'Other search';
  return host.replace(/^www\./, '');
}

function createAnalytics({ dataDir, now = () => new Date(), tz = 'America/Chicago' }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'analytics.json');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    data = null;
  }
  if (!data || typeof data !== 'object') data = {};
  if (!data.secret) data.secret = crypto.randomBytes(32).toString('hex');
  data.days = data.days || {};
  data.recent = data.recent || [];
  const active = new Map(); // visitor hash -> last seen ms (in memory only)

  function save() {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    } catch (e) {
      /* analytics must never break the site */
    }
  }

  function prune(t) {
    const keys = Object.keys(data.days).sort();
    while (keys.length > KEEP_DAYS) delete data.days[keys.shift()];
    data.recent = data.recent.filter((r) => t - r.t < 24 * 60 * 60 * 1000).slice(-RECENT_MAX);
    for (const [k, last] of active) if (t - last > ACTIVE_WINDOW_MS) active.delete(k);
  }

  function visitorHash(ip, ua, day) {
    return crypto.createHash('sha256').update(`${data.secret}|${day}|${ip}|${ua}`).digest('hex').slice(0, 16);
  }

  /** Called on every public page view. */
  function recordView({ path: pagePath, query = {}, referrer = '', ip = '', userAgent = '', ownHost = '' }) {
    const t = now();
    const ua = String(userAgent || '');
    if (!TRACKED_PAGES.has(pagePath) || BOT_RE.test(ua) || !ua) return;
    const source = classifySource({ utm: query.utm_source, referrer, ownHost });
    if (source === null) return; // moved between our own pages
    const day = dayKey(t, tz);
    const hash = visitorHash(ip, ua, day);
    const d = data.days[day] || (data.days[day] = { views: 0, visitors: [], sources: {}, pages: {} });
    d.views += 1;
    if (!d.visitors.includes(hash) && d.visitors.length < 20000) d.visitors.push(hash);
    d.sources[source] = (d.sources[source] || 0) + 1;
    d.pages[pagePath] = (d.pages[pagePath] || 0) + 1;
    data.recent.push({ t: t.getTime(), p: pagePath, s: source, h: hash });
    active.set(hash, t.getTime());
    prune(t.getTime());
    save();
  }

  /** Called by the page every ~30 seconds while someone is looking at it. */
  function heartbeat({ path: pagePath, ip = '', userAgent = '' }) {
    const t = now();
    const ua = String(userAgent || '');
    if (!TRACKED_PAGES.has(pagePath) || BOT_RE.test(ua) || !ua) return;
    active.set(visitorHash(ip, ua, dayKey(t, tz)), t.getTime());
  }

  /** Numbers for the admin panel. Nothing here identifies a person. */
  function summary({ days = 30 } = {}) {
    const t = now();
    const today = dayKey(t, tz);
    const keys = [];
    for (let i = days - 1; i >= 0; i -= 1) keys.push(dayKey(new Date(t.getTime() - i * 86400000), tz));
    const sumRange = (ks) => {
      const out = { views: 0, visitors: new Set(), sources: {}, pages: {} };
      for (const k of ks) {
        const d = data.days[k];
        if (!d) continue;
        out.views += d.views;
        d.visitors.forEach((v) => out.visitors.add(v));
        for (const [s, n] of Object.entries(d.sources)) out.sources[s] = (out.sources[s] || 0) + n;
        for (const [p, n] of Object.entries(d.pages)) out.pages[p] = (out.pages[p] || 0) + n;
      }
      return { views: out.views, visitors: out.visitors.size, sources: out.sources, pages: out.pages };
    };
    const last7 = keys.slice(-7);
    const range = sumRange(keys);
    const byTotal = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
    const cutoff = t.getTime() - ACTIVE_WINDOW_MS;
    const liveVisitors = new Set([...active].filter(([, last]) => last >= cutoff).map(([h]) => h));
    const recentVisits = data.recent.slice(-25).reverse().map((r) => ({ at: new Date(r.t).toISOString(), page: r.p, source: r.s }));
    return {
      generatedAt: t.toISOString(),
      timezone: tz,
      activeNow: liveVisitors.size,
      today: (() => { const d = data.days[today] || { views: 0, visitors: [] }; return { views: d.views, visitors: d.visitors.length }; })(),
      last7: (() => { const r = sumRange(last7); return { views: r.views, visitors: r.visitors }; })(),
      rangeDays: days,
      range: { views: range.views, visitors: range.visitors },
      daily: keys.map((k) => ({ date: k, views: (data.days[k] || { views: 0 }).views, visitors: ((data.days[k] || { visitors: [] }).visitors || []).length })),
      sources: byTotal(range.sources),
      pages: byTotal(range.pages),
      recentVisits,
    };
  }

  return { recordView, heartbeat, summary, classifySource, dayKey };
}

module.exports = { createAnalytics, classifySource, TRACKED_PAGES };
