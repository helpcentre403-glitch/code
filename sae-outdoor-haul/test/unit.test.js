'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../lib/pricing');
const { promotionActive } = pricing;
const cal = require('../lib/calendar');
const { amountsIn, createAi } = require('../lib/ai');
const { cityFromFormatted } = require('../lib/distance');
const { defaultSettings } = require('../lib/defaults');
const { validateSettings } = require('../server');
const { pricedSettings, FIXED_NOW } = require('./helpers');

const computeEstimate = (d, st, di, opts = {}) => pricing.computeEstimate(d, st, di, { now: FIXED_NOW, ...opts });
const range = (p) => [p.min, p.max];
const dist = (miles, city = 'Plano', free = false) => ({ miles, city, free });

test('distance (owner rates): flat $10 outside Carrollton up to 20 mi, nothing past 20, Carrollton free', () => {
  const r = pricedSettings().rates;
  const fee = (miles) => pricing.distanceLine(r, dist(miles)).line.price.min;
  assert.equal(fee(0), 10);
  assert.equal(fee(9.6), 10);
  assert.equal(fee(15), 10);
  assert.equal(fee(20.4), 10); // rounds to 20
  assert.equal(pricing.distanceLine(r, dist(20.6)).outOfArea, true);
  assert.equal(pricing.distanceLine(r, dist(25)).outOfArea, true);
  const free = pricing.distanceLine(r, dist(3, 'Carrollton', true)).line;
  assert.deepEqual(range(free.price), [0, 0]);
  assert.match(free.label, /Carrollton address: no distance fee/);
});

test('distance fee not set yet (TODO) shows "to be confirmed", never a made-up number', () => {
  const r = defaultSettings().rates;
  r.distance.bands[0].fee = null;
  const l = pricing.distanceLine(r, dist(12)).line;
  assert.equal(l.status, 'tbd');
  assert.equal(l.price, null);
});

function junk(overrides = {}) {
  return { service: 'junk', whatToGo: 'old couch and boxes', load: 'full', items: [], cleanout: null, locations: ['ground'], special: '', heavyLifting: false, disassembly: false, ...overrides };
}

test('junk: load + extras + distance + same-day', () => {
  const s = pricedSettings();
  const e = computeEstimate(junk({ locations: ['elevated', 'longCarry'], disassembly: true }), s, dist(14.8), { isSameDay: true });
  // base 450-550, elevated 25-75, long carry 30, disassembly 25-100, distance 10, same-day 20
  assert.deepEqual(range(e.total), [450 + 25 + 30 + 25 + 10 + 20, 550 + 75 + 30 + 100 + 10 + 20]);
  assert.deepEqual(e.sections.map((x) => x.title), ['Base price', 'Extras', 'Distance fee', 'Same-day fee']);
  assert.equal(e.hasUnpriced, false);
});

test('junk: items and cleanout priced; $100 minimum applies to the whole job', () => {
  const s = pricedSettings();
  const e1 = computeEstimate(junk({ load: null, items: [{ key: 'couch', qty: 2 }, { key: 'mattress', qty: 1 }], cleanout: 'shed' }), s, dist(3, 'Carrollton', true));
  assert.deepEqual(range(e1.sections[0].subtotal), [200 + 75 + 175, 300 + 110 + 350]);
  const e2 = computeEstimate(junk({ load: null, items: [{ key: 'recliner', qty: 1 }] }), s, dist(3, 'Carrollton', true));
  assert.deepEqual(range(e2.total), [100, 100]);
  assert.ok(e2.sections[0].lines.some((l) => /\$100 minimum per junk job/.test(l.label)));
  // recliner 65-90 + $10 distance = 75-100 -> raised to 100-100
  const e3 = computeEstimate(junk({ load: null, items: [{ key: 'recliner', qty: 1 }] }), s, dist(15));
  assert.deepEqual(range(e3.total), [100, 100]);
  // no adjustment when the job is already over $100
  const e4 = computeEstimate(junk({ load: 'quarter' }), s, dist(15));
  assert.deepEqual(range(e4.total), [160, 160]);
  assert.ok(!e4.sections[0].lines.some((l) => l.status === 'info'));
});

test('junk: trailer load is used only when no items or cleanout are chosen', () => {
  const e = computeEstimate(junk({ load: 'quarter', items: [{ key: 'couch', qty: 1 }] }), pricedSettings(), dist(3, 'Carrollton', true));
  assert.deepEqual(range(e.total), [100, 150]); // couch, not the 1/4 load
  assert.ok(e.notes.some((n) => /instead of the trailer load/.test(n)));
  const e2 = computeEstimate(junk({ load: 'quarter', cleanout: 'smallGarage' }), pricedSettings(), dist(3, 'Carrollton', true));
  assert.deepEqual(range(e2.total), [200, 200]);
});

test('junk: open-ended prices keep "+", special materials flagged for confirmation', () => {
  const e = computeEstimate(junk({ load: 'overFull', whatToGo: 'old tires and broken concrete' }), pricedSettings(), dist(3, 'Carrollton', true));
  assert.equal(pricing.formatPrice(e.total), '$550 to $700');
  const labels = e.sections[1].lines.map((l) => `${l.status}:${l.label}`);
  assert.ok(labels.some((l) => l.startsWith('confirm:Tires')));
  assert.ok(labels.some((l) => l.startsWith('confirm:Concrete')));
  assert.equal(e.hasUnpriced, true);
});

test('junk: same-day fee only when same day', () => {
  const e = computeEstimate(junk(), pricedSettings(), dist(3, 'Carrollton', true), { isSameDay: false });
  assert.ok(!e.sections.some((x) => x.title === 'Same-day fee'));
});

test('landscaping: visit price + distance', () => {
  const e = computeEstimate({ service: 'landscaping', area: 'both', size: 'large' }, pricedSettings(), dist(20.4));
  assert.deepEqual(range(e.total), [75 + 10, 75 + 10]);
  const e2 = computeEstimate({ service: 'landscaping', area: 'front', size: 'medium' }, pricedSettings(), dist(3, 'Carrollton', true));
  assert.deepEqual(range(e2.total), [35, 35]);
});

test('trees: (tree price + service fee) per tree + distance', () => {
  const data = { service: 'trees', trees: [{ size: 'medium', service: 'both' }, { size: 'large', service: 'delivery' }] };
  const e = computeEstimate(data, pricedSettings(), dist(6.1));
  assert.deepEqual(range(e.total), [(80 + 75) + (100 + 75) + 10, (80 + 75) + (100 + 75) + 10]);
  // Owner default: each tree is estimated at "$60+" and included in the total with a "+"
  const e2 = computeEstimate(data, defaultSettings(), dist(3, 'Carrollton', true));
  assert.equal(pricing.formatPrice(e2.total), `$${60 + 75 + 60 + 75}+`);
  assert.ok(e2.sections[0].lines[0].label.includes("we'll tell you the exact cost"));
  // A tree price the owner clears in admin shows "to be confirmed" and is left out
  const cleared = defaultSettings();
  cleared.rates.trees.treePrice.medium = { min: null, max: null, plus: false };
  const e3 = computeEstimate(data, cleared, dist(3, 'Carrollton', true));
  assert.equal(e3.sections[0].lines.filter((l) => l.status === 'tbd').length, 1);
});

test('validation asks instead of guessing', () => {
  const s = defaultSettings();
  const v = (service, answers, c = { name: 'Al', phone: '2145550100', email: 'al@example.com' }) => pricing.validate(service, { answers, contact: c }, s).errors.map((e) => e.field);
  const base = { date: '2026-12-07', time: '17:00', address: '1 Main St, Plano TX', cityZone: 'outside' };
  assert.ok(v('junk', { ...base, whatToGo: '', load: 'full', locations: ['ground'] }).includes('whatToGo'));
  assert.ok(v('junk', { ...base, whatToGo: 'stuff', load: 'full', locations: ['ground'] }).includes('whatToGo'));
  assert.ok(v('junk', { ...base, whatToGo: 'couch', locations: ['ground'] }).includes('load'));
  assert.ok(v('junk', { ...base, whatToGo: 'couch', load: 'full' }).includes('locations'));
  assert.deepEqual(v('junk', { ...base, whatToGo: 'couch', load: 'full', locations: ['ground'] }), []);
  assert.ok(v('trees', { ...base, count: 0, trees: [] }).includes('count'));
  assert.ok(v('trees', { ...base, count: 4, trees: [] }).includes('count'));
  assert.ok(v('trees', { ...base, count: 1, trees: [{ size: 'small' }] }).includes('trees.0.service'));
  assert.ok(v('landscaping', { ...base, area: 'side', size: 'small' }).includes('area'));
  assert.ok(v('landscaping', { area: 'front', size: 'small' }).includes('address'));
  assert.ok(v('landscaping', { ...base, cityZone: '', area: 'front', size: 'small' }).includes('cityZone'));
  assert.ok(v('landscaping', { ...base, area: 'front', size: 'small' }, { name: 'Al', phone: '555' }).includes('contact.phone'));
  assert.ok(v('landscaping', { ...base, area: 'front', size: 'small' }, { name: '', phone: '2145550100' }).includes('contact.name'), 'name required');
  assert.ok(v('landscaping', { ...base, area: 'front', size: 'small' }, { name: '1', phone: '2145550100' }).includes('contact.name'), 'name needs letters');
  assert.ok(!v('landscaping', { ...base, area: 'front', size: 'small' }, { name: 'Jo', phone: '2145550100' }).includes('contact.name'));
  assert.equal(pricing.normalizePhone('+1 (469) 756-1984'), '4697561984');
});

test('calendar: weekday evenings, weekends, holidays, blocks, opens, bookings, lead time', () => {
  const sch = defaultSettings().schedule;
  const none = new Set();
  const times = (date, s = sch, booked = none, now = FIXED_NOW) => cal.daySlotStatus(s, date, booked, now).filter((x) => x.status === 'open').map((x) => x.time);
  assert.deepEqual(times('2026-12-08'), ['17:00', '18:00', '19:00', '20:00']); // Tuesday
  assert.equal(times('2026-12-12').length, 11); // Saturday 10:00..20:00
  assert.equal(times('2026-12-12')[0], '10:00');
  assert.equal(times('2026-12-13').at(-1), '20:00'); // Sunday

  const s2 = structuredClone(sch);
  s2.holidays = ['2026-12-08'];
  s2.blockedDates = ['2026-12-09'];
  s2.blockedSlots = [{ date: '2026-12-10', time: '18:00' }];
  s2.openedSlots = [{ date: '2026-12-09', time: '19:00' }, { date: '2026-12-10', time: '12:00' }];
  assert.equal(times('2026-12-08', s2).length, 11); // holiday uses weekend hours
  assert.deepEqual(times('2026-12-09', s2), ['19:00']); // blocked day, one slot re-opened
  assert.deepEqual(times('2026-12-10', s2), ['12:00', '17:00', '19:00', '20:00']);
  assert.deepEqual(times('2026-12-08', sch, new Set(['2026-12-08 18:00'])), ['17:00', '19:00', '20:00']);

  // Same day: at 4:30 PM with 120-minute notice, only 7 PM and 8 PM remain
  const late = new Date('2026-12-07T22:30:00Z');
  assert.deepEqual(times('2026-12-07', sch, none, late), ['19:00', '20:00']);

  const days = cal.availability(sch, none, FIXED_NOW);
  assert.equal(days[0].date, '2026-12-07');
  assert.equal(days[0].isToday, true);
  assert.equal(days.length, 20); // 21-day window minus Christmas Day

  // Owner's holiday rules
  assert.equal(times('2027-11-25').length, 11); // Thanksgiving 2027 (Thu) = weekend hours
  assert.equal(times('2026-12-22').length, 11); // Dec 20 - Jan 6 (Tue) = weekend hours
  assert.equal(times('2027-01-06').length, 11);
  assert.deepEqual(times('2027-01-07'), ['17:00', '18:00', '19:00', '20:00']); // back to normal
  assert.deepEqual(times('2026-12-24'), ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00']); // Christmas Eve closes 4 PM
  assert.deepEqual(times('2026-12-25'), []); // closed Christmas Day
  assert.ok(!days.some((d) => d.date === '2026-12-25'));
  assert.equal(cal.isSlotAvailable(sch, none, '2027-02-01', '17:00', FIXED_NOW), false); // outside window
  assert.equal(cal.isSlotAvailable(sch, none, '2026-12-08', '16:00', FIXED_NOW), false); // outside hours
  assert.equal(cal.isSlotAvailable(sch, none, '2026-12-08', '17:00', FIXED_NOW), true);
});

test('calendar uses Dallas time even when UTC has rolled over to the next day', () => {
  const sch = defaultSettings().schedule;
  // 2026-12-08 03:00 UTC is still Monday 2026-12-07 9 PM in Dallas
  const t = new Date('2026-12-08T03:00:00Z');
  assert.equal(cal.nowInZone('America/Chicago', t).date, '2026-12-07');
  assert.equal(cal.availability(sch, new Set(), t)[0].date, '2026-12-08');
});

test('AI guard: summary dollar amounts must come from the estimate', async () => {
  assert.deepEqual(amountsIn('From $1,500 to $2,000.50 or $40'), [1500, 2000.5, 40]);
  const estimate = computeEstimate({ service: 'landscaping', area: 'front', size: 'small' }, pricedSettings(), dist(3, 'Carrollton', true));
  const fake = (summary) => ({ beta: { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ questions: [], summary }) }] }) } } });
  const ok = await createAi({ client: fake('Your front yard mow is $30.') }).review({ data: { service: 'landscaping' }, estimate });
  assert.equal(ok.summary, 'Your front yard mow is $30.');
  const bad = await createAi({ client: fake('Your mow is $25 today.') }).review({ data: { service: 'landscaping' }, estimate });
  assert.equal(bad.summary, null);
  const refused = await createAi({ client: { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } } } }).review({ data: {}, estimate });
  assert.equal(refused, null);
});

test('city parsing from a formatted address', () => {
  assert.equal(cityFromFormatted('1234 Main St, Carrollton, TX 75006, USA'), 'Carrollton');
  assert.equal(cityFromFormatted('Carrollton, TX, USA'), 'Carrollton');
  assert.equal(cityFromFormatted('Texas'), null);
});

test('settings validation rejects broken admin input', () => {
  assert.deepEqual(validateSettings(defaultSettings()), []);
  const s = defaultSettings();
  s.schedule.hours[1] = { open: '21:00', close: '17:00' };
  s.rates.junk.loads.full.price = { min: 500, max: 400, plus: false };
  s.business.phone = '123';
  const p = validateSettings(s);
  assert.equal(p.length, 3);
  assert.ok(validateSettings({}).length > 0);
});

test('mailer: Gmail settings, SMTP settings, or off; subject cannot inject headers', async () => {
  const { createMailer } = require('../lib/mailer');
  assert.equal(createMailer({}), null);
  const sent = [];
  const m = createMailer({ GMAIL_USER: 'owner@gmail.com', GMAIL_APP_PASSWORD: 'x' }, { transport: { sendMail: async (o) => sent.push(o) } });
  await m.send('to@example.com', 'Hi\r\nBcc: evil@example.com', 'body');
  assert.equal(sent[0].from, 'owner@gmail.com');
  assert.equal(sent[0].subject, 'Hi Bcc: evil@example.com');
});

test('address suggestions: Photon (free) formatting, Google formatting, failures are quiet', async () => {
  const { createAddressSuggester } = require('../lib/address');
  const calls = [];
  const photonFetch = async (url) => {
    calls.push(String(url));
    return { ok: true, json: async () => ({ features: [
      { properties: { housenumber: '2400', street: 'Kelly Boulevard', city: 'Carrollton', state: 'Texas', postcode: '75006' } },
      { properties: { housenumber: '2400', street: 'Kelly Boulevard', city: 'Carrollton', state: 'Texas', postcode: '75006' } },
      { properties: { name: 'Belt Line Road', city: 'Addison', state: 'Texas', postcode: '75001' } },
    ] }) };
  };
  const p = createAddressSuggester({ fetchImpl: photonFetch, log: { error() {} } });
  assert.equal(p.provider, 'photon');
  assert.deepEqual(await p.suggest('abc'), [], 'too short: no lookup');
  const out = await p.suggest('2400 kelly');
  assert.deepEqual(out, [
    { label: '2400 Kelly Boulevard, Carrollton, TX 75006', city: 'Carrollton' },
    { label: 'Belt Line Road, Addison, TX 75001', city: 'Addison' },
  ]);
  assert.match(calls[0], /photon\.komoot\.io\/api\/\?q=2400\+kelly/);
  assert.match(calls[0], /countrycode=US/);
  assert.match(calls[0], /bbox=-97\.4%2C32\.6%2C-96\.38%2C33\.31/);
  await p.suggest('2400 KELLY'); // cached (same text, different case)
  assert.equal(calls.length, 1);

  let gBody = null; let gHeaders = null;
  const g = createAddressSuggester({ googleKey: 'k', fetchImpl: async (url, init) => {
    gBody = JSON.parse(init.body); gHeaders = init.headers;
    return { ok: true, json: async () => ({ suggestions: [{ placePrediction: {
      text: { text: '2400 Kelly Blvd, Carrollton, TX, USA' },
      structuredFormat: { mainText: { text: '2400 Kelly Blvd' }, secondaryText: { text: 'Carrollton, TX, USA' } },
    } }] }) };
  } });
  assert.deepEqual(await g.suggest('2400 kelly'), [{ label: '2400 Kelly Blvd, Carrollton, TX', city: 'Carrollton' }]);
  assert.equal(gHeaders['X-Goog-Api-Key'], 'k');
  assert.deepEqual(gBody.includedRegionCodes, ['us']);
  assert.equal(gBody.locationBias.circle.radius, 50000);

  const broken = createAddressSuggester({ fetchImpl: async () => { throw new Error('down'); }, log: { error() {} } });
  assert.deepEqual(await broken.suggest('2400 kelly'), []);
});

test('Google key rejected: distance and address suggestions fall back to free OpenStreetMap', async () => {
  const { createDistanceService } = require('../lib/distance');
  const { createAddressSuggester } = require('../lib/address');
  const seen = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    seen.push(u.split('?')[0]);
    if (u.includes('maps.googleapis.com')) return { ok: true, json: async () => ({ status: 'REQUEST_DENIED', rows: [] }) };
    if (u.includes('places.googleapis.com')) return { ok: false, status: 403, json: async () => ({}) };
    if (u.includes('nominatim')) return { ok: true, json: async () => ([{ lat: '33', lon: '-96.9', address: { city: u.includes('Plano') ? 'Plano' : 'Carrollton' }, display_name: 'x' }]) };
    if (u.includes('project-osrm')) return { ok: true, json: async () => ({ code: 'Ok', routes: [{ distance: 16093.44 }] }) };
    if (u.includes('photon')) return { ok: true, json: async () => ({ features: [{ properties: { housenumber: '1', street: 'Main Street', city: 'Plano', state: 'Texas', postcode: '75075' } }] }) };
    throw new Error('unexpected ' + u);
  };
  const errors = [];
  const d = createDistanceService({ provider: 'google', googleKey: 'bad', fetchImpl, log: { error: (m) => errors.push(m) } });
  const r = await d.measure('Carrollton, TX', '1 Main St, Plano, TX');
  assert.equal(Math.round(r.miles), 10);
  assert.equal(r.city, 'Plano');
  assert.match(errors[0], /REQUEST_DENIED/);
  const a = createAddressSuggester({ googleKey: 'bad', fetchImpl, log: { error() {} } });
  assert.deepEqual(await a.suggest('1 main st'), [{ label: '1 Main Street, Plano, TX 75075', city: 'Plano' }]);
  assert.equal((await a.lookup('1 main st')).provider, 'photon', 'credit line names whose data was used');
  assert.ok(seen.some((x) => x.includes('photon')));
});

test('server starts the way Render starts it (real services, Google key set, nothing faked)', () => {
  const { createApp } = require('../server');
  const { tmpDir } = require('./helpers');
  const saved = { ...process.env };
  try {
    process.env.GOOGLE_MAPS_API_KEY = 'some-key';
    process.env.GMAIL_USER = 'owner@gmail.com';
    process.env.GMAIL_APP_PASSWORD = 'xxxx';
    const app = createApp({ dataDir: tmpDir(), adminPassword: 'x' });
    assert.equal(typeof app.listen, 'function');
  } finally {
    process.env = saved;
  }
});

test('free map lookup retries simpler versions of an address and caches results', async () => {
  const { createDistanceService } = require('../lib/distance');
  const asked = [];
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    if (u.hostname.includes('nominatim')) {
      const q = u.searchParams.get('q');
      asked.push(q);
      const found = q === 'Carrollton, TX' || q === '75006, TX';
      return { ok: true, json: async () => (found ? [{ lat: '32.95', lon: '-96.89', address: { city: 'Carrollton' }, display_name: q }] : []) };
    }
    return { ok: true, json: async () => ({ code: 'Ok', routes: [{ distance: 3218.69 }] }) };
  };
  const d = createDistanceService({ provider: 'osrm', fetchImpl });
  const r = await d.measure('Carrollton, TX', '999 Madeup Ln Apt 4B, Carrollton TX 75006');
  assert.equal(r.city, 'Carrollton');
  assert.equal(r.approximate, true);
  assert.ok(asked.includes('75006, TX'), asked.join(' | '));
  assert.ok(asked.some((q) => !/apt/i.test(q) && /Madeup/.test(q)), 'tried without the apartment number');
  const before = asked.length;
  await d.measure('Carrollton, TX', '1 Other St, 75006');
  assert.ok(!asked.slice(before).includes('Carrollton, TX'), 'base address looked up only once');
});

test('Twilio sender: Messaging Service or From number, phone formats, readable errors', async () => {
  const { createSms } = require('../lib/sms');
  assert.equal(createSms({ accountSid: 'AC1', authToken: 't' }), null, 'needs a number or messaging service');
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, params: Object.fromEntries(init.body) , auth: init.headers.Authorization }); return { ok: true, json: async () => ({}) }; };
  await createSms({ accountSid: 'AC1', authToken: 't', messagingServiceSid: 'MG9', fetchImpl }).send('2145550100', 'hi');
  assert.deepEqual(calls[0].params, { To: '+12145550100', Body: 'hi', MessagingServiceSid: 'MG9' });
  assert.match(calls[0].url, /Accounts\/AC1\/Messages\.json$/);
  assert.equal(calls[0].auth, `Basic ${Buffer.from('AC1:t').toString('base64')}`);
  await createSms({ accountSid: 'AC1', authToken: 't', from: '(469) 555-0199', fetchImpl }).send('12145550100', 'hi');
  assert.deepEqual(calls[1].params, { To: '+12145550100', Body: 'hi', From: '+14695550199' });
  const bad = createSms({ accountSid: 'AC1', authToken: 't', from: '+14695550199', fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ code: 21606, message: 'The From phone number is not a valid, SMS-capable inbound phone number' }) }) });
  await assert.rejects(bad.send('2145550100', 'x'), /Twilio HTTP 400 \(Twilio error 21606/);
});

test('public calendar shows booked times (no customer info) and keeps fully booked days as Full', () => {
  const { defaultSettings: ds } = require('../lib/defaults');
  const sch = ds().schedule;
  const booked = new Set(['2026-12-08 18:00', '2026-12-09 17:00', '2026-12-09 18:00', '2026-12-09 19:00', '2026-12-09 20:00']);
  const days = cal.availability(sch, booked, FIXED_NOW);
  const tue = days.find((d) => d.date === '2026-12-08');
  assert.deepEqual(tue.slots.map((x) => x.time), ['17:00', '19:00', '20:00']);
  assert.deepEqual(tue.booked, [{ time: '18:00', label: '6:00 PM' }]);
  assert.equal(tue.full, false);
  const wed = days.find((d) => d.date === '2026-12-09');
  assert.equal(wed.full, true);
  assert.deepEqual(wed.slots, []);
  assert.equal(wed.booked.length, 4);
  assert.equal(cal.isSlotAvailable(sch, booked, '2026-12-08', '18:00', FIXED_NOW), false);
});

test('phone is optional; a typed but invalid phone is flagged; no text consent without a phone', () => {
  const s = defaultSettings();
  const base = { date: '2026-12-07', time: '17:00', address: '1 Main St, Plano TX', cityZone: 'outside' };
  const errs = (c) => pricing.validate('landscaping', { answers: { ...base, area: 'front', size: 'small' }, contact: c }, s).errors.map((e) => e.field);
  assert.ok(!errs({ name: 'Al', email: 'al@example.com' }).includes('contact.phone'), 'blank phone is fine');
  assert.ok(errs({ name: 'Al', email: 'al@example.com', phone: '555' }).includes('contact.phone'), 'bad phone flagged');
  const ok = pricing.validate('landscaping', { answers: { ...base, area: 'front', size: 'small' }, contact: { name: 'Al', email: 'al@example.com', smsConsent: true } }, s);
  assert.equal(ok.data.contact.smsConsent, false, 'consent needs a phone number');
});

test('Black Friday: 15% off the whole estimate through Dec 1 (Dallas time), with the savings shown', () => {
  const st = pricedSettings();
  const last = computeEstimate(junk({ load: 'quarter' }), st, dist(3, 'Carrollton', true), { now: new Date('2026-12-02T05:59:00Z') }); // Dec 1, 11:59 PM Dallas
  assert.ok(last.promo, 'active on Dec 1 Dallas time');
  assert.equal(last.promo.percent, 15);
  assert.deepEqual(range(last.total), [128, 128], '$150 less 15% = $127.50, rounded to $128');
  assert.equal(last.promo.savedMin, 22);
  const after = computeEstimate(junk({ load: 'quarter' }), st, dist(3, 'Carrollton', true), { now: new Date('2026-12-02T06:01:00Z') });
  assert.equal(after.promo, null, 'off on Dec 5 Dallas time');
  assert.deepEqual(range(after.total), [150, 150]);
  assert.equal(promotionActive(st, new Date('2026-11-23T18:00:00Z')), true);
});

test('same-day shows $20 with $40 as the was price', () => {
  const e = computeEstimate(junk({ load: 'quarter' }), pricedSettings(), dist(3, 'Carrollton', true), { isSameDay: true, now: FIXED_NOW });
  const sd = e.sections.find((x) => x.title === 'Same-day fee').lines[0];
  assert.equal(sd.price.min, 20);
  assert.equal(sd.was, 40);
});
