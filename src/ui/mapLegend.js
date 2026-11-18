// How to read the minimap: a small picture key. Shown the first time the minimap is tapped
// (then the tap opens the journal map as usual), and from "What the marks mean" on the
// journal's Map tab. The swatches use the minimap's own colours (src/ui/minimap.js).

import { storeKey } from '../channel.js';
import { storage } from '../storage.js';

const SEEN = storeKey('mapLegendSeen');
const $ = (id) => document.getElementById(id);

const ROWS = [
  ['<i class="lg-you"></i>', '<b>You</b>, in the middle. The map turns with you: <b>up is the way you’re facing</b>, and the gold <b>N</b> on the rim points north.'],
  ['<i class="lg-sq" style="background:rgba(225,235,210,0.55)"></i>', 'Ground you’ve <b>walked</b> lights up, about 150 m at a time. The dark is ground you haven’t explored yet.'],
  ['<i class="lg-sq" style="background:rgba(120,200,255,0.42)"></i><i class="lg-sq" style="background:rgba(176,122,255,0.30)"></i>', 'Blue: explored <b>from home</b>. Purple: only seen in <b>Roam</b>.'],
  ['<i class="lg-dot" style="background:#e2603a"></i><i class="lg-dot" style="background:#36b06c"></i><i class="lg-dot" style="background:#8e6bd2"></i>', 'Coloured dots: real places you <b>haven’t found yet</b> (the colour is the kind of place, as on the map icons).'],
  ['<i class="lg-dot" style="background:rgba(160,160,160,0.6)"></i>', 'Grey dots: places you’ve <b>already found</b>.'],
  ['<i class="lg-dot" style="background:#3db8ff"></i>', 'Your <b>home base</b>.'],
  ['<i class="lg-ring"></i>', 'A <b>creature</b> close by: walk up to it.'],
  ['<i class="lg-glow"></i>', 'A green glow: an animal you’re <b>tracking</b>. It tightens as you get closer.'],
  ['<i class="lg-arc"></i>', 'A gold arc on the rim: the way to <b>today’s treasure</b>.'],
  ['<i class="lg-zone"></i>', 'A dashed gold circle: a mystery’s <b>search area</b> (a clue you bought).'],
  ['<i class="lg-pin"></i>', 'A pin: an expedition’s <b>finish</b> or the animal’s habitat. When it’s further than the map shows, it sits on the rim, pointing the way.'],
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
    <h2>Reading your minimap</h2>
    <ul>${ROWS.map(([sw, text]) => `<li><span class="lg-sw">${sw}</span><span>${text}</span></li>`).join('')}</ul>
    <p class="hint">On an expedition, the ring around your character points the way too: blue when it’s far, gold when you’re getting close, orange when you’re very close.</p>
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
