// Colour helpers — engine.js
// ==========================
// `normalizeHex`, `luminance`, `colorDistance` and `safeTextColor` decide
// what colour text is drawn in on six pages: the game page, the view
// page, the broadcast overlay, and the three report surfaces. They are
// the only reason a team's own colours do not make their own scoreboard
// unreadable.
//
// They were consolidated into engine.js on 13 Aug 2026 and had no test at
// all. This is that test.
//
// WHY IT MATTERS MORE THAN IT LOOKS. The bug that prompted the
// consolidation was silent: `#fff` was parsed as if it had six digits,
// produced NaN, and `NaN > 0.55` is false — so a shorthand hex quietly
// chose white text and put white on white. Nothing threw. Nothing logged.
// The scoreboard was simply blank in the one place a coach looks.
//
// So the assertions here are mostly about MALFORMED input, not the happy
// path. A colour helper that works on '#1a4d2e' and falls over on '#fff'
// is the one that ships.
//
// Reachability, stated honestly: every colour that reaches these
// functions today comes from an `<input type="color">`, which the HTML
// spec requires to emit seven-character lowercase hex. So the shorthand
// case is NOT reachable through the UI right now — this is hardening, and
// the tests are here so it stays hardened rather than because a coach can
// trigger it today. A hand-edited database row or a future import path
// changes that without warning.

const path = require('path');

// engine.js is loaded the way api/feed.js loads it: as a plain module,
// with no page around it. If it ever stops working that way this file
// fails to require, which is itself worth knowing.
const engine = require(path.join(__dirname, '..', 'engine.js'));

function run(){
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });
  const show = (v) => v === undefined ? 'undefined' : JSON.stringify(v);

  // --- normalizeHex ------------------------------------------------------
  // The gate everything else goes through. Six-digit passes, three-digit
  // EXPANDS (that is the fix), anything else is null rather than a
  // half-parsed value that reads as a real colour.
  const NORM = [
    ['#ffffff', '#ffffff', 'plain six-digit'],
    ['#1A4D2E', '#1a4d2e', 'uppercase is lowercased, so keys compare equal'],
    ['  #abcdef  ', '#abcdef', 'a value pasted from a spreadsheet carries spaces'],
    ['#fff',    '#ffffff', 'THE BUG: #abc is the same colour as #aabbcc'],
    ['#FFF',    '#ffffff', 'shorthand, uppercase'],
    ['#AbC',    '#aabbcc', 'shorthand, mixed case'],
    ['#000',    '#000000', 'shorthand black — must not be confused with invalid'],
    ['red',     null,      'a CSS colour name is not a hex value'],
    ['ffffff',  null,      'no hash'],
    ['#ffff',   null,      'four digits is not a hex colour'],
    ['#fffffff', null,     'seven digits'],
    ['#gggggg', null,      'not hex digits'],
    ['',        null,      'empty'],
    [null,      null,      'null'],
    [undefined, null,      'undefined'],
    [42,        null,      'a number, not a string'],
    [{},        null,      'an object']
  ];
  NORM.forEach(([input, expected, why]) => {
    let got;
    try { got = engine.normalizeHex(input); }
    catch (e) { fail('normalizeHex', 'threw on ' + show(input) + ' (' + why + '): ' + e.message); return; }
    if (got !== expected){
      fail('normalizeHex', show(input) + ' -> ' + show(got) + ', expected ' + show(expected) +
           ' — ' + why);
    }
  });

  // --- luminance ---------------------------------------------------------
  // Never NaN. That is the whole point: a NaN here does not throw, it
  // makes every comparison downstream silently false.
  const LUM = [
    ['#ffffff', 1],
    ['#000000', 0],
    ['#fff',    1],      // was NaN before the fix
    ['#000',    0],
    ['red',     0],      // unreadable scores as black, so white text goes on it
    ['',        0],
    [null,      0],
    [undefined, 0]
  ];
  LUM.forEach(([input, expected]) => {
    const got = engine.luminance(input);
    if (typeof got !== 'number' || Number.isNaN(got)){
      fail('luminance', show(input) + ' produced ' + show(got) + ' — a NaN never throws, it ' +
           'just makes every comparison after it false, which is how white ended up on white');
      return;
    }
    if (Math.abs(got - expected) > 0.001){
      fail('luminance', show(input) + ' -> ' + got + ', expected about ' + expected);
    }
  });
  // Ordering, not just endpoints: a mid grey has to sit between them.
  if (!(engine.luminance('#000000') < engine.luminance('#808080') &&
        engine.luminance('#808080') < engine.luminance('#ffffff'))){
    fail('luminance', 'black < grey < white does not hold, so the whole scale is wrong');
  }

  // --- safeTextColor -----------------------------------------------------
  // THE REGRESSION THAT STARTED IT. White on a white background, from a
  // three-digit hex, with no error anywhere.
  if (engine.safeTextColor('#fff', '#ffffff') === '#ffffff'){
    fail('safeTextColor', 'white text on a #fff background — this is the exact bug the ' +
         'shorthand handling exists to prevent, and it is invisible rather than broken');
  }
  // WHATEVER IT RETURNS MUST BE READABLE, measured as WCAG contrast.
  // ------------------------------------------------------------------
  // This used to assert a LUMINANCE GAP of 0.3, mirroring what
  // safeTextColor itself did -- a test that agreed with the code rather
  // than with the requirement. Both were wrong in the same direction, so
  // the suite stayed green while grey text shipped onto a navy banner:
  // the gap was 0.41, over the line, and the contrast was 4.3:1.
  //
  // A fixture that repeats the implementation's own rule cannot catch
  // the rule being wrong.
  const MIN = 4.5;
  const CONTRAST = [
    ['#ffffff', '#ffffff', 'white on white'],
    ['#fff',    '#ffffff', 'white on shorthand white'],
    ['#000000', '#000000', 'black on black'],
    ['#000',    '#000000', 'black on shorthand black'],
    ['#1a4d2e', '#1a4d2e', 'a real team colour on itself'],
    ['#1f2a80', '#999999', 'grey on navy — the case reported from a real game'],
    ['#8b0000', '#000080', 'maroon on navy — two dark brand colours'],
    ['#ffc72c', '#ffffff', 'white on gold'],
    ['#000000', '#333333', 'dark grey on black'],
    ['#7f7f7f', '#808080', 'a mid-tone, where a light/dark cutoff is a coin toss']
  ];
  CONTRAST.forEach(([bg, pref, why]) => {
    const out = engine.safeTextColor(bg, pref);
    const ratio = engine.contrastRatio(bg, out);
    if (ratio < MIN){
      fail('safeTextColor', why + ': chose ' + show(out) + ' on ' + show(bg) +
           ' — contrast ' + ratio.toFixed(2) + ':1, below ' + MIN + ':1. A team\'s ' +
           'colours are used when they can be read; the point of this function is ' +
           'to rescue the pairs that cannot');
    }
  });

  // ...and a readable preference must be HONOURED, or the function is
  // just imposing a house style on every team in the league.
  [['#1f2a80', '#c9a227', 'gold on navy'],
   ['#1a4d2e', '#ffc72c', 'gold on green'],
   ['#ffc72c', '#1a1a2e', 'near-black on gold']].forEach(([bg, pref, why]) => {
    if (engine.safeTextColor(bg, pref) !== pref){
      fail('safeTextColor', why + ' reads at ' + engine.contrastRatio(bg, pref).toFixed(1) +
           ':1 and was overridden anyway — that is a team losing its own colours for ' +
           'no reason');
    }
  });

  // contrastRatio itself: a ratio, not a difference, bounded 1..21.
  if (Math.abs(engine.contrastRatio('#000000', '#ffffff') - 21) > 0.1){
    fail('contrastRatio', 'black on white should be 21:1, got ' +
         engine.contrastRatio('#000000', '#ffffff').toFixed(2));
  }
  if (Math.abs(engine.contrastRatio('#4a7c59', '#4a7c59') - 1) > 0.001){
    fail('contrastRatio', 'a colour against itself should be 1:1');
  }
  if (Math.abs(engine.contrastRatio('#123456', '#abcdef') -
               engine.contrastRatio('#abcdef', '#123456')) > 0.001){
    fail('contrastRatio', 'the ratio must not depend on argument order');
  }
  // A preference that already contrasts must be honoured, or a team's
  // chosen colours get overridden for no reason.
  if (engine.safeTextColor('#000000', '#ffc72c') !== '#ffc72c'){
    fail('safeTextColor', 'gold on black is perfectly readable and was overridden — the ' +
         'point is to rescue unreadable combinations, not to impose a house style');
  }
  // Missing inputs must still return something usable.
  [['#ffffff', null], ['#000000', null], [null, '#123456'], [null, null], ['red', '#ffffff']]
    .forEach(([bg, pref]) => {
      const out = engine.safeTextColor(bg, pref);
      if (!engine.normalizeHex(out)){
        fail('safeTextColor', 'bg=' + show(bg) + ' pref=' + show(pref) + ' returned ' +
             show(out) + ', which is not a usable colour — this value goes straight into ' +
             'a style attribute');
      }
    });

  // --- colorDistance -----------------------------------------------------
  if (engine.colorDistance('#ffffff', '#000000') <= engine.colorDistance('#ffffff', '#eeeeee')){
    fail('colorDistance', 'black is not further from white than near-white is');
  }
  if (engine.colorDistance('#8b0000', '#8b0000') !== 0){
    fail('colorDistance', 'a colour is not zero distance from itself');
  }
  // Shorthand must measure the same as its long form, or two spellings of
  // one colour read as different colours.
  if (engine.colorDistance('#fff', '#000') !== engine.colorDistance('#ffffff', '#000000')){
    fail('colorDistance', '#fff/#000 measured differently from #ffffff/#000000 — the same ' +
         'colour written two ways must not compare as two colours');
  }
  // Unreadable input reports MAXIMUM distance on purpose: a caller asking
  // "are these too similar?" should keep what it has rather than swap on
  // the strength of a comparison that never happened.
  [['red', '#000000'], [null, '#000000'], ['#000000', undefined]].forEach(([a, b]) => {
    const d = engine.colorDistance(a, b);
    if (d !== Infinity){
      fail('colorDistance', show(a) + ' vs ' + show(b) + ' -> ' + show(d) +
           ', expected Infinity so an unreadable colour is treated as maximally distant ' +
           'rather than accidentally "similar"');
    }
  });

  // --- the five page copies must not drift ------------------------------
  // markerLabel and the colour helpers were each duplicated across pages
  // and had to be fixed in three places at once. RECEIVE_POS was defaulted
  // in Node only and nobody noticed for months. This is the cheap guard:
  // every page's position lists must be character-identical.
  {
    const fs = require('fs');
    const read = (file, name, isSet) => {
      const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      const re = isSet
        ? new RegExp('const ' + name + ' = new Set\\(\\[([^\\]]*)\\]\\)')
        : new RegExp('const ' + name + ' = \\[([^\\]]*)\\]');
      const m = src.match(re);
      return m ? m[1].replace(/\s|'/g, '') : null;
    };
    // SIX COPIES, NOT FIVE. broadcast_stats.html carries the same three
    // lists and was never in this guard -- so a position could be added
    // to the five it did watch and silently left out of the sixth, which
    // is precisely the drift the guard exists to catch. Found on 31 Aug
    // 2026 while adding 'ST'.
    const pages = [['create_game.html', false], ['roster.html', false],
                   ['game.html', true], ['view.html', true], ['broadcast.html', true],
                   ['broadcast_stats.html', true]];
    ['OFFENSE_POS', 'DEFENSE_POS', 'SPECIAL_POS'].forEach(listName => {
      const values = pages.map(([f, isSet]) => [f, read(f, listName, isSet)]);
      const missing = values.filter(([, v]) => v === null).map(([f]) => f);
      if (missing.length){
        fail('position lists', listName + ' could not be read from ' + missing.join(', ') +
             ' — if the declaration moved, this guard is no longer guarding anything');
        return;
      }
      const first = values[0][1];
      const differ = values.filter(([, v]) => v !== first).map(([f]) => f);
      if (differ.length){
        fail('position lists', listName + ' differs in ' + differ.join(', ') + ' from ' +
             values[0][0] + '. Six copies exist and they must stay identical: a code the ' +
             'import accepts but the entry app does not know leaves that player with no unit');
      }
    });
  }

  return failures;
}

if (require.main === module){
  const f = run();
  console.log('=== Colour helpers ===\n');
  console.log('Failures: ' + f.length);
  f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
  if (!f.length){
    console.log('  shorthand hex expands, malformed input never yields NaN,');
    console.log('  text stays readable, and the six position lists agree.');
  }
  process.exitCode = f.length ? 1 : 0;
}

module.exports = { run };
