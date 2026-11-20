'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const { createStore } = require('./lib/store');
const cal = require('./lib/calendar');
const pricing = require('./lib/pricing');
const { createDistanceService, DistanceError } = require('./lib/distance');
const { createAi } = require('./lib/ai');
const { createSms } = require('./lib/sms');
const { defaultSettings } = require('./lib/defaults');

const DISCLAIMER = 'This is an estimate. Our crew confirms the final price before work starts.';
const VIEWS = path.join(__dirname, 'views');

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const todo = (label) => `<span class="todo">[TODO: ${esc(label)}]</span>`;
const phoneDisplay = (d) => (d && d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : null);

function hoursRows(schedule, holidayNote) {
  const h = schedule.hours;
  const fmt = (x) => (x ? `${cal.formatTime(x.open)} to ${cal.formatTime(x.close)}` : 'Closed');
  // Group consecutive weekdays with identical hours (Mon..Sun order).
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups = [];
  for (const d of order) {
    const label = fmt(h[d]);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.days.push(d); else groups.push({ label, days: [d] });
  }
  const rows = groups.map((g) => {
    const first = cal.DAY_NAMES[g.days[0]];
    const lastDay = cal.DAY_NAMES[g.days[g.days.length - 1]];
    const name = g.days.length === 1 ? first : g.days.length === 2 ? `${first} and ${lastDay}` : `${first} to ${lastDay}`;
    return `<li><strong>${esc(name)}:</strong> ${esc(g.label)}</li>`;
  });
  rows.push(`<li><strong>Holidays:</strong> ${holidayNote ? esc(holidayNote) : `${esc(fmt(schedule.holidayHours))} ${todo('HOLIDAY DATES')}`}</li>`);
  return rows.join('');
}

function pageTokens(settings) {
  const b = settings.business;
  const c = settings.content;
  const phone = phoneDisplay(b.phone);
  const text = phoneDisplay(b.textNumber);
  const cities = b.serviceAreaCities.map(esc);
  return {
    BUSINESS_NAME: esc(b.name),
    PHONE_DISPLAY: phone ? esc(phone) : todo('PHONE'),
    PHONE_TEL: b.phone ? `tel:+1${esc(b.phone)}` : '#',
    TEXT_DISPLAY: text ? esc(text) : todo('TEXT NUMBER'),
    TEXT_SMS: b.textNumber ? `sms:+1${esc(b.textNumber)}` : '#',
    EMAIL_HTML: b.email ? `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : todo('EMAIL'),
    BASE_ADDRESS: esc(b.baseAddress),
    FREE_CITIES: esc(b.freeCities.join(', ')),
    MAX_MILES: esc(settings.rates.distance.maxServiceMiles),
    CITY_LIST_HTML: cities.map((x) => `<li>${x}</li>`).join(''),
    CITY_SENTENCE: `${cities.join(', ')}, and nearby areas`,
    HOURS_HTML: hoursRows(settings.schedule, c.holidayNote),
    FAQ_DONT_TAKE: c.dontTake ? esc(c.dontTake) : todo('CONFIRM LIST'),
    FAQ_HOME: c.needToBeHome ? esc(c.needToBeHome) : todo('CONFIRM'),
    FAQ_PAY: c.paymentMethods ? esc(c.paymentMethods) : todo('CONFIRM PAYMENT METHODS'),
    YEAR: String(new Date().getFullYear()),
    DISCLAIMER: esc(DISCLAIMER),
  };
}

function render(name, settings) {
  const read = (f) => fs.readFileSync(path.join(VIEWS, f), 'utf8');
  const tokens = pageTokens(settings);
  let html = read(`${name}.html`).replace(/\{\{>\s*(\w+)\s*\}\}/g, (_, p) => read(`partials/${p}.html`));
  html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in tokens ? tokens[k] : m));
  return html;
}

/** Public-safe view of the rates for building the forms (labels + display prices only). */
function publicConfig(settings) {
  const r = settings.rates;
  const map = (obj) => Object.entries(obj).map(([key, v]) => ({ key, label: v.label, price: pricing.formatPrice(v.price) }));
  return {
    business: { name: settings.business.name, phone: settings.business.phone, textNumber: settings.business.textNumber },
    disclaimer: DISCLAIMER,
    maxServiceMiles: r.distance.maxServiceMiles,
    junk: {
      loads: map(r.junk.loads),
      items: map(r.junk.items),
      cleanouts: map(r.junk.cleanouts),
      extras: {
        longCarry: pricing.formatPrice(r.junk.extras.longCarry.price),
        stairs: pricing.formatPrice(r.junk.extras.stairs.price),
        heavyLifting: pricing.formatPrice(r.junk.extras.heavyLifting.price),
        disassembly: pricing.formatPrice(r.junk.extras.disassembly.price),
        sameDay: pricing.formatPrice(r.junk.extras.sameDay.price),
      },
      minimumCharge: r.junk.minimumCharge,
    },
    landscaping: Object.fromEntries(Object.entries(r.landscaping).map(([area, sizes]) => [area, map(sizes)])),
    trees: {
      maxTrees: r.trees.maxTrees,
      sizes: Object.entries(r.trees.sizes).map(([key, v]) => ({ key, label: v.label })),
      services: Object.entries(r.trees.services).map(([key, label]) => ({ key, label })),
      serviceFees: r.trees.serviceFees,
      treePrice: Object.fromEntries(Object.entries(r.trees.treePrice).map(([k, v]) => [k, typeof v === 'number' ? pricing.money(v) : 'To be confirmed'])),
    },
  };
}

function decorate(estimate) {
  const statusText = { tbd: 'To be confirmed', confirm: "We'll confirm", info: '' };
  return {
    ...estimate,
    totalDisplay: pricing.formatPrice(estimate.total),
    sections: estimate.sections.map((s) => ({
      ...s,
      subtotalDisplay: pricing.formatPrice(s.subtotal),
      lines: s.lines.map((l) => ({ ...l, display: l.status === 'ok' ? pricing.formatPrice(l.price) : statusText[l.status] })),
    })),
  };
}

function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ status: 'error', message: 'Too many requests. Please wait a few minutes, or call or text us.' });
    list.push(now);
    hits.set(key, list);
    if (hits.size > 10000) hits.clear();
    return next();
  };
}

function createApp(opts = {}) {
  const store = opts.store || createStore(opts.dataDir || path.join(__dirname, 'data'));
  const distance = opts.distance || createDistanceService({
    provider: process.env.DISTANCE_PROVIDER || undefined,
    googleKey: process.env.GOOGLE_MAPS_API_KEY,
    stubTable: process.env.DISTANCE_STUB ? JSON.parse(process.env.DISTANCE_STUB) : undefined,
  });
  const ai = opts.ai !== undefined ? opts.ai : createAi({ apiKey: process.env.ANTHROPIC_API_KEY });
  const sms = opts.sms !== undefined ? opts.sms : createSms({
    accountSid: process.env.TWILIO_ACCOUNT_SID, authToken: process.env.TWILIO_AUTH_TOKEN, from: process.env.TWILIO_FROM,
  });
  const adminPassword = opts.adminPassword !== undefined ? opts.adminPassword : process.env.ADMIN_PASSWORD;
  const now = opts.now || (() => new Date());
  const log = opts.log || console;

  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.json({ limit: '50kb' }));
  app.use('/assets', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

  const bookedKeys = () => new Set(
    store.listLeads().filter((l) => l.booking && l.booking.status === 'booked').map((l) => cal.slotKey(l.booking.date, l.booking.time)),
  );

  // ---------- Admin auth (HTTP Basic, user "admin") ----------
  const failedLogins = new Map(); // ip -> [timestamps]
  function requireAdmin(req, res, next) {
    if (!adminPassword) return res.status(503).send('Admin is disabled. Set the ADMIN_PASSWORD environment variable.');
    const t = Date.now();
    const fails = (failedLogins.get(req.ip) || []).filter((x) => t - x < 15 * 60 * 1000);
    if (fails.length >= 10) return res.status(429).send('Too many failed logins. Try again in 15 minutes.');
    const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
    const [user, ...rest] = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':') : [];
    const pass = rest.join(':');
    const a = crypto.createHash('sha256').update(String(pass)).digest();
    const b = crypto.createHash('sha256').update(String(adminPassword)).digest();
    if (user === 'admin' && crypto.timingSafeEqual(a, b)) return next();
    if (req.headers.authorization) { fails.push(t); failedLogins.set(req.ip, fails); }
    res.set('WWW-Authenticate', 'Basic realm="Admin", charset="UTF-8"');
    return res.status(401).send('Login required');
  }

  // ---------- Pages ----------
  const page = (name) => (req, res) => res.type('html').send(render(name, store.getSettings()));
  app.get('/', page('index'));
  app.get('/prices', page('prices'));
  app.get('/thank-you', page('thank-you'));
  app.get('/privacy', page('privacy'));
  app.get('/terms', page('terms'));
  app.get('/admin', requireAdmin, (req, res) => { res.set('Cache-Control', 'no-store'); page('admin')(req, res); });

  // ---------- Public API ----------
  app.get('/api/config', (req, res) => res.json(publicConfig(store.getSettings())));

  app.get('/api/availability', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ days: cal.availability(store.getSettings().schedule, bookedKeys(), now()) });
  });

  app.post('/api/estimate', rateLimiter({ windowMs: 15 * 60 * 1000, max: opts.estimateRateLimit || 40 }), async (req, res) => {
    const settings = store.getSettings();
    const service = String((req.body && req.body.service) || '');
    const { errors, data } = pricing.validate(service, req.body, settings);
    if (errors.length) return res.json({ status: 'needs_info', questions: errors });

    const schedule = settings.schedule;
    if (!cal.isSlotAvailable(schedule, bookedKeys(), data.date, data.time, now())) {
      return res.json({ status: 'needs_info', questions: [{ field: 'date', message: 'That date and time is no longer available. Please pick another one.' }] });
    }
    const isSameDay = data.date === cal.nowInZone(schedule.timezone, now()).date;

    let dist;
    try {
      dist = await distance.measure(settings.business.baseAddress, data.address);
    } catch (e) {
      if (e instanceof DistanceError && e.code === 'not_found') {
        return res.json({ status: 'needs_info', questions: [{ field: 'address', message: "We couldn't find that address. Check the street, city, and ZIP code." }] });
      }
      log.error('distance lookup failed:', e.message);
      const lead = store.addLead({ service, answers: data, contact: data.contact, status: 'needs_follow_up', problem: 'Distance lookup failed' });
      return res.json({
        status: 'distance_unavailable', leadId: lead.id,
        message: "We couldn't measure the driving distance right now. We saved your request and will text you, or you can call or text us.",
      });
    }
    const free = settings.business.freeCities.some((c) => (dist.city
      ? dist.city.toLowerCase() === c.toLowerCase()
      : new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(data.address)));
    const distanceInfo = { miles: Math.round(dist.miles * 10) / 10, city: dist.city, free, formattedAddress: dist.formattedAddress };

    const estimate = pricing.computeEstimate(data, settings, distanceInfo, { isSameDay });
    if (estimate.outOfArea) {
      store.addLead({ service, answers: data, contact: data.contact, distance: distanceInfo, status: 'out_of_area' });
      return res.json({
        status: 'out_of_area',
        message: `That address is more than ${settings.rates.distance.maxServiceMiles} driving miles from our base, so we can't give an online estimate. Contact us. We may still be able to help, depending on our schedule.`,
      });
    }

    let summary = null;
    let aiQuestions = [];
    if (ai) {
      try {
        const r = await ai.review({ data, estimate });
        if (r) { summary = r.summary; aiQuestions = r.questions; }
      } catch (e) {
        log.error('AI review failed (using template summary):', e.message);
      }
      if (aiQuestions.length && req.body.aiAcknowledged !== true) {
        return res.json({ status: 'needs_info', aiQuestions: true, questions: aiQuestions.map((message) => ({ field: 'ai', message })) });
      }
    }
    summary = summary || pricing.templateSummary(data, estimate, settings);

    const lead = store.addLead({
      service, answers: data, contact: data.contact, distance: distanceInfo, sameDay: isSameDay,
      estimate, summary, aiQuestions, booking: { date: data.date, time: data.time, status: 'requested' },
    });
    return res.json({ status: 'ok', leadId: lead.id, estimate: decorate(estimate), summary, disclaimer: DISCLAIMER, date: data.date, time: data.time, dateLabel: `${cal.formatDate(data.date)}, ${cal.formatTime(data.time)}` });
  });

  app.post('/api/leads/:id/text', async (req, res) => {
    const lead = store.getLead(req.params.id);
    if (!lead || !lead.estimate) return res.status(404).json({ status: 'error', message: 'Quote not found.' });
    const settings = store.getSettings();
    const body = `${settings.business.name} estimate: ${pricing.formatPrice(lead.estimate.total)}. ${lead.summary} ${DISCLAIMER} Reply here or call ${phoneDisplay(settings.business.phone) || ''}.`;
    let sent = false;
    if (sms) {
      try { sent = await sms.send(lead.contact.phone, body.slice(0, 1500)); } catch (e) { log.error('SMS failed:', e.message); }
    }
    store.updateLead(lead.id, { textRequested: true, textSent: sent });
    return res.json({ status: 'ok', sent });
  });

  app.post('/api/leads/:id/book', (req, res) => {
    const lead = store.getLead(req.params.id);
    if (!lead || !lead.booking) return res.status(404).json({ status: 'error', message: 'Quote not found.' });
    if (lead.booking.status === 'booked') return res.json({ status: 'ok' });
    const { date, time } = lead.booking;
    if (!cal.isSlotAvailable(store.getSettings().schedule, bookedKeys(), date, time, now())) {
      return res.status(409).json({ status: 'error', message: 'Sorry, that time was just taken. Please pick another time and generate a new estimate, or call or text us.' });
    }
    store.updateLead(lead.id, { booking: { ...lead.booking, status: 'booked', bookedAt: now().toISOString() }, status: 'booked' });
    return res.json({ status: 'ok' });
  });

  // ---------- Admin API ----------
  app.use('/api/admin', requireAdmin, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  app.get('/api/admin/settings', (req, res) => res.json(store.getSettings()));

  app.put('/api/admin/settings', (req, res) => {
    const problems = validateSettings(req.body);
    if (problems.length) return res.status(400).json({ status: 'error', problems });
    store.saveSettings(req.body);
    return res.json({ status: 'ok', settings: store.getSettings() });
  });

  app.get('/api/admin/defaults', (req, res) => res.json(defaultSettings()));

  app.get('/api/admin/calendar', (req, res) => {
    const s = store.getSettings().schedule;
    const booked = bookedKeys();
    const days = Math.max(1, Math.min(120, Number(req.query.days) || s.bookingWindowDays));
    const start = cal.nowInZone(s.timezone, now()).date;
    const out = Array.from({ length: days }, (_, i) => cal.addDays(start, i)).map((date) => ({
      date, label: cal.formatDate(date), holiday: s.holidays.includes(date), blocked: s.blockedDates.includes(date),
      special: (s.specialHours || []).find((x) => x.date === date) || null,
      slots: cal.daySlotStatus(s, date, booked, now()),
    }));
    res.json({ days: out });
  });

  app.post('/api/admin/calendar', (req, res) => {
    const { action, date, time } = req.body || {};
    if (!cal.isDate(date) || (time !== undefined && !cal.isTime(time))) return res.status(400).json({ status: 'error', message: 'Bad date or time.' });
    const settings = structuredClone(store.getSettings());
    const s = settings.schedule;
    const without = (list) => list.filter((x) => !(x.date === date && x.time === time));
    switch (action) {
      case 'blockDate': if (!s.blockedDates.includes(date)) s.blockedDates.push(date); break;
      case 'unblockDate': s.blockedDates = s.blockedDates.filter((d) => d !== date); break;
      case 'blockSlot':
        if (!time) return res.status(400).json({ status: 'error', message: 'Time required.' });
        s.openedSlots = without(s.openedSlots);
        if (cal.regularSlots(s, date).includes(time) && !s.blockedSlots.some((x) => x.date === date && x.time === time)) s.blockedSlots.push({ date, time });
        break;
      case 'openSlot':
        if (!time) return res.status(400).json({ status: 'error', message: 'Time required.' });
        s.blockedSlots = without(s.blockedSlots);
        if (!cal.regularSlots(s, date).includes(time) || s.blockedDates.includes(date)) {
          if (!s.openedSlots.some((x) => x.date === date && x.time === time)) s.openedSlots.push({ date, time });
        }
        break;
      case 'setSpecialHours': {
        const { open, close } = req.body;
        if (!cal.isTime(open) || !cal.isTime(close) || open >= close) return res.status(400).json({ status: 'error', message: 'Special hours need open before close.' });
        s.specialHours = (s.specialHours || []).filter((x) => x.date !== date).concat({ date, open, close }).sort((x, y) => x.date.localeCompare(y.date));
        break;
      }
      case 'clearSpecialHours': s.specialHours = (s.specialHours || []).filter((x) => x.date !== date); break;
      case 'addHoliday': if (!s.holidays.includes(date)) s.holidays.push(date); s.holidays.sort(); break;
      case 'removeHoliday': s.holidays = s.holidays.filter((d) => d !== date); break;
      default: return res.status(400).json({ status: 'error', message: 'Unknown action.' });
    }
    store.saveSettings(settings);
    return res.json({ status: 'ok' });
  });

  app.get('/api/admin/leads', (req, res) => res.json({ leads: [...store.listLeads()].reverse() }));

  app.patch('/api/admin/leads/:id', (req, res) => {
    const allowed = ['new', 'contacted', 'booked', 'done', 'lost', 'out_of_area', 'needs_follow_up'];
    const patch = {};
    if (req.body.status !== undefined) {
      if (!allowed.includes(req.body.status)) return res.status(400).json({ status: 'error', message: 'Bad status.' });
      patch.status = req.body.status;
    }
    if (typeof req.body.crewNotes === 'string') patch.crewNotes = req.body.crewNotes.slice(0, 2000);
    if (req.body.cancelBooking === true) {
      const lead = store.getLead(req.params.id);
      if (lead && lead.booking) patch.booking = { ...lead.booking, status: 'cancelled' };
    }
    const lead = store.updateLead(req.params.id, patch);
    if (!lead) return res.status(404).json({ status: 'error', message: 'Not found.' });
    return res.json({ status: 'ok', lead });
  });

  app.use((err, req, res, _next) => {
    log.error(err);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ status: 'error', message: 'Bad request.' });
    return res.status(500).json({ status: 'error', message: 'Something went wrong. Please call or text us.' });
  });

  return app;
}

/** Structural checks on admin-submitted settings so a typo can't break the site. */
function validateSettings(s) {
  const problems = [];
  const need = (cond, msg) => { if (!cond) problems.push(msg); };
  const priceOk = (p) => p && (p.min === null || (typeof p.min === 'number' && p.min >= 0))
    && (p.max === null || (typeof p.max === 'number' && p.max >= (p.min ?? 0)));
  try {
    need(s && s.business && typeof s.business.name === 'string' && s.business.name.trim(), 'Business name is required.');
    need(/^\d{10}$/.test(s.business.phone || ''), 'Phone must be 10 digits.');
    need(/^\d{10}$/.test(s.business.textNumber || ''), 'Text number must be 10 digits.');
    need(typeof s.business.baseAddress === 'string' && s.business.baseAddress.trim().length > 2, 'Base address is required.');
    need(Array.isArray(s.business.freeCities) && Array.isArray(s.business.serviceAreaCities), 'City lists must be lists.');
    const sch = s.schedule;
    for (let d = 0; d < 7; d += 1) {
      const h = sch.hours[d];
      need(h === null || (cal.isTime(h.open) && cal.isTime(h.close) && h.open < h.close), `Hours for ${cal.DAY_NAMES[d]} must have open before close (or be closed).`);
    }
    need(cal.isTime(sch.holidayHours.open) && cal.isTime(sch.holidayHours.close) && sch.holidayHours.open < sch.holidayHours.close, 'Holiday hours must have open before close.');
    need(Number.isInteger(sch.slotMinutes) && sch.slotMinutes >= 15 && sch.slotMinutes <= 480, 'Slot length must be 15 to 480 minutes.');
    need(Number.isInteger(sch.bookingWindowDays) && sch.bookingWindowDays >= 1 && sch.bookingWindowDays <= 120, 'Booking window must be 1 to 120 days.');
    need(Number.isInteger(sch.minLeadMinutes) && sch.minLeadMinutes >= 0, 'Same-day notice must be 0 or more minutes.');
    for (const list of ['holidays', 'blockedDates']) need(Array.isArray(sch[list]) && sch[list].every(cal.isDate), `${list} must be dates.`);
    need(Array.isArray(sch.specialHours) && sch.specialHours.every((x) => cal.isDate(x.date) && cal.isTime(x.open) && cal.isTime(x.close) && x.open < x.close), 'Special hours must be dates with open before close.');
    for (const list of ['blockedSlots', 'openedSlots']) need(Array.isArray(sch[list]) && sch[list].every((x) => cal.isDate(x.date) && cal.isTime(x.time)), `${list} must be dates and times.`);
    const r = s.rates;
    need(r.distance.bands.every((b) => typeof b.maxMiles === 'number' && (b.fee === null || (typeof b.fee === 'number' && b.fee >= 0))), 'Distance bands need max miles and a fee (or blank).');
    need(typeof r.distance.maxServiceMiles === 'number', 'Max service miles is required.');
    const groups = [r.junk.loads, r.junk.items, r.junk.cleanouts, r.junk.extras, r.landscaping.front, r.landscaping.back, r.landscaping.both];
    for (const g of groups) for (const [k, v] of Object.entries(g)) need(priceOk(v.price), `Price for "${v.label || k}" is invalid (low must be a number and high must be at least low).`);
    for (const size of Object.keys(r.trees.sizes)) {
      need(r.trees.treePrice[size] === null || typeof r.trees.treePrice[size] === 'number', `Tree price for ${size} must be a number or blank.`);
      for (const svc of Object.keys(r.trees.services)) need(typeof r.trees.serviceFees[size][svc] === 'number', `Tree service fee ${size}/${svc} must be a number.`);
    }
  } catch (e) {
    problems.push(`Settings are missing a section (${e.message}).`);
  }
  return problems;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const app = createApp({ dataDir: process.env.DATA_DIR || undefined });
  app.listen(port, () => console.log(`SAE Outdoor and Haul site running on http://localhost:${port}`));
}

module.exports = { createApp, validateSettings, pageTokens, DISCLAIMER };
