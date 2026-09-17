/* Wiring: load the config, build a tile per counter, and keep the board honest
 * as the day turns over.
 *
 * All the arithmetic is in counters.js and runs in the browser, so once the
 * page is cached the board needs no network at all - it keeps working on a
 * plane, which is more than the Flask version it grew out of could say.
 */

import { buildPayload } from './counters.js';
import { createBoard } from './flap.js';
import { loadConfig } from './config.js';
import { mountSettings } from './settings.js';

const POLL_MS = 5 * 60 * 1000;

const el = (id) => document.getElementById(id);
const boards = new Map(); // counter id -> { board, note }
let config = {};
let signature = '';       // which tiles are currently built
let rolloverTimer = null;

/* --- tiles -------------------------------------------------------------- */

function makeTile(counter) {
  const section = document.createElement('section');
  section.className = `counter tier-${counter.tier}`;
  section.dataset.id = counter.id;

  const label = document.createElement('div');
  label.className = 'counter-label';
  label.textContent = counter.label || '';

  const flaps = document.createElement('div');
  flaps.className = 'flaps';

  const note = document.createElement('div');
  note.className = 'minor-note';

  section.append(label, flaps, note);
  // Minor tiles are narrow, so they hold two digits; the big ones hold three
  // and only grow past that for a genuinely long countdown.
  const board = createBoard(flaps, { min: counter.tier === 'minor' ? 2 : 3 });
  boards.set(counter.id, { board, note, label, opened: false });
  return section;
}

/** Rebuild the tiles only when the counter list itself changed - otherwise a
 *  refresh would re-seed every board and replay the opening flip. */
function syncTiles(counters) {
  const next = counters.map((c) => `${c.id}:${c.tier}`).join('|');
  if (next === signature) return false;
  signature = next;
  boards.clear();

  const majors = el('majors');
  const minors = el('minors');
  majors.replaceChildren();
  minors.replaceChildren();

  for (const counter of counters) {
    (counter.tier === 'minor' ? minors : majors).appendChild(makeTile(counter));
  }
  el('empty').hidden = counters.length > 0;
  return true;
}

/* --- rendering ---------------------------------------------------------- */

function render(payload) {
  const rebuilt = syncTiles(payload.counters);

  el('today-date').textContent = payload.todayLabel;
  el('title').textContent = payload.title;
  document.title = payload.title;

  for (const counter of payload.counters) {
    const tile = boards.get(counter.id);
    if (!tile) continue;
    tile.label.textContent = counter.label || '';
    // A rebuilt tile plays the opening flip; an existing one just turns.
    if (rebuilt && !tile.opened) {
      tile.opened = true;
      tile.board.open(counter.value);
    } else {
      tile.board.render(counter.value);
    }
    tile.note.textContent = counter.note || '';
    tile.note.hidden = !counter.note;
  }

  el('target').innerHTML = '';
  el('target').append(`${payload.targetPrefix} `, Object.assign(document.createElement('strong'), {
    textContent: payload.targetLabel,
  }));

  const off = payload.nextDayOff;
  el('detail').textContent = off
    ? `next day off · ${off.name}, ${off.label} · ${off.remaining} left`
    : 'no days off left · it’s just weekends from here';

  const quote = el('quote');
  if (payload.quote) {
    el('quote-text').textContent = payload.quote.text;
    el('quote-source').textContent = payload.quote.source || '';
  }
  quote.hidden = !payload.quote;

  el('tagline').textContent = payload.tagline;
  el('tagline').hidden = !payload.tagline;

  scheduleRollover(payload.secondsUntilRollover);
}

function refresh() {
  render(buildPayload(config));
}

/* Roll over at the configured zone's midnight, not the viewer's. A board
 * pinned to Pacific should turn at Pacific midnight wherever it is open. */
function scheduleRollover(seconds) {
  clearTimeout(rolloverTimer);
  rolloverTimer = setTimeout(refresh, Math.max(5, Number(seconds) + 5) * 1000);
}

/* --- startup ------------------------------------------------------------ */

async function start() {
  config = await loadConfig();

  mountSettings({
    getConfig: () => config,
    onSave: async () => {
      config = await loadConfig();
      signature = ''; // settings can add or drop counters, so rebuild the tiles
      refresh();
    },
  });

  refresh();

  // A tab left open for weeks - or a laptop asleep at midnight - would
  // otherwise sit on a stale number.
  setInterval(refresh, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
}

start();

// Relative scope on purpose: project Pages serve from /<repo>/, and a leading
// slash here would register against the wrong path and silently do nothing.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is a bonus; the board works fine without it */
    });
  });
}
