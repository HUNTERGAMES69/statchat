// Clicking a ladder button twice leaves nothing highlighted
// =========================================================
// Reported on the dark game page: clicking Rush opens its tree and
// highlights the button; clicking it again collapses the tree and leaves
// the button still highlighted.
//
// TWO LISTENERS FIRE ON ONE CLICK. The button carries its own handler
// (target phase) and the rail carries a delegated one (bubble phase), and
// a listener on the target always runs first. So on a second click:
//
//   1. button handler  -> currentLadderType = null, collapsePlayPanel()
//   2. collapsePlayPanel -> __railClear -> the highlight is removed
//   3. rail handler bubbles -> and adds it straight back
//
// The fix asks __ladderOpen() -- the same record the button handler just
// updated -- rather than assuming a click always means "open".
//
// This models the two handlers and runs the sequence, because reading the
// code is what let the bug through in the first place.
//
//   node tests/ladder_toggle_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

// game.html is the CURRENT LIVE PAGE and has this bug today -- the check
// found it there too, which confirms the fault is pre-existing rather than
// something the dark conversion introduced. It is listed so that promoting
// gamedark over game.html fixes it, and so the run goes green at that
// point rather than staying permanently red.
const PAGES = ['game.html'];
// game.html WAS listed here while the fix lived only in gamedark.html.
// gamedark has now been promoted over it, so the allowance is empty and
// the real assertion runs on the live page. A stale allowance is a test
// that has quietly stopped testing.
const KNOWN_UNFIXED = new Set();

for (const f of PAGES) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');

  const dom = new JSDOM('<!doctype html><html><body>' +
    '<div id="typeRail">' +
    '<button class="ptypeBtn" data-type="rush">Rush</button>' +
    '<button class="ptypeBtn" data-type="pass">Pass</button>' +
    '<button id="manualBtn">Manual entry</button>' +
    '</div><div id="entryStage"></div></body></html>');
  const w = dom.window, d = w.document;
  const rail = d.getElementById('typeRail');

  // --- the two handlers, in the same shape as the page ---
  let currentLadderType = null;
  w.__ladderOpen = () => currentLadderType;
  const clearActive = () => rail.querySelectorAll('button.rail-active')
    .forEach(b => b.classList.remove('rail-active'));
  w.__railClear = () => clearActive();

  d.querySelectorAll('.ptypeBtn').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.type;
    if (currentLadderType === t) { currentLadderType = null; w.__railClear(); return; }
    currentLadderType = t;
  }));

  // the rail's delegated handler, lifted from the page so the test breaks
  // when the page changes
  //
  // IT DID BREAK, 5 September 2026, and correctly. The guard grew a second
  // clause: a rail button carrying aria-expanded owns a card of its own and
  // has its highlight re-asserted from the attribute after the sweep, so it
  // is not decided here as well. Deciding it twice is what left the Roster
  // button lit after the press that closed its card.
  //
  // The pattern below matches the guard by its SHAPE -- a `stillOpen` that
  // consults __ladderOpen, and a highlight applied only when it is true --
  // rather than by the exact opening clause, which is what went stale. What
  // this file is protecting is the ladder rule; the aria-expanded half is
  // driven against the real page in tests/rail_toggle_check.js, which is
  // where a behavioural claim about it belongs.
  const guarded = /const stillOpen =[\s\S]{0,320}?__ladderOpen\(\) === btn\.dataset\.type[\s\S]{0,120}?if \(stillOpen\) btn\.classList\.add\('rail-active'\)/.test(src);
  rail.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || !rail.contains(btn)) return;
    clearActive();
    if (!guarded) { btn.classList.add('rail-active'); return; }
    // Modelled in the same order as the page: sweep, re-assert the
    // self-describing toggles from their attribute, then decide the button
    // that was actually clicked -- skipping it if the attribute already
    // spoke for it.
    rail.querySelectorAll('button[aria-expanded="true"]')
        .forEach(b => b.classList.add('rail-active'));
    const isPlayType = btn.classList.contains('ptypeBtn');
    const stillOpen = !btn.hasAttribute('aria-expanded') &&
      (!isPlayType || w.__ladderOpen() === btn.dataset.type);
    if (stillOpen) btn.classList.add('rail-active');
  });

  const rush = d.querySelector('[data-type="rush"]');
  const pass = d.querySelector('[data-type="pass"]');
  const manual = d.getElementById('manualBtn');
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  click(rush);
  chk(rush.classList.contains('rail-active'), f + ': first click highlights Rush');
  chk(currentLadderType === 'rush', f + ': and opens its tree');

  click(rush);
  if (KNOWN_UNFIXED.has(f)) {
    console.log('  --   ' + f + ': second click still leaves the highlight — the same bug, ' +
                'live today, fixed when gamedark is promoted over it');
  } else {
    chk(!rush.classList.contains('rail-active'),
        f + ': SECOND click removes the highlight — the tree is closed, so nothing ' +
        'should look selected');
  }
  chk(currentLadderType === null, f + ': and the tree is closed');

  click(rush); click(pass);
  chk(pass.classList.contains('rail-active') && !rush.classList.contains('rail-active'),
      f + ': moving to Pass highlights only Pass');

  click(manual);
  chk(manual.classList.contains('rail-active'),
      f + ': a non-play-type button still highlights — Manual entry is not in the ' +
      'ladder record and must not be caught by the guard');
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
