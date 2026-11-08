// Expeditions (beta) UI: the quest board dealt when you open the game, the active quest in
// the HUD and tracker pill, the age guess at the end of a mystery, the card reveal, and the
// card collection. Game rules live in src/game/quests.js.

import { ERAS, RARITIES, allDone, bearingTo, sectorOf } from '../game/quests.js';
import { GROUP_STYLE } from '../data/wildlife.js';
import { wikiSummary } from '../data/wiki.js';
import { groupInfo } from '../world/icons.js';
import { haversine } from '../geo.js';
import { fmtDist, fmtElev } from '../units.js';
import { esc, safeUrl } from '../util/html.js';
import { buzz } from '../sensors.js';
import { toast } from './hud.js';

const $ = (id) => document.getElementById(id);
const TYPE = {
  mystery: { glyph: '🔍', label: 'Mystery', verb: 'Deduce' },
  bounty: { glyph: '🎯', label: 'Bounty', verb: 'Track' },
  race: { glyph: '⏱', label: 'Race', verb: 'Beat the clock' },
};
const RARITY_LABEL = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
const starsHtml = (n, of = 3) => `<span class="qstars">${'<i class="on">★</i>'.repeat(n)}${'<i>★</i>'.repeat(Math.max(0, of - n))}</span>`;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.round(s % 60))).padStart(2, '0')}`;

export function initExpeditions(ctx) {
  const { game, profile } = ctx;
  let tab = 'today';
  let onClose = null;

  const q = () => game.quests;
  const on = () => !!game.features.quests && !!q();

  // ---------------------------------------------------------------- board
  function open(which) {
    if (!on()) return;
    if (which) tab = which;
    $('quests').hidden = false;
    render();
  }
  function close() {
    $('quests').hidden = true;
    const f = onClose; onClose = null; f?.();
  }
  function isOpen() { return !$('quests').hidden; }

  function header() {
    const r = q().rank(), cards = q().s.cards.length;
    return `<div class="qrank">
      <div class="qbadge" aria-hidden="true">${r.level}</div>
      <div class="qrank-txt"><b>${esc(r.name)}</b><small>${r.stars}★${r.next ? ` · ${r.next - r.stars} to ${esc(nextName(r))}` : ' · top rank'}</small>
        <div class="qbar"><i style="width:${Math.round(r.frac * 100)}%"></i></div></div>
      <div class="qcount"><b>${cards}</b><small>cards</small></div>
    </div>
    <div class="jtabs"><button data-qtab="today" class="${tab === 'today' ? 'active' : ''}">Today</button><button data-qtab="cards" class="${tab === 'cards' ? 'active' : ''}">Your cards</button></div>`;
  }
  function nextName(r) { const i = r.level; return ['Scout', 'Pathfinder', 'Tracker', 'Ranger', 'Surveyor', 'Naturalist', 'Explorer', 'Cartographer', 'Legend'][i - 1] || ''; }

  function render() {
    if (!isOpen()) return;
    const s = q().s;
    let body;
    if (tab === 'today') {
      const act = q().active();
      body = `<p class="qintro">${act ? 'On an expedition. Tap it for clues and progress.' : 'Pick one. Each is built from real places, wildlife and terrain around you.'}${game.mode === 'roam' ? ' <span class="echo-note">Roam: cards are echoes (no stars) until you play for real.</span>' : ''}</p>
        <div class="qdeck">${s.offers.map((o, i) => offerHtml(o, i, act)).join('')}</div>
        ${allDone(s) ? '<button class="primary qmore" data-qmore>Deal three more</button>' : ''}`;
    } else body = cardsHtml();
    const html = header() + body;
    const el = $('quests-body');
    if (el.dataset.v !== html) { el.dataset.v = html; el.innerHTML = html; }
  }

  function offerHtml(o, i, act) {
    if (!o) return `<article class="qcard scouting"><div class="qtop"><span class="qtype">Scouting…</span></div><div class="qart shimmer"></div><p class="qhook">Reading the map, the wildlife records and the lie of the land around you.</p></article>`;
    const T = TYPE[o.type], isAct = act?.id === o.id, locked = act && !isAct;
    const meta = [];
    let art, hook, extra = '';
    if (o.type === 'mystery') {
      const col = groupInfo(o.place.kind, o.place.cls).color;
      art = `<div class="qart mystery" style="--c:${col}"><span>?</span></div>`;
      hook = `<p class="qriddle">“${esc(o.riddle)}”</p><p class="qhook">Somewhere to the <b>${o.sector}</b>, about ${fmtDist(o.dist)} away.${o.alike >= 2 ? ` One of ${o.alike} places like it in that direction.` : ''}</p>`;
      meta.push(`${o.clues.length} clues to buy · each costs ★`);
      if (isAct) extra = cluesHtml(o);
    } else if (o.type === 'bounty') {
      art = `<div class="qart bounty">${o.sp.photo && safeUrl(o.sp.photo) ? `<img src="${esc(o.sp.photo)}" alt="" loading="lazy" />` : `<span style="color:${GROUP_STYLE[o.sp.group]?.color || '#5fd08a'}">●</span>`}<em>WANTED</em></div>`;
      const lbl = GROUP_STYLE[o.sp.group]?.label || 'creature';
      hook = `<p class="qhook"><i>${esc(o.sp.sci || '')}</i>, ${/^[aeiou]/.test(lbl) ? 'an' : 'a'} ${esc(lbl)} recorded <b>${o.sp.count}</b> times near here by real naturalists.</p>
        <p class="qhook">${o.habitat ? `It favours ${esc(o.habitat.text)}: the nearest is ${o.habitat.d ? `about ${fmtDist(o.habitat.d)} to the <b>${o.habitat.sector}</b>` : '<b>right here</b>'}.` : 'It gets by among the streets. Keep your eyes open as you walk.'}</p>`;
      meta.push('Follow its signs · approach gently');
      if (o.fled) meta.push(`Fled ${o.fled}×`);
      if (o.sp.credit) extra += `<p class="credit">Photo: ${esc(o.sp.credit)}</p>`;
    } else {
      art = `<div class="qart race ${o.sunset ? 'sunset' : ''}"><span>${o.sunset ? '🌅' : o.kind === 'summit' ? '⛰' : '🚩'}</span></div>`;
      const where = `${fmtDist(o.dist)} to the <b>${sectorOf(bearingTo(game.pos || o, o))}</b>`;
      hook = `<p class="qhook">${o.kind === 'summit' ? `The highest ground around is <b>${fmtElev(o.gain)}</b> above you, ${where}.` : `${where}.`}</p>
        <p class="qhook">${o.sunset ? `Sunset in <b>${Math.max(0, Math.round((o.sunsetAt - Date.now()) / 60000))} min</b>. Get there before it goes.` : `Par time <b>${mmss(o.par)}</b>. Beat it for three stars.`}</p>`;
      if (isAct && o.startedAt) meta.push(`Clock: ${mmss((Date.now() - o.startedAt) / 1000)} / ${mmss(o.par)}`);
    }
    const btns = o.done ? '<span class="qdone">✓ Done</span>'
      : isAct ? '<button data-qabandon>Give up</button><button class="primary" data-qclose>Go!</button>'
      : `${q().s.swaps > 0 && !locked ? `<button data-qswap="${i}" title="Swap for a different one (once a day)">↻ Swap</button>` : ''}<button class="primary" data-qaccept="${esc(o.id)}" ${locked ? 'disabled' : ''}>${locked ? 'One at a time' : 'Accept'}</button>`;
    return `<article class="qcard ${o.type} r-${o.rarity} ${isAct ? 'active' : ''} ${o.done ? 'done' : ''}">
      <div class="qtop"><span class="qtype">${T.glyph} ${T.label} <small>${T.verb}</small></span><span class="qgem r-${o.rarity}" title="Reward">${RARITY_LABEL[o.rarity]} card</span></div>
      ${art}<h3>${esc(o.title)}</h3>${hook}
      ${meta.length ? `<p class="qmeta">${meta.join(' · ')}</p>` : ''}${extra}
      <div class="qbtns">${btns}</div></article>`;
  }

  function cluesHtml(o) {
    const left = Math.max(1, 3 - o.used.length);
    return `<div class="qclues"><p class="qmeta">Worth ${starsHtml(left)} now${o.place.year ? ' · guess its age at the end to win one back' : ''}</p>
      ${o.clues.map((c) => o.used.includes(c.key)
        ? `<div class="qclue got">💡 ${esc(c.text)}</div>`
        : `<button class="qclue" data-qclue="${c.key}">💡 ${esc(c.label)} <small>−★</small></button>`).join('')}</div>`;
  }

  function cardsHtml() {
    const cards = q().s.cards;
    if (!cards.length) return '<p class="qintro">No cards yet. Finish an expedition to win your first one.</p>';
    const byR = {};
    for (const c of cards) byR[c.rarity] = (byR[c.rarity] || 0) + 1;
    return `<p class="qintro">${RARITIES.slice().reverse().filter((r) => byR[r]).map((r) => `<span class="qgem r-${r}">${byR[r]} ${RARITY_LABEL[r]}</span>`).join(' ')}</p>
      <div class="qgrid">${cards.map((c, i) => `<button class="qmini r-${c.rarity} ${c.grade === 'echo' ? 'echo' : ''}" data-qcard="${i}">
        <span class="qmini-t">${TYPE[c.type].glyph}</span><b>${esc(c.name || '')}</b>${starsHtml(c.stars)}<small>${esc(c.date)}</small></button>`).join('')}</div>`;
  }

  $('quests').addEventListener('click', (e) => {
    const t = e.target;
    if (t.id === 'quests' || t.closest('#quests-close') || t.closest('[data-qclose]')) return close();
    const b = t.closest('button');
    if (!b) return;
    if (b.dataset.qtab) { tab = b.dataset.qtab; render(); }
    else if (b.dataset.qaccept) {
      q().accept(b.dataset.qaccept);
      buzz([20, 30, 20]); ctx.ambience.chime(4);
      render();
      const o = q().active();
      if (o?.type !== 'mystery') setTimeout(close, 450); // mysteries stay open so you can read the riddle
    } else if (b.dataset.qswap) { if (!q().swap(+b.dataset.qswap)) toast('Nothing else to swap in around here right now.'); render(); }
    else if (b.dataset.qabandon) { if (confirm('Give up this expedition? It goes back on the board.')) { q().abandon(); render(); } }
    else if (b.dataset.qclue) { const c = q().buyClue(b.dataset.qclue); if (c) { buzz(15); ctx.ambience.chime(2); } render(); }
    else if (b.dataset.qmore !== undefined) { q().more(); render(); }
    else if (b.dataset.qcard) reveal(q().s.cards[+b.dataset.qcard], { replay: true });
  });
  $('quests-close').onclick = close;

  // ---------------------------------------------------------------- HUD: the "Today" button + tracker pill
  // Returns true if it drew the expedition (so the field assignment stays out of the way).
  function hud() {
    if (!on()) return false;
    const o = q().active(), s = q().s;
    const nm = $('n-name'), nd = $('n-dist'), na = $('n-arrow'), lbl = document.querySelector('#nearest .n-label');
    $('nearest').classList.add('quest');
    $('nearest').classList.remove('done');
    if (lbl) lbl.textContent = 'Expedition';
    let arrow = null;
    if (!o) {
      const open = s.offers.filter((x) => x && !x.done).length;
      nm.textContent = open ? `${open} expedition${open > 1 ? 's' : ''} waiting` : allDone(s) ? 'All done! Deal three more' : 'Scouting the area…';
      nd.textContent = `${q().rank().name} · ${q().stars()}★ · tap to choose`;
      na.textContent = '✦';
    } else if (o.type === 'mystery') {
      nm.textContent = `Who am I? “${o.riddle}”`;
      nd.textContent = `${o.sector} · ${o.used.length}/${o.clues.length} clues · worth ${'★'.repeat(Math.max(1, 3 - o.used.length))}`;
      na.textContent = '🔍';
    } else if (o.type === 'bounty') {
      nm.textContent = `Wanted: ${o.sp.name}`;
      const h = o.habitat, dh = h && game.pos ? haversine(game.pos.lat, game.pos.lon, h.lat, h.lon) : null;
      nd.textContent = game.hunt?.sp.id === o.sp.id ? 'On its trail! Follow the signs.' : h ? (dh < 40 ? `You're in ${h.text}. Walk and watch for signs.` : `Head for ${h.text} · ${fmtDist(dh)}`) : 'Walk and watch for signs';
      if (h && dh >= 40) arrow = bearingTo(game.pos, h); else na.textContent = '🎯';
    } else {
      const t = o.startedAt ? (Date.now() - o.startedAt) / 1000 : 0;
      nm.textContent = o.title;
      nd.textContent = `${o.live != null ? fmtDist(o.live) : ''} · ${o.sunset ? `sunset in ${mmss((o.sunsetAt - Date.now()) / 1000)}` : `${mmss(t)} / par ${mmss(o.par)}`}`;
      arrow = game.pos ? bearingTo(game.pos, o) : null;
    }
    if (arrow != null) { na.textContent = '↑'; na.style.transform = `rotate(${arrow + (ctx.controls.yaw * 180) / Math.PI}deg)`; }
    else na.style.transform = '';
    return true;
  }
  // a compact chip for the tracker pill (visible even in the map-only view)
  function chip() {
    if (!on()) return '';
    const o = q().active();
    if (!o) return q().s.offers.some((x) => x && !x.done) && !isOpen() ? '<span class="tk-quest idle">✦ Expeditions</span>' : '';
    const yaw = (ctx.controls.yaw * 180) / Math.PI;
    if (o.type === 'race' && game.pos) {
      const t = o.startedAt ? (Date.now() - o.startedAt) / 1000 : 0;
      const late = o.sunset ? false : t > o.par;
      return `<span class="tk-quest race ${late ? 'late' : ''}">⏱ ${o.sunset ? `🌅 ${mmss((o.sunsetAt - Date.now()) / 1000)}` : mmss(t)}<i style="transform:rotate(${Math.round((bearingTo(game.pos, o) + yaw) / 5) * 5}deg)">↑</i></span>`;
    }
    if (o.type === 'mystery') return `<span class="tk-quest">🔍 ${o.sector}</span>`;
    return `<span class="tk-quest">🎯 ${esc(o.sp.name)}</span>`;
  }
  // what the minimap should draw for the active quest
  function minimap() {
    const o = on() ? q().active() : null;
    if (!o) return null;
    if (o.type === 'mystery') { const z = o.used.includes('zone') && o.clues.find((c) => c.key === 'zone'); return z ? { zone: z.zone } : null; }
    if (o.type === 'race') return { target: { lat: o.lat, lon: o.lon } };
    if (o.type === 'bounty' && o.habitat?.d) return { habitat: { lat: o.habitat.lat, lon: o.habitat.lon } };
    return null;
  }

  // ---------------------------------------------------------------- the age guess
  function guess() {
    const box = $('reveal');
    box.innerHTML = `<div class="rv-card guess">
      <p class="rv-kicker">🔍 You found it!</p>
      <h2>Before the reveal: how old is it?</h2>
      <p class="qhook">Look at it. Its stone, its style, its wear. Get the era right to win a star back.</p>
      <div class="eras">${ERAS.map((e) => `<button data-era="${e.id}">${e.label}</button>`).join('')}</div>
      <button class="link" data-era="skip">Skip</button></div>`;
    box.hidden = false;
    box.onclick = (e) => {
      const b = e.target.closest('[data-era]');
      if (!b) return;
      box.onclick = null;
      q().guess(b.dataset.era === 'skip' ? null : b.dataset.era);
    };
  }

  // ---------------------------------------------------------------- the reveal
  async function reveal(card, { replay = false, rank = null, rankUp = null, before = null } = {}) {
    const box = $('reveal');
    const T = TYPE[card.type], reduce = document.body.classList.contains('reduce-motion');
    const facts = [];
    const img = card.img && safeUrl(card.img) ? card.img : null;
    if (card.type === 'mystery') {
      if (card.year) facts.push(`Built ${card.year} · ${new Date().getFullYear() - card.year} years old`);
      facts.push(`Solved with ${card.clues || 'no'} clue${card.clues === 1 ? '' : 's'}`);
      if (card.guessRight != null) facts.push(card.guessRight ? '🎯 Dated it correctly: +★' : 'Age guess: not quite');
    } else if (card.type === 'bounty') {
      facts.push(`<i>${esc(card.sci || '')}</i>`);
      facts.push(card.photo ? '📸 Photographed in the field' : 'Tracked down on foot');
    } else {
      facts.push(`Time ${mmss(card.secs)} · par ${mmss(card.par)}`);
      if (card.gain) facts.push(`Climbed ${fmtElev(card.gain)}${card.ground != null ? ` to ${fmtElev(card.ground)} above sea level` : ''}`);
      if (card.sunset) facts.push('🌅 Made it before sunset');
    }
    if (card.grade === 'echo') facts.push('<span class="echo-note">Echo: found in Roam. Do it for real to earn stars.</span>');
    const front = (wiki) => `
      <div class="rv-face rv-front r-${card.rarity}">
        <div class="rv-top"><span>${T.glyph} ${T.label}</span><span class="qgem r-${card.rarity}">${RARITY_LABEL[card.rarity]}</span></div>
        <div class="rv-img">${(wiki?.thumb || img) ? `<img src="${esc(wiki?.thumb || img)}" alt="" />` : `<span>${T.glyph}</span>`}</div>
        <h2>${esc(card.name || '')}</h2>
        <div class="rv-stars">${[1, 2, 3].map((k) => `<i class="${k <= card.stars ? 'on' : ''}" style="animation-delay:${reduce ? 0 : 0.9 + k * 0.25}s">★</i>`).join('')}</div>
        <p class="rv-facts">${facts.join('<br>')}</p>
        ${wiki?.extract ? `<p class="rv-wiki">${esc(wiki.extract.slice(0, 240))}${wiki.extract.length > 240 ? '…' : ''} ${safeUrl(wiki.url) ? `<a href="${esc(wiki.url)}" target="_blank" rel="noopener">Wikipedia</a>` : ''}</p>` : ''}
        ${card.credit ? `<p class="credit">Photo: ${esc(card.credit)}</p>` : ''}
      </div>`;
    const r = rank || q().rank();
    const gained = card.grade === 'echo' ? 0 : card.stars;
    const rankHtml = replay ? '' : `<div class="rv-rank">${rankUp ? `<p class="rv-up">Rank up! You're now a <b>${esc(rankUp.name)}</b></p>` : ''}
      <div class="qrank small"><div class="qbadge">${r.level}</div><div class="qrank-txt"><b>${esc(r.name)}</b><small>+${gained}★ · ${r.stars}★ total</small>
      <div class="qbar"><i style="width:${Math.round(((before && !rankUp ? before.frac : 0)) * 100)}%" data-to="${Math.round(r.frac * 100)}"></i></div></div></div></div>`;
    box.innerHTML = `<div class="rv-flip ${reduce || replay ? 'flipped' : ''}">
        <div class="rv-face rv-back r-${card.rarity}"><span>${T.glyph}</span><b>${RARITY_LABEL[card.rarity]}</b></div>
        ${front(null)}
      </div>${rankHtml}
      <div class="rv-btns">${replay ? '<button class="primary" data-rv="close">Close</button>' : `<button data-rv="close">Keep exploring</button><button class="primary" data-rv="board">${allDone(q().s) ? 'Deal three more' : 'Next expedition'}</button>`}</div>`;
    box.hidden = false;
    if (!replay) {
      buzz([30, 50, 30, 50, 90]);
      ctx.ambience.chime(RARITIES.indexOf(card.rarity) + 6);
      setTimeout(() => box.querySelector('.rv-flip')?.classList.add('flipped'), reduce ? 0 : 650);
      setTimeout(() => { const bar = box.querySelector('.rv-rank .qbar i'); if (bar) bar.style.width = `${bar.dataset.to}%`; }, reduce ? 0 : 1500);
    }
    box.onclick = (e) => {
      const b = e.target.closest('[data-rv]');
      if (!b) return;
      box.hidden = true; box.onclick = null;
      if (b.dataset.rv === 'board') { q().more(); open('today'); }
    };
    // the story behind a place, when it has one
    if (card.type === 'mystery' && card.tags && (card.tags.wikipedia || card.tags.wikidata)) {
      const wiki = await wikiSummary(card.tags).catch(() => null);
      if (wiki && !box.hidden) {
        const f = box.querySelector('.rv-front');
        if (f) f.outerHTML = front(wiki);
        if (wiki.thumb && !card.img) { card.img = wiki.thumb; profile.save(); }
      }
    }
  }

  // ---------------------------------------------------------------- events from the rules
  function onEvent(ev) {
    if (ev.type === 'quest-done') { closeBoardQuietly(); reveal(ev.card, ev); ctx.hud.render(); }
    else if (ev.type === 'quest-guess') { closeBoardQuietly(); buzz([20, 40, 20]); ctx.ambience.chime(7); guess(); }
    else if (ev.type === 'quest-wrong') { toast(ev.msg, 'quest'); buzz(25); }
    else if (ev.type === 'quest-info' || ev.type === 'quest-redeal') toast(ev.msg, 'quest');
    else if (ev.type === 'quest-start') {
      const o = ev.quest;
      if (o.type === 'race') toast(o.sunset ? 'The race is on! Beat the sunset.' : `The race is on! Par ${mmss(o.par)}.`, 'quest');
      else if (o.type === 'bounty') toast(`Bounty accepted: ${o.sp.name}. ${o.habitat?.d ? `Head for ${o.habitat.text}.` : 'Walk and watch for signs.'}`, 'quest');
    }
    else if (ev.type === 'quest-dealt') render();
  }
  function closeBoardQuietly() { $('quests').hidden = true; }

  // show the board when the game starts (then run `after`, e.g. the first-run tutorial)
  let shown = false;
  function openOnStart(after) {
    if (!on()) return false;
    if (shown) { if (onClose) { onClose = after || null; return true; } return false; } // still waiting for the first close
    shown = true;
    onClose = after || null;
    setTimeout(() => open('today'), 500);
    return true;
  }

  setInterval(() => { if (isOpen() && tab === 'today') render(); }, 1000); // clocks, scouting

  return { open, close, render, hud, chip, minimap, onEvent, openOnStart, isOpen };
}
