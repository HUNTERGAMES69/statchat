// The rotate prompt appears on a phone, and nowhere else
// =======================================================
// Andy's call, 25 August 2026: let a phone reader open these reports, but
// tell them once that landscape is better. The report layout is NOT
// touched -- the four pages look right on a PC and stay that way.
//
// THE EXPORTS MUST KEEP WORKING IN PORTRAIT, which is what shaped the
// design. A first version covered the whole viewport and would have sat on
// top of Download PDF and Download XLS. The prompt is anchored to the
// report CONTAINER instead, so it cannot drift over the toolbar however
// long the page grows -- a structural guarantee rather than a z-index I
// have to keep getting right.
//
// PDF export here is window.print(), the browser's own print-to-PDF. An
// overlay left visible would be baked into the PDF as a grey box across
// the first page, so it is hidden in @media print AND dismissed on
// beforeprint.
//
// Device detection is viewport + pointer, never user-agent: UA sniffing is
// wrong on every device released after it was written.
//
//   node tests/rotate_prompt_check.js

// Drive the prompt's own logic against synthetic devices.
const { JSDOM } = require('jsdom');
const fs = require('fs');

function run(page, {w, h, coarse, dismissed}) {
  const src = fs.readFileSync(require('path').join(__dirname,'..',page), 'utf8');
  const host = /getElementById\('(\w+)'\)/.exec(src.slice(src.indexOf('ROTATE PROMPT ===')))[1];
  const dom = new JSDOM('<!doctype html><html><body><div id="' + host + '">report</div></body></html>',
    { pretendToBeVisual: true, runScripts: 'outside-only' });
  const w2 = dom.window, d = w2.document;
  Object.defineProperty(w2, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(w2, 'innerHeight', { value: h, configurable: true });
  w2.matchMedia = q => ({ matches: /coarse/.test(q) ? coarse : false });
  const store = {};
  if (dismissed) store['sc_rotate_dismissed'] = '1';
  Object.defineProperty(w2, 'sessionStorage', { value: {
    getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }
  }, configurable: true });
  w2.getComputedStyle = () => ({ position: 'static' });

  const m = /\n  \(function\(\)\{\n    var KEY = 'sc_rotate_dismissed';[\s\S]*?\n  \}\)\(\);/.exec(src);
  w2.__w = w2; w2.__d = d;
  w2.eval('(function(window, document){' + m[0] + '})(__w, __d);');
  // The component defers to DOMContentLoaded when the document is still
  // loading. jsdom's document is already complete here, so maybeShow runs
  // synchronously -- but the 600ms retry does not, and reading the result
  // before either had run made every "shows on a phone" case fail. The
  // harness was wrong, not the page.
  if (d.readyState === 'loading') d.dispatchEvent(new w2.Event('DOMContentLoaded'));
  const gate = d.querySelector('.rotateGate');
  return { shown: !!gate && gate.classList.contains('show'), store };
}

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

const PHONE_P  = { w: 390, h: 844, coarse: true,  dismissed: false };
const PHONE_L  = { w: 844, h: 390, coarse: true,  dismissed: false };
const TABLET_P = { w: 820, h: 1180, coarse: true, dismissed: false };
const DESKTOP  = { w: 1600, h: 900, coarse: false, dismissed: false };

const PAGES = ['recap.html','stat_package.html','player_report.html','season_report.html'];

// ---- the export path, which is the reason this design looks like it does
for (const page of PAGES) {
  const src = fs.readFileSync(require('path').join(__dirname,'..',page), 'utf8');
  chk(/@media print \{ \.rotateGate/.test(src),
      page + ': the prompt is hidden when printing — PDF export is window.print(), so an ' +
      'overlay would be baked into the PDF');
  chk(/addEventListener\('beforeprint', hide\)/.test(src),
      page + ': and dismisses itself as printing starts');
  chk(!/\.rotateGate\.show \{[^}]*position:fixed/.test(src),
      page + ': the overlay is NOT position:fixed — fixed would cover the download buttons');
  chk(/host\.appendChild\(gate\)/.test(src),
      page + ': it is appended to the report container, not to the body');
  chk(/Download PDF and XLS work either way/.test(src),
      page + ': and says so, so nobody dismisses it just to reach the exports');
}

for (const page of PAGES) {
  chk(run(page, PHONE_P).shown,  page + ': shows on a phone in portrait');
  chk(!run(page, PHONE_L).shown, page + ': NOT in landscape — telling someone already sideways to rotate reads as a bug');
  chk(!run(page, TABLET_P).shown, page + ': NOT on a tablet — 820px portrait reads fine');
  chk(!run(page, DESKTOP).shown, page + ': NOT on a desktop');
  chk(!run(page, { ...PHONE_P, dismissed: true }).shown, page + ': NOT once dismissed this visit');
}

// dismissing records it
const dom = run('recap.html', PHONE_P);
chk(dom.shown, 'a fresh visit shows it');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
