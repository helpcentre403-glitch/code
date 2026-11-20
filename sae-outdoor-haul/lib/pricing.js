'use strict';
/**
 * Validation + estimate math. Pure functions: every number comes from the rates table.
 * Nothing here (or in the AI step) is allowed to invent a price. A rate the owner has not
 * set yet (null) is shown as "To be confirmed" and left out of the total.
 */

const money = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

function formatPrice(price) {
  if (!price || price.min == null) return 'To be confirmed';
  const plus = price.plus ? '+' : '';
  if (price.max == null || price.max === price.min) return `${money(price.min)}${plus}`;
  return `${money(price.min)} to ${money(price.max)}${plus}`;
}

const isSet = (price) => price && typeof price.min === 'number' && typeof price.max === 'number';
const fixed = (n) => (typeof n === 'number' ? { min: n, max: n, plus: false } : null);
const times = (price, qty) => (isSet(price) ? { min: price.min * qty, max: price.max * qty, plus: price.plus } : price);

const UNCLEAR_WORDS = new Set(['stuff', 'junk', 'things', 'thing', 'misc', 'miscellaneous', 'idk', 'n/a', 'na', 'none', 'trash', 'everything', 'various', 'items', 'test', 'asdf', '?', '-', '.']);
const SPECIAL_RE = /\b(tires?|paint|chemicals?|propane|batter(y|ies)|motor oil|oil drums?|solvents?|pesticides?|hazardous)\b/i;
const HEAVY_RE = /\b(concrete|dirt|soil|roofing|shingles?|bricks?|rocks?|gravel|pavers?|sand)\b/i;
const PHONE_RE = /^\+?1?\D*(\d{3})\D*(\d{3})\D*(\d{4})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const has = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);

function normalizePhone(raw) {
  const m = PHONE_RE.exec(str(raw, 40));
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

/** Validates the shared fields + service-specific answers. Returns { errors, data }. */
function validate(service, body, settings) {
  const rates = settings.rates;
  const errors = [];
  const ask = (field, message) => errors.push({ field, message });
  const a = (body && body.answers) || {};
  const c = (body && body.contact) || {};
  const data = { service };

  // Service-specific
  if (service === 'junk') {
    const j = rates.junk;
    data.whatToGo = str(a.whatToGo, 1000);
    if (!data.whatToGo) ask('whatToGo', 'Tell us what needs to go.');
    else if (data.whatToGo.length < 3 || UNCLEAR_WORDS.has(data.whatToGo.toLowerCase())) {
      ask('whatToGo', 'Please list the main items that need to go (for example: "old couch, 6 boxes, a treadmill").');
    }
    data.load = a.load ? str(a.load, 40) : null;
    if (data.load && !has(j.loads, data.load)) ask('load', 'Please choose a trailer load from the picture.');
    data.items = [];
    for (const it of Array.isArray(a.items) ? a.items.slice(0, 20) : []) {
      const key = str(it && it.key, 40);
      const qty = Math.floor(Number(it && it.qty) || 1);
      if (!has(j.items, key)) { ask('items', 'One of the items you added is not on our list. Please remove it and add it again.'); continue; }
      if (qty < 1 || qty > 20) { ask('items', 'Item quantities must be between 1 and 20.'); continue; }
      const existing = data.items.find((x) => x.key === key);
      if (existing) existing.qty = Math.min(20, existing.qty + qty); else data.items.push({ key, qty });
    }
    data.cleanout = a.cleanout ? str(a.cleanout, 40) : null;
    if (data.cleanout && !has(j.cleanouts, data.cleanout)) ask('cleanout', 'Please choose a cleanout type from the list.');
    if (!data.load && data.items.length === 0 && !data.cleanout) {
      ask('load', 'Choose how much (a trailer load), or add single items or a cleanout type.');
    }
    const allowedLoc = ['ground', 'outdoors', 'elevated', 'longCarry', 'garageShed'];
    data.locations = [...new Set((Array.isArray(a.locations) ? a.locations : []).filter((x) => allowedLoc.includes(x)))];
    if (data.locations.length === 0) ask('locations', 'Tell us where the items are (choose all that apply).');
    data.special = str(a.special, 1000);
    data.heavyLifting = a.heavyLifting === true;
    data.disassembly = a.disassembly === true;
  } else if (service === 'landscaping') {
    data.area = str(a.area, 10);
    data.size = str(a.size, 10);
    if (!['front', 'back', 'both'].includes(data.area)) ask('area', 'Choose which area: front yard, back yard, or both.');
    if (!['small', 'medium', 'large'].includes(data.size)) ask('size', 'Choose the lawn size that matches your yard.');
  } else if (service === 'trees') {
    const t = rates.trees;
    const count = Number(a.count);
    data.trees = [];
    if (!Number.isInteger(count) || count < 1) ask('count', 'Choose at least 1 tree.');
    else if (count > t.maxTrees) ask('count', `Online estimates cover up to ${t.maxTrees} trees. Contact us for more.`);
    else {
      const list = Array.isArray(a.trees) ? a.trees : [];
      for (let i = 0; i < count; i += 1) {
        const tr = list[i] || {};
        const size = str(tr.size, 10);
        const svc = str(tr.service, 20);
        if (!has(t.sizes, size)) ask(`trees.${i}.size`, `Choose a size for tree ${i + 1}.`);
        if (!has(t.services, svc)) ask(`trees.${i}.service`, `Choose a service for tree ${i + 1}.`);
        data.trees.push({ size, service: svc });
      }
    }
  } else {
    ask('service', 'Unknown service.');
  }

  // Shared fields
  data.date = str(a.date, 10);
  data.time = str(a.time, 5);
  if (!data.date || !data.time) ask('date', 'Pick a date and time on the calendar.');
  data.address = str(a.address, 300);
  if (data.address.length < 5) ask('address', 'Enter the service address (street, city, and ZIP) so we can measure the driving distance.');
  data.cityZone = str(a.cityZone, 10);
  if (!['inside', 'outside'].includes(data.cityZone)) {
    ask('cityZone', `Tell us whether the address is inside or outside ${settings.business.freeCities[0] || 'the city'}.`);
  }

  data.contact = { name: str(c.name, 100), phone: normalizePhone(c.phone), email: str(c.email, 200) || null };
  if (!data.contact.name) ask('contact.name', 'Enter your name.');
  if (!data.contact.phone) ask('contact.phone', 'Enter a 10-digit mobile number so we can text you.');
  if (data.contact.email && !EMAIL_RE.test(data.contact.email)) ask('contact.email', 'That email address does not look right. Fix it or leave it blank.');

  return { errors, data };
}

/** Distance band lookup. Returns { outOfArea, line } */
function distanceLine(rates, distance) {
  const d = rates.distance;
  if (distance.free) {
    return { outOfArea: false, line: { label: `${distance.city || 'Carrollton'} address: no distance fee`, price: fixed(0), status: 'ok', free: true } };
  }
  if (distance.unverified || typeof distance.miles !== 'number') {
    const first = [...d.bands].sort((x, y) => x.maxMiles - y.maxMiles)[0];
    const price = first ? fixed(first.fee) : null;
    return { outOfArea: false, line: { label: `${first ? first.label : 'Distance'} (address to be confirmed)`, price, status: price ? 'ok' : 'tbd' } };
  }
  const rounded = Math.round(distance.miles);
  if (rounded > d.maxServiceMiles) return { outOfArea: true };
  const band = [...d.bands].sort((x, y) => x.maxMiles - y.maxMiles).find((b) => rounded <= b.maxMiles);
  if (!band) return { outOfArea: true };
  const price = fixed(band.fee);
  return {
    outOfArea: false,
    line: { label: d.bands.length === 1 ? band.label : `${band.label} (about ${rounded} mi)`, price, status: price ? 'ok' : 'tbd' },
  };
}

function section(title, lines, subtotalOverride) {
  let min = 0; let max = 0; let plus = false;
  for (const l of lines) {
    if (l.status === 'ok' && isSet(l.price)) { min += l.price.min; max += l.price.max; plus = plus || l.price.plus; }
  }
  const subtotal = subtotalOverride || { min, max, plus };
  return { title, lines, subtotal };
}

/**
 * Build the estimate. `distance` = { miles, city, free }. `isSameDay` from the calendar.
 * Returns { outOfArea } or { sections, total, notes, hasUnpriced }.
 */
function computeEstimate(data, settings, distance, { isSameDay = false } = {}) {
  const rates = settings.rates;
  const dist = distanceLine(rates, distance);
  if (dist.outOfArea) return { outOfArea: true };

  const line = (label, price, status) => ({ label, price, status: status || (isSet(price) ? 'ok' : 'tbd') });
  const sections = [];
  const notes = [];

  if (data.service === 'junk') {
    const j = rates.junk;
    const baseLines = [];
    // Owner rule: the trailer load is used only when no single items or cleanout are chosen.
    if (data.items.length || data.cleanout) {
      for (const it of data.items) {
        const item = j.items[it.key];
        baseLines.push(line(`${item.label}${it.qty > 1 ? ` x ${it.qty}` : ''}`, times(item.price, it.qty)));
      }
      if (data.cleanout) baseLines.push(line(`Cleanout: ${j.cleanouts[data.cleanout].label}`, j.cleanouts[data.cleanout].price));
      if (data.load) notes.push('You added single items or a cleanout, so the base price uses those instead of the trailer load. Your load choice is saved for the crew.');
    } else {
      baseLines.push(line(`Trailer: ${j.loads[data.load].label}`, j.loads[data.load].price));
    }
    sections.push(section('Base price', baseLines));

    const ex = j.extras;
    const extraLines = [];
    if (data.locations.includes('elevated')) extraLines.push(line(ex.stairs.label, ex.stairs.price));
    if (data.locations.includes('longCarry')) extraLines.push(line(ex.longCarry.label, ex.longCarry.price));
    if (data.heavyLifting) extraLines.push(line(ex.heavyLifting.label, ex.heavyLifting.price));
    if (data.disassembly) extraLines.push(line(ex.disassembly.label, ex.disassembly.price));
    const text = `${data.whatToGo} ${data.special}`;
    if (SPECIAL_RE.test(text)) extraLines.push({ label: j.notes.specialDisposal, price: null, status: 'confirm' });
    if (HEAVY_RE.test(text) || data.items.some((i) => i.key === 'constructionDebris')) {
      extraLines.push({ label: j.notes.heavyMaterials, price: null, status: 'confirm' });
    }
    sections.push(section('Extras', extraLines));
  } else if (data.service === 'landscaping') {
    const opt = rates.landscaping[data.area][data.size];
    sections.push(section('Base price', [line(`Lawn visit: ${opt.label}`, opt.price)]));
    sections.push(section('Extras', []));
  } else if (data.service === 'trees') {
    const t = rates.trees;
    const lines = [];
    data.trees.forEach((tr, i) => {
      // Tree price is an estimate (e.g. "$60+"); the crew confirms the exact price.
      lines.push(line(`Tree ${i + 1}: ${t.sizes[tr.size].label} tree (estimated price, we'll tell you the exact cost)`, t.treePrice[tr.size]));
      lines.push(line(`Tree ${i + 1}: ${t.services[tr.service]} fee`, fixed(t.serviceFees[tr.size][tr.service])));
    });
    sections.push(section('Base price', lines));
    sections.push(section('Extras', []));
  }

  sections.push(section('Distance fee', [dist.line]));

  if (data.service === 'junk' && isSameDay) {
    sections.push(section('Same-day fee', [line(rates.junk.extras.sameDay.label, rates.junk.extras.sameDay.price)]));
  }

  const sum = () => sections.reduce(
    (acc, s) => ({ min: acc.min + s.subtotal.min, max: acc.max + s.subtotal.max, plus: acc.plus || s.subtotal.plus }),
    { min: 0, max: 0, plus: false },
  );
  let total = sum();
  // Junk: every job has a minimum charge (whole job). Raise the base so the total meets it.
  const minC = data.service === 'junk' ? rates.junk.minimumCharge : null;
  if (typeof minC === 'number' && (total.min < minC || total.max < minC)) {
    const base = sections[0];
    base.subtotal = {
      min: base.subtotal.min + Math.max(0, minC - total.min),
      max: base.subtotal.max + Math.max(0, minC - total.max),
      plus: base.subtotal.plus,
    };
    base.lines.push({ label: `${money(minC)} minimum per junk job applied`, price: null, status: 'info' });
    total = sum();
  }
  const hasUnpriced = sections.some((s) => s.lines.some((l) => l.status === 'tbd' || l.status === 'confirm'));
  if (hasUnpriced) notes.push('Lines marked "To be confirmed" or "We\'ll confirm" are not included in the range above. Our crew will confirm them with you.');

  return { outOfArea: false, sections, total, notes, hasUnpriced };
}

/** Every dollar figure that legitimately appears in an estimate (used to police the AI summary). */
function allowedAmounts(estimate) {
  const set = new Set();
  const add = (p) => { if (p && typeof p.min === 'number') { set.add(p.min); set.add(p.max); } };
  for (const s of estimate.sections) { add(s.subtotal); s.lines.forEach((l) => add(l.price)); }
  add(estimate.total);
  return set;
}

function templateSummary(data, estimate, settings) {
  const svc = { junk: 'junk removal', landscaping: 'lawn service', trees: 'Christmas tree service' }[data.service];
  let s = `Your ${svc} estimate is ${formatPrice(estimate.total)}`;
  if (estimate.hasUnpriced) s += ', plus any items marked to be confirmed';
  s += '.';
  if (data.service === 'trees') s += ` That covers ${data.trees.length} tree${data.trees.length > 1 ? 's' : ''}: the price of each tree plus our service fee. Tree prices are estimates; we'll let you know exactly how much each tree costs.`;
  return `${s} ${settings.business.name} will confirm the final price before work starts.`;
}

module.exports = {
  validate, computeEstimate, distanceLine, formatPrice, money, allowedAmounts, templateSummary, normalizePhone, isSet,
};
