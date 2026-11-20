'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../lib/pricing');
const cal = require('../lib/calendar');
const { amountsIn, createAi } = require('../lib/ai');
const { cityFromFormatted } = require('../lib/distance');
const { defaultSettings } = require('../lib/defaults');
const { validateSettings } = require('../server');
const { pricedSettings, FIXED_NOW } = require('./helpers');

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
  const e = pricing.computeEstimate(junk({ locations: ['elevated', 'longCarry'], disassembly: true }), s, dist(14.8), { isSameDay: true });
  // base 450-550, elevated 25-75, long carry 30, disassembly 25-100, distance 20, same-day 40
  assert.deepEqual(range(e.total), [450 + 25 + 30 + 25 + 10 + 40, 550 + 75 + 30 + 100 + 10 + 40]);
  assert.deepEqual(e.sections.map((x) => x.title), ['Base price', 'Extras', 'Distance fee', 'Same-day fee']);
  assert.equal(e.hasUnpriced, false);
});

test('junk: items and cleanout priced; $100 minimum applies to the whole job', () => {
  const s = pricedSettings();
  const e1 = pricing.computeEstimate(junk({ load: null, items: [{ key: 'couch', qty: 2 }, { key: 'mattress', qty: 1 }], cleanout: 'shed' }), s, dist(3, 'Carrollton', true));
  assert.deepEqual(range(e1.sections[0].subtotal), [200 + 75 + 175, 300 + 110 + 350]);
  const e2 = pricing.computeEstimate(junk({ load: null, items: [{ key: 'recliner', qty: 1 }] }), s, dist(3, 'Carrollton', true));
  assert.deepEqual(range(e2.total), [100, 100]);
  assert.ok(e2.sections[0].lines.some((l) => /\$100 minimum per junk job/.test(l.label)));
  // recliner 65-90 + $10 distance = 75-100 -> raised to 100-100
  const e3 = pricing.computeEstimate(junk({ load: null, items: [{ key: 'recliner', qty: 1 }] }), s, dist(15));
  assert.deepEqual(range(e3.total), [100, 100]);
  // no adjustment when the job is already over $100
  const e4 = pricing.computeEstimate(junk({ load: 'quarter' }), s, dist(15));
  assert.deepEqual(range(e4.total), [160, 160]);
  assert.ok(!e4.sections[0].lines.some((l) => l.status === 'info'));
});

test('junk: trailer load is used only when no items or cleanout are chosen', () => {
  const e = pricing.computeEstimate(junk({ load: 'quarter', items: [{ key: 'couch', qty: 1 }] }), pricedSettings(), dist(3, 'Carrollton', true));
  assert.deepEqual(range(e.total), [100, 150]); // couch, not the 1/4 load
  assert.ok(e.notes.some((n) => /instead of the trailer load/.test(n)));
  const e2 = pricing.computeEstimate(junk({ load: 'quarter', cleanout: 'smallGarage' }), pricedSettings(), dist(3, 'Carrollton', true));
  assert.deepEqual(range(e2.total), [200, 200]);
});

test('junk: open-ended prices keep "+", special materials flagged for confirmation', () => {
  const e = pricing.computeEstimate(junk({ load: 'overFull', whatToGo: 'old tires and broken concrete' }), pricedSettings(), dist(3, 'Carrollton', true));
  assert.equal(pricing.formatPrice(e.total), '$550 to $700');
  const labels = e.sections[1].lines.map((l) => `${l.status}:${l.label}`);
  assert.ok(labels.some((l) => l.startsWith('confirm:Tires')));
  assert.ok(labels.some((l) => l.startsWith('confirm:Concrete')));
  assert.equal(e.hasUnpriced, true);
});

test('junk: same-day fee only when same day', () => {
  const e = pricing.computeEstimate(junk(), pricedSettings(), dist(3, 'Carrollton', true), { isSameDay: false });
  assert.ok(!e.sections.some((x) => x.title === 'Same-day fee'));
});

test('landscaping: visit price + distance', () => {
  const e = pricing.computeEstimate({ service: 'landscaping', area: 'both', size: 'large' }, pricedSettings(), dist(20.4));
  assert.deepEqual(range(e.total), [75 + 10, 75 + 10]);
  const e2 = pricing.computeEstimate({ service: 'landscaping', area: 'front', size: 'medium' }, pricedSettings(), dist(3, 'Carrollton', true));
  assert.deepEqual(range(e2.total), [35, 35]);
});

test('trees: (tree price + service fee) per tree + distance', () => {
  const data = { service: 'trees', trees: [{ size: 'medium', service: 'both' }, { size: 'large', service: 'delivery' }] };
  const e = pricing.computeEstimate(data, pricedSettings(), dist(6.1));
  assert.deepEqual(range(e.total), [(80 + 75) + (100 + 75) + 10, (80 + 75) + (100 + 75) + 10]);
  // Owner default: each tree is estimated at "$60+" and included in the total with a "+"
  const e2 = pricing.computeEstimate(data, defaultSettings(), dist(3, 'Carrollton', true));
  assert.equal(pricing.formatPrice(e2.total), `$${60 + 75 + 60 + 75}+`);
  assert.ok(e2.sections[0].lines[0].label.includes("we'll tell you the exact cost"));
  // A tree price the owner clears in admin shows "to be confirmed" and is left out
  const cleared = defaultSettings();
  cleared.rates.trees.treePrice.medium = { min: null, max: null, plus: false };
  const e3 = pricing.computeEstimate(data, cleared, dist(3, 'Carrollton', true));
  assert.equal(e3.sections[0].lines.filter((l) => l.status === 'tbd').length, 1);
});

test('validation asks instead of guessing', () => {
  const s = defaultSettings();
  const v = (service, answers, c = { name: 'A', phone: '2145550100' }) => pricing.validate(service, { answers, contact: c }, s).errors.map((e) => e.field);
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
  assert.ok(v('landscaping', { ...base, area: 'front', size: 'small' }, { name: 'A', phone: '555' }).includes('contact.phone'));
  assert.equal(pricing.normalizePhone('+1 (469) 686-4690'), '4696864690');
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
  const estimate = pricing.computeEstimate({ service: 'landscaping', area: 'front', size: 'small' }, pricedSettings(), dist(3, 'Carrollton', true));
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
