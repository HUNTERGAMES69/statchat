// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// broadcasting.html borrows the brochure's stylesheet — prove it fits
// ==================================================================
// broadcasting.html carries NO stylesheet of its own. It copies index.html's
// <style> block character for character, so a brochure restyle reaches both
// pages and neither can drift. That arrangement has exactly one failure mode
// and it is silent: markup written with a class the shared sheet does not
// define renders as unstyled text with a header on top. No error, no console
// warning, nothing on a build. The first draft of the page did precisely that
// with .card, .eyebrow and .ticks.
//
// WHY A BROWSER AND NOT A REGEX. The obvious check — "does the token .foo
// appear anywhere in the sheet" — was written first and a mutation killed it
// in one line. `.cards` IS in the sheet, but only as `.ovlead .cards`, so
// class="cards" outside an .ovlead styles nothing and the regex called it
// fine. The real question is whether a rule mentioning that class MATCHES a
// real element on this page, and only a browser can answer it.
//
//   node tests/shared_stylesheet_check.js
//
// Needs Playwright. Skips with a clear message, and a non-zero exit, if it
// is not installed — a check that quietly passes when it cannot run is worse
// than one that is missing.

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
  catch (e2) {
    console.log('=== Shared stylesheet ===\n');
    console.log('  SKIP  playwright is not installed — this check did NOT run.');
    console.log('        npm i -D playwright, then rerun.');
    process.exit(2);
  }
}

// OFF THE NETWORK, DELIBERATELY. These pages link Google Fonts, and this
// check opens roughly a hundred and twenty of them for the width sweep. On a
// machine that cannot reach fonts.googleapis.com every one of those waits for
// a timeout, which turned a fast check into a two-minute one. Nothing here
// depends on the webfont: the classes and the panel widths are decided by the
// inline sheet, and the fallback stack is metric-close enough that a clipping
// panel still clips.
// http(s) only -- routing '**' would also abort the file:// navigation itself.
const blockNetwork = (p) => p.route(/^https?:/, r => r.abort());

let pass = 0, fail = 0;
const chk = (l, ok, det) => { if (ok) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + (det ? '\n         ' + det : '')); } };

// The pages that share index.html's sheet. Add a page here when it is built
// the same way.
const SHARED = ['broadcasting.html', 'stats.html', 'pricing.html', 'compare.html'];
// Every public page gets the dead-class sweep, shared sheet or its own.
const PUBLIC = ['index.html', 'broadcasting.html', 'stats.html', 'pricing.html',
                'compare.html', 'vmix.html', 'tips.html', 'help.html'];

const styleOf = s => (s.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
// Prose comments on these pages quote class names they no longer use.
// Counting those is how two earlier checks in this repo produced false
// positives, so comments come out before anything is read.
const decomment = s => s.replace(/<!--[\s\S]*?-->/g, '');

console.log('=== Shared stylesheet ===\n');

(async () => {
  const home = read('index.html');

  // ---- the sheet is genuinely the same file ---------------------------
  SHARED.forEach(f => {
    chk(f + ": the stylesheet is index.html's, character for character",
        styleOf(read(f)) === styleOf(home) && styleOf(home).length > 30000,
        styleOf(read(f)).length + ' vs ' + styleOf(home).length);
  });

  // ---- static structure ------------------------------------------------
  SHARED.forEach(f => {
    const body = decomment(read(f).slice(read(f).indexOf('</head>')));

    // <use href="#lg-a"> needs its <symbol> to travel with the markup. It
    // does not come from the stylesheet, so copying the sheet is not enough.
    //
    // A PAGE WITH NO <use> IS NOT A FAILURE. The first version required
    // uses.length > 0, which failed pricing.html and compare.html for the
    // crime of not drawing a scorebug -- a check reporting a fault where
    // there is none, which is the same class of bug as missing a real one.
    // Both directions are asserted instead: no orphan <use>, and no orphan
    // <symbol> either, since a sprite nobody references is dead weight
    // carried over from whichever page it was copied from.
    const uses = [...new Set([...body.matchAll(/<use href="#([^"]+)"/g)].map(m => m[1]))];
    const syms = [...new Set([...body.matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1]))];
    chk(f + ': every <use> reference has its symbol on the page',
        uses.every(id => syms.includes(id)),
        uses.length ? JSON.stringify(uses.filter(u => !syms.includes(u)))
                    : 'no <use> on this page, which is fine');
    chk('  ...and ' + f + ' carries no unreferenced <symbol>',
        syms.every(id => uses.includes(id)),
        JSON.stringify(syms.filter(x => !uses.includes(x))));

    const links = [...new Set([...body.matchAll(/href="([^"]+)"/g)].map(m => m[1]))]
      .filter(h => !/^(https?:|mailto:|#)/.test(h));
    const broken = links.filter(h => {
      const t = h.split(/[#?]/)[0].replace(/^\//, '');
      return t !== '' && !fs.existsSync(path.join(ROOT, t));
    });
    chk(f + ': every internal link resolves to a file in the repo',
        broken.length === 0, JSON.stringify(broken));

    // The header nav points back at the brochure's anchors. If one is
    // renamed there, these links scroll nowhere and nothing errors.
    const anchors = [...new Set([...body.matchAll(/href="\/#([\w-]+)"/g)].map(m => m[1]))];
    const missing = anchors.filter(a => !new RegExp('id="' + a + '"').test(home));
    chk(f + ': every /#anchor into the brochure exists on the brochure',
        anchors.length > 0 && missing.length === 0, JSON.stringify(missing));
  });

  // ---- the dead-class sweep, in a real browser -------------------------
  const b = await chromium.launch();
  for (const f of PUBLIC) {
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    await blockNetwork(p);
    await p.goto('file://' + path.join(ROOT, f), { waitUntil: 'load' });
    const r = await p.evaluate(() => {
      const sels = [];
      // Rules inside a @media block are collected too, so a class that is
      // only ever styled on a phone still counts as alive at this width.
      const walk = (rules) => { for (const r of rules) {
        if (r.selectorText) sels.push(r.selectorText);
        else if (r.cssRules) walk(r.cssRules);
      } };
      for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch (e) {} }

      const used = new Set();
      document.querySelectorAll('[class]').forEach(el =>
        el.classList.forEach(c => used.add(c)));

      const dead = [];
      for (const c of used) {
        const rx = new RegExp('\\.' + c.replace(/-/g, '\\-') + '(?![\\w-])');
        // Split selector groups on the comma: one live selector in a group
        // must not vouch for a dead sibling sharing the same rule.
        const alive = sels.filter(s => rx.test(s)).some(s => s.split(',').some(one => {
          if (!rx.test(one)) return false;
          try { return document.querySelector(one.replace(/::?[a-z-]+(\([^)]*\))?/g, '').trim()) !== null; }
          catch (e) { return false; }
        }));
        if (!alive) dead.push(c);
      }
      return { dead: dead.sort(), used: used.size, sels: sels.length };
    });

    chk(f + ': every class written on the page is styled by a rule that matches it',
        r.dead.length === 0, JSON.stringify(r.dead));
    // NOT VACUOUS: the sheet parsed and there are classed elements to test.
    // The floor stays low because the three guides are short pages with their
    // own small sheets — a threshold tuned to the brochure would fail them
    // for being what they are.
    chk('  ...' + f + ' has a parsed stylesheet and classed elements',
        r.used >= 8 && r.sels >= 30, r.used + ' classes against ' + r.sels + ' selectors');
    // 200+ selectors is the brochure's sheet and nothing else. The class
    // floor is 18, not the first draft's 30: pricing.html is a short page
    // that is entirely correct with twenty-odd classes, and a threshold
    // tuned to the longest page fails the others for being shorter.
    if (SHARED.includes(f))
      chk('  ...and ' + f + ' is really drawing on the brochure sheet',
          r.used >= 18 && r.sels > 200, r.used + ' classes against ' + r.sels + ' selectors');
    await p.close();
  }

  // ---- the overlay previews must not clip themselves -------------------
  // Both previews are overflow:hidden panels holding a flex row wider than
  // the panel. When it does not fit, the away team silently loses its shield
  // and its name is cut mid-word — "Northgate" rendered "NORTHG" on the live
  // brochure at every width, and the team comparison did the same on a phone.
  // Swept in 20px steps because the fault lives in the bands BETWEEN the
  // breakpoints, which is exactly where spot checks at 1400 and 390 miss it.
  for (const f of ['index.html', 'broadcasting.html']) {
    const bad = [];
    for (let w = 320; w <= 1440; w += 20) {
      const p = await b.newPage({ viewport: { width: w, height: 800 } });
      await blockNetwork(p);
      await p.goto('file://' + path.join(ROOT, f), { waitUntil: 'load' });
      const r = await p.evaluate(() => ({
        clip: [...document.querySelectorAll('.ovbar, .ovcmp, .ovlead')]
          .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className),
        side: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }));
      if (r.clip.length || r.side) bad.push(w + ': ' + JSON.stringify(r.clip) + (r.side ? ' +sidescroll' : ''));
      await p.close();
    }
    chk(f + ': no overlay preview clips, 320px to 1440px', bad.length === 0,
        bad.slice(0, 6).join(' | '));
  }

  await b.close();
  console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
  if (fail) console.log('\n' + fail + ' FAILURES');
  process.exitCode = fail ? 1 : 0;
})();
