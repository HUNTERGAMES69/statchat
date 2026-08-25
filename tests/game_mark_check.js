// The StatChat mark in game.html's header — and the rule that beat it
// ===================================================================
// SEVEN ATTEMPTS FAILED, all overruled in the same place:
//
//     #headerLeft > * { flex:1 1 0; min-width:0; display:flex;
//                       height:auto !important; padding:0 12px !important; }
//
// `flex:1 1 0` means every child SPLITS THE ROW EQUALLY. The comment on
// that rule says so — it was written for exactly two children, half the
// width each, stretched to the banner's height. A third child made it
// thirds, which deformed ON AIR; `min-width:0` then let the mark collapse
// to nothing, which is why it kept disappearing.
//
// And it is specificity (1,0,0). A class rule is (0,1,0), so
// `.scMarkBox { display:block; width:32px }` never applied — not from a
// stylesheet, not inline, and no amount of arguing with layoutHeader()
// would have helped, because the problem was never the JavaScript.
//
// **Nothing in the file said so, and every attempt was verified by reading
// the file.** It took a getComputedStyle readout from the live page —
// display:flex on an element whose rule said block — to find it.
//
// So this check asserts the RELATIONSHIP, not the values: whatever
// `#headerLeft > *` sets, the mark's override must answer, at higher
// specificity, and with !important wherever the base rule uses it.
//
//   node tests/game_mark_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const FILES = ['game.html', 'gamemock.html']
  .map(f => ({ name: f, full: path.join(__dirname, '..', f) }))
  .filter(f => fs.existsSync(f.full));

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

// CSS comments stripped before any match: an explanation living inside a
// rule mentions the very properties being looked for, and a check that
// reads its own prose passes rules that do not exist.
const decls = body => body.replace(/\/\*[\s\S]*?\*\//g, '');

for (const f of FILES) {
  console.log('\n  --- ' + f.name + ' ---');
  const raw = fs.readFileSync(f.full, 'utf8');
  const live = raw.replace(/<!--[\s\S]*?-->/g, '');
  const doc = new JSDOM(raw).window.document;

  const el = doc.querySelector('#headerLeft > .scMarkBox');
  chk(!!el, 'the mark is a direct child of #headerLeft');
  chk(!!el && el.tagName !== 'IMG',
      'and is not an <img> — an img stripped of its height falls back to 512px');
  chk(/role="img"[^>]*aria-label="StatChat"|aria-label="StatChat"[^>]*role="img"/.test(raw),
      'with a role and a label, since a background carries no alt text');

  // the base rule, and the override that must answer it
  const baseM = /#headerLeft > \* \{([^}]*)\}/.exec(live);
  chk(!!baseM, 'found #headerLeft > *');
  const overrides = [...live.matchAll(/#headerLeft > \.scMarkBox \{([^}]*)\}/g)].map(m => decls(m[1]));
  chk(overrides.length >= 1, 'the mark has a (1,1,0) override');

  if (baseM && overrides.length) {
    const base = decls(baseM[1]);
    // EACH OVERRIDE IS CHECKED ON ITS OWN, not as one concatenated blob.
    // Joining them let the touch-block copy satisfy an assertion about the
    // base-cascade copy: dropping !important from the base override still
    // passed, because the other one had it.
    const all = overrides.find(o => /background:url/.test(o)) || overrides[0];

    // EVERY LAYOUT PROPERTY THE BASE RULE SETS MUST BE ANSWERED. flex is
    // the one that mattered: 1 1 0 gives the mark a third of the row.
    ['flex', 'min-width', 'display'].forEach(p => {
      chk(new RegExp('(^|[;\\s])' + p + '\\s*:').test(all),
          'answers ' + p + ' — the base rule sets it and would otherwise win on specificity');
    });
    chk(/flex\s*:\s*0 0 auto/.test(all),
        'and answers it with flex:0 0 auto, so the mark takes no share of the row width');

    // AND !IMPORTANT WHEREVER THE BASE RULE USES IT. An important
    // declaration beats a normal one however specific the normal one is;
    // specificity only decides between two importants.
    const baseImportant = [...base.matchAll(/([a-z-]+)\s*:[^;]*!important/g)].map(m => m[1]);
    // margin is deliberately NOT in this list. The base rule sets
    // margin:0 !important and that is what the mark wants -- spacing in
    // this row comes from #headerLeft's `gap`, not from margins. Demanding
    // an answer to it would be demanding a redundant declaration.
    const layoutProps = ['height', 'padding', 'border-radius'];
    baseImportant.filter(p => layoutProps.includes(p)).forEach(p => {
      chk(new RegExp(p + '\\s*:[^;]*!important').test(all),
          'answers ' + p + ' with !important, which the base rule also marks important');
    });

    // source order, so there is no doubt even between equal specificity
    // SOURCE ORDER OF THE RULE THAT ACTUALLY OVERRIDES THE BASE ONE.
    // A first version compared the first occurrence of the selector, which
    // is the copy inside the touch media block -- legitimately earlier in
    // the file, so it reported a failure against correct code. The one
    // that matters is the base-cascade override, identified by carrying
    // the background.
    const baseOverrideAt = live.indexOf('#headerLeft > .scMarkBox {\n    /* No !important');
    const bgOverride = baseOverrideAt !== -1 ? baseOverrideAt
      : live.search(/#headerLeft > \.scMarkBox \{[^}]*background:url/);
    chk(bgOverride > live.indexOf('#headerLeft > * {'),
        'the base-cascade override is written after the rule it overrides');
  }

  // layoutHeader must not write an inline height that fights the stylesheet
  const markup = (/<span class="scMarkBox"[^>]*><\/span>/.exec(raw) || [])[0];
  chk(!!markup, 'the mark markup is a self-contained span');
  if (markup) {
    const runLayout = touch => {
      const dom = new JSDOM('<!doctype html><html><body><div id="headerLeft">' + markup +
        '<a class="hdr-btn" href="#">Dashboard</a>' +
        '<button id="onAirBanner" class="hdr-btn">ON AIR</button></div>' +
        '<div id="topActions"></div></body></html>',
        { pretendToBeVisual: true, runScripts: 'outside-only' });
      const w = dom.window, d = w.document;
      w.matchMedia = () => ({ matches: touch });
      Object.defineProperty(w, 'innerWidth', { value: touch ? 800 : 1600, configurable: true });
      d.querySelector('.hdr-btn').getBoundingClientRect = () => ({ height: 36, width: 100 });
      const c = raw.match(/const clear = \(el, names\) => \{[\s\S]*?\n    \};/)[0];
      const fn = raw.match(/function layoutHeader\(\)\{[\s\S]*?\n  \}/)[0];
      w.__w = w; w.__d = d;
      w.eval('(function(window,document){\n' + c.replace('const clear', 'var clear') +
             '\n' + fn + '\nlayoutHeader();\n})(__w,__d);');
      return d.querySelector('.scMarkBox').style.height || null;
    };
    chk(runLayout(true) === null, 'layoutHeader on touch writes no inline height');
    chk(runLayout(false) === null, 'and none on desktop');
  }
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
