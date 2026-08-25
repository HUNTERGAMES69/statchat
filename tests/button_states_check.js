// Buttons that light up on selection must still light up
// ======================================================
// Four regressions at once on the dark game page: ON AIR stopped going
// red, Touchdown stopped lighting, the keypad confirm stopped going green,
// and the play ladder lost its state. One cause:
//
//   **A STYLESHEET `!important` BEATS AN INLINE STYLE.**
//
// This page lights its state buttons from JavaScript -- 49 separate
// `btn.style.background = ...` writes -- and an inline style carries no
// !important. So a blanket `button { background:... !important }` silently
// won every one of them. The rule came from statchat-dark.css, where it
// was needed to override pages that had NOT been converted; on a page that
// styles its own buttons it does nothing but break them.
//
// Nothing else catches this. The contrast audit reads declarations, so a
// page can pass it completely while every state button is dead.
//
// jsdom cannot resolve var() in getComputedStyle, so the assertions below
// read the declarations rather than computed colours -- a first version
// tested computed values and reported a correct rule as broken.
//
//   node tests/button_states_check.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

const PAGES = ['gamedark.html', 'game.html', 'view.html'].filter(
  f => fs.existsSync(path.join(ROOT, f)));

console.log('=== Selection states survive the cascade ===\n');

for (const f of PAGES) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const css = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

  const runtime = (src.match(/style\.(?:background|backgroundColor)\s*=/g) || []).length +
                  (src.match(/style\.setProperty\('background/g) || []).length;
  if (!runtime) { console.log('  --   ' + f + ': no runtime background writes'); continue; }

  // Any rule matching plain `button` (no state class) that forces a
  // background with !important will beat every one of those writes.
  const offenders = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(m => {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    const body = m[2];
    if (!/background[^;:]*:[^;]*!important/.test(body)) return false;
    return sel.split(',').some(one => {
      const t = one.trim();
      // a bare `button`, or button with no state class -- these match the
      // buttons JavaScript lights
      return /(^|[\s>])(button|\.btn|\.button-link)$/.test(t);
    });
  });

  chk(offenders.length === 0,
      f + ': no blanket `button { background: !important }` — ' + runtime +
      ' buttons are lit from JavaScript and a stylesheet !important beats an inline style' +
      (offenders.length ? ' (found: ' + offenders.map(o => o[1].trim().split('\n').pop().trim()).join(', ') + ')' : ''));

  // The ladder's active state: one solid state, not a doubled ring.
  // The ladder shape is a DARK-THEME decision. game.html is still light and
  // its inset ring reads fine on white, so this pair only applies to a
  // converted page -- asserting it everywhere reported the untouched live
  // page as broken.
  const isDark = /color-scheme:\s*dark/.test(src);
  const rail = isDark ? /#typeRail button\.rail-active\s*\{([^}]*)\}/.exec(css) : null;
  if (rail) {
    const b = rail[1].replace(/\s+/g, ' ');
    chk(/background:/.test(b),
        f + ': the ladder active item has a fill, not only an outline');
    chk(!/inset[^,;]*,\s*0 0 0/.test(b),
        f + ': and not a doubled ring — an inset ring plus an outer ring reads as a ' +
        'thick outline rather than a selection');
  }
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
