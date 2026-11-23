'use strict';
/**
 * The site's API logic, independent of Express. Each handler returns { status, json }.
 * server.js wires these to HTTP routes; the browser preview calls them directly.
 */
const cal = require('./calendar');
const pricing = require('./pricing');
const { DistanceError } = require('./distance');
const { DISCLAIMER, phoneDisplay, publicConfig, decorate, validateSettings } = require('./pages');

const ok = (json) => ({ status: 200, json });
const fail = (status, json) => ({ status, json });

const SERVICE_NAMES = { junk: 'Junk removal', landscaping: 'Landscaping', trees: 'Christmas trees' };

/** One-line description of the job for the owner's booking text. */
function describeJob(lead, settings) {
  const a = lead.answers || {};
  const r = settings.rates;
  if (lead.service === 'junk') {
    const parts = [a.whatToGo];
    if (a.items && a.items.length) parts.push(`items: ${a.items.map((i) => `${r.junk.items[i.key] ? r.junk.items[i.key].label : i.key}${i.qty > 1 ? ` x${i.qty}` : ''}`).join(', ')}`);
    else if (a.load && r.junk.loads[a.load]) parts.push(r.junk.loads[a.load].label);
    if (a.cleanout && r.junk.cleanouts[a.cleanout]) parts.push(`${r.junk.cleanouts[a.cleanout].label} cleanout`);
    if (a.special) parts.push(`notes: ${a.special}`);
    return parts.filter(Boolean).join('; ');
  }
  if (lead.service === 'landscaping') {
    const opt = r.landscaping[a.area] && r.landscaping[a.area][a.size];
    return opt ? opt.label : `${a.area} ${a.size}`;
  }
  if (lead.service === 'trees') {
    return (a.trees || []).map((t, i) => `tree ${i + 1}: ${t.size}, ${r.trees.services[t.service] || t.service}`).join('; ');
  }
  return '';
}

function bookingText(lead, settings) {
  const b = lead.booking;
  const c = lead.contact || {};
  const phone = c.phone ? `(${c.phone.slice(0, 3)}) ${c.phone.slice(3, 6)}-${c.phone.slice(6)}` : 'no phone';
  return [
    `NEW BOOKING: ${SERVICE_NAMES[lead.service] || lead.service}`,
    `${cal.formatDate(b.date)} at ${cal.formatTime(b.time)}`,
    `${c.name || 'No name'}, ${phone}`,
    `Address: ${(lead.answers && lead.answers.address) || '-'}`,
    `Job: ${describeJob(lead, settings)}`,
    lead.estimate ? `Estimate: ${pricing.formatPrice(lead.estimate.total)}${lead.estimate.hasUnpriced ? ' + items to confirm' : ''}` : '',
    lead.zoneMismatch ? 'CHECK: customer\'s inside/outside choice does not match the map' : '',
  ].filter(Boolean).join('\n');
}

/** Full details for the owner's email: everything the crew needs before calling. */
function leadEmail(lead, settings, heading) {
  const c = lead.contact || {};
  const lines = [`CUSTOMER: ${c.name || '(no name)'}`, '', heading, '', bookingText(lead, settings)];
  if (c.email) lines.push(`Customer email: ${c.email}`);
  if (lead.estimate) {
    lines.push('', 'Estimate breakdown:');
    for (const s of lead.estimate.sections) {
      if (!s.lines.length) continue;
      lines.push(`  ${s.title}: ${pricing.formatPrice(s.subtotal)}`);
      for (const l of s.lines) lines.push(`    - ${l.label}: ${l.status === 'ok' ? pricing.formatPrice(l.price) : l.status === 'info' ? '' : 'to confirm'}`);
    }
    lines.push(`  Total: ${pricing.formatPrice(lead.estimate.total)}`);
  }
  lines.push('', 'All answers:', JSON.stringify({ ...lead.answers, contact: undefined }, null, 2));
  lines.push('', 'See every lead on your admin page (/admin).');
  return lines.join('\n');
}

function money0(p) { return pricing.formatPrice(p); }

/** Short text for the customer (fits in about two text messages). */
function customerText(lead, settings) {
  const b = lead.booking;
  const e = lead.estimate;
  const phone = settings.business.phone ? `(${settings.business.phone.slice(0, 3)}) ${settings.business.phone.slice(3, 6)}-${settings.business.phone.slice(6)}` : '';
  const base = e.sections.find((s) => s.title === 'Base price');
  const dist = e.sections.find((s) => s.title === 'Distance fee');
  const parts = [
    `${settings.business.name}: you're booked!`,
    `${SERVICE_NAMES[lead.service] || lead.service}, ${cal.formatDate(b.date)} at ${cal.formatTime(b.time)}`,
    `${(lead.answers && lead.answers.address) || ''}`,
    `Estimate: ${money0(e.total)}${e.hasUnpriced ? ' + items to confirm' : ''}`
      + (base ? ` (job ${money0(base.subtotal)}` : '')
      + (dist ? `, distance ${dist.lines.every((l) => l.free) ? 'no fee' : money0(dist.subtotal)})` : base ? ')' : ''),
    'Final price confirmed before work starts.',
    phone ? `Questions? Call/text ${phone}` : '',
    'Reply STOP to opt out.',
  ];
  return parts.filter(Boolean).join('\n');
}

/** Email receipt for the customer (if they gave an email). */
function customerEmail(lead, settings) {
  const e = lead.estimate;
  const lines = [customerText(lead, settings), '', 'Estimate details:'];
  for (const s of e.sections) {
    if (!s.lines.length) continue;
    lines.push(`  ${s.title}: ${s.lines.every((l) => l.free) ? 'No fee' : money0(s.subtotal)}`);
    for (const l of s.lines) if (l.status !== 'info') lines.push(`    - ${l.label}: ${l.free ? 'No fee' : l.status === 'ok' ? money0(l.price) : 'to be confirmed'}`);
  }
  lines.push(`  Estimated total: ${money0(e.total)}`, '', 'This is an estimate. Our crew confirms the final price before work starts.');
  return lines.join('\n');
}

function createApi({ store, distance, ai = null, sms = null, mailer = null, notifyEmail = null, textEmail = null, now = () => new Date(), log = console, defaults = null, notifyPhone = null }) {
  // Email the owner. Never blocks or breaks the customer's request if email fails.
  // Alerts can go to several people: comma-separated lists, e.g. "a@x.com, b@y.com" or "4695550100, 4695550101".
  const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
  const alertEmails = () => list(notifyEmail || store.getSettings().business.email);
  const alertPhones = () => list(notifyPhone || store.getSettings().business.phone);

  async function emailOwner(subject, body) {
    const to = alertEmails();
    if (!mailer || !to.length) return false;
    let any = false;
    for (const addr of to) {
      try {
        await mailer.send(addr, subject, body);
        if (log.log) log.log(`Owner email sent to ${addr}: ${subject}`);
        any = true;
      } catch (e) { log.error(`Owner email to ${addr} failed:`, e.message); }
    }
    return any;
  }

  const bookedKeys = () => new Set(
    store.listLeads().filter((l) => l.booking && l.booking.status === 'booked').map((l) => cal.slotKey(l.booking.date, l.booking.time)),
  );

  return {
    config: () => ok({ ...publicConfig(store.getSettings()), autoText: Boolean(sms) }),

    availability: () => ok({ days: cal.availability(store.getSettings().schedule, bookedKeys(), now()) }),

    async estimate(body) {
      body = body || {};
      const settings = store.getSettings();
      const service = String(body.service || '');
      const { errors, data } = pricing.validate(service, body, settings);
      if (errors.length) return ok({ status: 'needs_info', questions: errors });

      const schedule = settings.schedule;
      if (!cal.isSlotAvailable(schedule, bookedKeys(), data.date, data.time, now())) {
        return ok({ status: 'needs_info', questions: [{ field: 'date', message: 'That date and time is no longer available. Please pick another one.' }] });
      }
      const isSameDay = data.date === cal.nowInZone(schedule.timezone, now()).date;

      let dist;
      try {
        dist = await distance.measure(settings.business.baseAddress, data.address);
      } catch (e) {
        // Don't turn the customer away: price it from their Inside/Outside choice and let the crew check the address.
        log.error(`Distance not measured (${e instanceof DistanceError ? e.code : 'error'}: ${e.message}); using the customer's Inside/Outside choice.`);
        dist = { miles: null, city: null, unverified: true };
      }
      // Inside/outside the free city: the map's city wins when it has one (owner's rule); otherwise the
      // customer's "Inside / Outside of Carrollton" choice decides. A disagreement is flagged for the crew.
      // Letters are compared with doubles squeezed out, so "Carrolton" still matches "Carrollton".
      const squeeze = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/([a-z])\1+/g, '$1').trim();
      const freeCity = settings.business.freeCities.find((c) => dist.city && squeeze(dist.city) === squeeze(c));
      const choseInside = data.cityZone === 'inside';
      const free = dist.city ? Boolean(freeCity) : choseInside;
      const zoneMismatch = Boolean(dist.city) && free !== choseInside;
      const cityName = settings.business.freeCities[0] || 'the city';
      const distanceInfo = {
        miles: typeof dist.miles === 'number' ? Math.round(dist.miles * 10) / 10 : null,
        city: free ? (freeCity || cityName) : dist.city, free, formattedAddress: dist.formattedAddress,
        customerChose: data.cityZone, zoneMismatch, unverified: Boolean(dist.unverified), approximate: Boolean(dist.approximate),
      };

      const estimate = pricing.computeEstimate(data, settings, distanceInfo, { isSameDay });
      if (distanceInfo.unverified && !estimate.outOfArea) {
        estimate.notes.unshift("We couldn't check this address on the map, so the distance fee is based on your Inside/Outside choice. Our crew will confirm the address before your visit.");
      }
      if (zoneMismatch && !estimate.outOfArea) {
        estimate.notes.unshift(free
          ? `You picked outside of ${cityName}, but the map places this address in ${cityName}, so there is no distance fee. Our crew will double-check.`
          : `You picked inside of ${cityName}, but the map places this address in ${dist.city}, so the outside fee applies. Our crew will double-check.`);
      }
      if (estimate.outOfArea) {
        store.addLead({ service, answers: data, contact: data.contact, distance: distanceInfo, status: 'out_of_area' });
        return ok({
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
        if (aiQuestions.length && body.aiAcknowledged !== true) {
          return ok({ status: 'needs_info', aiQuestions: true, questions: aiQuestions.map((message) => ({ field: 'ai', message })) });
        }
      }
      summary = summary || pricing.templateSummary(data, estimate, settings);

      if (data.contact.smsConsent) {
        data.contact.smsConsentAt = now().toISOString();
        data.contact.smsConsentText = 'Text me my booking confirmation, estimate receipt, and appointment updates. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help. Not required to book.';
      }
      const lead = store.addLead({
        service, answers: data, contact: data.contact, distance: distanceInfo, sameDay: isSameDay, zoneMismatch,
        addressUnverified: distanceInfo.unverified,
        estimate, summary, aiQuestions, booking: { date: data.date, time: data.time, status: 'requested' },
      });
      return ok({ status: 'ok', leadId: lead.id, smsConsent: data.contact.smsConsent, emailGiven: Boolean(data.contact.email), estimate: decorate(estimate), summary, disclaimer: DISCLAIMER, date: data.date, time: data.time, dateLabel: `${cal.formatDate(data.date)}, ${cal.formatTime(data.time)}` });
    },

    async textQuote(id) {
      const lead = store.getLead(id);
      if (!lead || !lead.estimate) return fail(404, { status: 'error', message: 'Quote not found.' });
      const settings = store.getSettings();
      const text = `${settings.business.name} estimate: ${pricing.formatPrice(lead.estimate.total)}. ${lead.summary} ${DISCLAIMER} Reply here or call ${phoneDisplay(settings.business.phone) || ''}.`;
      let sent = false;
      if (sms) {
        try { sent = await sms.send(lead.contact.phone, text.slice(0, 1500)); } catch (e) { log.error('SMS failed:', e.message); }
      }
      store.updateLead(lead.id, { textRequested: true, textSent: sent });
      return ok({ status: 'ok', sent });
    },

    async book(id) {
      const lead = store.getLead(id);
      if (!lead || !lead.booking) return fail(404, { status: 'error', message: 'Quote not found.' });
      if (lead.booking.status === 'booked') return ok({ status: 'ok' });
      const { date, time } = lead.booking;
      if (!cal.isSlotAvailable(store.getSettings().schedule, bookedKeys(), date, time, now())) {
        return fail(409, { status: 'error', message: 'Sorry, that time was just taken. Please pick another time and generate a new estimate, or call or text us.' });
      }
      store.updateLead(lead.id, { booking: { ...lead.booking, status: 'booked', bookedAt: now().toISOString() }, status: 'booked' });
      // Text the owner who booked, when, and what the job is.
      let ownerTexted = false;
      if (sms) {
        for (const ownerPhone of alertPhones()) {
          try {
            await sms.send(ownerPhone, bookingText(lead, store.getSettings()).slice(0, 1500));
            ownerTexted = true;
          } catch (e) { log.error(`Owner booking text to ${ownerPhone} failed:`, e.message); }
        }
      }
      const booked = store.getLead(lead.id);
      const s2 = store.getSettings();
      // Confirm to the customer right away: text (needs a text service), and email if they gave one.
      let customerTexted = false;
      let customerEmailed = false;
      if (sms && booked.contact.phone && booked.contact.smsConsent) {
        try { customerTexted = await sms.send(booked.contact.phone, customerText(booked, s2).slice(0, 600)); } catch (e) { log.error('Customer confirmation text failed:', e.message); }
      }
      if (mailer && booked.contact.email) {
        try {
          customerEmailed = await mailer.send(booked.contact.email, `Your booking with ${s2.business.name}: ${cal.formatDate(booked.booking.date)} at ${cal.formatTime(booked.booking.time)}`, customerEmail(booked, s2));
        } catch (e) { log.error('Customer confirmation email failed:', e.message); }
      }
      const p = booked.contact.phone || '';
      const customerPhone = p.length === 10 ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : p;
      let status;
      if (customerTexted) status = 'The customer was texted their confirmation and estimate.';
      else if (!booked.contact.smsConsent) status = `>>> CONFIRM WITH THIS CUSTOMER: they did not check the box for automatic texts. Call or text ${customerPhone} to confirm. <<<${customerEmailed ? ' (They were emailed a copy.)' : ''}`;
      else status = `>>> TEXT THIS CUSTOMER: they were NOT texted automatically (${sms ? 'the text failed' : 'no text service is set up'}). Text ${customerPhone} to confirm. <<<${customerEmailed ? ' (They were emailed a copy.)' : ''}`;
      const ownerEmailed = await emailOwner(
        `New booking: ${lead.contact.name} - ${SERVICE_NAMES[lead.service] || lead.service}, ${cal.formatDate(lead.booking.date)} at ${cal.formatTime(lead.booking.time)}`,
        leadEmail(booked, s2, `A customer just booked on your website.\n${status}`),
      );
      // Optional free "text" alert through the carrier's email-to-text address (e.g. 4697561984@tmomail.net).
      // Short, because carriers cut long messages. Only works if the carrier still runs that service.
      let ownerTextEmailed = false;
      if (mailer && textEmail) {
        try {
          const b = lead.booking;
          const short = [`${SERVICE_NAMES[lead.service] || lead.service}`, `${cal.formatDate(b.date)} ${cal.formatTime(b.time)}`,
            `${lead.contact.name} ${lead.contact.phone}`, (lead.answers && lead.answers.address) || ''].join(' | ');
          for (const addr of list(textEmail)) {
            try { await mailer.send(addr, 'New booking', short.slice(0, 150)); ownerTextEmailed = true; } catch (e) { log.error(`Email-to-text alert to ${addr} failed:`, e.message); }
          }
        } catch (e) { log.error('Email-to-text alert failed:', e.message); }
      }
      store.updateLead(lead.id, { ownerTexted, ownerEmailed, ownerTextEmailed, customerTexted, customerEmailed });
      return ok({ status: 'ok' });
    },

    // ---------- Admin ----------
    getSettings: () => ok(store.getSettings()),

    /** Admin "Send test text": texts the business phone and reports Twilio's exact error. */
    async testText() {
      const phones = alertPhones();
      const to = phones.join(', ');
      if (!sms) return ok({ status: 'error', message: 'Texting is not set up on the server. On Render, add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID (or TWILIO_FROM) under Environment, then save.' });
      try {
        for (const p of phones) await sms.send(p, `${store.getSettings().business.name}: test text from your website. Booking texts are working. Reply STOP to opt out.`);
        return ok({ status: 'ok', message: `Twilio accepted the text to ${to}. If it doesn't arrive within a few minutes, check the message log in Twilio for error 30034 (A2P registration not approved yet).` });
      } catch (e) {
        const raw = String(e && e.message || e);
        let hint = '';
        if (/20003|401/.test(raw)) hint = ' The Account SID or Auth Token is wrong.';
        else if (/21606|21659|21212/.test(raw)) hint = ' TWILIO_FROM is not a Twilio number on this account. Use your Twilio number or the Messaging Service SID.';
        else if (/21608/.test(raw)) hint = ' Trial accounts can only text verified numbers.';
        return ok({ status: 'error', message: `Text failed: ${raw.slice(0, 300)}.${hint}` });
      }
    },

    /** Admin "Send test email": reports exactly why email is not working. */
    async testEmail() {
      const to = alertEmails().join(', ');
      if (!mailer) {
        return ok({ status: 'error', message: 'Email is not set up on the server. On Render, add GMAIL_USER and GMAIL_APP_PASSWORD under Environment, then save.' });
      }
      if (!to) return ok({ status: 'error', message: 'No business email is set. Add one under Business details.' });
      try {
        for (const addr of alertEmails()) await mailer.send(addr, 'Test email from your website', `This is a test from your SAE Outdoor and Haul website.\nIf you can read this, booking emails will reach ${to}.`);
        return ok({ status: 'ok', message: `Sent to ${to}. Check Inbox, Spam, and Sent (Gmail sometimes files emails you send to yourself under Sent).` });
      } catch (e) {
        const raw = String(e && e.message || e);
        let hint = '';
        if (/535|Username and Password not accepted|Invalid login|BadCredentials/i.test(raw)) hint = 'Gmail rejected the login. GMAIL_APP_PASSWORD must be the 16-character app password (not your normal password), and GMAIL_USER must be the same Gmail address.';
        else if (/ETIMEDOUT|ECONNREFUSED|ENETUNREACH|timeout/i.test(raw)) hint = 'The server could not reach Gmail. Check that the Render service is on a paid plan (free plans block email).';
        return ok({ status: 'error', message: `Sending failed: ${raw.slice(0, 300)}${hint ? ` ${hint}` : ''}` });
      }
    },

    putSettings(body) {
      const problems = validateSettings(body);
      if (problems.length) return fail(400, { status: 'error', problems });
      store.saveSettings(body);
      return ok({ status: 'ok', settings: store.getSettings() });
    },

    defaults: () => ok(defaults ? defaults() : null),

    calendar(query = {}) {
      const s = store.getSettings().schedule;
      const booked = bookedKeys();
      const days = Math.max(1, Math.min(120, Number(query.days) || s.bookingWindowDays));
      const start = cal.nowInZone(s.timezone, now()).date;
      const out = Array.from({ length: days }, (_, i) => cal.addDays(start, i)).map((date) => ({
        date, label: cal.formatDate(date), holiday: s.holidays.includes(date), blocked: s.blockedDates.includes(date),
        special: (s.specialHours || []).find((x) => x.date === date) || null,
        slots: cal.daySlotStatus(s, date, booked, now()),
      }));
      return ok({ days: out });
    },

    calendarAction(body) {
      const { action, date, time } = body || {};
      if (!cal.isDate(date) || (time !== undefined && !cal.isTime(time))) return fail(400, { status: 'error', message: 'Bad date or time.' });
      const settings = structuredClone(store.getSettings());
      const s = settings.schedule;
      const without = (list) => list.filter((x) => !(x.date === date && x.time === time));
      switch (action) {
        case 'blockDate': if (!s.blockedDates.includes(date)) s.blockedDates.push(date); break;
        case 'unblockDate': s.blockedDates = s.blockedDates.filter((d) => d !== date); break;
        case 'blockSlot':
          if (!time) return fail(400, { status: 'error', message: 'Time required.' });
          s.openedSlots = without(s.openedSlots);
          if (cal.regularSlots(s, date).includes(time) && !s.blockedSlots.some((x) => x.date === date && x.time === time)) s.blockedSlots.push({ date, time });
          break;
        case 'openSlot':
          if (!time) return fail(400, { status: 'error', message: 'Time required.' });
          s.blockedSlots = without(s.blockedSlots);
          if (!cal.regularSlots(s, date).includes(time) || s.blockedDates.includes(date)) {
            if (!s.openedSlots.some((x) => x.date === date && x.time === time)) s.openedSlots.push({ date, time });
          }
          break;
        case 'setSpecialHours': {
          const { open, close } = body;
          if (!cal.isTime(open) || !cal.isTime(close) || open >= close) return fail(400, { status: 'error', message: 'Special hours need open before close.' });
          s.specialHours = (s.specialHours || []).filter((x) => x.date !== date).concat({ date, open, close }).sort((x, y) => x.date.localeCompare(y.date));
          break;
        }
        case 'clearSpecialHours': s.specialHours = (s.specialHours || []).filter((x) => x.date !== date); break;
        case 'addHoliday': if (!s.holidays.includes(date)) s.holidays.push(date); s.holidays.sort(); break;
        case 'removeHoliday': s.holidays = s.holidays.filter((d) => d !== date); break;
        default: return fail(400, { status: 'error', message: 'Unknown action.' });
      }
      store.saveSettings(settings);
      return ok({ status: 'ok' });
    },

    leads: () => ok({ leads: [...store.listLeads()].reverse() }),

    patchLead(id, body) {
      body = body || {};
      const allowed = ['new', 'contacted', 'booked', 'done', 'lost', 'out_of_area', 'needs_follow_up'];
      const patch = {};
      if (body.status !== undefined) {
        if (!allowed.includes(body.status)) return fail(400, { status: 'error', message: 'Bad status.' });
        patch.status = body.status;
      }
      if (typeof body.crewNotes === 'string') patch.crewNotes = body.crewNotes.slice(0, 2000);
      if (body.cancelBooking === true) {
        const lead = store.getLead(id);
        if (lead && lead.booking) patch.booking = { ...lead.booking, status: 'cancelled' };
      }
      const lead = store.updateLead(id, patch);
      if (!lead) return fail(404, { status: 'error', message: 'Not found.' });
      return ok({ status: 'ok', lead });
    },
  };
}

module.exports = { createApi, bookingText, describeJob, leadEmail, customerText, customerEmail };
