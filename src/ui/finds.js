// The moment of a find. A new place gets a small card with its most surprising real fact
// ("Built 1676: older than the USA") instead of a line in the log, and arriving among several
// places at once is one message, not four. Some finds offer a ten-second challenge that turns
// the fact into a game:
//   places with a known build date: "When was it built?" (three eras)
//   creatures you spot:             "Which is it?" (its photo, three local names)
//   rock underfoot:                 "Older than the end of the dinosaurs?"
// Getting it right is "field mastery", kept in the profile (profile.data.mastery).

import { groupInfo } from '../world/icons.js';
import { yearOf } from '../game/quests.js';
import { factFor, eraChoices } from '../game/facts.js';
import { ageText } from '../data/science.js';
import { GROUP_STYLE } from '../data/wildlife.js';
import { esc, safeUrl } from '../util/html.js';
import { buzz } from '../sensors.js';
import { sfx } from '../sfx.js';
import { toast } from './hud.js';

export function initFinds(ctx) {
  const { game, profile } = ctx;
  const box = document.createElement('div');
  box.id = 'find';
  box.className = 'find';
  box.hidden = true;
  box.setAttribute('role', 'status');
  document.getElementById('hud').appendChild(box);
  let hideT = 0, queue = [], flushT = 0, busy = null;

  const mastered = (key) => !!profile.data.mastery?.[key];
  function master(key) {
    profile.data.mastery ||= {};
    if (!profile.data.mastery[key]) { profile.data.mastery[key] = new Date().toISOString().slice(0, 10); profile.save(); }
  }

  function show(html, { stay = false, onClick = null } = {}) {
    clearTimeout(hideT);
    box.innerHTML = html;
    box.hidden = false;
    box.classList.remove('in'); void box.offsetWidth; box.classList.add('in');
    box.onclick = onClick;
    if (!stay) hideT = setTimeout(hide, 6500);
  }
  function hide() { clearTimeout(hideT); box.hidden = true; box.onclick = null; busy?.(); busy = null; }
  const gradeWord = (g) => (g === 'echo' ? 'Echo' : g === 'home' ? 'Found from home' : 'Found');

  // ---------------------------------------------------------------- places
  function placeCard(ev) {
    const poi = ev.poi, info = groupInfo(poi.kind, poi.cls), fact = factFor(poi), y = yearOf(poi);
    const mysteryHere = ctx.game.quests?.active()?.ref === poi.ref; // its own age guess is coming
    const canQuiz = y && !mastered(`p:${poi.ref}`) && !mysteryHere;
    show(`<div class="f-top"><i class="f-dot" style="background:${info.color}"></i><small>${esc(info.label)} · ${gradeWord(ev.grade)}</small><button class="f-x" aria-label="Close">✕</button></div>
      <b class="f-name">${esc(poi.name)}</b>
      ${canQuiz ? `<p class="f-q">Quick: when was it built?</p><div class="f-opts">${eraChoices(y).map((o) => `<button data-era="${o.right ? 1 : 0}">${o.label}</button>`).join('')}</div>`
        : fact ? `<p class="f-fact">${esc(fact)}</p>` : '<p class="f-fact muted">Added to your journal.</p>'}`,
    { stay: !!canQuiz, onClick: (e) => {
      if (e.target.closest('.f-x')) return hide();
      const b = e.target.closest('[data-era]');
      if (b) {
        const right = b.dataset.era === '1';
        box.querySelectorAll('[data-era]').forEach((x) => { x.disabled = true; if (x.dataset.era === '1') x.classList.add('right'); });
        if (right) { master(`p:${poi.ref}`); sfx.right(); buzz([20, 30, 20]); } else { b.classList.add('wrong'); sfx.wrong(); buzz(40); }
        box.querySelector('.f-q').innerHTML = right ? '✓ Right! <b>Field mastery</b> for this place.' : `Not quite: ${esc(fact || `built ${y}`)}`;
        if (right && fact) box.querySelector('.f-q').insertAdjacentHTML('afterend', `<p class="f-fact">${esc(fact)}</p>`);
        clearTimeout(hideT); hideT = setTimeout(hide, 5000);
        return;
      }
      hide(); ctx.openPlace(poi);
    } });
  }

  // many finds at once (arriving somewhere new): one friendly line
  function flush() {
    const list = queue; queue = [];
    if (!list.length) return;
    sfx.discover(list[0].grade);
    if (list.length === 1) return placeCard(list[0]);
    const names = list.slice(0, 3).map((e) => e.poi.name);
    const more = list.length - names.length;
    show(`<div class="f-top"><i class="f-dot" style="background:var(--accent)"></i><small>${list[0].grade === 'echo' ? 'Echoes' : 'New finds'}</small><button class="f-x" aria-label="Close">✕</button></div>
      <b class="f-name">You arrived among ${list.length} places</b>
      <p class="f-fact">${esc(names.join(', '))}${more ? ` and ${more} more` : ''}. They’re in your journal.</p>`,
    { onClick: (e) => { hide(); if (!e.target.closest('.f-x')) ctx.openJournal?.('collections'); } });
  }

  // ---------------------------------------------------------------- creatures
  /** Before the species card: "Which is it?" with its photo and three local names. Calls done() after. */
  function quizSpecies(sp, done) {
    const key = `s:${sp.id}`;
    const others = (game.wild?.species || []).filter((s) => s.group === sp.group && s.id !== sp.id && s.name && s.name !== sp.name);
    if (!sp.photo || mastered(key) || others.length < 2 || !safeUrl(sp.photo)) return done();
    const pick = others.sort(() => Math.random() - 0.5).slice(0, 2).map((s) => s.name);
    const opts = [sp.name, ...pick].sort(() => Math.random() - 0.5);
    const label = GROUP_STYLE[sp.group]?.label || 'creature';
    busy = done;
    show(`<div class="f-top"><i class="f-dot" style="background:var(--species)"></i><small>You spotted ${/^[aeiou]/.test(label) ? 'an' : 'a'} ${esc(label)}!</small><button class="f-x" aria-label="Skip">Skip</button></div>
      <div class="f-sp"><img src="${esc(safeUrl(sp.photo))}" alt=""><div><p class="f-q">Which is it?</p><div class="f-opts col">${opts.map((n) => `<button data-sp="${n === sp.name ? 1 : 0}">${esc(n)}</button>`).join('')}</div></div></div>`,
    { stay: true, onClick: (e) => {
      if (e.target.closest('.f-x')) return hide();
      const b = e.target.closest('[data-sp]');
      if (!b) return;
      const right = b.dataset.sp === '1';
      box.querySelectorAll('[data-sp]').forEach((x) => { x.disabled = true; if (x.dataset.sp === '1') x.classList.add('right'); });
      if (right) { master(key); sfx.right(); buzz([20, 30, 20]); } else { b.classList.add('wrong'); sfx.wrong(); buzz(40); }
      box.querySelector('.f-q').innerHTML = right ? '✓ Right! <b>Field mastery</b>.' : `It’s ${esc(sp.name)}.`;
      clearTimeout(hideT); hideT = setTimeout(hide, 1800);
    } });
  }

  // ---------------------------------------------------------------- rock
  function rockFound(rock) {
    const key = `r:${rock.name}`, mid = rock.top != null && rock.bottom != null ? (rock.top + rock.bottom) / 2 : null;
    sfx.discover();
    const canQuiz = mid != null && !mastered(key) && Math.abs(mid - 66) > 3; // ambiguous right at the boundary: no quiz
    const age = ageText(rock);
    show(`<div class="f-top"><i class="f-dot" style="background:#b08a5a"></i><small>New rock underfoot</small><button class="f-x" aria-label="Close">✕</button></div>
      <b class="f-name">${esc(rock.name)}</b>
      ${canQuiz ? '<p class="f-q">Is it older than the end of the dinosaurs (66 million years ago)?</p><div class="f-opts"><button data-old="1">Older</button><button data-old="0">Younger</button></div>'
        : `<p class="f-fact">${esc([rock.lith?.split(',')[0], age].filter(Boolean).join(', '))}.</p>`}`,
    { stay: canQuiz, onClick: (e) => {
      if (e.target.closest('.f-x')) return hide();
      const b = e.target.closest('[data-old]');
      if (!b) return;
      const right = (b.dataset.old === '1') === mid > 66;
      box.querySelectorAll('[data-old]').forEach((x) => { x.disabled = true; if ((x.dataset.old === '1') === mid > 66) x.classList.add('right'); });
      if (right) { master(key); sfx.right(); buzz([20, 30, 20]); } else { b.classList.add('wrong'); sfx.wrong(); buzz(40); }
      box.querySelector('.f-q').innerHTML = `${right ? '✓ Right! ' : ''}It’s ${esc(age)}${mid > 66 ? ': it was already here when dinosaurs walked the Earth.' : ': it formed after the dinosaurs were gone.'}`;
      clearTimeout(hideT); hideT = setTimeout(hide, 6000);
    } });
  }

  return {
    /** a 'discover' game event */
    discovered(ev) {
      if (ev.result !== 'new') { toast(ev.msg, ev.grade); sfx.chime(3); return; }
      if (busy) { toast(ev.msg, ev.grade); return; } // a challenge is open: don't interrupt it
      queue.push(ev);
      clearTimeout(flushT);
      flushT = setTimeout(flush, 900);
    },
    quizSpecies,
    rockFound,
    get open() { return !box.hidden; },
    masteryCount: () => Object.keys(profile.data.mastery || {}).length,
  };
}
