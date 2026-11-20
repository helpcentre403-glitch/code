'use strict';
/**
 * Availability calendar. All dates are "YYYY-MM-DD" strings and all times are "HH:MM"
 * in the business time zone (America/Chicago by default), regardless of server time zone.
 */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function nowInZone(tz, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map((x) => [x.type, x.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const isDate = (s) => typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const isTime = (s) => typeof s === 'string' && TIME_RE.test(s);

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function formatTime(t) {
  const m = toMin(t);
  const h = Math.floor(m / 60);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${suffix}`;
}
function formatDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

function hoursFor(schedule, date) {
  const special = (schedule.specialHours || []).find((x) => x.date === date);
  if (special) return special;
  if (schedule.holidays.includes(date)) return schedule.holidayHours;
  return schedule.hours[weekday(date)] || null;
}

/** Slots from regular hours only (before blocks/opens/bookings). */
function regularSlots(schedule, date) {
  const h = hoursFor(schedule, date);
  if (!h || !isTime(h.open) || !isTime(h.close)) return [];
  const step = Math.max(15, Number(schedule.slotMinutes) || 60);
  const out = [];
  for (let m = toMin(h.open); m + step <= toMin(h.close); m += step) out.push(toTime(m));
  return out;
}

const slotKey = (date, time) => `${date} ${time}`;

/**
 * Full status of every slot on a date. Used by both the public calendar (only "open")
 * and the admin calendar (everything).
 * bookedKeys: Set of "YYYY-MM-DD HH:MM" strings already booked.
 */
function daySlotStatus(schedule, date, bookedKeys, now) {
  const today = nowInZone(schedule.timezone, now);
  const dayBlocked = schedule.blockedDates.includes(date);
  const blocked = new Set(schedule.blockedSlots.filter((s) => s.date === date).map((s) => s.time));
  const opened = schedule.openedSlots.filter((s) => s.date === date).map((s) => s.time);
  const regular = regularSlots(schedule, date);
  const times = [...new Set([...regular, ...opened])].sort();
  const lead = Number(schedule.minLeadMinutes) || 0;

  return times.map((time) => {
    let status = 'open';
    const extra = !regular.includes(time);
    if (date < today.date || (date === today.date && toMin(time) < today.minutes + lead)) status = 'past';
    else if (bookedKeys.has(slotKey(date, time))) status = 'booked';
    else if (opened.includes(time)) status = 'open'; // explicitly opened by the owner wins over a block
    else if (dayBlocked || blocked.has(time)) status = 'blocked';
    return { time, label: formatTime(time), status, extra };
  });
}

function windowDates(schedule, now) {
  const today = nowInZone(schedule.timezone, now).date;
  const days = Math.max(1, Math.min(120, Number(schedule.bookingWindowDays) || 21));
  return Array.from({ length: days }, (_, i) => addDays(today, i));
}

/** Public availability: only dates with at least one open slot, only open slots. */
/**
 * Public availability: open slots, plus booked slots (shown scratched out, one booking per time
 * across all services). Days with nothing open or booked are left out; fully booked days are kept
 * so customers see them as "Full". Booked entries never include who booked.
 */
function availability(schedule, bookedKeys, now = new Date()) {
  const today = nowInZone(schedule.timezone, now).date;
  return windowDates(schedule, now)
    .map((date) => {
      const all = daySlotStatus(schedule, date, bookedKeys, now);
      const pick = (st) => all.filter((s) => s.status === st).map(({ time, label }) => ({ time, label }));
      const slots = pick('open');
      const booked = pick('booked');
      return { date, label: formatDate(date), dayName: DAY_NAMES[weekday(date)], isToday: date === today, slots, booked, full: slots.length === 0 };
    })
    .filter((d) => d.slots.length > 0 || d.booked.length > 0);
}

function isSlotAvailable(schedule, bookedKeys, date, time, now = new Date()) {
  if (!isDate(date) || !isTime(time)) return false;
  if (!windowDates(schedule, now).includes(date)) return false;
  const s = daySlotStatus(schedule, date, bookedKeys, now).find((x) => x.time === time);
  return Boolean(s && s.status === 'open');
}

module.exports = {
  nowInZone, addDays, weekday, formatTime, formatDate, isDate, isTime,
  regularSlots, daySlotStatus, availability, isSlotAvailable, windowDates, slotKey, DAY_NAMES,
};
