/* Where the board's settings come from.
 *
 * Two layers: config.json in the repo holds the defaults everybody gets, and
 * whatever the viewer saved in this browser overrides it. Nothing personal is
 * ever committed - a fork is a blank template, and each person's dates live on
 * their own device.
 *
 * The cost of that is real: settings are per-browser, and clearing site data
 * clears them. Export/Import below is the way across to a second device.
 */

const STORAGE_KEY = 'countdown.settings.v1';

/* Fields the Settings panel owns. Anything else in config.json is a default
 * the panel doesn't touch, which keeps the two files from fighting. */
export const SETTINGS_FIELDS = [
  'title', 'tagline', 'timezone', 'target', 'holidayPreset',
  'daysOff', 'counters', 'showQuotes', 'customQuotes',
];

async function fetchJson(path) {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null; // offline, or a preset that isn't there - fall back quietly
  }
}

/* localStorage throws outright in some privacy modes rather than just coming
 * back empty, so every access is wrapped. A board with no saved settings is a
 * perfectly good board; a board that white-screens is not. */
export function readStored() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function writeStored(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function clearStored() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing saved to clear */
  }
}

export function hasStorage() {
  try {
    const probe = '__countdown_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** Defaults from config.json, overridden per-field by anything saved here. */
export async function loadConfig() {
  const defaults = (await fetchJson('./config.json')) || {};
  const config = { ...defaults, ...readStored() };

  // Holidays come from a named preset rather than a hand-kept list, so nobody
  // has to type a federal calendar to get a sensible working-day count.
  const preset = config.holidayPreset || 'none';
  const holidays = preset === 'none' ? null : await fetchJson(`./presets/${preset}.json`);
  config.holidays = holidays?.holidays || [];

  const packaged = config.showQuotes === false ? null : await fetchJson('./quotes.json');
  config.quotes = [...(packaged?.quotes || []), ...(config.customQuotes || [])];

  return config;
}

/* --- moving settings between devices ------------------------------------ */

export function exportSettings() {
  const blob = new Blob([JSON.stringify(readStored(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'countdown-settings.json';
  link.click();
  URL.revokeObjectURL(url);
}

/** Resolves to the imported settings, or rejects with a readable message -
 *  the file is usually one someone exported, but it might be anything. */
export function importSettings(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That file couldn't be read."));
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch {
        return reject(new Error("That doesn't look like a settings file - it isn't valid JSON."));
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return reject(new Error("That doesn't look like a Countdown settings file."));
      }
      // Keep only fields the panel owns, so importing a stray JSON file can't
      // inject arbitrary keys into the config.
      const clean = Object.fromEntries(
        Object.entries(parsed).filter(([key]) => SETTINGS_FIELDS.includes(key)),
      );
      if (!Object.keys(clean).length) {
        return reject(new Error('That file had no Countdown settings in it.'));
      }
      writeStored(clean);
      resolve(clean);
    };
    reader.readAsText(file);
  });
}
