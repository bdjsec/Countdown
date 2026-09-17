/* All of the date math, with no DOM and no globals, so `node --test` can
 * exercise it directly. Everything here is pure: pass in a config and a clock,
 * get back a payload the page can render.
 *
 * Dates are ISO "YYYY-MM-DD" strings everywhere. Internally they become day
 * ordinals (days since the epoch) via a UTC-anchored Date, never a local one -
 * `new Date("2027-01-01")` is UTC midnight but `new Date(2027, 0, 1)` is local
 * midnight, and mixing the two puts you a day out for part of every day.
 *
 * Weekdays follow the JS convention: 0 = Sunday ... 6 = Saturday.
 */

const MS_PER_DAY = 86400000;
export const SUNDAY = 0;
export const SATURDAY = 6;

/* --- ISO dates and ordinals ------------------------------------------- */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIso(value) {
  if (typeof value !== 'string' || !ISO.test(value)) return false;
  // Rejects "2027-02-30", which Date happily rolls forward to March 2.
  return toIso(new Date(`${value}T00:00:00Z`)) === value;
}

export function toIso(date) {
  return date.toISOString().slice(0, 10);
}

export function toOrdinal(iso) {
  return Math.round(new Date(`${iso}T00:00:00Z`).getTime() / MS_PER_DAY);
}

export function fromOrdinal(ordinal) {
  return toIso(new Date(ordinal * MS_PER_DAY));
}

export function weekdayOf(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export function isWeekend(iso) {
  const day = weekdayOf(iso);
  return day === SUNDAY || day === SATURDAY;
}

/* --- the clock --------------------------------------------------------- */
//
// The date is a *pinned* calendar date, not the viewer's. Someone who sets the
// board to Pacific and then opens it in Berlin should still see the Pacific
// day, exactly as the original computed every date server-side in one zone.

export function resolveZone(timezone) {
  if (!timezone || timezone === 'auto') {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }
  return timezone;
}

export function todayIn(timezone, now = new Date()) {
  // en-CA formats as YYYY-MM-DD, which is the shape we want anyway.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveZone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function secondsUntilRollover(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: resolveZone(timezone),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const at = (type) => Number(parts.find((p) => p.type === type).value);
  const elapsed = at('hour') * 3600 + at('minute') * 60 + at('second');

  // Off by an hour on the two DST days a year. The page also polls every five
  // minutes and refreshes on tab focus, so the worst case is a board that is
  // late by minutes, not one that is wrong all day - not worth a tz library.
  return 86400 - elapsed;
}

/* --- formatting -------------------------------------------------------- */

function formatIso(iso, options) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options })
    .format(new Date(`${iso}T00:00:00Z`));
}

export const shortDate = (iso) => formatIso(iso, { month: 'short', day: 'numeric' });
export const mediumDate = (iso) => formatIso(iso, { month: 'short', day: 'numeric', year: 'numeric' });
export const longDate = (iso) => formatIso(iso, { month: 'long', day: 'numeric', year: 'numeric' });
export const fullDate = (iso) =>
  formatIso(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

/* --- days off ---------------------------------------------------------- */
//
// Holidays, one-off days off, and vacation ranges all collapse into one set of
// ISO strings. A day in that set is a day not worked, whatever put it there,
// so a vacation day that lands on a holiday is naturally not counted twice.

export function expandRange(range) {
  const days = [];
  if (!isIso(range?.start)) return days;
  const end = isIso(range.end) ? range.end : range.start;
  // An end before its start contributes nothing rather than erroring, which is
  // the friendlier answer for a field someone typed by hand.
  for (let d = toOrdinal(range.start); d <= toOrdinal(end); d += 1) {
    days.push(fromOrdinal(d));
  }
  return days;
}

/** Every day off, as a Map of iso -> label. Later sources win the label. */
export function daysOffMap(config) {
  const days = new Map();

  for (const entry of config.holidays ?? []) {
    // 'date' is the OBSERVED day - the one actually taken off - since that is
    // what the working-day math has to subtract. A holiday on a weekend is
    // stored at the weekday it is observed on.
    if (isIso(entry?.date)) days.set(entry.date, entry.name ?? 'Holiday');
  }

  for (const entry of config.daysOff ?? []) {
    if (typeof entry === 'string') {
      if (isIso(entry)) days.set(entry, 'Day off');
    } else {
      for (const iso of expandRange(entry)) days.set(iso, entry.label || 'Day off');
    }
  }

  // Vacation ranges are entered once, on the counter that counts down to them,
  // and feed this set from there - no separate PTO list to keep in sync.
  for (const counter of config.counters ?? []) {
    if (counter?.type !== 'next-range' || counter.countsAsWorked) continue;
    for (const range of counter.ranges ?? []) {
      for (const iso of expandRange(range)) {
        days.set(iso, range.label || counter.label || 'Time off');
      }
    }
  }

  return days;
}

/* --- the counts -------------------------------------------------------- */
//
// Every count excludes today and includes the target date itself, because the
// target is the last day that counts - on the day, the board reads 0 and it is
// over. Nothing goes negative once the date passes.

export function calendarDays(today, target) {
  return Math.max(0, toOrdinal(target) - toOrdinal(today));
}

/** Days matching `predicate` in (today, target]. */
function countDays(today, target, predicate) {
  let count = 0;
  const last = toOrdinal(target);
  for (let d = toOrdinal(today) + 1; d <= last; d += 1) {
    if (predicate(fromOrdinal(d))) count += 1;
  }
  return count;
}

export function workingDays(today, target, daysOff) {
  return countDays(today, target, (iso) => !isWeekend(iso) && !daysOff.has(iso));
}

/** Mondays you actually have to show up for: a holiday Monday doesn't count. */
export function weekdayCount(today, target, weekday, daysOff) {
  return countDays(today, target, (iso) => weekdayOf(iso) === weekday && !daysOff.has(iso));
}

/** The next date strictly after today. Dates past the target still count -
 *  equity doesn't care when you stop showing up. */
export function nextDate(today, dates) {
  const upcoming = (dates ?? []).filter(isIso).sort().find((d) => d > today);
  return upcoming ? { date: upcoming, daysAway: calendarDays(today, upcoming) } : null;
}

/** The range you are in, or the next one coming. */
export function nextRange(today, ranges) {
  const valid = (ranges ?? [])
    .filter((r) => isIso(r?.start))
    .map((r) => ({ ...r, end: isIso(r.end) && r.end >= r.start ? r.end : r.start }))
    .sort((a, b) => a.start.localeCompare(b.start));

  const current = valid.find((r) => r.start <= today && today <= r.end);
  if (current) {
    return { ...current, inProgress: true, daysAway: calendarDays(today, current.end) };
  }
  const upcoming = valid.find((r) => r.start > today);
  return upcoming ? { ...upcoming, inProgress: false, daysAway: calendarDays(today, upcoming.start) } : null;
}

export function nextDayOff(today, target, days) {
  const upcoming = [...days.keys()].filter((d) => d > today && d <= target).sort();
  if (!upcoming.length) return null;
  return { date: upcoming[0], name: days.get(upcoming[0]), remaining: upcoming.length };
}

/* --- quotes ------------------------------------------------------------ */
//
// One quote per day, stable for that whole day so a refresh or the five-minute
// poll doesn't reshuffle it mid-read. Ported from the original's rotation.

/** mulberry32 - small, seeded, and good enough to shuffle a quote list. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function baseOrder(block, n) {
  const order = [...Array(n).keys()];
  const random = seededRandom(block);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** The viewing order for one block of n days, reshuffled per block so the
 *  sequence isn't identical cycle after cycle.
 *
 *  A block must not end on the quote the next block starts with, or the same
 *  line shows two days running and the page looks stuck. Each block fixes its
 *  own tail: it looks ahead at the next block's first quote and, on a clash,
 *  swaps its last two entries. That leaves index 0 untouched, so the next
 *  block's opening quote stays what this one just checked against - the fix
 *  needs no history and cannot drift.
 *
 *  With two quotes the only repeat-free sequence is a strict alternation, and
 *  with one there is nothing to vary. */
export function quoteOrder(block, n) {
  if (n <= 2) return [...Array(n).keys()];
  const order = baseOrder(block, n);
  if (order[n - 1] === baseOrder(block + 1, n)[0]) {
    [order[n - 1], order[n - 2]] = [order[n - 2], order[n - 1]];
  }
  return order;
}

/** Every quote appears once per block of len(quotes) days before any repeats. */
export function quoteFor(today, quotes) {
  const n = quotes?.length ?? 0;
  if (!n) return null;
  const ordinal = toOrdinal(today);
  // Ordinals are positive for any date this century, so floor division is
  // plain division - no negative-block edge case to guard.
  return quotes[quoteOrder(Math.floor(ordinal / n), n)[ordinal % n]];
}

/* --- assembling the board ---------------------------------------------- */

const NO_DATES = 'add dates in Settings';

/** One counter's value and the small note under it. `value: null` renders as
 *  dashes, which is how an unconfigured tile shows it is waiting for input. */
export function computeCounter(counter, { today, target, daysOff }) {
  const base = { id: counter.id, label: counter.label, tier: counter.tier || 'minor' };

  switch (counter.type) {
    case 'calendar':
      return { ...base, value: calendarDays(today, target), note: '' };

    case 'working':
      return { ...base, value: workingDays(today, target, daysOff), note: '' };

    case 'weekday':
      return { ...base, value: weekdayCount(today, target, counter.weekday ?? 1, daysOff), note: '' };

    case 'date': {
      if (!isIso(counter.date)) return { ...base, value: null, note: NO_DATES };
      return { ...base, value: calendarDays(today, counter.date), note: longDate(counter.date) };
    }

    case 'next-date': {
      const next = nextDate(today, counter.dates);
      if (!next) return { ...base, value: null, note: NO_DATES };
      return { ...base, value: next.daysAway, note: mediumDate(next.date) };
    }

    case 'next-range': {
      const next = nextRange(today, counter.ranges);
      if (!next) return { ...base, value: null, note: NO_DATES };
      // Mid-trip the tile stops counting down to it and starts counting what
      // is left of it, so it stays useful for the whole week rather than
      // sitting on 0.
      const when = next.inProgress
        ? `through ${shortDate(next.end)}`
        : mediumDate(next.start);
      return {
        ...base,
        value: next.daysAway,
        note: [next.label, when].filter(Boolean).join(' · '),
        inProgress: next.inProgress,
      };
    }

    default:
      return { ...base, value: null, note: `unknown counter type "${counter.type}"` };
  }
}

export function buildPayload(config, now = new Date()) {
  const today = todayIn(config.timezone, now);
  const target = isIso(config.target?.date) ? config.target.date : today;
  const daysOff = daysOffMap(config);

  const counters = (config.counters ?? []).map((c) => computeCounter(c, { today, target, daysOff }));
  const upcoming = nextDayOff(today, target, daysOff);

  return {
    today,
    todayLabel: fullDate(today),
    title: config.title ?? 'Countdown',
    targetLabel: longDate(target),
    targetPrefix: config.target?.label ?? 'until',
    counters,
    nextDayOff: upcoming && {
      ...upcoming,
      label: shortDate(upcoming.date),
    },
    quote: config.showQuotes === false ? null : quoteFor(today, config.quotes),
    tagline: config.tagline ?? '',
    secondsUntilRollover: secondsUntilRollover(config.timezone, now),
  };
}
