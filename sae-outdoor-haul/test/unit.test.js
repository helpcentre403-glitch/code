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

test('distance bands: boundaries round to nearest mile, free city, over 25', () => {
  const r = pricedSettings().rates;
  const fee = (miles) => pricing.distanceLine(r, dist(miles)).line.price.min;
  assert.equal(fee(0), 20);
  assert.equal(fee(9.4), 20);
  assert.equal(fee(9.6), 30); // rounds to 10
  assert.equal(fee(15), 30);
  assert.equal(fee(15.6), 40);
  assert.equal(fee(20.4), 40);
  assert.equal(fee(21), 50);
  assert.equal(fee(25.4), 50);
  assert.equal(pricing.distanceLine(r, dist(25.6)).outOfArea, true);
  assert.equal(pricing.distanceLine(r, dist(40)).outOfArea, true);
  const free = pricing.distanceLine(r, dist(3, 'Carrollton', true)).line;
  assert.deepEqual(range(free.price), [0, 0]);
  assert.match(free.label, /Carrollton \(free\)/);
});

test('distance fee not set yet (TODO) shows "to be confirmed", never a made-up number', () => {
  const r = defaultSettings().rates;
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
  // base 450-550, stairs 25-75, long carry 30, disassembly 25-100, distance 30, same-day 40
  assert.deepEqual(range(e.total), [450 + 25 + 30 + 25 + 30 + 40, 550 + 75 + 30 + 100 + 30 + 40]);
  assert.deepEqual(e.sections.map((x) => x.title), ['Base price', 'Extras', 'Distance fee', 'Same-day fee']);
  assert.equal(e.hasUnpriced, false);
});

test('junk: items and cleanout used when no load is chosen; minimum charge applies', () => {
  const s = pricedSettings();
  const e1 = pricing.computeEstimate(junk({ load: null, items: [{ key: 'couch', qty: 2 }, { key: 'mattress', qty: 1 }], cleanout: 'shed' }), s, dist(3, 'Carrollton', true));
  assert.deepEqual(range(e1.sections[0].subtotal), [200 + 75 + 175, 300 + 110 + 350]);
  const e2 = pricing.computeEstimate(junk({ load: null, items: [{ key: 'recliner', qty: 1 }] }), s, dist(3, 'Carrollton', true));
  assert.deepEqual(range(e2.sections[0].subtotal), [100, 100]);
  assert.ok(e2.sections[0].lines.some((l) => /Minimum service charge/.test(l.label)));
});

test('junk: load chosen with items uses load price only (no double count)', () => {
  const e = pricing.computeEstimate(junk({ load: 'quarter', items: [{ key: 'couch', qty: 1 }] }), pricedSettings(), dist(3, 'Carrollton', true));
  assert.deepEqual(range(e.total), [150, 150]);
});

test('junk: open-ended prices keep "+", special materials flagged for confirmation', () => {
  const e = pricing.computeEstimate(junk({ load: 'overFull', whatToGo: 'old tires and broken concrete' }), pricedSettings(), dist(3, 'Carrollton', true));
  assert.equal(pricing.formatPrice(e.total), '$550 to $700+');
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
  assert.deepEqual(range(e.total), [75 + 40, 75 + 40]);
  const e2 = pricing.computeEstimate({ service: 'landscaping', area: 'front', size: 'medium' }, pricedSettings(), dist(3, 'Carrollton', true));
  assert.deepEqual(range(e2.total), [35, 35]);
});

test('trees: (tree price + service fee) per tree + distance', () => {
  const data = { service: 'trees', trees: [{ size: 'medium', service: 'both' }, { size: 'large', service: 'delivery' }] };
  const e = pricing.computeEstimate(data, pricedSettings(), dist(6.1));
  assert.deepEqual(range(e.total), [(80 + 75) + (100 + 75) + 20, (80 + 75) + (100 + 75) + 20]);
  // With tree price still TODO, it is shown as "to be confirmed" and excluded from the total
  const e2 = pricing.computeEstimate(data, defaultSettings(), dist(3, 'Carrollton', true));
  assert.deepEqual(range(e2.total), [75 + 75, 75 + 75]);
  assert.equal(e2.sections[0].lines.filter((l) => l.status === 'tbd').length, 2);
});

test('validation asks instead of guessing', () => {
  const s = defaultSettings();
  const v = (service, answers, c = { name: 'A', phone: '2145550100' }) => pricing.validate(service, { answers, contact: c }, s).errors.map((e) => e.field);
  const base = { date: '2026-12-07', time: '17:00', address: '1 Main St, Plano TX' };
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
  assert.equal(days.length, 21);
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
