// Super-mini tutorial for first-time players: a few coach marks that point at the real
// controls. Step 1 starts with everything hidden and waits for the player to tap the eye.
// Shown once per device; skippable; never shown again.

import { storeKey } from '../channel.js';
import { storage } from '../storage.js';

const KEY = storeKey('tipsDone');
const $ = (id) => document.getElementById(id);

export function tutorialDone() { return !!storage.get(KEY); }
function markDone() { storage.set(KEY, '1'); }

// steps: [{ target: () => Element, text, waitFor?: 'click' }]
export function runTutorial(steps, { onDone } = {}) {
  if (tutorialDone()) return;
  const box = $('tips'), ring = $('tip-ring');
  let i = -1, cleanup = () => {};
  const finish = () => { cleanup(); box.hidden = true; ring.hidden = true; markDone(); onDone?.(); removeEventListener('resize', place); };

  function place() {
    const st = steps[i], el = st?.target();
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
