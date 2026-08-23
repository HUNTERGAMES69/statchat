// STYLE AUDIT -- a measurement, not a pass/fail test.
// ---------------------------------------------------------------------
// "Everything has to line up and be uniform" is not something you can fix
// by reading 25 files once; it drifts back the following week. This
// prints the numbers that describe how uniform the app currently is, so
// the same command can be run before and after any tidying and the
// difference is visible rather than felt.
//
// It deliberately does NOT fail. Turning it into a gate before the
// numbers are down would block every unrelated change; the gate comes
// later, once a shared stylesheet exists and the counts are small.
//
//   node tests/style_audit.js
//   node tests/style_audit.js --json     (for diffing between runs)

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');

// Prototypes and mockups are counted separately: they inflate every
// number and none of them ship.
const DEAD = ['gametest.html', 'gametest2.html', 'gametest3.html',
              'layout_mockup.html', 'layout_mockup_left.html',
              'layout_mockup_margin.html', 'game_legacy.html'];

function audit() {
  const files = fs.readdirSync(REPO).filter(f => f.endsWith('.html')).sort();
  const live = files.filter(f => DEAD.indexOf(f) === -1);

  const colours = {}, breakpoints = {}, perFile = [];
  let noViewport = [], sharedSheet = [];

  files.forEach(f => {
    const src = fs.readFileSync(path.join(REPO, f), 'utf8');
    const isDead = DEAD.indexOf(f) !== -1;
    const inline = (src.match(/style="/g) || []).length;
    const pxs = (src.match(/\d+px/g) || []).length;
    const hexes = (src.match(/#[0-9a-fA-F]{6}\b/g) || []).map(h => h.toLowerCase());
    // Must be followed by a brace: /@media[^{]*/ alone matched the words
    // "@media rule can force THIS to full width" inside a code comment
    // and reported it as a breakpoint, which is the sort of thing that
    // makes an audit easy to dismiss.
    const media = (src.match(/@media[^{;]{0,60}\{/g) || [])
      .map(m => m.replace(/\s*\{$/, '').trim())
      .filter(m => /\(|print|screen/.test(m));

    if (!isDead) {
      hexes.forEach(h => { colours[h] = (colours[h] || 0) + 1; });
      media.forEach(m => { breakpoints[m] = (breakpoints[m] || 0) + 1; });
      if (!/name="viewport"/.test(src)) noViewport.push(f);
      if (/rel="stylesheet"/.test(src)) sharedSheet.push(f);
    }
    perFile.push({ file: f, dead: isDead, inline: inline, px: pxs,
                   colours: new Set(hexes).size, media: media.length });
  });

  return { files, live, perFile, colours, breakpoints, noViewport, sharedSheet };
}

function report() {
  const a = audit();
  const uniqueColours = Object.keys(a.colours).length;

  console.log('=== StatChat style audit ===\n');
  console.log('Live pages: ' + a.live.length + '   (excluding ' +
              DEAD.length + ' prototypes/fallbacks)\n');

  console.log('SHARED STYLESHEET');
  console.log('  pages linking one : ' + a.sharedSheet.length + ' / ' + a.live.length);
  if (!a.sharedSheet.length) {
    console.log('  -> every page carries its own <style> block. This is the root');
    console.log('     cause of every number below: there is no single place to');
    console.log('     change a colour, a spacing or a button.');
  }

  console.log('\nCOLOUR');
  console.log('  distinct hex values across live pages: ' + uniqueColours);
  console.log('  the ten most used (the real tokens hiding in there):');
  Object.entries(a.colours).sort((x, y) => y[1] - x[1]).slice(0, 10)
    .forEach(([hex, n]) => console.log('     ' + hex + '   x' + n));

  console.log('\nBREAKPOINTS  (one product should have two or three, not five)');
  Object.entries(a.breakpoints).sort((x, y) => y[1] - x[1])
    .forEach(([m, n]) => console.log('     x' + String(n).padEnd(3) + m));

  console.log('\nMOBILE');
  if (a.noViewport.length) {
    console.log('  NO viewport meta -- cannot render sanely on a phone at all:');
    a.noViewport.forEach(f => console.log('     ' + f));
  } else {
    console.log('  every live page declares a viewport.');
  }

  console.log('\nPER FILE  (inline style= attributes are the drift surface)');
  a.perFile.filter(f => !f.dead).sort((x, y) => y.inline - x.inline)
    .forEach(f => console.log('  ' + f.file.padEnd(24) +
      String(f.inline).padStart(4) + ' inline  ' +
      String(f.px).padStart(5) + ' px  ' +
      String(f.colours).padStart(3) + ' colours  ' +
      String(f.media).padStart(2) + ' media'));

  const dead = a.perFile.filter(f => f.dead);
  if (dead.length) {
    console.log('\nNOT SHIPPED, still in the repo (they drift and mislead):');
    dead.forEach(f => console.log('  ' + f.file));
  }
  console.log('');
}

// THE BREAKPOINT SET IS FIXED AT THREE. Unlike the rest of this file,
// which only measures, this one FAILS -- because the five it replaced
// included two that contradicted each other, and that is the kind of
// fault nobody sees until a page looks wrong at one particular width.
//
//   node tests/style_audit.js --check
const ALLOWED_BREAKPOINTS = [
  '@media (max-width: 767px)',    // phone
  '@media (min-width: 768px)',    // tablet and up
  '@media (max-width: 1219px)',   // tablet and below
  // LANDSCAPE TABLET, a BAND between two agreed edges rather than a new
  // threshold -- it introduces no number the other three do not already
  // use. Added 23 Aug for the collapsible rails, which apply only where
  // there is room for a rail beside the entry card (1024+) but not room
  // for two (below 1220). Portrait tablet stacks and is left alone.
  '@media (min-width: 1024px) and (max-width: 1219px)'
];

function checkBreakpoints() {
  const a = audit();
  const failures = [];
  Object.keys(a.breakpoints).forEach(m => {
    if (/print/.test(m)) return;
    if (ALLOWED_BREAKPOINTS.indexOf(m) === -1) {
      failures.push(m + ' is not one of the three agreed breakpoints');
    }
  });
  console.log('=== Breakpoints ===\n');
  ALLOWED_BREAKPOINTS.forEach(m =>
    console.log('  allowed  ' + m + (a.breakpoints[m] ? '   x' + a.breakpoints[m] : '   (unused)')));
  if (failures.length) {
    console.log('');
    failures.forEach(f => console.log('  [breakpoint] ' + f));
  }
  console.log('\nFailures: ' + failures.length);
  if (!failures.length) {
    console.log('  three breakpoints, no contradictions.');
  }
  return failures;
}


if (require.main === module) {
  if (process.argv.indexOf('--check') !== -1) {
    process.exitCode = checkBreakpoints().length ? 1 : 0;
  } else if (process.argv.indexOf('--json') !== -1) {
    const a = audit();
    console.log(JSON.stringify({
      colours: Object.keys(a.colours).length,
      breakpoints: Object.keys(a.breakpoints),
      noViewport: a.noViewport,
      sharedSheet: a.sharedSheet.length,
      inlineTotal: a.perFile.filter(f => !f.dead).reduce((n, f) => n + f.inline, 0)
    }, null, 2));
  } else {
    report();
  }
}

module.exports = { audit, checkBreakpoints, ALLOWED_BREAKPOINTS };
