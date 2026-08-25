// Every text colour must be readable on the surface behind it
// ===========================================================
// Written after view.html went dark. Converting that page turned up
// ELEVEN colours that read fine on white and nearly vanished on
// charcoal, and only two of them were caught by looking at the screen.
// The other nine were found by computing the ratio.
//
// **Legible enough to miss by eye is not the same as legible.**
//
// It also lists INLINE colours separately, because those are the ones a
// stylesheet cannot reach at any specificity — the reason the view.html
// conversion took two passes rather than one.
//
//   node tests/contrast_check.js              # every *_mock.html
//   node tests/contrast_check.js dashboard    # one page

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const SURFACES = { panel: '#191f27', tile: '#20272f', page: '#10141a' };
// Large text needs 3:1, body 4.5:1 (WCAG AA). Anything declared at 20px+
// or bold 14px+ counts as large; this cannot tell, so it uses the lower
// bar and flags only what fails even that.
const FLOOR = 3.0;

const lum = hex => {
  const c = hex.replace('#', '');
  const v = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
  const [r, g, b] = [0, 2, 4].map(i => {
    const x = parseInt(v.substr(i, 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

function audit(file) {
  const raw = fs.readFileSync(path.join(ROOT, file), 'utf8');
  // Comments carry example colours and explanations; matching them
  // produces failures against code that does not exist. Four checks in
  // this project have made that mistake.
  const src = raw.replace(/<!--[\s\S]*?-->/g, '')
                 .replace(/\/\*[\s\S]*?\*\//g, '')
                 .replace(/\/\/[^\n]*/g, '');

  // `color:` not preceded by a hyphen or letter, so border-color and
  // background-color do not masquerade as text.
  const all = [...src.matchAll(/(^|[^-a-zA-Z])color:\s*(#[0-9a-fA-F]{3,6})\b/g)]
    .map(m => m[2].toLowerCase());
  const inline = [...src.matchAll(/style\s*=\s*["'][^"']*?(?<![-a-zA-Z])color:\s*(#[0-9a-fA-F]{3,6})/g)]
    .map(m => m[1].toLowerCase());

  const uniq = [...new Set(all)];
  const low = uniq
    .map(c => ({ c, r: ratio(c, SURFACES.panel) }))
    .filter(x => x.r < FLOOR)
    .sort((a, b) => a.r - b.r);

  return { file, colours: uniq.length, low, inline: [...new Set(inline)] };
}

const only = process.argv[2];
const files = fs.readdirSync(ROOT)
  // view_mock.html is the two-variant COMPARISON built to choose a
  // direction, not a page of the app. Its one low value is a decorative
  // score dash. Excluded so a real regression is not lost among it.
  .filter(f => /_mock\.html$/.test(f) && f !== 'view_mock.html')
  .filter(f => !only || f.startsWith(only));

let bad = 0;
console.log('=== Contrast of every text colour against the panel (#191f27) ===\n');
for (const f of files.sort()) {
  const a = audit(f);
  const flag = a.low.length ? 'FAIL' : ' ok ';
  if (a.low.length) bad++;
  console.log('  ' + flag + '  ' + f.padEnd(28) +
              a.colours + ' colours' +
              (a.inline.length ? ', ' + a.inline.length + ' inline' : ''));
  a.low.forEach(x => console.log('          ' + x.c + '  ' + x.r.toFixed(1) +
    ':1   (needs ' + FLOOR + ':1 — a colour chosen against white)'));
}
console.log('\nPages with a low-contrast colour: ' + bad + ' of ' + files.length);
if (!bad) console.log('  every text colour clears ' + FLOOR + ':1 on the panel.');
process.exitCode = bad ? 1 : 0;
