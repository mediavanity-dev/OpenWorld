// Three-step first-run tips. Skippable; shown once per device.
const KEY = 'openworld.tipsDone';
const $ = (id) => document.getElementById(id);

export function maybeShowTips(isTouch) {
  try { if (localStorage.getItem(KEY)) return; } catch { return; }
  const steps = [
    isTouch ? 'Drag to look around and pinch to zoom. In Present mode you move by walking for real.' : 'Drag to look around, scroll to zoom, and use W A S D to move (in Home or Roam).',
    'Walk within 30 m of a coloured marker to discover a real place. Tap any marker or name for details.',
    'Open the 📓 Journal for your collections, records and today\'s field assignment, and 📍 This spot for the geology, sky and history around you.',
  ];
  let i = 0;
  const el = $('tips');
  const done = () => { el.hidden = true; try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } };
  const show = () => {
    el.innerHTML = `<p>${steps[i]}</p><div class="row end"><button class="skip">Skip</button><span class="muted">${i + 1}/${steps.length}</span><button class="primary next">${i === steps.length - 1 ? 'Got it' : 'Next'}</button></div>`;
    el.querySelector('.skip').onclick = done;
    el.querySelector('.next').onclick = () => (++i < steps.length ? show() : done());
  };
  el.hidden = false;
  show();
}
