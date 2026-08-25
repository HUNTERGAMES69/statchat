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
      '<img src="logo.png" alt="StatChat" class="scMark-inline">' +
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

const BTN_H = 46;                     // what the stubbed .hdr-btn measures
const touch = run(true), desktop = run(false);

chk(touch.height === BTN_H + 'px',
    'on touch the mark matches the measured button height (' + touch.height + ')');
chk(touch.width === BTN_H + 'px', 'and stays square (' + touch.width + ')');
chk(touch.display === 'block',
    'and is NOT display:flex — the loop forces flex on controls, which on an img ' +
    'combined with no height gives the intrinsic size (' + touch.display + ')');

chk(desktop.height === '' && desktop.width === '',
    'on desktop every inline style is cleared, so the stylesheet 30px applies');

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
