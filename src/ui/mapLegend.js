// How to read the minimap: a small picture key. Shown the first time the minimap is tapped
// (then the tap opens the journal map as usual), and from "What the marks mean" on the
// journal's Map tab. The swatches use the minimap's own colours (src/ui/minimap.js).

import { storeKey } from '../channel.js';
import { storage } from '../storage.js';

const SEEN = storeKey('mapLegendSeen');
const $ = (id) => document.getElementById(id);

const ROWS = [
  ['<i class="lg-you"></i>', '<b>You</b>, in the middle. The radar turns with you: <b>up is the way you’re facing</b>; the gold <b>N</b> on the rim points north.'],
  ['<i class="lg-rings"></i>', 'The two faint rings are <b>100 m</b> and <b>250 m</b> away; the rim is about 300 m.'],
  ['<i class="lg-star">★</i>', 'Your <b>expedition’s goal</b>, with how far it is. Further than the radar shows, it sits on the rim, pointing the way.'],
  ['<i class="lg-icon" style="background:#e2603a">★</i><i class="lg-icon" style="background:#8e6bd2">⏳</i>', 'The nearest <b>places you haven’t found yet</b>, with the same icons as on the map (landmarks first).'],
  ['<span class="lg-emoji">🐾</span>', 'An animal you’re <b>tracking</b>: the green glow is the area it’s in, and tightens as you get closer.'],
  ['<i class="lg-dot" style="background:#5fd08a;width:12px;height:12px;border:2px solid #fff"></i>', 'A creature that has <b>shown itself</b>: walk up to it.'],
  ['<span class="lg-emoji" style="color:#ffd36b">✦</span>', '<b>Today’s treasure</b>: on the rim when it’s about (pointing the way), on the spot when you’re close.'],
  ['<span class="lg-emoji">🎯</span>', 'A bounty’s <b>habitat</b>, where its animal likes to be.'],
  ['<i class="lg-zone"></i>', 'A dashed gold circle: a mystery’s <b>search area</b> (a clue you bought).'],
  ['<span class="lg-emoji">🏠</span>', 'Your <b>home base</b>.'],
];

export function showLegend({ onMap = null } = {}) {
  let box = $('maplegend');
  if (!box) {
    box = document.createElement('div');
    box.id = 'maplegend';
    box.className = 'modal';
    document.body.appendChild(box);
  }
  box.innerHTML = `<div class="card legend">
    <h2>Reading your radar</h2>
    <ul>${ROWS.map(([sw, text]) => `<li><span class="lg-sw">${sw}</span><span>${text}</span></li>`).join('')}</ul>
    <p class="hint">The ground you’ve explored is on the journal’s Map. On an expedition, the ring around your character points the way too: blue when it’s far, gold when you’re getting close, orange when you’re very close.</p>
    <div class="row end">${onMap ? '<button data-lg="map">Open the full map</button>' : '<span></span>'}<button class="primary" data-lg="ok">Got it</button></div>
  </div>`;
  box.hidden = false;
  storage.set(SEEN, '1');
  box.onclick = (e) => {
    const b = e.target.closest('[data-lg]');
    if (!b && e.target !== box) return;
    box.hidden = true;
    if (b?.dataset.lg === 'map') onMap?.();
  };
}

/** The minimap's tap: the key the first time, the journal map after that. */
export function minimapTap(openMap) {
  if (!storage.get(SEEN)) showLegend({ onMap: openMap });
  else openMap();
}
