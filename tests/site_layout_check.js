// The marketing site's layout rules, asserted from SOURCE TEXT
// ============================================================
// index.html is the only page a stranger sees before deciding whether to
// buy, and it is the page with the least test coverage: nothing here runs
// the app, so nothing here was ever checked.
//
// WHY SOURCE TEXT AND NOT getComputedStyle. jsdom has no layout engine.
// It ignores @media entirely, cannot resolve `!important`, and reports a
// width of zero for everything. A check written with getComputedStyle
// would pass whatever the stylesheet said, including "display:none" --
// which is not a hypothetical: a mutation that hid the login lockup
// slipped past a structural check on 24 Aug and had to be caught by
// reading the rule instead.
//
// So every visual assertion here reads the RULE, not the rendering. That
// is a weaker check than a browser, and it is the strongest one that can
// actually fail in this harness.
//
// THE BUG THAT PROMPTED IT. `.wrap{padding:0 24px}` is a class; `section`
// is an element. The class won, so its shorthand zeroed every section's
// vertical padding, and three separate attempts to add space between
// sections changed nothing at all. Nobody noticed for a day because the
// hero -- which uses a class -- did move. A specificity conflict between
// a shorthand and a longhand is invisible in a diff and obvious in a
// rule dump, which is what this does.
//
//   node tests/site_layout_check.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// CSS comments are stripped before ANY assertion. Two checks on 24 Aug
// matched their own explanatory comments -- one looking for `order:`,
// one for `margin-inline` -- and reported failures that were not real.
// A check a comment can pass or fail is not a check.
const cssOf = html => {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  return m ? m[1].replace(/\/\*[\s\S]*?\*\//g, '') : '';
};

const mediaBlock = (css, header) => {
  const i = css.indexOf(header);
  if (i === -1) return '';
  let depth = 0;
  for (let j = i; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}' && --depth === 0) return css.slice(i, j + 1);
  }
  return '';
};

// every rule whose declarations set a vertical padding, with its selector
const verticalPaddingRules = css => {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].trim(), decl = m[2];
    if (/(^|;)\s*padding\s*:/.test(decl) || /padding-block/.test(decl) ||
        /padding-top/.test(decl) || /padding-bottom/.test(decl)) {
      out.push({ sel, decl: decl.replace(/\s+/g, ' ').trim() });
    }
  }
  return out;
};

function run() {
  const fails = [];
  const bad = (area, detail) => fails.push({ area, detail });

  const html = read('index.html');
  const css = cssOf(html);

  // ---- the specificity trap -------------------------------------------
  // .wrap must not set a vertical padding at all. If it does, it beats
  // every `section` rule and the page silently loses its rhythm.
  // Scans the WHOLE sheet, media queries included: the desktop rule was
  // fixed on 24 Aug and the identical one inside @media (max-width:560px)
  // was missed, so phones kept losing their section padding.
  const wrap = verticalPaddingRules(css).filter(r => /(^|,)\s*\.wrap\s*$/.test(r.sel));
  if (wrap.length) {
    bad('specificity', '.wrap sets vertical padding (' + wrap[0].decl + ') — it is a class ' +
        'and will beat every `section` rule. Use padding-inline.');
  }
  if (!/\.wrap\{[^}]*padding-inline\s*:/.test(css)) {
    bad('specificity', '.wrap no longer sets padding-inline — the side gutters are gone.');
  }
  // EVERY section padding rule must carry the class, not just one of
  // them. Checking that `section.wrap` appears somewhere is not enough:
  // with a desktop rule and a phone rule, one can lose its class while
  // the other still satisfies the search. That exact mutation passed a
  // first version of this check.
  const bareSection = verticalPaddingRules(css)
    .filter(r => r.sel.split(',').some(one => /^section$/.test(one.trim())));
  if (bareSection.length) {
    bad('specificity', bareSection.length + ' padding rule(s) on a bare `section` selector ' +
        '(' + bareSection[0].decl.slice(0, 50) + '…). An element selector loses to .wrap; ' +
        'write `section.wrap`.');
  }
  const scoped = verticalPaddingRules(css)
    .filter(r => /section\.wrap/.test(r.sel) && /padding-block/.test(r.decl));
  if (scoped.length < 2) {
    bad('specificity', 'expected a desktop AND a phone `section.wrap` padding-block rule, ' +
        'found ' + scoped.length + '.');
  }

  // ---- @media rules, which jsdom cannot see at all ---------------------
  const phone = mediaBlock(css, '@media (max-width:560px)');
  if (!phone) bad('phone', 'the ≤560px block is missing entirely');
  else {
    const need = [
      ['.wrap{padding-inline:18px}', 'narrower side gutters, set INLINE not shorthand'],
      ['.bug{flex-wrap:wrap', 'the hero scorebug wraps instead of overflowing'],
      ['.ovbar{flex-wrap:wrap}', 'the score-bar overlay wraps'],
      ['.ovlead{flex-direction:column}', 'the leader strips stack'],
      ['section.wrap{padding-block:', 'sections keep a phone rhythm'],
    ];
    need.forEach(([frag, why]) => {
      if (!phone.includes(frag)) bad('phone', 'missing: ' + why + '  (' + frag + ')');
    });
  }

  // ---- print/aspect rules that only exist as text ----------------------
  if (!/@media \(prefers-reduced-motion:reduce\)/.test(css)) {
    bad('motion', 'no prefers-reduced-motion block — the scorebug loop never stops');
  }

  // ---- things that must NOT be in the stylesheet -----------------------
  // NOT a blanket ban on `order:`. The score-bar overlay legitimately
  // moves its middle cell below the two teams on a phone. What broke the
  // page on 23 Aug was `order` on :nth-child selectors restoring a grid
  // pairing — a rule per child, which silently mis-sorts the moment a
  // child is added. That specific shape is what is banned.
  const re = /([^{}]+)\{[^{}]*(?<![-\w])order\s*:[^{}]*\}/g;
  let om;
  while ((om = re.exec(css))) {
    if (/:nth-child/.test(om[1])) {
      bad('layout', '`order:` on an :nth-child selector — ' + om[1].trim() +
          '. A rule per child mis-sorts as soon as a child is added, which is ' +
          'exactly what scrambled the Efficiency row on 23 Aug.');
    }
  }
  ['chart-row', 'chart-row-3'].forEach(dead => {
    if (css.includes(dead)) bad('layout', 'dead rule `.' + dead + '` is back');
  });

  // ---- every class used must have a rule -------------------------------
  const body = html.slice(html.indexOf('<body'));
  const used = new Set();
  (body.match(/class="([^"]+)"/g) || []).forEach(a =>
    a.slice(7, -1).split(/\s+/).forEach(c => c && used.add(c)));
  const undefinedClasses = [...used].filter(c =>
    !new RegExp('\\.' + c.replace(/-/g, '\\-') + '(?![a-z0-9-])').test(css));
  if (undefinedClasses.length) {
    bad('css', 'classes used with no rule: ' + undefinedClasses.join(', ') +
        '  (a dead-CSS sweep on 24 Aug deleted .fld, which the contact form shared ' +
        'with a graphic — deleting by class name is only safe when the name means one thing)');
  }

  // ---- braces ----------------------------------------------------------
  if ((css.match(/\{/g) || []).length !== (css.match(/\}/g) || []).length) {
    bad('css', 'unbalanced braces in <style>');
  }

  return fails;
}

if (require.main === module) {
  const f = run();
  console.log('=== Marketing site layout ===\n');
  console.log('Failures: ' + f.length);
  f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
  if (!f.length) console.log('  layout rules intact, and asserted from source rather than jsdom.');
  process.exitCode = f.length ? 1 : 0;
}

module.exports = { run };
