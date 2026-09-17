/* Node entry point for the suite: `node test/run.js`. The tests themselves are
 * plain ESM with no Node imports, so test/index.html runs the same file in a
 * browser - handy on a machine with no Node installed.
 */

import './counters.test.js';
import { run } from './harness.js';

const { results, passed, failed } = run();

for (const result of results) {
  console.log(result.ok ? `  ok   ${result.name}` : `  FAIL ${result.name}\n       ${result.error}`);
}
console.log(`\n${passed} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
