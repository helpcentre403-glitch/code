'use strict';
/** Page rendering helpers, public config, and settings validation. No Node-only APIs, so the browser preview can reuse it. */
const cal = require('./calendar');
const pricing = require('./pricing');

const DISCLAIMER = 'This is an estimate. Our crew confirms the final price before work starts.';

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

/** Fill a page template. `read(file)` returns a template's text (fs on the server, a bundle in the preview). */
function renderTemplate(read, name, settings) {
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
      treePrice: Object.fromEntries(Object.entries(r.trees.treePrice).map(([k, v]) => [k, pricing.formatPrice(v)])),
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
      need(priceOk(r.trees.treePrice[size]), `Tree price for ${size} is invalid (low must be a number and high must be at least low).`);
      for (const svc of Object.keys(r.trees.services)) need(typeof r.trees.serviceFees[size][svc] === 'number', `Tree service fee ${size}/${svc} must be a number.`);
    }
  } catch (e) {
    problems.push(`Settings are missing a section (${e.message}).`);
  }
  return problems;
}

module.exports = { DISCLAIMER, esc, phoneDisplay, pageTokens, renderTemplate, publicConfig, decorate, validateSettings };
