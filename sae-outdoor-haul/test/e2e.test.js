'use strict';
/* Browser tests at phone size (390x844) using the pre-installed Playwright + Chromium. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer, pricedSettings } = require('./helpers');

let browser; let srv;
test.before(async () => {
  browser = await chromium.launch();
  srv = await startServer({ settings: pricedSettings() });
});
test.after(async () => { await browser.close(); await srv.close(); });

async function phone(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { ctx, page, errors };
}
async function noHorizontalScroll(page) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(w[0] <= w[1], `page scrolls sideways: ${w}`);
}
async function fillContact(section, name = 'Pat Test') {
  await section.locator('input[name="name"]').fill(name);
  await section.locator('input[name="phone"]').fill('214-555-0100');
}
const iso = (label) => `2026-12-${label.split(' ')[1].padStart(2, '0')}`; // 'Dec 12' -> '2026-12-12'
async function dayRow(section, dateLabel) {
  const row = section.locator(`.day-row[data-date="${iso(dateLabel)}"]`);
  if (!(await row.isVisible())) await section.locator('.show-more').click();
  return row;
}
async function slotsOn(section, dateLabel) {
  return (await dayRow(section, dateLabel)).locator('.slot').allInnerTexts();
}
async function pickSlot(section, dateLabel, timeLabel) {
  const row = await dayRow(section, dateLabel);
  await row.locator('.slot', { hasText: new RegExp(`^${timeLabel}$`) }).click();
  assert.match(await section.locator('.chosen-slot').innerText(), new RegExp(`${dateLabel}.*${timeLabel}`));
}

test('home page: order, FAQ accordion, tap-to-call/text, no sideways scroll', async () => {
  const { ctx, page, errors } = await phone();
  await page.goto(`${srv.base}/`);
  await noHorizontalScroll(page);
  assert.equal(await page.locator('h1').innerText(), 'SAE Outdoor and Haul: Junk Removal, Landscaping, and Christmas Trees');
  assert.equal(await page.locator('.card h3').allInnerTexts().then((x) => x.join('|')), 'Junk Removal|Landscaping|Christmas Trees');
  const faq = page.locator('.faq details').first();
  assert.equal(await faq.getAttribute('open'), null);
  await faq.locator('summary').click();
  assert.notEqual(await faq.getAttribute('open'), null);
  assert.equal(await page.locator('.faq details').count(), 10);
  assert.equal(await page.locator('#contact a[href="tel:+14696864690"]').count(), 1);
  assert.equal(await page.locator('#contact a[href="sms:+14696864690"]').count(), 1);
  await page.locator('.hero a', { hasText: 'Get a Quote' }).click();
  await page.waitForURL(/\/prices$/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('junk removal: full flow -> estimate breakdown -> Book This Date -> thank you', async () => {
  const { ctx, page, errors } = await phone();
  await page.goto(`${srv.base}/prices#junk`);
  await page.waitForSelector('body[data-ready="true"]');
  await noHorizontalScroll(page);
  const sec = page.locator('#junk');

  // Submitting empty asks for the missing answers
  await sec.locator('[data-submit]').click();
  await sec.locator('[data-error="whatToGo"]:not(:empty)').waitFor();
  assert.match(await sec.locator('[data-error="whatToGo"]').innerText(), /what needs to go/i);

  assert.equal(await sec.locator('.trailer-opt').count(), 6);
  // Times are visible for every listed day without tapping a date first
  const firstRow = sec.locator('.day-row').first();
  assert.ok(await firstRow.locator('.slot').first().isVisible());
  assert.equal(await sec.locator('.day-row:visible').count(), 7);
  assert.deepEqual(await firstRow.locator('.slot').allInnerTexts(), ['5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM']);
  await sec.locator('textarea[name="whatToGo"]').fill('Old sectional couch, mattress, 8 boxes');
  await sec.locator('.trailer-opt', { hasText: /^Full load/ }).click();
  await sec.locator('.toggle', { hasText: 'Elevated' }).click();
  await sec.locator('.toggle', { hasText: 'Long carry' }).click();
  await sec.locator('.item-row', { hasText: 'Mattress' }).locator('button[aria-label^="Add"]').click();
  await pickSlot(sec, 'Dec 12', '10:00 AM');
  await sec.locator('input[name="address"]').fill('500 Coit Rd, Plano, TX 75075');
  await fillContact(sec);
  await sec.locator('[data-submit]').click();

  const est = page.locator('[data-result="junk"] .estimate');
  await est.waitFor();
  // A single item was added, so it is priced instead of the full load:
  // mattress 75-110 + elevated 25-75 + long carry 30 + Plano $20
  assert.equal(await est.locator('.total').innerText(), '$150 to $235');
  assert.ok((await est.innerText()).includes('instead of the trailer load'));
  const text = await est.innerText();
  for (const s of ['Base price', 'Extras', 'Distance fee', 'This is an estimate. Our crew confirms the final price before work starts.']) assert.ok(text.includes(s), s);
  assert.ok(!text.includes('Same-day fee'));
  await est.getByRole('button', { name: 'Text Me This Quote' }).waitFor();
  await est.getByRole('button', { name: 'Book This Date' }).click();
  await page.waitForURL(/thank-you/);
  assert.match(await page.locator('h1').innerText(), /Got it\. We.ll text you to confirm\./);
  assert.equal(await page.locator('main a[href="tel:+14696864690"]').count(), 1);
  assert.equal(await page.locator('main a[href="sms:+14696864690"]').count(), 1);

  // The booked slot is gone for the next customer
  await page.goto(`${srv.base}/prices`);
  await page.waitForSelector('body[data-ready="true"]');
  const times = await slotsOn(page.locator('#junk'), 'Dec 12');
  assert.ok(!times.includes('10:00 AM'));
  assert.ok(times.includes('11:00 AM'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('landscaping: area -> size -> Carrollton is free -> Text Me This Quote', async () => {
  const { ctx, page, errors } = await phone();
  await page.goto(`${srv.base}/prices#landscaping`);
  await page.waitForSelector('body[data-ready="true"]');
  const sec = page.locator('#landscaping');
  await sec.locator('.chip', { hasText: 'Both' }).click();
  assert.equal(await sec.locator('.size-opt').count(), 3);
  await sec.locator('.size-opt', { hasText: 'Medium front and back' }).click();
  await pickSlot(sec, 'Dec 13', '2:00 PM');
  await sec.locator('input[name="address"]').fill('1 Main St, Carrollton, TX 75006');
  await fillContact(sec);
  await sec.locator('[data-submit]').click();
  const est = page.locator('[data-result="landscaping"] .estimate');
  await est.waitFor();
  assert.equal(await est.locator('.total').innerText(), '$55');
  assert.ok((await est.innerText()).includes('Carrollton address: no travel fee'));
  await est.getByRole('button', { name: 'Text Me This Quote' }).click();
  await page.waitForURL(/thank-you\?type=quote/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('christmas trees: slider starts at 0 (blocked), drag to 2, per-tree choices, total', async () => {
  const { ctx, page, errors } = await phone();
  await page.goto(`${srv.base}/prices#trees`);
  await page.waitForSelector('body[data-ready="true"]');
  const sec = page.locator('#trees');
  assert.equal(await sec.locator('[data-tree-count]').innerText(), '0');
  assert.match(await sec.locator('.callout').innerText(), /You pay for the tree too/);
  assert.equal(await sec.locator('[data-submit]').isDisabled(), true);

  // Drag the slider thumb most of the way right (0..3 -> lands on 2)
  await sec.locator('[data-tree-slider]').scrollIntoViewIfNeeded();
  const box = await sec.locator('[data-tree-slider]').boundingBox();
  await page.mouse.move(box.x + 6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.66, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  assert.equal(await sec.locator('[data-tree-count]').innerText(), '2');
  assert.equal(await sec.locator('.tree-card').count(), 2);
  assert.equal(await sec.locator('[data-submit]').isDisabled(), false);

  const cards = sec.locator('.tree-card');
  await cards.nth(0).locator('.chip', { hasText: 'Large' }).click();
  await cards.nth(0).locator('.chip', { hasText: 'Delivery and installation' }).click();
  await cards.nth(1).locator('.chip', { hasText: 'Small' }).click();
  await cards.nth(1).locator('.chip', { hasText: 'Delivery only' }).click();
  await pickSlot(sec, 'Dec 19', '6:00 PM');
  await sec.locator('input[name="address"]').fill('300 Belt Line Rd, Addison, TX');
  await fillContact(sec);
  await sec.locator('[data-submit]').click();
  const est = page.locator('[data-result="trees"] .estimate');
  await est.waitFor();
  // (100 + 115) + (60 + 35) + Addison 0-9 mi band $10
  assert.equal(await est.locator('.total').innerText(), '$320');

  // Back to 0 disables the button again
  await sec.locator('[data-tree-slider]').fill('0');
  assert.equal(await sec.locator('[data-submit]').isDisabled(), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('over 20 miles shows the contact-us message, not an estimate', async () => {
  const { ctx, page } = await phone();
  await page.goto(`${srv.base}/prices#landscaping`);
  await page.waitForSelector('body[data-ready="true"]');
  const sec = page.locator('#landscaping');
  await sec.locator('.chip', { hasText: 'Front yard' }).click();
  await sec.locator('.size-opt').first().click();
  await pickSlot(sec, 'Dec 20', '11:00 AM');
  await sec.locator('input[name="address"]').fill('1 Main St, FortWorth, TX');
  await fillContact(sec);
  await sec.locator('[data-submit]').click();
  const box = page.locator('[data-result="landscaping"] .estimate.notice');
  await box.waitFor();
  assert.match(await box.innerText(), /more than 20 driving miles[\s\S]*Contact us/);
  assert.equal(await box.locator('.total').count(), 0);
  await ctx.close();
});

test('admin: block a date and change hours, customer calendar updates right away', async () => {
  const { ctx, page, errors } = await phone({ httpCredentials: { username: 'admin', password: 'test-pass' } });
  await page.goto(`${srv.base}/admin`);
  await page.waitForSelector('body[data-ready="true"]');
  await noHorizontalScroll(page);
  assert.ok(await page.locator('.lead').count() >= 1, 'leads listed');

  // Block Tuesday Dec 15
  const day = page.locator('.cal-day', { hasText: 'Tue, Dec 15' });
  await day.getByRole('button', { name: 'Block whole day' }).click();
  await page.locator('.cal-day.blocked', { hasText: 'Tue, Dec 15' }).waitFor();

  // Block one slot on Wed Dec 16 (5 PM)
  await page.locator('.cal-day', { hasText: 'Wed, Dec 16' }).locator('.slot-status.open', { hasText: '5:00 PM' }).click();
  await page.locator('.cal-day', { hasText: 'Wed, Dec 16' }).locator('.slot-status.blocked', { hasText: '5:00 PM' }).waitFor();

  // Change Thursday hours to 6 PM - 9 PM and save
  const thu = page.locator('.hours-row[data-day="4"]');
  await thu.locator('input[type=time]').first().fill('18:00');
  await thu.locator('input[type=time]').first().dispatchEvent('change');
  await page.locator('#hours [data-save]').click();
  await page.locator('.admin-status.good').waitFor();

  const cust = await ctx.newPage();
  await cust.goto(`${srv.base}/prices`);
  await cust.waitForSelector('body[data-ready="true"]');
  const junk = cust.locator('#junk');
  await junk.locator('.show-more').click();
  assert.equal(await junk.locator('.day-row[data-date="2026-12-15"]').count(), 0, 'blocked date hidden');
  assert.deepEqual(await slotsOn(junk, 'Dec 16'), ['6:00 PM', '7:00 PM', '8:00 PM']);
  assert.deepEqual(await slotsOn(junk, 'Dec 17'), ['6:00 PM', '7:00 PM', '8:00 PM']);
  assert.match(await (await ctx.newPage()).goto(`${srv.base}/`).then((r) => r.text()), /Thursday:<\/strong> 6:00 PM to 9:00 PM/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('screenshots for review', async () => {
  const { ctx, page } = await phone({ deviceScaleFactor: 1 });
  const out = process.env.SCREENSHOT_DIR;
  if (!out) { await ctx.close(); return; }
  await page.goto(`${srv.base}/`); await page.screenshot({ path: `${out}/home.png`, fullPage: true });
  await page.goto(`${srv.base}/prices`); await page.waitForSelector('body[data-ready="true"]');
  await page.screenshot({ path: `${out}/prices.png`, fullPage: true });
  await ctx.close();
});
