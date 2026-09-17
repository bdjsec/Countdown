/* Split-flap rendering.
 *
 * A flap is four stacked halves: two static ones showing the resting digit,
 * plus two leaves that animate. To go old -> new, the top leaf (old) falls
 * away to reveal the static top (new), then the bottom leaf (new) drops onto
 * the static bottom (old). When it settles, everything is set to new.
 *
 * The original addressed five boards by hardcoded element id. Counters are
 * configurable now, so this exports a factory instead: one board per counter,
 * created as the page builds its tiles.
 */

const FLIP_MS = 680;        // fall + land, matches the CSS animation timings
const PLACEHOLDER = '–'; // shown when a counter has nothing configured yet

function makeFlap(digit) {
  const flap = document.createElement('div');
  flap.className = 'flap';
  flap.dataset.digit = digit;
  flap.innerHTML = `
    <div class="half half-top static-top"><span>${digit}</span></div>
    <div class="half half-bottom static-bottom"><span>${digit}</span></div>
    <div class="half half-top leaf-top"><span>${digit}</span></div>
    <div class="half half-bottom leaf-bottom"><span>${digit}</span></div>`;
  return flap;
}

function setFlap(flap, next) {
  const current = flap.dataset.digit;
  if (current === next) return;

  const q = (sel) => flap.querySelector(`${sel} span`);
  q('.static-top').textContent = next;   // revealed as the old top falls
  q('.static-bottom').textContent = current;
  q('.leaf-top').textContent = current;
  q('.leaf-bottom').textContent = next;

  flap.classList.remove('flipping');
  void flap.offsetWidth; // restart the animation
  flap.classList.add('flipping');

  flap.dataset.digit = next;
  setTimeout(() => {
    flap.classList.remove('flipping');
    q('.static-bottom').textContent = next;
    q('.leaf-top').textContent = next;
  }, FLIP_MS);
}

function digitsFor(element, value, min) {
  // value === null means "nothing to show yet" - fill the board with dashes.
  if (value === null || value === undefined) {
    return PLACEHOLDER.repeat(Math.max(min, element.children.length)).split('');
  }
  const width = Math.max(min, String(value).length, element.children.length);
  return String(value).padStart(width, '0').split('');
}

/** A board of flaps inside `element`. `min` is the fewest digits it ever
 *  shows, so a two-digit tile doesn't visibly shrink to one. */
export function createBoard(element, { min = 2 } = {}) {
  let seeded = false;

  function render(value) {
    const digits = digitsFor(element, value, min);
    while (element.children.length < digits.length) element.appendChild(makeFlap('0'));
    while (element.children.length > digits.length) element.removeChild(element.firstChild);
    digits.forEach((d, i) => setFlap(element.children[i], d));
  }

  return {
    render,
    /* Seed one higher than the real number, then flip down to it, so opening
     * the page shows the flaps actually turn. */
    open(value) {
      if (seeded) return render(value);
      seeded = true;
      const from = value === null || value === undefined ? null : value + 1;
      digitsFor(element, from, min).forEach((d) => element.appendChild(makeFlap(d)));
      setTimeout(() => render(value), 400);
    },
  };
}
