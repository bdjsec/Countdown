/* A test harness small enough to read in one sitting, so the project has no
 * dependencies at all. `run()` returns results rather than printing them,
 * which lets the same suite drive the Node runner and the browser page.
 */

const cases = [];

export function test(name, fn) {
  cases.push({ name, fn });
}

export function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

export function equal(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message ? message + ': ' : ''}expected ${e}, got ${a}`);
}

export function throws(fn, message) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message || 'expected a throw');
}

export function run() {
  const results = cases.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (error) {
      return { name, ok: false, error: error.message };
    }
  });
  return { results, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };
}
