// Home base setup (beta): an easy way to set a home base on a computer, which usually has
// no GPS. Either use the computer's own location (desktop browsers locate by Wi-Fi, often
// to tens of metres), or type a street / postcode, which is accepted only if it's near where
// the internet connection places you. A home base still has to be where you really are
// (see Game.homeCheck); this just makes that practical without a phone.

import { deviceFix, ipFix } from '../game/locator.js';
import { RULES } from '../game/game.js';
import { fmtDist } from '../units.js';
import { esc } from '../util/html.js';

const $ = (id) => document.getElementById(id);

export function initHomeSetup(ctx, { parsePlace }) {
  const { game } = ctx;
  let pending = null;   // { pt, fix, via, place }
  let cb = {};          // { onSet, onLater }

  function open({ reason = '', onSet = null, onLater = null } = {}) {
    cb = { onSet, onLater };
    pending = null;
    const locked = game.homeLockedDays();
    $('homesetup-body').innerHTML = `
      ${reason ? `<p class="hs-reason">${reason}</p>` : ''}
      <p class="sub">Your home base is where you play from when you're not out walking: you can wander
        ${fmtDist(RULES.LEASH_M)} around it, and expeditions are dealt there. It has to be near where you
        really are, and it can only move once every ${RULES.HOME_COOLDOWN_DAYS} days.</p>
      ${locked ? `<p class="msg">Your home base is set. It can move again in ${locked} days.</p>` : `
      <button id="hs-device" class="primary hs-big">📍 Use this device's location</button>
      <p class="hint">Computers usually find themselves by Wi-Fi, often to within a few dozen metres. Your browser will ask first.</p>
      <form id="hs-form" class="row"><input id="hs-q" placeholder="…or type your street, postcode or a nearby place" autocomplete="off" aria-label="Your street, postcode or a nearby place" /><button type="submit">Find</button></form>
      <p id="hs-msg" class="msg"></p>
      <div id="hs-confirm" class="hs-confirm" hidden><p id="hs-where"></p><button id="hs-set" class="primary hs-big">Set my home base here</button></div>`}
      <div class="row end"><span></span><button id="hs-later">${locked ? 'Close' : 'Not now'}</button></div>`;
    $('homesetup').hidden = false;
    $('hs-later').onclick = later;
    if (locked) return;
    $('hs-device').onclick = useDevice;
    $('hs-form').onsubmit = (e) => { e.preventDefault(); useAddress($('hs-q').value); };
    $('hs-set').onclick = confirmSet;
  }
  function close() { $('homesetup').hidden = true; }
  function later() { close(); const f = cb.onLater; cb = {}; f?.(); }
  const msg = (t) => { $('hs-msg').textContent = t; };

  function propose(p) {
    pending = p;
    $('hs-where').innerHTML = p.via === 'address'
      ? `🏠 <b>${esc(p.place || 'That spot')}</b>`
      : `🏠 <b>Right where you are</b> <span class="muted">(±${fmtDist(p.fix.accuracy)})</span>`;
    $('hs-confirm').hidden = false;
    msg('');
  }

  async function useDevice() {
    msg('Asking for this device’s location…');
    $('hs-confirm').hidden = true;
    try {
      const fix = await deviceFix(15000);
      game.setFix(fix);
      if (fix.accuracy > 3000) return msg(`This device only knows roughly where it is (±${fmtDist(fix.accuracy)}). Type your street or postcode instead for a better home base.`);
      propose({ pt: { lat: fix.lat, lon: fix.lon }, fix, via: 'fix' });
    } catch (e) { msg(`Couldn’t get this device’s location (${e.message}). Type your street or postcode instead.`); }
  }

  async function useAddress(q) {
    if (!q.trim()) return;
    $('hs-confirm').hidden = true;
    try {
      // any real fix will do as the check; an internet (IP) lookup is enough for a typed address
      let fix = game.fix;
      if (!fix) { msg('Checking roughly where you are…'); fix = await ipFix(); game.setFix(fix); }
      msg('Finding that place…');
      const pt = await parsePlace(q);
      const why = game.homeCheck(pt, fix);
      if (why) return msg(why);
      propose({ pt: { lat: pt.lat, lon: pt.lon }, fix, via: 'address', place: (pt.name || q).split(',').slice(0, 3).join(',') });
    } catch (e) { msg(e.message); }
  }

  function confirmSet() {
    if (!pending) return;
    if (!game.setHomeAt(pending.pt, pending.fix, { via: pending.via, place: pending.place })) return;
    close();
    const f = cb.onSet; cb = {}; f?.();
  }

  $('homesetup').addEventListener('click', (e) => { if (e.target.id === 'homesetup') later(); });
  return { open, close, isOpen: () => !$('homesetup').hidden };
}
