/* The Settings panel.
 *
 * This is what makes a public fork safe: every personal date is typed here and
 * saved in this browser, so the repo stays a blank template and nobody
 * publishes their vest schedule by pushing a config file. It is also the
 * reason a non-technical friend never has to touch JSON or git to change a
 * date - which was the whole point of the rewrite.
 *
 * The free-text fields take small, forgiving formats rather than raw JSON, and
 * every parse failure is reported as a sentence naming the offending line.
 */

import { isIso } from './counters.js';
import {
  clearStored, exportSettings, hasStorage, importSettings, readStored, writeStored,
} from './config.js';

const el = (id) => document.getElementById(id);

const COUNTER_TYPES = [
  ['working', 'Working days'],
  ['calendar', 'Calendar days'],
  ['weekday', 'A particular weekday'],
  ['next-date', 'Next date in a list'],
  ['next-range', 'Next time off'],
  ['date', 'One fixed date'],
];

const TIERS = [['primary', 'Large'], ['secondary', 'Medium'], ['minor', 'Small']];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PRESETS = [
  ['none', 'None — I’ll add my own'],
  ['us-federal', 'US federal holidays'],
];

/* --- small text formats -------------------------------------------------- */
//
// Each parser returns { value, errors }. Collecting errors rather than
// throwing lets the panel report every bad line at once instead of making
// someone fix them one save at a time.

const lines = (text) => (text || '').split('\n').map((l) => l.trim()).filter(Boolean);

/** "2026-12-24 Christmas Eve" or "2026-12-07..2026-12-11 Road trip" */
function parseRanges(text) {
  const value = [];
  const errors = [];
  for (const line of lines(text)) {
    const [dates, ...rest] = line.split(/\s+/);
    const label = rest.join(' ');
    const [start, end = start] = dates.split('..');
    if (!isIso(start) || !isIso(end)) {
      errors.push(`“${line}” — dates need to look like 2026-12-24.`);
    } else if (end < start) {
      errors.push(`“${line}” — the end date is before the start date.`);
    } else {
      value.push(label ? { start, end, label } : { start, end });
    }
  }
  return { value, errors };
}

/** One ISO date per line. */
function parseDates(text) {
  const value = [];
  const errors = [];
  for (const line of lines(text)) {
    if (isIso(line)) value.push(line);
    else errors.push(`“${line}” — dates need to look like 2027-03-15.`);
  }
  return { value: value.sort(), errors };
}

/** "The quote — Who said it". An em dash or a plain double hyphen both work. */
function parseQuotes(text) {
  const value = lines(text).map((line) => {
    const match = line.match(/^(.*?)\s+(?:—|--)\s+(.*)$/);
    return match ? { text: match[1], source: match[2] } : { text: line, source: '' };
  });
  return { value, errors: [] };
}

const formatRanges = (ranges) => (ranges || [])
  .map((r) => {
    const dates = !r.end || r.end === r.start ? r.start : `${r.start}..${r.end}`;
    return r.label ? `${dates} ${r.label}` : dates;
  })
  .join('\n');

const formatDaysOff = (days) => formatRanges(
  (days || []).map((d) => (typeof d === 'string' ? { start: d } : d)),
);

const formatQuotes = (quotes) => (quotes || [])
  .map((q) => (q.source ? `${q.text} — ${q.source}` : q.text))
  .join('\n');

/* --- select helpers ------------------------------------------------------ */

function fillSelect(select, options, selected) {
  select.replaceChildren(...options.map(([value, label]) => {
    const option = new Option(label, value);
    option.selected = value === selected;
    return option;
  }));
  return select;
}

function makeSelect(className, options, selected) {
  const select = document.createElement('select');
  select.className = className;
  return fillSelect(select, options, selected);
}

function timezoneOptions() {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    // Older browsers don't expose the list; the handful below covers most
    // people and anything else can still be saved via an imported file.
    zones = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
      'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];
  }
  return [['auto', 'Match this device'], ...zones.map((z) => [z, z.replace(/_/g, ' ')])];
}

/* --- counter rows -------------------------------------------------------- */
//
// Held as a plain array and re-rendered on structural change. The list is
// short enough that rebuilding it is simpler, and less buggy, than patching.

let counters = [];

function detailFor(counter) {
  const wrap = document.createElement('div');
  const hint = (html) => {
    const p = document.createElement('p');
    p.className = 'hint';
    p.innerHTML = html;
    return p;
  };

  switch (counter.type) {
    case 'weekday': {
      const select = makeSelect('c-weekday', WEEKDAYS.map((d, i) => [String(i), d]), String(counter.weekday ?? 1));
      select.addEventListener('change', () => { counter.weekday = Number(select.value); });
      wrap.append(select, hint('Counts how many are left, skipping any that are a day off.'));
      break;
    }
    case 'date': {
      const input = document.createElement('input');
      input.type = 'date';
      input.className = 'c-date';
      input.value = counter.date || '';
      input.addEventListener('change', () => { counter.date = input.value; });
      wrap.append(input, hint('Counts calendar days to this one date.'));
      break;
    }
    case 'next-date': {
      const area = document.createElement('textarea');
      area.className = 'c-dates';
      area.value = (counter.dates || []).join('\n');
      area.addEventListener('change', () => { counter.datesText = area.value; });
      wrap.append(area, hint('One date per line, like <code>2027-03-15</code>. Shows the next one still ahead — vest dates, paydays, renewals.'));
      break;
    }
    case 'next-range': {
      const area = document.createElement('textarea');
      area.className = 'c-ranges';
      area.value = formatRanges(counter.ranges);
      area.addEventListener('change', () => { counter.rangesText = area.value; });

      const check = document.createElement('label');
      check.className = 'field-check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !counter.countsAsWorked;
      box.addEventListener('change', () => { counter.countsAsWorked = !box.checked; });
      check.append(box, 'These are days off work');

      wrap.append(
        area,
        hint('One per line: <code>2026-12-07..2026-12-11 Road trip</code>. Counts down to the next one, then counts what’s left of it.'),
        check,
      );
      break;
    }
    default:
      wrap.append(hint('Counts to the target date above.'));
  }
  return wrap;
}

function renderCounters() {
  const host = el('counter-rows');
  host.replaceChildren(...counters.map((counter, index) => {
    const row = document.createElement('div');
    row.className = 'counter-row';

    const head = document.createElement('div');
    head.className = 'counter-row-head';
    const label = document.createElement('input');
    label.type = 'text';
    label.value = counter.label || '';
    label.placeholder = 'Label';
    label.setAttribute('aria-label', `Counter ${index + 1} label`);
    label.addEventListener('input', () => { counter.label = label.value; });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-small btn-danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      counters.splice(index, 1);
      renderCounters();
    });
    head.append(label, remove);

    const kind = document.createElement('div');
    kind.className = 'counter-row-kind';
    const type = makeSelect('c-type', COUNTER_TYPES, counter.type);
    type.addEventListener('change', () => {
      counter.type = type.value;
      renderCounters(); // the detail field below depends on the type
    });
    const tier = makeSelect('c-tier', TIERS, counter.tier || 'minor');
    tier.addEventListener('change', () => { counter.tier = tier.value; });
    kind.append(type, tier);

    row.append(head, kind, detailFor(counter));
    return row;
  }));
}

/* --- the panel ----------------------------------------------------------- */

export function mountSettings({ getConfig, onSave }) {
  const panel = el('settings');
  const error = el('settings-error');

  fillSelect(el('f-preset'), PRESETS, 'none');
  fillSelect(el('f-timezone'), timezoneOptions(), 'auto');

  function load() {
    const config = getConfig();
    el('f-title').value = config.title || '';
    el('f-tagline').value = config.tagline || '';
    el('f-target-date').value = config.target?.date || '';
    el('f-target-label').value = config.target?.label || '';
    el('f-timezone').value = config.timezone || 'auto';
    el('f-preset').value = config.holidayPreset || 'none';
    el('f-daysoff').value = formatDaysOff(config.daysOff);
    el('f-quotes').checked = config.showQuotes !== false;
    el('f-customquotes').value = formatQuotes(config.customQuotes);

    // A working copy, so cancelling a half-finished edit changes nothing.
    counters = structuredClone(config.counters || []);
    renderCounters();
    error.hidden = true;
  }

  function collect() {
    const errors = [];
    const daysOff = parseRanges(el('f-daysoff').value);
    errors.push(...daysOff.errors);

    const collected = counters.map((counter, index) => {
      const clean = {
        id: counter.id || `c${index}-${Date.now().toString(36)}`,
        label: counter.label || '',
        type: counter.type,
        tier: counter.tier || 'minor',
      };
      const where = `“${clean.label || `counter ${index + 1}`}”`;

      if (counter.type === 'weekday') clean.weekday = counter.weekday ?? 1;
      if (counter.type === 'date') {
        if (counter.date && !isIso(counter.date)) errors.push(`${where} — that date didn’t look right.`);
        clean.date = counter.date || '';
      }
      if (counter.type === 'next-date') {
        const text = counter.datesText ?? (counter.dates || []).join('\n');
        const parsed = parseDates(text);
        errors.push(...parsed.errors.map((e) => `${where} — ${e}`));
        clean.dates = parsed.value;
      }
      if (counter.type === 'next-range') {
        const text = counter.rangesText ?? formatRanges(counter.ranges);
        const parsed = parseRanges(text);
        errors.push(...parsed.errors.map((e) => `${where} — ${e}`));
        clean.ranges = parsed.value;
        if (counter.countsAsWorked) clean.countsAsWorked = true;
      }
      return clean;
    });

    const target = el('f-target-date').value;
    if (target && !isIso(target)) errors.push('The target date didn’t look right.');

    return {
      errors,
      settings: {
        title: el('f-title').value.trim(),
        tagline: el('f-tagline').value.trim(),
        timezone: el('f-timezone').value,
        target: { date: target, label: el('f-target-label').value.trim() || 'until' },
        holidayPreset: el('f-preset').value,
        daysOff: daysOff.value,
        counters: collected,
        showQuotes: el('f-quotes').checked,
        customQuotes: parseQuotes(el('f-customquotes').value).value,
      },
    };
  }

  function show(message) {
    error.textContent = message;
    error.hidden = !message;
    if (message) error.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    load();
    panel.hidden = false;
    document.body.style.overflow = 'hidden';
    el('f-title').focus();
  }

  function close() {
    panel.hidden = true;
    document.body.style.overflow = '';
    el('settings-open').focus();
  }

  el('settings-open').addEventListener('click', open);
  el('settings-close').addEventListener('click', close);
  panel.addEventListener('click', (event) => {
    if (event.target === panel) close(); // click the backdrop to dismiss
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) close();
  });

  el('settings-save').addEventListener('click', async () => {
    const { errors, settings } = collect();
    if (errors.length) return show(errors.join(' '));
    if (!writeStored(settings)) {
      return show('This browser wouldn’t let the settings be saved — private browsing usually blocks it.');
    }
    await onSave();
    close();
  });

  el('settings-reset').addEventListener('click', async () => {
    if (!window.confirm('Clear your settings and go back to the defaults? This only affects this browser.')) return;
    clearStored();
    await onSave();
    load();
  });

  el('settings-export').addEventListener('click', () => {
    if (!Object.keys(readStored()).length) return show('There’s nothing saved yet — hit Save first.');
    exportSettings();
  });

  el('settings-import').addEventListener('click', () => el('settings-file').click());
  el('settings-file').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    event.target.value = ''; // so re-picking the same file fires again
    if (!file) return;
    try {
      await importSettings(file);
      await onSave();
      load();
      show('');
    } catch (failure) {
      show(failure.message);
    }
  });

  el('add-counter').addEventListener('click', () => {
    counters.push({
      id: `c${Date.now().toString(36)}`,
      label: 'New counter',
      type: 'next-range',
      tier: 'minor',
      ranges: [],
    });
    renderCounters();
    el('counter-rows').lastElementChild?.querySelector('input')?.focus();
  });

  el('settings-note').textContent = hasStorage()
    ? 'Settings are saved in this browser only — never uploaded, and never committed to the repository. Use Export to carry them to another device.'
    : 'This browser is blocking local storage, so settings can’t be saved. Private browsing is the usual cause.';
}
