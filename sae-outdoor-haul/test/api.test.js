'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, pricedSettings, contact } = require('./helpers');

const junkAnswers = (o = {}) => ({ whatToGo: 'old couch, 6 boxes, treadmill', load: 'half', locations: ['ground'], items: [], date: '2026-12-08', time: '18:00', address: '100 Main St, Plano, TX', ...o });

test('pages render with phone + Text Us in header and footer on every page', async () => {
  const s = await startServer();
  try {
    for (const p of ['/', '/prices', '/thank-you', '/privacy', '/terms']) {
      const r = await s.get(p);
      assert.equal(r.status, 200, p);
      assert.equal((r.text.match(/href="tel:\+14696864690"/g) || []).length >= 2, true, `${p} phone in header+footer`);
      assert.equal((r.text.match(/href="sms:\+14696864690"[^>]*>Text Us/g) || []).length >= 2, true, `${p} Text Us in header+footer`);
      assert.match(r.text, /href="\/prices">Get a Quote/);
      assert.match(r.text, /href="\/privacy">Privacy Policy/);
      assert.ok(!/\{\{/.test(r.text), `${p} has no unreplaced tokens`);
    }
    const home = (await s.get('/')).text;
    assert.match(home, /<h1>SAE Outdoor and Haul: Junk Removal, Landscaping, and Christmas Trees<\/h1>/);
    const order = ['id="services"', 'id="faq"', 'id="where"', 'id="contact"', 'site-footer'].map((x) => home.indexOf(x));
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'home sections in the required order');
    assert.match(home, /Base:<\/strong> Carrollton, TX/);
    assert.match(home, /\(469\) 686-4690/);
    assert.match(home, /mailto:Helpcentre403@gmail\.com/);
    assert.match(home, /Closed Christmas Day/);
    assert.ok(!/\[TODO/.test(home), 'no TODO placeholders left on the home page');
    assert.match(home, /Monday to Friday:<\/strong> 5:00 PM to 9:00 PM/);
    assert.match(home, /Saturday and Sunday:<\/strong> 10:00 AM to 9:00 PM/);
    assert.match(home, /href="\/prices#junk"/);
    assert.match(home, /href="\/prices#landscaping"/);
    assert.match(home, /href="\/prices#trees"/);
    assert.match((await s.get('/thank-you')).text, /Got it\. We&#39;ll text you to confirm\.|Got it\. We'll text you to confirm\./);
    assert.match((await s.get('/privacy')).text, /<h1>Privacy Policy<\/h1>/);
    assert.match((await s.get('/terms')).text, /<h1>Terms of Service<\/h1>/);
  } finally { await s.close(); }
});

test('junk estimate end to end: breakdown, distance band, lead saved, book, slot disappears', async () => {
  const s = await startServer({ settings: pricedSettings() });
  try {
    const r = await s.post('/api/estimate', { service: 'junk', answers: junkAnswers({ locations: ['elevated'] }), contact });
    assert.equal(r.json.status, 'ok', JSON.stringify(r.json));
    const e = r.json.estimate;
    assert.equal(e.totalDisplay, '$295 to $345'); // 250 + elevated 25-75 + 10-20 mi band $20
    assert.deepEqual(e.sections.map((x) => x.title), ['Base price', 'Extras', 'Distance fee']);
    assert.match(e.sections[2].lines[0].label, /10 to 20 miles \(about 15 mi\)/);
    assert.equal(r.json.disclaimer, 'This is an estimate. Our crew confirms the final price before work starts.');

    const leads = (await s.admin('GET', '/api/admin/leads')).json.leads;
    assert.equal(leads.length, 1);
    assert.equal(leads[0].contact.phone, '2145550100');
    assert.equal(leads[0].answers.whatToGo, 'old couch, 6 boxes, treadmill');
    assert.equal(leads[0].booking.status, 'requested');

    const t = await s.post(`/api/leads/${r.json.leadId}/text`, {});
    assert.equal(t.json.status, 'ok');
    assert.equal(t.json.sent, false); // no SMS provider configured -> saved for the crew

    const b = await s.post(`/api/leads/${r.json.leadId}/book`, {});
    assert.equal(b.json.status, 'ok');
    const day = (await s.get('/api/availability')).json.days.find((d) => d.date === '2026-12-08');
    assert.deepEqual(day.slots.map((x) => x.time), ['17:00', '19:00', '20:00']);

    // A second customer can't take the same slot
    const r2 = await s.post('/api/estimate', { service: 'junk', answers: junkAnswers(), contact });
    assert.equal(r2.json.status, 'needs_info');
    assert.equal(r2.json.questions[0].field, 'date');

    const stored = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'leads.json'), 'utf8'));
    assert.equal(stored[0].textRequested, true);
    assert.equal(stored[0].status, 'booked');
  } finally { await s.close(); }
});

test('book race: slot taken between estimate and booking returns 409', async () => {
  const s = await startServer({ settings: pricedSettings() });
  try {
    const a = await s.post('/api/estimate', { service: 'junk', answers: junkAnswers(), contact });
    const b = await s.post('/api/estimate', { service: 'junk', answers: junkAnswers(), contact });
    assert.equal((await s.post(`/api/leads/${a.json.leadId}/book`, {})).json.status, 'ok');
    const second = await s.post(`/api/leads/${b.json.leadId}/book`, {});
    assert.equal(second.status, 409);
  } finally { await s.close(); }
});

test('distance bands through the API, Carrollton free, over 20 miles = contact us', async () => {
  const s = await startServer({ settings: pricedSettings() });
  try {
    const fee = async (address) => {
      const r = await s.post('/api/estimate', { service: 'landscaping', answers: { area: 'front', size: 'small', date: '2026-12-12', time: '10:00', address }, contact });
      return r.json;
    };
    const distLine = (j) => j.estimate.sections.find((x) => x.title === 'Distance fee').lines[0];
    assert.equal(distLine(await fee('5 Elm St, Carrollton, TX 75006')).display, '$0');
    assert.match(distLine(await fee('5 Elm St, Carrollton, TX 75006')).label, /Within Carrollton \(free\)/);
    assert.equal(distLine(await fee('1 Belt Line Rd, Addison')).display, '$10');
    assert.equal(distLine(await fee('nine road')).display, '$10');
    assert.equal(distLine(await fee('tenish road')).display, '$20');
    assert.equal(distLine(await fee('Plano TX')).display, '$20');
    assert.equal(distLine(await fee('Irving TX')).display, '$20');
    assert.equal(distLine(await fee('Garland TX')).display, '$20');
    assert.equal((await fee('justover road')).status, 'out_of_area');
    assert.equal((await fee('Denton TX')).status, 'out_of_area');
    const far = await fee('Downtown FortWorth TX');
    assert.equal(far.status, 'out_of_area');
    assert.match(far.message, /more than 20 driving miles/);
    assert.match(far.message, /Contact us/);
    const unknown = await fee('Nowhere Special');
    assert.equal(unknown.status, 'needs_info');
    assert.equal(unknown.questions[0].field, 'address');
    const leads = (await s.admin('GET', '/api/admin/leads')).json.leads;
    assert.ok(leads.some((l) => l.status === 'out_of_area'), 'out-of-area request saved as a lead');
  } finally { await s.close(); }
});

test('trees and landscaping totals; zero trees rejected', async () => {
  const s = await startServer({ settings: pricedSettings() });
  try {
    const t = await s.post('/api/estimate', {
      service: 'trees',
      answers: { count: 3, trees: [{ size: 'small', service: 'delivery' }, { size: 'medium', service: 'installation' }, { size: 'large', service: 'both' }], date: '2026-12-12', time: '11:00', address: 'Plano TX' },
      contact,
    });
    assert.equal(t.json.status, 'ok');
    assert.equal(t.json.estimate.totalDisplay, `$${(60 + 35) + (80 + 40) + (100 + 115) + 20}`);
    const zero = await s.post('/api/estimate', { service: 'trees', answers: { count: 0, trees: [], date: '2026-12-12', time: '11:00', address: 'Plano TX' }, contact });
    assert.equal(zero.json.status, 'needs_info');
    assert.equal(zero.json.questions[0].field, 'count');
    const l = await s.post('/api/estimate', { service: 'landscaping', answers: { area: 'back', size: 'large', date: '2026-12-12', time: '12:00', address: 'Irving TX' }, contact });
    assert.equal(l.json.estimate.totalDisplay, '$75');
  } finally { await s.close(); }
});

test('same-day junk adds the same-day fee; long carry (still TODO) shows "To be confirmed"', async () => {
  const s = await startServer(); // default settings: long carry and tree price are still TODO
  try {
    const r = await s.post('/api/estimate', { service: 'junk', answers: junkAnswers({ date: '2026-12-07', time: '17:00', locations: ['longCarry'] }), contact });
    assert.equal(r.json.status, 'ok');
    const secs = r.json.estimate.sections;
    assert.equal(secs.at(-1).title, 'Same-day fee');
    assert.equal(secs.at(-1).lines[0].display, '$40');
    assert.equal(secs.find((x) => x.title === 'Extras').lines[0].display, 'To be confirmed');
    assert.equal(secs.find((x) => x.title === 'Distance fee').lines[0].display, '$20');
    assert.equal(r.json.estimate.totalDisplay, '$310'); // 250 + $20 distance + $40 same-day; long carry excluded, not guessed
    assert.ok(r.json.estimate.notes.some((n) => /not included/.test(n)));
  } finally { await s.close(); }
});

test('missing answers come back as questions, not guesses', async () => {
  const s = await startServer();
  try {
    const r = await s.post('/api/estimate', { service: 'junk', answers: { whatToGo: '', locations: [] }, contact: {} });
    const fields = r.json.questions.map((q) => q.field);
    for (const f of ['whatToGo', 'load', 'locations', 'date', 'address', 'contact.name', 'contact.phone']) assert.ok(fields.includes(f), f);
    assert.equal((await s.admin('GET', '/api/admin/leads')).json.leads.length, 0);
  } finally { await s.close(); }
});

test('AI step: questions are asked first; invented prices are dropped from the summary', async () => {
  let mode = 'ask';
  const ai = {
    review: async () => (mode === 'ask'
      ? { questions: ['Is the treadmill electric?'], summary: 'x' }
      : { questions: [], summary: null }), // null = summary failed the price check
  };
  const s = await startServer({ settings: pricedSettings(), ai });
  try {
    const r1 = await s.post('/api/estimate', { service: 'junk', answers: junkAnswers(), contact });
    assert.equal(r1.json.status, 'needs_info');
    assert.equal(r1.json.aiQuestions, true);
    const r2 = await s.post('/api/estimate', { service: 'junk', answers: junkAnswers(), contact, aiAcknowledged: true });
    assert.equal(r2.json.status, 'ok');
    mode = 'bad-summary';
    const r3 = await s.post('/api/estimate', { service: 'junk', answers: junkAnswers({ time: '19:00' }), contact });
    assert.match(r3.json.summary, /^Your junk removal estimate is \$270\./);
  } finally { await s.close(); }
});

test('AI failure falls back to template summary', async () => {
  const s = await startServer({ settings: pricedSettings(), ai: { review: async () => { throw new Error('timeout'); } } });
  try {
    const r = await s.post('/api/estimate', { service: 'junk', answers: junkAnswers(), contact });
    assert.equal(r.json.status, 'ok');
    assert.match(r.json.summary, /SAE Outdoor and Haul will confirm the final price/);
  } finally { await s.close(); }
});

test('admin: auth required; edit hours, block/open dates and slots, holidays show on public calendar', async () => {
  const s = await startServer();
  try {
    assert.equal((await s.get('/admin')).status, 401);
    assert.equal((await s.get('/api/admin/settings')).status, 401);
    assert.equal((await s.admin('GET', '/admin')).status, 200);

    const slots = async (date) => ((await s.get('/api/availability')).json.days.find((d) => d.date === date) || { slots: [] }).slots.map((x) => x.time);

    // Change weekday hours to 4 PM - 8 PM
    const settings = (await s.admin('GET', '/api/admin/settings')).json;
    for (const d of [1, 2, 3, 4, 5]) settings.schedule.hours[d] = { open: '16:00', close: '20:00' };
    settings.schedule.hours[0] = null; // closed Sundays
    assert.equal((await s.admin('PUT', '/api/admin/settings', settings)).json.status, 'ok');
    assert.deepEqual(await slots('2026-12-08'), ['16:00', '17:00', '18:00', '19:00']);
    assert.deepEqual(await slots('2026-12-13'), []);
    assert.match((await s.get('/')).text, /Monday to Friday:<\/strong> 4:00 PM to 8:00 PM/);

    // Bad hours are rejected
    const bad = structuredClone(settings); bad.schedule.hours[2] = { open: '20:00', close: '10:00' };
    assert.equal((await s.admin('PUT', '/api/admin/settings', bad)).status, 400);

    // Block a whole day, then re-open one slot on it
    await s.admin('POST', '/api/admin/calendar', { action: 'blockDate', date: '2026-12-09' });
    assert.deepEqual(await slots('2026-12-09'), []);
    await s.admin('POST', '/api/admin/calendar', { action: 'openSlot', date: '2026-12-09', time: '18:00' });
    assert.deepEqual(await slots('2026-12-09'), ['18:00']);

    // Block a single slot, then open an extra one outside hours
    await s.admin('POST', '/api/admin/calendar', { action: 'blockSlot', date: '2026-12-10', time: '17:00' });
    await s.admin('POST', '/api/admin/calendar', { action: 'openSlot', date: '2026-12-10', time: '11:00' });
    assert.deepEqual(await slots('2026-12-10'), ['11:00', '16:00', '18:00', '19:00']);
    await s.admin('POST', '/api/admin/calendar', { action: 'openSlot', date: '2026-12-10', time: '17:00' });
    assert.deepEqual(await slots('2026-12-10'), ['11:00', '16:00', '17:00', '18:00', '19:00']);

    // Holiday uses holiday hours
    await s.admin('POST', '/api/admin/calendar', { action: 'addHoliday', date: '2026-12-11' });
    assert.equal((await slots('2026-12-11')).length, 11);
    await s.admin('POST', '/api/admin/calendar', { action: 'setSpecialHours', date: '2026-12-14', open: '18:00', close: '20:00' });
    assert.deepEqual(await slots('2026-12-14'), ['18:00', '19:00']);
    assert.equal((await s.admin('POST', '/api/admin/calendar', { action: 'setSpecialHours', date: '2026-12-14', open: '20:00', close: '18:00' })).status, 400);
    await s.admin('POST', '/api/admin/calendar', { action: 'clearSpecialHours', date: '2026-12-14' });
    assert.deepEqual(await slots('2026-12-14'), ['16:00', '17:00', '18:00', '19:00']);

    // Blocked slot cannot be booked via the API
    const r = await s.post('/api/estimate', { service: 'landscaping', answers: { area: 'front', size: 'small', date: '2026-12-09', time: '17:00', address: 'Plano' }, contact });
    assert.equal(r.json.status, 'needs_info');
  } finally { await s.close(); }
});

test('admin rate edits flow straight into estimates', async () => {
  const s = await startServer();
  try {
    const settings = (await s.admin('GET', '/api/admin/settings')).json;
    settings.rates.landscaping.front.small.price = { min: 32, max: 32, plus: false };
    settings.rates.distance.bands[1].fee = 15;
    await s.admin('PUT', '/api/admin/settings', settings);
    const r = await s.post('/api/estimate', { service: 'landscaping', answers: { area: 'front', size: 'small', date: '2026-12-12', time: '10:00', address: 'Plano' }, contact });
    assert.equal(r.json.estimate.totalDisplay, '$47');
    const cfg = (await s.get('/api/config')).json;
    assert.equal(cfg.landscaping.front[0].price, '$32');
  } finally { await s.close(); }
});

test('admin locks out after 10 failed logins', async () => {
  const s = await startServer();
  try {
    const bad = `Basic ${Buffer.from('admin:wrong').toString('base64')}`;
    for (let i = 0; i < 10; i += 1) assert.equal((await fetch(`${s.base}/admin`, { headers: { Authorization: bad } })).status, 401);
    assert.equal((await fetch(`${s.base}/admin`, { headers: { Authorization: bad } })).status, 429);
  } finally { await s.close(); }
});

test('admin disabled when no password is configured', async () => {
  const s = await startServer({ adminPassword: '' });
  try {
    assert.equal((await s.get('/admin')).status, 503);
  } finally { await s.close(); }
});
