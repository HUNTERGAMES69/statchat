// Every colour on a converted page, measured against what is behind it
// ====================================================================
// Built while converting view.html, extended on login.html. It exists
// because converting a page by eye does not work: on view.html eleven
// colours read fine on white and nearly vanished on charcoal, and only
// TWO of them were caught by looking at the screen.
//
// **Legible enough to miss by eye is not the same as legible.**
//
// It does four things a grep cannot:
//
//   * RESOLVES TOKENS. `color:var(--sc-navy)` tells you nothing until you
//     know what --sc-navy is. Pointing that token at a dark value and
//     letting text inherit it has caused two separate bugs -- game.html's
//     play ladder and login.html's wordmark -- so the check follows the
//     variable to its value.
//   * FINDS LIGHT BACKGROUNDS BY LUMINANCE, not by matching names. An
//     enumerated list of light colours missed 7 on game.html and 23
//     across the other pages. "A pale notice panel" is not a set anyone
//     can recall.
//   * LISTS INLINE COLOURS SEPARATELY, because no stylesheet reaches them
//     at any specificity. That is why the view.html conversion took two
//     passes.
//   * CHECKS THE DARK-THEME PREREQUISITES -- color-scheme, the WebKit
//     autofill override, a visible focus ring. Each was missing on
//     login.html and each is invisible until a real user hits it.
//
//   node tests/contrast_check.js            # every converted page
//   node tests/contrast_check.js login      # one page

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const CARD = '#191f27';   // what text normally sits on
const PAGE = '#10141a';
const AA_BODY = 4.5, AA_LARGE = 3.0;

// Colours that are deliberately below body AA, with the reason. Anything
// not on this list that falls short is a finding.
const ALLOWED_LOW = {
  '#5f6b78': 'disabled control — must read as unavailable, not vanish',
  '#4b5665': 'decorative score dash, not text',
};

const lum = hex => {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const [r, g, b] = [0, 2, 4].map(i => {
    const x = parseInt(c.substr(i, 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Is the declaration at `at` inside a rule whose selector is repeated
// later with an !important for the same property? If so it is dead.
function isOverridden(src, at) {
  const open = src.lastIndexOf('{', at);
  if (open === -1) return false;
  const selStart = Math.max(src.lastIndexOf('}', open), src.lastIndexOf(';', open)) + 1;
  const sel = src.slice(selStart, open).trim().split('\n').pop().trim();
  if (!sel || sel.length > 120) return false;
  const after = src.slice(src.indexOf('}', at) + 1);
  // GROUPED AND RE-SCOPED SELECTORS COUNT. A first version required the
  // override to repeat the selector verbatim, so it missed
  //   table.stattable th, table.player-stat-table th { ... !important }
  // overriding `table.stattable th`, and `.stat-label` overriding
  // `.inline-stat-item .stat-label`. It then reported two dead rules as
  // failures -- which is how a checker teaches people to ignore it.
  //
  // Matching on the LAST simple selector in the chain: an override written
  // for a broader or grouped form of the same target still wins.
  const key = sel.split(',').pop().trim().split(/\s+/).pop();
  if (!key) return false;
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[,{}\\s])[^{}]*' + esc + '[^{}]*\\{[^}]*color\\s*:[^;}]*!important', 'm').test(after);
}

// The background twin of the above. isOverriddenBg only matched an
// override repeating the selector verbatim, so it missed
//   .quad, .card{ background:... !important }
// overriding `.quad` and `.card` separately -- and reported two dead rules
// on view.html as live failures.
function overriddenBgGrouped(src, at) {
  const open = src.lastIndexOf('{', at);
  if (open === -1) return false;
  const selStart = Math.max(src.lastIndexOf('}', open), src.lastIndexOf(';', open)) + 1;
  const sel = src.slice(selStart, open).trim().split('\n').pop().trim();
  if (!sel || sel.length > 120) return false;
  const key = sel.split(',').pop().trim().split(/\s+/).pop();
  if (!key) return false;
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const after = src.slice(src.indexOf('}', at) + 1);
  return new RegExp('(^|[,{}\\s])[^{}]*' + esc + '[^{}]*\\{[^}]*background[^;}]*!important', 'm').test(after);
}

function isOverriddenBg(src, at) {
  const open = src.lastIndexOf('{', at);
  if (open === -1) return false;
  const selStart = Math.max(src.lastIndexOf('}', open), src.lastIndexOf(';', open)) + 1;
  const sel = src.slice(selStart, open).trim().split('\n').pop().trim();
  if (!sel || sel.length > 120) return false;
  const after = src.slice(src.indexOf('}', at) + 1);
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(esc + '\\s*\\{[^}]*background[^;}]*!important').test(after);
}

function audit(file) {
  const raw = fs.readFileSync(path.join(ROOT, file), 'utf8');
  // Comments carry example colours and explanations. Matching them
  // reports failures against code that does not exist -- a mistake this
  // project has made four separate times.
  const src = raw.replace(/<!--[\s\S]*?-->/g, '')
                 .replace(/\/\*[\s\S]*?\*\//g, '')
                 .replace(/^\s*\/\/[^\n]*$/gm, '');

  const tokens = {};
  for (const m of src.matchAll(/(--[a-z-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\b/g)) tokens[m[1]] = m[2];
  // AN UNDEFINED TOKEN SILENTLY BECOMES ITS FALLBACK, and every fallback
  // in this codebase was chosen for a white page. `var(--sc-blue, #1565c0)`
  // on the dashboard rendered as #1565c0 -- 2.89:1 on the menu -- because
  // --sc-blue was never defined there. Returning null for that case meant
  // the audit skipped it entirely and reported the page clean.
  //
  // So: resolve to the token when defined, and to the FALLBACK when not,
  // which is what the browser does.
  const undefinedTokens = new Set();
  const resolve = v => {
    const t = /var\(\s*(--[a-z-]+)\s*(?:,\s*(#[0-9a-fA-F]{3,6}))?/.exec(v);
    if (t) {
      if (tokens[t[1]]) return tokens[t[1]];
      if (t[2]) { undefinedTokens.add(t[1] + ' -> ' + t[2]); return t[2]; }
      return null;
    }
    return /^#[0-9a-fA-F]{3,6}$/.test(v) ? v : null;
  };

  const findings = [];

  // ---- text colours -----------------------------------------------------
  for (const m of src.matchAll(/(?<![-a-zA-Z])color\s*:\s*(var\([^)]*\)|#[0-9a-fA-F]{3,6})/g)) {
    const c = resolve(m[1]);
    if (!c) continue;
    const r = ratio(c, CARD);
    if (r >= AA_BODY) continue;
    if (ALLOWED_LOW[c.toLowerCase()]) continue;
    // OVERRIDDEN DECLARATIONS ARE NOT FINDINGS. view.html is themed by an
    // appended block, so a rule earlier in the file may be entirely dead.
    // Reporting it sends someone to fix code that never runs -- and worse,
    // it buries the findings that are real: the one that mattered on that
    // page was a MISSING color-scheme, hidden among six false positives.
    if (isOverridden(src, m.index)) continue;
    findings.push({
      kind: r < AA_LARGE ? 'FAIL' : 'large-only',
      msg: c + ' is ' + r.toFixed(2) + ':1 on the card' +
           (r < AA_LARGE ? ' — below the 3:1 floor for any text' :
            ' — only acceptable for large or bold text'),
    });
  }

  // ---- light backgrounds, by luminance ---------------------------------
  // #fff USED TO BE ON THIS LIST and it hid two bugs: the row menu and
  // the account menu were both `background:#fff` inside a JavaScript
  // string, so eight dark-theme labels sat on a white panel. The audit
  // passed both times, because white was exempt.
  //
  // It is exempt only where it is deliberate -- the logo plate, which is
  // dark artwork needing a light backing. That is `.scMark`/`logo.png`,
  // so the exemption is now scoped to that context rather than granted to
  // the colour everywhere it appears.
  const keep = new Set(['#ffc72c', '#7cb518', '#a3d93f']);
  for (const m of src.matchAll(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6})\b/g)) {
    const c = m[1].toLowerCase();
    if (keep.has(c) || lum(c) <= 0.5) continue;
    if (isOverriddenBg(src, m.index) || overriddenBgGrouped(src, m.index)) continue;
    // The logo plate: white behind dark artwork, within ~200 chars of the
    // mark's own selector or filename.
    // The logo plate. The selector can sit some way above the colour --
    // a multi-line rule with a comment in it -- so the window is generous,
    // and `padding:2px` is required alongside, which is what makes it a
    // plate rather than a panel that happens to be white.
    const around = src.slice(Math.max(0, m.index - 600), m.index + 120);
    if (/scMark|splashIcon|\.brand img/.test(around) && /padding:\s*2px/.test(around)) continue;
    findings.push({ kind: 'FAIL', msg: 'light background ' + c +
      ' (luminance ' + lum(c).toFixed(2) + ') — converted pages should have none' });
  }

  // ---- the prerequisites ------------------------------------------------
  const needs = [
    [/color-scheme\s*:\s*dark/, 'color-scheme:dark — without it the browser paints ' +
      'scrollbars, the caret and AUTOFILLED fields light'],
  ];
  if (/<input/.test(src)) {
    needs.push([/-webkit-autofill(?![a-zA-Z])/, 'a WebKit autofill override — it paints with an ' +
      'inset shadow that no background rule reaches, and a saved password is the ' +
      'normal way in']);
    needs.push([/:focus-visible(?![a-zA-Z])/, 'a visible focus ring — the default outline is dark ' +
      'and disappears on a dark card']);
  }
  needs.forEach(([re, what]) => {
    if (!re.test(src)) findings.push({ kind: 'FAIL', msg: 'missing ' + what });
  });

  const inline = [...new Set([...src.matchAll(
    /style\s*=\s*["'][^"']*?(?<![-a-zA-Z])color\s*:\s*(#[0-9a-fA-F]{3,6})/g)].map(m => m[1]))];

  undefinedTokens.forEach(t => findings.push({ kind: 'FAIL',
    msg: 'undefined token falls back to a light-theme colour: ' + t }));

  return { file, findings, inline, tokens: Object.keys(tokens).length };
}

// WHICH PAGES ARE CONVERTED IS DETECTED, NOT LISTED.
// A hardcoded array meant this file changed on every page conversion, so
// it had to be re-uploaded each time -- and a list that must be edited in
// lockstep with something else is a list that will eventually disagree
// with it.
//
// `color-scheme:dark` is the marker: it is required on every converted
// page (see DARK_THEME_PLAN.md) and appears on no other. So a page opts
// itself in by being converted, and this file can be uploaded once.
const CONVERTED = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.html') && !f.includes('_mock') && f !== 'index.html')
  .filter(f => /color-scheme\s*:\s*dark/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
  .sort();

const only = process.argv[2];
const files = (only
  ? fs.readdirSync(ROOT).filter(f => f.startsWith(only) && f.endsWith('.html'))
  : CONVERTED
).filter(f => fs.existsSync(path.join(ROOT, f)));

let bad = 0;
console.log('=== Dark-theme audit (text vs card ' + CARD + ') ===\n');
for (const f of files) {
  const a = audit(f);
  const fails = a.findings.filter(x => x.kind === 'FAIL');
  if (fails.length) bad++;
  console.log('  ' + (fails.length ? 'FAIL' : ' ok ') + '  ' + f.padEnd(22) +
              a.tokens + ' tokens' + (a.inline.length ? ', ' + a.inline.length + ' inline colours' : ''));
  a.findings.forEach(x => console.log('          [' + x.kind + '] ' + x.msg));
}
console.log('\nPages with findings: ' + bad + ' of ' + files.length);
process.exitCode = bad ? 1 : 0;
