// The StatChat mark in game.html's header row — RUN, not read
// ===========================================================
// Reported twice, and the first fix did not work because it was verified
// by READING CSS rather than by executing the code that overrides it.
//
// game.html lays its header out from JavaScript. layoutHeader() walks
// EVERY child of #headerLeft and, on touch, strips height and width and
// forces `display:flex !important`. That is correct for a <button> or an
// <a>, whose size comes from padding and a label. Applied to an <img> it
// removes the only thing giving it a size, and the browser falls back to
// the image's intrinsic dimensions — a 512px logo filling the header.
//
// **The stylesheet was never going to win.** Those are inline
// !important, and a note inside that very function says so.
//
// So this drives layoutHeader() for real, at both widths, and asserts
// what the mark actually ends up with. A check that reads `.scMark-inline
// { height:30px }` out of the file passes happily while the browser
// renders 512px.
//
//   node tests/game_header_mark_check.js

// Drive layoutHeader() for real and inspect what the mark ends up with.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'game.html'), 'utf8');

function run(touch){
  const dom = new JSDOM('<!doctype html><html><body>' +
    '<div id="headerLeft">' +
      // THE REAL ELEMENT, lifted from game.html. A hand-written <img> in the
    // fixture omitted the inline style the page actually ships, so the
    // check reported "inline height untouched" for an element that never
    // had one. A fixture that does not match the page cannot test it.
    (src.match(/<img[^>]*class="scMark-inline"[^>]*>/s) || ['<img class="scMark-inline">'])[0] +
      '<a class="hdr-btn" href="#">Dashboard</a>' +
      '<button id="onAirBanner" class="hdr-btn">ON AIR</button>' +
    '</div><div id="topActions"></div></body></html>',
    { pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window, d = w.document;
  w.matchMedia = () => ({ matches: touch });
  Object.defineProperty(w, 'innerWidth', { value: touch ? 800 : 1400, configurable: true });
  // jsdom has no layout, so give the button a height to be measured
  d.querySelector('.hdr-btn').getBoundingClientRect = () => ({ height: touch ? 46 : 30, width: 100 });

  // extract just layoutHeader and the clear() helper it uses
  const m = src.match(/const clear = \(el, names\) => \{[\s\S]*?\n    \};/);
  const f = src.match(/function layoutHeader\(\)\{[\s\S]*?\n  \}/);
  w.__w = w; w.__d = d;
  w.eval('(function(window, document){\n' +
         m[0].replace('const clear', 'var clear') + '\n' + f[0] +
         '\nlayoutHeader();\n})(__w, __d);');
  const mark = d.querySelector('.scMark-inline');
  return { height: mark.style.height, width: mark.style.width,
           display: mark.style.display, flex: mark.style.flex };
}

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

const touch = run(true), desktop = run(false);

// TOUCH. The loop must leave the mark's own size alone. It strips height
// and width from every other child and forces display:flex -- correct for
// a button, fatal for an <img>, which then falls back to its intrinsic
// 512px. That is the bug, twice reported.
chk(touch.height === '30px',
    'on touch the mark keeps its 30px and is not stripped (' + touch.height + ')');
// THE INLINE SIZE IS THE INSURANCE, and must not be quietly deleted as
// redundant. The stylesheet alone was correct twice and the mark still
// rendered at 512px, because script rewrote it. An inline declaration is
// the only thing a stylesheet edit cannot lose an argument with.
chk(/class="scMark-inline"[^>]*style="[^"]*height:30px/.test(
      require('fs').readFileSync(require('path').join(__dirname, '..', 'game.html'), 'utf8')),
    'and the size is declared inline on the element, not only in the stylesheet');
chk(touch.display === 'block',
    'and is not forced to display:flex (' + touch.display + ')');
chk(touch.flex === '0 0 auto', 'and does not stretch with the row (' + touch.flex + ')');

// DESKTOP. Everything inline is cleared and the stylesheet takes over.
chk(desktop.height === '' && desktop.width === '',
    'on desktop the inline styles are cleared, so the stylesheet applies');

// NOTHING MEASURES A BUTTON. An earlier version copied a button's height,
// which is wrong here: the banner sync gives #headerLeft an explicit
// height and align-items:stretch makes the buttons fill it, so "match a
// button" can mean "match the whole score banner".
const srcTxt = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'game.html'), 'utf8');
chk(!/getBoundingClientRect\(\)\.height[\s\S]{0,200}scMark-inline/.test(srcTxt) &&
    !/scMark-inline[\s\S]{0,300}getBoundingClientRect\(\)\.height/.test(srcTxt),
    'and nothing sizes the mark from a measured button');

// And the stylesheet number must still equal .hdr-btn's own box, or
// desktop drifts the moment the buttons change.
const fs2 = require('fs'), path2 = require('path');
const g = fs2.readFileSync(path2.join(__dirname, '..', 'game.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '');
const btn = /\.hdr-btn\s*\{([^}]*)\}/.exec(g)[1];
const n = (c, p) => { const m = new RegExp(p + ':\\s*(\\d+)px').exec(c); return m ? +m[1] : 0; };
const expected = n(btn, 'line-height') + n(btn, 'padding') * 2 + n(btn, 'border-width') * 2;
const declared = n(/\.scMark-inline\s*\{([^}]*)\}/.exec(g)[1], 'height');
chk(declared === expected,
    'the desktop rule is ' + declared + 'px and .hdr-btn computes to ' + expected + 'px');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
