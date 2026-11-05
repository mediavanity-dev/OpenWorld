// Super-mini tutorial for first-time players: a few coach marks that point at the real
// controls. Step 1 starts with everything hidden and waits for the player to tap the eye.
// Shown once per device; skippable; never shown again.
// Also: showHint(), a single coach mark for one moment (e.g. entering Home mode).

import { storeKey } from '../channel.js';
import { storage } from '../storage.js';

const KEY = storeKey('tipsDone');
const $ = (id) => document.getElementById(id);

export function tutorialDone() { return !!storage.get(KEY); }
function markDone() { storage.set(KEY, '1'); }

// Put the bubble next to `el` (above it, or below when there's no room) and ring the control.
function placeNear(el) {
  const box = $('tips'), ring = $('tip-ring');
  if (!el) return;
  const r = el.getBoundingClientRect(), pad = 6;
  ring.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;border-radius:${Math.min(r.width, r.height) > 60 ? 14 : 999}px`;
  const bw = box.offsetWidth, bh = box.offsetHeight, gap = 16;
  const below = r.top < bh + gap + 20; // not enough room above: go below
  const left = Math.max(10, Math.min(innerWidth - bw - 10, r.left + r.width / 2 - bw / 2));
  const top = below ? r.bottom + gap : r.top - bh - gap;
  box.style.left = `${left}px`; box.style.top = `${Math.max(10, top)}px`;
  box.dataset.side = below ? 'below' : 'above';
  box.style.setProperty('--ax', `${Math.max(18, Math.min(bw - 18, r.left + r.width / 2 - left))}px`);
}

let hintClose = null;
// One hint bubble pointing at a control. Closes on "Got it", after `timeout` ms, or when
// `until` fires; "Don't show again" remembers it per device under `key`. Never interrupts
// the first-run tutorial. text is trusted markup (our own copy, never outside text).
// Returns true if the hint is showing.
export function showHint({ target, text, key = null, timeout = 9000, until = null }) {
  if (key && storage.get(storeKey(`hint.${key}`))) return false;
  const box = $('tips'), ring = $('tip-ring'), el = target();
  if (!el || !el.getClientRects().length) return false;
  if (!box.hidden && !hintClose) return false; // the tutorial is showing
  hintClose?.();
  box.innerHTML = `<p>${text}</p><div class="row end">${key ? '<button class="skip">Don’t show again</button>' : '<span></span>'}<button class="primary next">Got it</button></div>`;
  box.hidden = false; ring.hidden = false;
  const place = () => placeNear(target());
  const timer = setTimeout(() => close(), timeout);
  const off = until?.(() => close());
  function close() {
    if (hintClose !== close) return;
    hintClose = null;
    clearTimeout(timer); off?.(); removeEventListener('resize', place);
    box.hidden = true; ring.hidden = true;
  }
  hintClose = close;
  box.querySelector('.next').onclick = close;
  box.querySelector('.skip')?.addEventListener('click', () => { storage.set(storeKey(`hint.${key}`), '1'); close(); });
  addEventListener('resize', place);
  requestAnimationFrame(place);
  return true;
}

// steps: [{ target: () => Element, text, waitFor?: 'click' }]
export function runTutorial(steps, { onDone } = {}) {
  if (tutorialDone()) return;
  const box = $('tips'), ring = $('tip-ring');
  let i = -1, cleanup = () => {};
  const finish = () => { cleanup(); box.hidden = true; ring.hidden = true; markDone(); onDone?.(); removeEventListener('resize', place); };

  function place() { placeNear(steps[i]?.target()); }

  function show(n) {
    cleanup();
    i = n;
    if (i >= steps.length) return finish();
    const st = steps[i], el = st.target();
    if (!el || !el.getClientRects().length) return show(i + 1); // control not on screen: skip that step
    const last = i === steps.length - 1;
    box.innerHTML = `<p>${st.text}</p><div class="row end"><button class="skip">Skip</button><span class="muted">${i + 1}/${steps.length}</span>${st.waitFor ? '' : `<button class="primary next">${last ? 'Got it' : 'Next'}</button>`}</div>`;
    box.hidden = false; ring.hidden = false;
    box.querySelector('.skip').onclick = finish;
    box.querySelector('.next')?.addEventListener('click', () => show(i + 1));
    if (st.waitFor === 'click') {
      const go = () => setTimeout(() => show(i + 1), 350); // let the interface appear first
      el.addEventListener('click', go, { once: true });
      cleanup = () => el.removeEventListener('click', go);
    } else cleanup = () => {};
    requestAnimationFrame(place);
  }
  addEventListener('resize', place);
  show(0);
}
