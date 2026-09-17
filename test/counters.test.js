/* The counting rules are subtle enough - which end of the range is included,
 * observed holidays, a vacation day that lands on a holiday - that they are
 * worth pinning down. Everything here is pure, so no DOM and no fake timers:
 * the clock is just a Date passed in.
 */

import { test, assert, equal } from './harness.js';
import {
  buildPayload, calendarDays, computeCounter, daysOffMap, expandRange, isIso,
  nextDate, nextDayOff, nextRange, quoteFor, quoteOrder, secondsUntilRollover,
  todayIn, weekdayCount, workingDays,
} from '../js/counters.js';

const TODAY = '2026-09-17';   // a Thursday
const TARGET = '2026-09-30';  // the Wednesday two weeks out
const none = new Map();

/* --- ISO handling ------------------------------------------------------ */

test('isIso accepts a real date and rejects an impossible one', () => {
  assert(isIso('2026-09-17'));
  assert(!isIso('2027-02-30'), 'Feb 30 must not roll forward into March');
  assert(!isIso('2026-9-7'), 'unpadded months are not ISO');
  assert(!isIso(''));
  assert(!isIso(null));
});

/* --- endpoint rules ---------------------------------------------------- */

test('counts exclude today and include the target', () => {
  equal(calendarDays(TODAY, TARGET), 13);
  equal(workingDays(TODAY, TARGET, none), 9);
});

test('the board reads zero on the target day itself', () => {
  equal(calendarDays(TARGET, TARGET), 0);
  equal(workingDays(TARGET, TARGET, none), 0);
});

test('nothing goes negative once the target has passed', () => {
  equal(calendarDays('2026-10-05', TARGET), 0);
  equal(workingDays('2026-10-05', TARGET, none), 0);
});

/* --- days off ---------------------------------------------------------- */

test('a day off comes out of working days', () => {
  const off = new Map([['2026-09-21', 'Holiday']]);
  equal(workingDays(TODAY, TARGET, off), 8);
});

test('a holiday Monday is not a Monday you show up for', () => {
  equal(weekdayCount(TODAY, TARGET, 1, none), 2);
  equal(weekdayCount(TODAY, TARGET, 1, new Map([['2026-09-21', 'Holiday']])), 1);
});

test('time off landing on a holiday is not counted twice', () => {
  const config = {
    holidays: [{ date: '2026-09-21', name: 'Holiday' }],
    daysOff: [{ start: '2026-09-21', end: '2026-09-22', label: 'Long weekend' }],
  };
  const off = daysOffMap(config);
  equal(off.size, 2, 'the overlapping day collapses into one entry');
  equal(workingDays(TODAY, TARGET, off), 7);
});

test('a vacation range feeds the days-off set from its own counter', () => {
  const config = {
    counters: [{ id: 'trip', type: 'next-range', label: 'Trip', ranges: [{ start: '2026-09-21', end: '2026-09-25' }] }],
  };
  equal(daysOffMap(config).size, 5, 'entered once, counted as time off');
  equal(workingDays(TODAY, TARGET, daysOffMap(config)), 4);
});

test('a range marked countsAsWorked does not reduce working days', () => {
  const config = {
    counters: [{ id: 'gig', type: 'next-range', countsAsWorked: true, ranges: [{ start: '2026-09-21', end: '2026-09-25' }] }],
  };
  equal(daysOffMap(config).size, 0);
});

test('expandRange includes both ends and tolerates a backwards range', () => {
  equal(expandRange({ start: '2026-09-21', end: '2026-09-23' }), ['2026-09-21', '2026-09-22', '2026-09-23']);
  equal(expandRange({ start: '2026-09-21' }), ['2026-09-21'], 'a missing end means a single day');
  equal(expandRange({ start: '2026-09-23', end: '2026-09-21' }), [], 'backwards contributes nothing');
  equal(expandRange({}), []);
});

test('nextDayOff reports the soonest one and how many are left', () => {
  const off = new Map([['2026-09-21', 'Labor Day'], ['2026-09-25', 'Floating'], ['2026-11-26', 'Too late']]);
  equal(nextDayOff(TODAY, TARGET, off), { date: '2026-09-21', name: 'Labor Day', remaining: 2 });
  equal(nextDayOff('2026-09-26', TARGET, off), null, 'none left inside the window');
});

/* --- list-driven counters ---------------------------------------------- */

test('nextDate skips today and picks the next one', () => {
  equal(nextDate(TODAY, ['2026-09-08', TODAY, '2026-12-08']), { date: '2026-12-08', daysAway: 82 });
  equal(nextDate(TODAY, []), null, 'an empty list is a blank tile, not an error');
  equal(nextDate(TODAY, ['not-a-date']), null);
});

test('dates past the target still count', () => {
  equal(nextDate(TODAY, ['2027-06-20']).daysAway, 276);
});

test('nextRange counts down to a trip, then counts what is left of it', () => {
  const ranges = [{ start: '2026-12-07', end: '2026-12-11', label: 'Hawai’i' }];
  const ahead = nextRange('2026-12-01', ranges);
  equal([ahead.inProgress, ahead.daysAway], [false, 6]);

  const during = nextRange('2026-12-09', ranges);
  equal([during.inProgress, during.daysAway], [true, 2], 'two days of the trip left');

  equal(nextRange('2026-12-12', ranges), null, 'a finished trip drops off the board');
});

test('an unlabelled range still reads cleanly', () => {
  const counter = { id: 'r', label: 'Next break', type: 'next-range', ranges: [{ start: '2026-12-07', end: '2026-12-11' }] };
  equal(computeCounter(counter, { today: '2026-12-01', target: TARGET, daysOff: none }).note, 'Dec 7, 2026');
});

test('an unconfigured counter shows dashes rather than a wrong number', () => {
  const blank = computeCounter({ id: 'v', label: 'Vest', type: 'next-date', dates: [] }, { today: TODAY, target: TARGET, daysOff: none });
  equal(blank.value, null);
  assert(blank.note.length > 0, 'and says what to do about it');
});

test('an unknown counter type fails visibly instead of silently', () => {
  const bad = computeCounter({ id: 'x', type: 'nonsense' }, { today: TODAY, target: TARGET, daysOff: none });
  equal(bad.value, null);
  assert(bad.note.includes('nonsense'));
});

/* --- the clock --------------------------------------------------------- */

test('the date is pinned to the configured zone, not the viewer', () => {
  // 05:30 UTC is still the previous evening in Los Angeles.
  const instant = new Date('2026-09-17T05:30:00Z');
  equal(todayIn('UTC', instant), '2026-09-17');
  equal(todayIn('America/Los_Angeles', instant), '2026-09-16');
  equal(todayIn('Pacific/Auckland', instant), '2026-09-17');
});

test('rollover is scheduled from the configured zone', () => {
  const instant = new Date('2026-09-17T05:30:00Z'); // 22:30 in Los Angeles
  equal(secondsUntilRollover('America/Los_Angeles', instant), 5400);
  equal(secondsUntilRollover('UTC', instant), 66600);
});

/* --- quotes ------------------------------------------------------------ */

test('every quote appears once per block before any repeats', () => {
  const n = 9;
  for (const block of [0, 1, 2, 37]) {
    equal([...quoteOrder(block, n)].sort((a, b) => a - b), [...Array(n).keys()], `block ${block} is a permutation`);
  }
});

test('no quote shows two days running, across block boundaries', () => {
  const quotes = Array.from({ length: 9 }, (_, i) => ({ text: `q${i}` }));
  let previous = null;
  for (let i = 0; i < 400; i += 1) {
    const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    const quote = quoteFor(day, quotes);
    assert(quote.text !== previous, `repeat on ${day}: ${quote.text}`);
    previous = quote.text;
  }
});

test('a short list still alternates, and an empty one is just hidden', () => {
  const two = [{ text: 'a' }, { text: 'b' }];
  assert(quoteFor('2026-09-17', two).text !== quoteFor('2026-09-18', two).text);
  equal(quoteFor('2026-09-17', []), null);
  equal(quoteFor('2026-09-17', undefined), null);
});

test('the same day always gives the same quote', () => {
  const quotes = Array.from({ length: 5 }, (_, i) => ({ text: `q${i}` }));
  equal(quoteFor(TODAY, quotes), quoteFor(TODAY, quotes));
});

/* --- the whole payload -------------------------------------------------- */

test('buildPayload assembles the default board', () => {
  const config = {
    title: 'Countdown',
    timezone: 'America/Los_Angeles',
    target: { date: TARGET, label: 'until' },
    holidays: [{ date: '2026-09-21', name: 'Labor Day' }],
    counters: [
      { id: 'working', label: 'Working Days', type: 'working', tier: 'primary' },
      { id: 'calendar', label: 'Calendar Days', type: 'calendar', tier: 'secondary' },
    ],
    quotes: [{ text: 'one', source: 'nobody' }],
  };
  const payload = buildPayload(config, new Date('2026-09-17T19:00:00Z')); // noon in LA

  equal(payload.today, TODAY);
  equal(payload.counters.map((c) => c.value), [8, 13]);
  equal(payload.targetLabel, 'September 30, 2026');
  equal(payload.nextDayOff.name, 'Labor Day');
  equal(payload.quote.text, 'one');
  assert(payload.secondsUntilRollover > 0 && payload.secondsUntilRollover <= 86400);
});

test('an empty config renders a board rather than throwing', () => {
  const payload = buildPayload({}, new Date('2026-09-17T19:00:00Z'));
  equal(payload.counters, []);
  equal(payload.quote, null);
  assert(payload.todayLabel.length > 0);
});

test('quotes can be switched off', () => {
  const config = { showQuotes: false, quotes: [{ text: 'hidden' }] };
  equal(buildPayload(config, new Date('2026-09-17T19:00:00Z')).quote, null);
});
