'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, pricedSettings, contact } = require('./helpers');

const junkAnswers = (o = {}) => ({ whatToGo: 'old couch, 6 boxes, treadmill', load: 'half', locations: ['ground'], items: [], date: '2026-12-08', time: '18:00', address: '100 Main St, Plano, TX', cityZone: 'outside', ...o });

test('pages render with phone + Text Us in header and footer on every page', async () => {
  const s = await startServer();
  try {
    for (const p of ['/', '/prices', '/thank-you', '/privacy', '/terms']) {
      const r = await s.get(p);
      assert.equal(r.status, 200, p);
      assert.equal((r.text.match(/href="tel:\+14697561984"/g) || []).length >= 2, true, `${p} phone in header+footer`);
      assert.equal((r.text.match(/href="sms:\+14697561984"[^>]*>Text Us/g) || []).length >= 2, true, `${p} Text Us in header+footer`);
      assert.match(r.text, /href="\/prices">Get a Quote/);
      assert.match(r.text, /href="\/privacy">Privacy Policy/);
      assert.ok(!/\{\{/.test(r.text), `${p} has no unreplaced tokens`);
    }
    const home = (await s.get('/')).text;
    assert.match(home, /<h1>SAE Outdoor and Haul: Junk Removal, Landscaping, and Christmas Trees<\/h1>/);
    const order = ['id="services"', 'id="faq"', 'id="where"', 'id="contact"', 'site-footer'].map((x) => home.indexOf(x));
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'home sections in the required order');
    assert.match(home, /Base:<\/strong> Carrollton, TX/);
    assert.match(home, /\(469\) 756-1984/);
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
    assert.equal(e.totalDisplay, '$285 to $335'); // 250 + elevated 25-75 + outside-Carrollton fee $10
    assert.deepEqual(e.sections.map((x) => x.title), ['Base price', 'Extras', 'Distance fee']);
    assert.equal(e.sections[2].lines[0].label, 'Outside Carrollton');
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

test('booking texts the owner who booked, when, and what the job is', async () => {
  const sent = [];
  const sms = { send: async (to, body) => { sent.push({ to, body }); return true; } };
  const s = await startServer({ settings: pricedSettings(), sms });
  try {
    const r = await s.post('/api/estimate', { service: 'junk', answers: junkAnswers({ items: [{ key: 'couch', qty: 2 }], special: 'gate code 1234' }), contact: { ...contact, smsConsent: true } });
    assert.equal(sent.length, 0, 'no owner text for a quote alone');
    assert.equal((await s.post(`/api/leads/${r.json.leadId}/book`, {})).json.status, 'ok');
    assert.equal(sent.length, 2, 'one text to the owner, one to the customer');
    const ownerText = sent.find((x) => x.to === '4697561984');
    assert.ok(ownerText);
    assert.ok(sent.some((x) => x.to === '2145550100'), 'customer texted');
    const body = ownerText.body;
    for (const part of ['NEW BOOKING: Junk removal', 'Tue, Dec 8 at 6:00 PM', 'Test Customer, (214) 555-0100', 'Address: 100 Main St, Plano, TX', 'old couch, 6 boxes, treadmill', 'Couch x2', 'gate code 1234', 'Estimate: $210 to $310']) {
      assert.ok(body.includes(part), `missing "${part}" in:\n${body}`);
    }
    const lead = (await s.admin('GET', '/api/admin/leads')).json.leads[0];
    assert.equal(lead.ownerTexted, true);
  } finally { await s.close(); }
});

test('Book This Date emails the owner right away: who, contact info, address, when, and what', async () => {
  const mails = [];
  const mailer = { send: async (to, subject, text) => { mails.push({ to, subject, text }); return true; } };
  const s = await startServer({ settings: pricedSettings(), mailer });
  try {
    const r = await s.post('/api/estimate', { service: 'landscaping', answers: { area: 'both', size: 'large', date: '2026-12-12', time: '10:00', address: '5 Elm St, Carrollton, TX', cityZone: 'inside' }, contact: { ...contact, email: 'pat@example.com' } });
    assert.equal(mails.length, 0, 'no email for a quote alone');
    await s.post(`/api/leads/${r.json.leadId}/text`, {});
    assert.equal(mails.length, 0, 'no email for Text Me This Quote');
    await s.post(`/api/leads/${r.json.leadId}/book`, {});
    assert.equal(mails.length, 2, 'owner email + customer receipt the moment they book');
    const m = mails.find((x) => x.to === 'Helpcentre403@gmail.com');
    assert.ok(mails.some((x) => x.to === 'pat@example.com'), 'customer emailed a receipt');
    assert.equal(m.subject, 'New booking: Test Customer - Landscaping, Sat, Dec 12 at 10:00 AM');
    assert.ok(m.text.startsWith('CUSTOMER: Test Customer'), 'name is the first line of the email');
    for (const part of ['A customer just booked', 'Test Customer, (214) 555-0100', 'Address: 5 Elm St, Carrollton, TX', 'Large front and back', 'Customer email: pat@example.com', 'Total: $75', '"cityZone": "inside"']) {
      assert.ok(m.text.includes(part), `missing "${part}" in:\n${m.text}`);
    }
    const lead = (await s.admin('GET', '/api/admin/leads')).json.leads[0];
    assert.equal(lead.ownerEmailed, true);
  } finally { await s.close(); }
});

test('a broken email setup never breaks a booking', async () => {
  const mailer = { send: async () => { throw new Error('SMTP down'); } };
  const s = await startServer({ settings: pricedSettings(), mailer });
  try {
    const r = await s.post('/api/estimate', { service: 'junk', answers: junkAnswers(), contact });
    assert.equal((await s.post(`/api/leads/${r.json.leadId}/book`, {})).json.status, 'ok');
    const lead = (await s.admin('GET', '/api/admin/leads')).json.leads[0];
    assert.equal(lead.status, 'booked');
    assert.equal(lead.ownerEmailed, false);
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

test('inside/outside Carrollton buttons: $0 inside, flat $10 outside, map wins, over 20 miles = contact us', async () => {
  const s = await startServer({ settings: pricedSettings() });
  try {
    const fee = async (address, zone = 'outside') => {
      const r = await s.post('/api/estimate', { service: 'landscaping', answers: { area: 'front', size: 'small', date: '2026-12-12', time: '10:00', address, cityZone: zone }, contact });
      return r.json;
    };
    const distLine = (j) => j.estimate.sections.find((x) => x.title === 'Distance fee').lines[0];
    assert.equal(distLine(await fee('5 Elm St, Carrollton, TX 75006')).display, 'No fee');
    // Map service gave no city: the customer's button decides
    assert.equal(distLine(await fee('2 nocity Rd', 'inside')).display, 'No fee');
    assert.equal(distLine(await fee('2 nocity Rd', 'outside')).display, '$10');
    // Map disagrees with the button: the map wins and the customer is told why
    const wrongInside = await fee('Plano TX', 'inside');
    assert.equal(distLine(wrongInside).display, '$10');
    assert.match(wrongInside.estimate.notes[0], /You picked inside of Carrollton, but the map places this address in Plano/);
    const wrongOutside = await fee('5 Elm St, Carrollton, TX 75006', 'outside');
    assert.equal(distLine(wrongOutside).display, 'No fee');
    assert.match(wrongOutside.estimate.notes[0], /You picked outside of Carrollton/);
    // Missing choice is asked for
    const noZone = await fee('Plano TX', '');
    assert.equal(noZone.status, 'needs_info');
    assert.equal(noZone.questions[0].field, 'cityZone');
    assert.match(distLine(await fee('5 Elm St, Carrollton, TX 75006')).label, /Carrollton address: no distance fee/);
    assert.equal(distLine(await fee('1 Belt Line Rd, Addison')).display, '$10');
    assert.equal(distLine(await fee('nine road')).display, '$10');
    assert.equal(distLine(await fee('tenish road')).display, '$10');
    assert.equal(distLine(await fee('Plano TX')).display, '$10');
    assert.equal(distLine(await fee('Irving TX')).display, '$10');
    assert.equal(distLine(await fee('Garland TX')).display, '$10');
    assert.equal((await fee('justover road')).status, 'out_of_area');
    assert.equal((await fee('Denton TX')).status, 'out_of_area');
    const far = await fee('Downtown FortWorth TX');
    assert.equal(far.status, 'out_of_area');
    assert.match(far.message, /more than 20 driving miles/);
    assert.match(far.message, /Contact us/);
    // Address the map can't place: still priced from the button, with a note, and flagged for the crew
    const unknown = await fee('Nowhere Special', 'outside');
    assert.equal(unknown.status, 'ok');
    assert.equal(distLine(unknown).display, '$10');
    assert.match(distLine(unknown).label, /address to be confirmed/);
    assert.match(unknown.estimate.notes[0], /couldn't check this address on the map/);
    const unknownInside = await fee('Nowhere Special', 'inside');
    assert.equal(distLine(unknownInside).display, 'No fee');
    const leads = (await s.admin('GET', '/api/admin/leads')).json.leads;
    assert.ok(leads.some((l) => l.status === 'out_of_area'), 'out-of-area request saved as a lead');
  } finally { await s.close(); }
});

test('trees and landscaping totals; zero trees rejected', async () => {
  const s = await startServer({ settings: pricedSettings() });
  try {
    const t = await s.post('/api/estimate', {
      service: 'trees',
      answers: { count: 3, trees: [{ size: 'small', service: 'delivery' }, { size: 'medium', service: 'installation' }, { size: 'large', service: 'both' }], date: '2026-12-12', time: '11:00', address: 'Plano TX', cityZone: 'outside' },
      contact,
    });
    assert.equal(t.json.status, 'ok');
    assert.equal(t.json.estimate.totalDisplay, `$${(60 + 35) + (80 + 40) + (100 + 115) + 10}`);
    const zero = await s.post('/api/estimate', { service: 'trees', answers: { count: 0, trees: [], date: '2026-12-12', time: '11:00', address: 'Plano TX', cityZone: 'outside' }, contact });
    assert.equal(zero.json.status, 'needs_info');
    assert.equal(zero.json.questions[0].field, 'count');
    const l = await s.post('/api/estimate', { service: 'landscaping', answers: { area: 'back', size: 'large', date: '2026-12-12', time: '12:00', address: 'Irving TX', cityZone: 'outside' }, contact });
    assert.equal(l.json.estimate.totalDisplay, '$65');
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
    assert.equal(secs.find((x) => x.title === 'Distance fee').lines[0].display, '$10');
    assert.equal(r.json.estimate.totalDisplay, '$300'); // 250 + $10 distance + $40 same-day; long carry excluded, not guessed
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
    assert.match(r3.json.summary, /^Your junk removal estimate is \$260\./);
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
    const r = await s.post('/api/estimate', { service: 'landscaping', answers: { area: 'front', size: 'small', date: '2026-12-09', time: '17:00', address: 'Plano', cityZone: 'outside' }, contact });
    assert.equal(r.json.status, 'needs_info');
  } finally { await s.close(); }
});

test('admin rate edits flow straight into estimates', async () => {
  const s = await startServer();
  try {
    const settings = (await s.admin('GET', '/api/admin/settings')).json;
    settings.rates.landscaping.front.small.price = { min: 32, max: 32, plus: false };
    settings.rates.distance.bands[0].fee = 15;
    await s.admin('PUT', '/api/admin/settings', settings);
    const r = await s.post('/api/estimate', { service: 'landscaping', answers: { area: 'front', size: 'small', date: '2026-12-12', time: '10:00', address: 'Plano', cityZone: 'outside' }, contact });
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

test('Meta Pixel: off by default, on when an ID is saved in admin, bad IDs rejected', async () => {
  const s = await startServer();
  try {
    assert.ok(!(await s.get('/')).text.includes('pixel.js'), 'no pixel until an ID is set');
    const settings = (await s.admin('GET', '/api/admin/settings')).json;
    settings.business.metaPixelId = 'abc123';
    assert.equal((await s.admin('PUT', '/api/admin/settings', settings)).status, 400);
    settings.business.metaPixelId = '123456789012345';
    assert.equal((await s.admin('PUT', '/api/admin/settings', settings)).json.status, 'ok');
    for (const p of ['/', '/prices', '/thank-you']) {
      assert.match((await s.get(p)).text, /<script src="\/assets\/js\/pixel.js" data-pixel-id="123456789012345"><\/script>/, p);
    }
    const res = await fetch(`${s.base}/`);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self' https:\/\/connect\.facebook\.net/);
  } finally { await s.close(); }
});

test('admin Send test email reports success and the real reason for failures', async () => {
  const bad = await startServer({ mailer: { send: async () => { throw new Error('Invalid login: 535-5.7.8 Username and Password not accepted'); } } });
  try {
    const r = (await bad.admin('POST', '/api/admin/test-email', {})).json;
    assert.equal(r.status, 'error');
    assert.match(r.message, /535/);
    assert.match(r.message, /16-character app password/);
  } finally { await bad.close(); }
  const none = await startServer();
  try {
    assert.match((await none.admin('POST', '/api/admin/test-email', {})).json.message, /GMAIL_USER and GMAIL_APP_PASSWORD/);
    assert.equal((await none.post('/api/admin/test-email', {})).status, 401);
  } finally { await none.close(); }
  const sent = [];
  const good = await startServer({ mailer: { send: async (to, sub) => { sent.push({ to, sub }); return true; } } });
  try {
    const r = (await good.admin('POST', '/api/admin/test-email', {})).json;
    assert.equal(r.status, 'ok');
    assert.deepEqual(sent, [{ to: 'Helpcentre403@gmail.com', sub: 'Test email from your website' }]);
  } finally { await good.close(); }
});

test('address suggestion endpoint', async () => {
  const s = await startServer();
  try {
    const r = (await s.get('/api/address-suggest?q=2400%20kelly')).json;
    assert.equal(r.provider, 'photon');
    assert.equal(r.suggestions.length, 2);
    assert.deepEqual((await s.get('/api/address-suggest?q=ab')).json.suggestions, []);
  } finally { await s.close(); }
});

test('map service down: estimate still works from the Inside/Outside choice and the lead is flagged', async () => {
  const { createApp } = require('../server');
  const { tmpDir, pricedSettings: ps } = require('./helpers');
  const fs = require('fs');
  const path = require('path');
  const dataDir = tmpDir();
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(ps()));
  const app = createApp({ dataDir, adminPassword: 'p', ai: null, sms: null, mailer: null, now: () => new Date('2026-12-07T18:00:00Z'),
    distance: { measure: async () => { throw new Error('map service down'); } }, log: { error() {}, log() {} },
    addressSuggester: { provider: 'photon', suggest: async () => [] } });
  const server = await new Promise((r) => { const sv = app.listen(0, () => r(sv)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/estimate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'landscaping', answers: { area: 'front', size: 'small', date: '2026-12-12', time: '10:00', address: '123 Some Rd', cityZone: 'outside' }, contact }) });
    const j = await res.json();
    assert.equal(j.status, 'ok');
    assert.equal(j.estimate.totalDisplay, '$40');
    const leads = await (await fetch(`${base}/api/admin/leads`, { headers: { Authorization: `Basic ${Buffer.from('admin:p').toString('base64')}` } })).json();
    assert.equal(leads.leads[0].addressUnverified, true);
  } finally { await new Promise((r) => server.close(r)); }
});

test('Book This Date: customer gets a text + email receipt, owner email says whether the customer was texted', async () => {
  const texts = []; const mails = [];
  const sms = { send: async (to, body) => { texts.push({ to, body }); return true; } };
  const mailer = { send: async (to, subject, text) => { mails.push({ to, subject, text }); return true; } };
  const s = await startServer({ settings: pricedSettings(), sms, mailer });
  try {
    assert.equal((await s.get('/api/config')).json.autoText, true);
    const r = await s.post('/api/estimate', { service: 'landscaping', answers: { area: 'front', size: 'small', date: '2026-12-12', time: '10:00', address: '5 Elm St, Carrollton, TX', cityZone: 'inside' }, contact: { ...contact, email: 'pat@example.com', smsConsent: true } });
    assert.equal(r.json.smsConsent, true);
    await s.post(`/api/leads/${r.json.leadId}/book`, {});
    const cust = texts.find((t) => t.to === '2145550100');
    assert.ok(cust, 'customer texted');
    for (const part of ["you're booked", 'Landscaping, Sat, Dec 12 at 10:00 AM', '5 Elm St, Carrollton, TX', 'Estimate: $30', 'distance no fee', 'Call/text (469) 756-1984']) {
      assert.ok(cust.body.includes(part), `missing "${part}" in:\n${cust.body}`);
    }
    const custMail = mails.find((m) => m.to === 'pat@example.com');
    assert.match(custMail.subject, /Your booking with SAE Outdoor and Haul: Sat, Dec 12 at 10:00 AM/);
    assert.match(custMail.text, /Estimated total: \$30/);
    const owner = mails.find((m) => m.to === 'Helpcentre403@gmail.com');
    assert.match(owner.text, /The customer was texted their confirmation/);
    const lead = (await s.admin('GET', '/api/admin/leads')).json.leads[0];
    assert.equal(lead.customerTexted, true);
    assert.equal(lead.customerEmailed, true);
  } finally { await s.close(); }
});

test('Book This Date without a text service: owner email says to text the customer', async () => {
  const mails = [];
  const mailer = { send: async (to, subject, text) => { mails.push({ to, subject, text }); return true; } };
  const s = await startServer({ settings: pricedSettings(), mailer });
  try {
    assert.equal((await s.get('/api/config')).json.autoText, false);
    const r = await s.post('/api/estimate', { service: 'junk', answers: { whatToGo: 'old couch', load: 'half', locations: ['ground'], items: [], date: '2026-12-08', time: '18:00', address: '100 Main St, Plano, TX', cityZone: 'outside' }, contact: { ...contact, smsConsent: true } });
    await s.post(`/api/leads/${r.json.leadId}/book`, {});
    assert.equal(mails.length, 1, 'no customer email (none given), one owner email');
    assert.match(mails[0].text, />>> TEXT THIS CUSTOMER: they were NOT texted automatically .* Text \(214\) 555-0100 to confirm/);
  } finally { await s.close(); }
});

test('customers who did not check the text box are never texted; consent is recorded with time and wording', async () => {
  const texts = []; const mails = [];
  const sms = { send: async (to, body) => { texts.push({ to, body }); return true; } };
  const mailer = { send: async (to, subject, text) => { mails.push({ to, subject, text }); return true; } };
  const s = await startServer({ settings: pricedSettings(), sms, mailer });
  try {
    const r = await s.post('/api/estimate', { service: 'landscaping', answers: { area: 'front', size: 'small', date: '2026-12-12', time: '11:00', address: '5 Elm St, Carrollton, TX', cityZone: 'inside' }, contact });
    await s.post(`/api/leads/${r.json.leadId}/book`, {});
    assert.ok(!texts.some((t) => t.to === '2145550100'), 'no text without consent');
    assert.match(mails.find((m) => m.to === 'Helpcentre403@gmail.com').text, /did not check the box for automatic texts/);
    const r2 = await s.post('/api/estimate', { service: 'landscaping', answers: { area: 'front', size: 'small', date: '2026-12-12', time: '12:00', address: '5 Elm St, Carrollton, TX', cityZone: 'inside' }, contact: { ...contact, smsConsent: true } });
    const lead = (await s.admin('GET', '/api/admin/leads')).json.leads.find((l) => l.id === r2.json.leadId);
    assert.equal(lead.contact.smsConsent, true);
    assert.equal(lead.contact.smsConsentAt, '2026-12-07T18:00:00.000Z');
    assert.match(lead.contact.smsConsentText, /Message and data rates may apply/);
  } finally { await s.close(); }
});

test('Privacy Policy and Terms of Service contain the wording Twilio asks for', async () => {
  const s = await startServer();
  try {
    const privacy = (await s.get('/privacy')).text;
    assert.match(privacy, /<title>Privacy Policy \| SAE Outdoor and Haul<\/title>/);
    assert.match(privacy, /<h1>Privacy Policy<\/h1>/);
    assert.ok(privacy.includes('We do not sell or share your SMS opt-in data or personal information with third parties for marketing purposes.'));
    assert.ok(privacy.includes('SAE Outdoor and Haul'));
    const terms = (await s.get('/terms')).text;
    assert.match(terms, /<h1>Terms of Service<\/h1>/);
    assert.match(terms, /<h2 id="sms">SMS Terms<\/h2>/);
    assert.ok(terms.includes('Message and data rates may apply.'));
    assert.match(terms, /reply STOP/i);
    assert.match(terms, /HELP/);
    assert.ok(terms.includes('SAE Outdoor and Haul'));
    for (const page of [privacy, terms]) assert.ok(!/\[TODO/.test(page), 'no TODO placeholders on legal pages');
  } finally { await s.close(); }
});

test('admin Send test text: not set up, success, and Twilio errors explained', async () => {
  const none = await startServer();
  try {
    assert.match((await none.admin('POST', '/api/admin/test-text', {})).json.message, /TWILIO_ACCOUNT_SID/);
  } finally { await none.close(); }
  const sent = [];
  const good = await startServer({ sms: { send: async (to, body) => { sent.push({ to, body }); return true; } } });
  try {
    const r = (await good.admin('POST', '/api/admin/test-text', {})).json;
    assert.equal(r.status, 'ok');
    assert.equal(sent[0].to, '4697561984');
    assert.match(sent[0].body, /Reply STOP to opt out/);
  } finally { await good.close(); }
  const bad = await startServer({ sms: { send: async () => { throw new Error('Twilio HTTP 401 (Twilio error 20003: Authenticate)'); } } });
  try {
    assert.match((await bad.admin('POST', '/api/admin/test-text', {})).json.message, /Account SID or Auth Token is wrong/);
  } finally { await bad.close(); }
});

test('alerts go to several people: two phones and two emails', async () => {
  const { createApi } = require('../lib/api');
  const { defaultSettings } = require('../lib/defaults');
  let settings = defaultSettings(); const leads = [];
  const store = { getSettings: () => settings, saveSettings: (x) => { settings = x; }, listLeads: () => leads, getLead: (id) => leads.find((l) => l.id === id) || null,
    addLead: (l) => { const f = { id: 'L' + leads.length, status: 'new', ...l }; leads.push(f); return f; },
    updateLead: (id, p) => { const i = leads.findIndex((l) => l.id === id); leads[i] = { ...leads[i], ...p }; return leads[i]; } };
  const texts = []; const mails = [];
  const api = createApi({ store, now: () => new Date('2026-12-07T18:00:00Z'), log: { error() {}, log() {} },
    distance: { measure: async () => ({ miles: 3, city: 'Carrollton' }) },
    sms: { send: async (to, body) => { texts.push(to); return true; } },
    mailer: { send: async (to) => { mails.push(to); return true; } },
    notifyPhone: '4697561984, 4696864690', notifyEmail: 'owner@example.com, Helpcentre403@gmail.com', textEmail: '4697561984@tmomail.net' });
  const r = await api.estimate({ service: 'landscaping', answers: { area: 'front', size: 'small', date: '2026-12-12', time: '10:00', address: '5 Elm St, Carrollton', cityZone: 'inside' }, contact: { name: 'Pat', phone: '2145550100' } });
  await api.book(r.json.leadId);
  assert.deepEqual(texts.sort(), ['4696864690', '4697561984']);
  assert.deepEqual(mails.sort(), ['4697561984@tmomail.net', 'Helpcentre403@gmail.com', 'owner@example.com']);
  const t = (await api.testText()).json;
  assert.match(t.message, /4697561984, 4696864690/);
});

test('email given: estimate says so and thank-you page tells them to check their email', async () => {
  const s = await startServer({ settings: pricedSettings() });
  try {
    const r = await s.post('/api/estimate', { service: 'landscaping', answers: { area: 'front', size: 'small', date: '2026-12-12', time: '15:00', address: '5 Elm St, Carrollton', cityZone: 'inside' }, contact: { ...contact, email: 'pat@example.com' } });
    assert.equal(r.json.emailGiven, true);
    assert.match((await s.get('/thank-you?type=booked&email=1')).text, /Check your email<\/strong> for your booking confirmation/);
    assert.ok(!/Check your email/.test((await s.get('/thank-you?type=booked')).text));
  } finally { await s.close(); }
});
