// The StatChat mark in game.html's header — the fifth attempt, and why
// ====================================================================
// FOUR EARLIER ATTEMPTS FAILED, all for one reason nobody had looked for:
//
//     #headerLeft > *, #topActions > * { height:auto !important; }
//
// A rule on DIRECT CHILDREN, with !important. A class rule loses to it, an
// inline style loses to it, and a runtime exemption inside layoutHeader()
// does not help because the rule is CSS, not script. Every attempt put the
// image directly in #headerLeft, so every attempt was overruled by that one
// line — and each was "verified" by reading the file, which showed the
// intended rule sitting there looking correct.
//
// THE FIX IS STRUCTURAL, not a stronger declaration. A <span> wrapper is
// the direct child and absorbs everything aimed at one: height:auto, the
// padding, layoutHeader's inline !important writes on touch, and the clear()
// on desktop. The <img> is one level deeper, where none of that reaches.
//
// There are FOUR separate mechanisms rewriting things in that header, and
// the wrapper is immune to all four rather than negotiating with each:
//   1. #headerLeft > *          height:auto + padding, !important
//   2. layoutHeader() touch     strips height/width, forces display:flex
//   3. layoutHeader() desktop   clear() removes the same properties
//   4. the banner sync          sets an explicit height on #headerLeft,
//                               which align-items:stretch passes down
//
//   node tests/game_mark_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Runs against gamemock.html until the change is promoted, then game.html.
const FILE = ['gamemock.html', 'game.html']
  .map(f => path.join(__dirname, '..', f))
  .find(f => fs.existsSync(f) && /scMarkBox/.test(fs.readFileSync(f, 'utf8')));

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

if (!FILE) {
  console.log('  FAIL  neither gamemock.html nor game.html carries the mark');
  process.exit(1);
}
const raw = fs.readFileSync(FILE, 'utf8');
// Comments stripped: a rule inside an HTML comment is inert, and that was
// one of the four failures.
const live = raw.replace(/<!--[\s\S]*?-->/g, '');
const doc = new JSDOM(raw).window.document;
console.log('  (checking ' + path.basename(FILE) + ')\n');

// ---- it is a BACKGROUND, so it cannot blow up ------------------------
// An <img> whose height is stripped falls back to its intrinsic 512px.
// That is what #headerLeft > * { height:auto !important } did to it, four
// times. A background image cannot make its element larger, so the failure
// mode is gone rather than guarded against.
const box = doc.querySelector('.scMarkBox');
chk(!!box, 'the mark exists');
chk(!!box && box.tagName !== 'IMG',
    'and is not an <img> — an <img> as a direct child of #headerLeft is the original bug');
chk(!!box && !box.querySelector('img'),
    'and contains no <img> either — nothing inside to be stripped');
const flat = live.replace(/\s+/g, ' ');
chk(/\.scMarkBox \{[^}]*background:url/.test(flat), 'the logo is a background image');
// CONTAIN, not cover. The mark is not square-cropped artwork: cover fills
// the box and cuts whatever does not fit, which on a logo means losing an
// edge of it. contain letterboxes instead.
chk(/\.scMarkBox \{[^}]*center\/contain/.test(flat),
    'sized with center/contain, so the whole mark shows rather than being cropped');
chk(/aria-label="StatChat"/.test(raw) && /role="img"/.test(raw),
    'with role and a label, since there is no alt text to carry the name');

// ---- FIXED SIZE, NOT STRETCHED --------------------------------------
// #headerLeft is absolutely positioned with a fixed right edge, so the row
// has a hard width limit. A square mark stretched to the banner height is
// ~66px WIDE, and that width came out of ON AIR — which is flex:0 0 auto
// on a desktop and cannot shrink, so it was pushed out of shape instead.
// CSS COMMENTS STRIPPED FROM THE RULE BODY. The explanation lives inside
// these braces and mentions display:flex; a regex looking for a display
// declaration matched the prose and passed a rule that had none. That is
// the fourth time today a check has read its own commentary as code.
const rule = /\.scMarkBox \{([^}]*)\}/.exec(live)[1]
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');
// A <span> IS INLINE BY DEFAULT, AND INLINE IGNORES WIDTH AND HEIGHT.
// Without an explicit display the box has no size and the background paints
// on nothing -- invisible on a desktop, while an iPad looked fine because
// layoutHeader() sets display:flex !important on every child there. One
// missing declaration, two completely different symptoms.
chk(/display:\s*(block|flex|inline-block)/.test(rule),
    'the mark declares a display — a span is inline by default and inline ignores ' +
    'width and height');

chk(/align-self:\s*center/.test(rule),
    'the mark is centred, not stretched — stretching it takes width from ON AIR');
chk(!/align-self:\s*stretch/.test(rule), 'and explicitly not stretched');
const w = /width:\s*(\d+)px/.exec(rule), h = /height:\s*(\d+)px/.exec(rule);
chk(!!w && !!h && w[1] === h[1],
    'it is square at a fixed size (' + (w ? w[1] : '?') + 'px)');

// The media block re-pads and re-heights every child with !important, so
// the mark needs a higher-specificity answer or it collapses.
const blocks = [...live.matchAll(
  /@media \(max-width: 1219px\), \(hover: none\) and \(pointer: coarse\) \{([\s\S]*?)\n  \}/g)]
  .map(m => m[1]);
const padBlock = blocks.find(b => /#headerLeft > \*/.test(b));
chk(!!padBlock, 'found the block that re-pads #headerLeft children');
if (padBlock) {
  chk(/#headerLeft > \.scMarkBox \{[^}]*padding:\s*0 !important/.test(padBlock),
      'the mark opts out of that padding at (1,1,0), which a class alone could not');
  chk(/#headerLeft > \.scMarkBox \{[^}]*height:\s*\d+px !important/.test(padBlock),
      'and pins its height past height:auto !important — a background on a zero-height ' +
      'box is nothing at all');
}

// ---- and layoutHeader, RUN, must leave the image alone ----------------
// Read, not run, was how three of the four failures were confirmed fixed.
function runLayout(touch) {
  // Lifted from the file, whatever attributes it carries. A regex that
  // assumed the exact old markup threw when the element changed shape --
  // a crash is not a test result.
  const m = /<span class="scMarkBox"[^>]*>[\s\S]*?<\/span>/.exec(raw);
  if (!m) { chk(false, 'could not find the mark markup to drive layoutHeader with'); return 'MISSING'; }
  const markup = m[0];
  const dom = new JSDOM('<!doctype html><html><body><div id="headerLeft">' + markup +
    '<a class="hdr-btn" href="#">Dashboard</a>' +
    '<button id="onAirBanner" class="hdr-btn">ON AIR</button></div>' +
    '<div id="topActions"></div></body></html>',
    { pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window, d = w.document;
  w.matchMedia = () => ({ matches: touch });
  Object.defineProperty(w, 'innerWidth', { value: touch ? 800 : 1400, configurable: true });
  d.querySelector('.hdr-btn').getBoundingClientRect = () => ({ height: 36, width: 100 });
  const clearSrc = raw.match(/const clear = \(el, names\) => \{[\s\S]*?\n    \};/)[0];
  const fnSrc = raw.match(/function layoutHeader\(\)\{[\s\S]*?\n  \}/)[0];
  w.__w = w; w.__d = d;
  w.eval('(function(window, document){\n' + clearSrc.replace('const clear', 'var clear') +
         '\n' + fnSrc + '\nlayoutHeader();\n})(__w, __d);');
  // The BOX may be rewritten freely; what matters is that it still has
  // its class, and that nothing has given it a height that fights the
  // stylesheet.
  const b = d.querySelector('.scMarkBox');
  return b ? (b.style.height || null) : 'MISSING';
}
chk(runLayout(true) === null,
    'layoutHeader() on touch sets no inline height on the mark, so the stylesheet holds');
chk(runLayout(false) === null, 'and on desktop too');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
