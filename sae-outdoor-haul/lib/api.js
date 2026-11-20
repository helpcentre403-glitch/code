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
  const lines = [heading, '', bookingText(lead, settings)];
  const c = lead.contact || {};
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

function createApi({ store, distance, ai = null, sms = null, mailer = null, notifyEmail = null, textEmail = null, now = () => new Date(), log = console, defaults = null, notifyPhone = null }) {
  // Email the owner. Never blocks or breaks the customer's request if email fails.
  async function emailOwner(subject, body) {
    const to = notifyEmail || store.getSettings().business.email;
    if (!mailer || !to) return false;
    try {
      const okSent = await mailer.send(to, subject, body);
      if (log.log) log.log(`Owner email sent to ${to}: ${subject}`);
      return okSent;
    } catch (e) { log.error('Owner email failed:', e.message); return false; }
  }

  const bookedKeys = () => new Set(
    store.listLeads().filter((l) => l.booking && l.booking.status === 'booked').map((l) => cal.slotKey(l.booking.date, l.booking.time)),
  );

  return {
    config: () => ok(publicConfig(store.getSettings())),

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
        if (e instanceof DistanceError && e.code === 'not_found') {
          return ok({ status: 'needs_info', questions: [{ field: 'address', message: "We couldn't find that address. Check the street, city, and ZIP code." }] });
        }
        log.error('distance lookup failed:', e.message);
        const lead = store.addLead({ service, answers: data, contact: data.contact, status: 'needs_follow_up', problem: 'Distance lookup failed' });
        return ok({
          status: 'distance_unavailable', leadId: lead.id,
          message: "We couldn't measure the driving distance right now. We saved your request and will text you, or you can call or text us.",
        });
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
        miles: Math.round(dist.miles * 10) / 10, city: free ? (freeCity || cityName) : dist.city, free, formattedAddress: dist.formattedAddress,
        customerChose: data.cityZone, zoneMismatch,
      };

      const estimate = pricing.computeEstimate(data, settings, distanceInfo, { isSameDay });
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

      const lead = store.addLead({
        service, answers: data, contact: data.contact, distance: distanceInfo, sameDay: isSameDay, zoneMismatch,
        estimate, summary, aiQuestions, booking: { date: data.date, time: data.time, status: 'requested' },
      });
      return ok({ status: 'ok', leadId: lead.id, estimate: decorate(estimate), summary, disclaimer: DISCLAIMER, date: data.date, time: data.time, dateLabel: `${cal.formatDate(data.date)}, ${cal.formatTime(data.time)}` });
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
      const ownerPhone = notifyPhone || store.getSettings().business.phone;
      let ownerTexted = false;
      if (sms && ownerPhone) {
        try {
          ownerTexted = await sms.send(ownerPhone, bookingText(lead, store.getSettings()).slice(0, 1500));
        } catch (e) { log.error('Owner booking text failed:', e.message); }
      }
      const booked = store.getLead(lead.id);
      const ownerEmailed = await emailOwner(
        `New booking: ${SERVICE_NAMES[lead.service] || lead.service}, ${cal.formatDate(lead.booking.date)} at ${cal.formatTime(lead.booking.time)}, ${lead.contact.name}`,
        leadEmail(booked, store.getSettings(), 'A customer just booked on your website.'),
      );
      // Optional free "text" alert through the carrier's email-to-text address (e.g. 4697561984@tmomail.net).
      // Short, because carriers cut long messages. Only works if the carrier still runs that service.
      let ownerTextEmailed = false;
      if (mailer && textEmail) {
        try {
          const b = lead.booking;
          const short = [`${SERVICE_NAMES[lead.service] || lead.service}`, `${cal.formatDate(b.date)} ${cal.formatTime(b.time)}`,
            `${lead.contact.name} ${lead.contact.phone}`, (lead.answers && lead.answers.address) || ''].join(' | ');
          ownerTextEmailed = await mailer.send(textEmail, 'New booking', short.slice(0, 150));
        } catch (e) { log.error('Email-to-text alert failed:', e.message); }
      }
      store.updateLead(lead.id, { ownerTexted, ownerEmailed, ownerTextEmailed });
      return ok({ status: 'ok' });
    },

    // ---------- Admin ----------
    getSettings: () => ok(store.getSettings()),

    /** Admin "Send test email": reports exactly why email is not working. */
    async testEmail() {
      const to = notifyEmail || store.getSettings().business.email;
      if (!mailer) {
        return ok({ status: 'error', message: 'Email is not set up on the server. On Render, add GMAIL_USER and GMAIL_APP_PASSWORD under Environment, then save.' });
      }
      if (!to) return ok({ status: 'error', message: 'No business email is set. Add one under Business details.' });
      try {
        await mailer.send(to, 'Test email from your website', `This is a test from your SAE Outdoor and Haul website.\nIf you can read this, booking emails will reach ${to}.`);
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

module.exports = { createApi, bookingText, describeJob, leadEmail };
