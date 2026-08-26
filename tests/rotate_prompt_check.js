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
// overlay left visible would be baked into the PDF as a gray box across
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
  Object.defineProperty(d.getElementById(host), 'offsetHeight', { value: 400, configurable: true });
  w2.ResizeObserver = undefined;

  // Anchored on `var dismissedThisView`, which is unique to this IIFE. The
  // old anchor was the sessionStorage key, which no longer exists.
  const m = /\n  \(function\(\)\{\n    \/\* SHOWN EVERY TIME[\s\S]*?\n  \}\)\(\);/.exec(src);
  if (!m) { chk(false, page + ': could not extract the rotate IIFE to run it'); return; }
  w2.__w = w2; w2.__d = d;
  w2.eval('(function(window, document){' + m[0] + '})(__w, __d);');
  // The component defers to DOMContentLoaded when the document is still
  // loading. jsdom's document is already complete here, so maybeShow runs
  // synchronously -- but the 600ms retry does not, and reading the result
  // before either had run made every "shows on a phone" case fail. The
  // harness was wrong, not the page.
  if (d.readyState === 'loading') d.dispatchEvent(new w2.Event('DOMContentLoaded'));
  // THE HOST MUST HAVE HEIGHT. The overlay is absolutely positioned inside
  // the report container, and that container is hidden until the data
  // loads -- appended to a zero-height host it renders as nothing, which
  // is why the prompt appeared on one page out of four in production.
  // jsdom reports 0 for offsetHeight always, so it is stubbed here to
  // model a loaded report.
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
  // SHOWN EVERY PAGE VIEW, NOT ONCE PER SESSION. Andy's call, 25 August
  // 2026, after never seeing the prompt at all. It was remembered in
  // sessionStorage under a key shared by all four pages, so one tap of
  // "View anyway" silenced every report for the life of the tab -- and a
  // mobile tab keeps sessionStorage for weeks. The prompt is a RESPONSE TO
  // A CONDITION, and the condition is still true on the next report.
  chk(!/sessionStorage\.(get|set)Item/.test(src),
      page + ': no storage — dismissal lasts for this page view only');
  chk(/var dismissedThisView = false/.test(src),
      page + ': and is a plain variable, so a reload brings the prompt back');

  // SYMMETRIC. The old resize handler only ever called hide(), so a report
  // opened in landscape and then turned to portrait never showed it.
  chk(/addEventListener\('resize', maybeShow\)/.test(src),
      page + ': rotating INTO portrait shows the prompt, not just out of it');
  chk(/addEventListener\('orientationchange'/.test(src),
      page + ': and orientationchange is handled too — iOS Safari fires it ' +
      'more reliably than resize');

  // TABLETS STAY EXCLUDED. An iPad in portrait is 744px or wider and renders
  // these tables readably.
  chk(/Math\.min\(window\.innerWidth, window\.innerHeight\) <= 500/.test(src),
      page + ': phones only — every iPad is 744px+ in portrait and is silent ' +
      'by design');

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
  chk(/host\.offsetHeight > 0/.test(src),
      page + ': waits for the host to have HEIGHT before showing — a fixed timeout was a ' +
      'guess about fetch duration and was wrong on three pages out of four');
  chk(/ResizeObserver/.test(src) && /setInterval/.test(src),
      page + ': with a ResizeObserver and a bounded poll fallback');
  chk(!/setTimeout\(maybeShow, 600\)/.test(src),
      page + ': and no longer relies on a 600ms guess');
}

for (const page of PAGES) {
  chk(run(page, PHONE_P).shown,  page + ': shows on a phone in portrait');
  chk(!run(page, PHONE_L).shown, page + ': NOT in landscape — telling someone already sideways to rotate reads as a bug');
  chk(!run(page, TABLET_P).shown, page + ': NOT on a tablet — 820px portrait reads fine');
  chk(!run(page, DESKTOP).shown, page + ': NOT on a desktop');
  // WAS: "NOT once dismissed this visit", driven by a sessionStorage flag
  // the harness pre-set. That flag is gone -- dismissal is per page view now,
  // so a FRESH LOAD must show the prompt even if a previous page was
  // dismissed. Asserting the opposite is what the old design did, and it is
  // why the prompt was never seen.
  chk(run(page, { ...PHONE_P, dismissed: true }).shown,
      page + ': STILL shows on a fresh load — a dismissal on another report ' +
      'no longer silences this one');
}

// dismissing records it
const dom = run('recap.html', PHONE_P);
chk(dom.shown, 'a fresh visit shows it');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
