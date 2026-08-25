// Total / Pass / Rush tiles carry the halftime figure
// ===================================================
// Andy's spec, 25 Aug 2026: from the second half onward each of the three
// yardage tiles shows the game total followed by what that number was at
// halftime — 487 [284]. Attempts and completions come off these tiles.
//
// THREE DECISIONS, each of which this pins down because each has a wrong
// answer that looks reasonable:
//
//   * FROM THE FIRST SECOND-HALF PLAY, not from the quarter changing. At
//     the Q3 kickoff the figures are identical — "284 [284]" — which reads
//     as a bug rather than as information.
//   * THE FIRST HALF IS QUARTERS 1 AND 2, ALWAYS. Overtime accrues into
//     the game total and leaves the bracket alone. A reference point that
//     moves is not one.
//   * RECOMPUTED, NOT SNAPSHOTTED. Running computeBoxScore over the
//     first-half plays means a first-half play corrected AFTER halftime is
//     reflected. A stored running total would freeze the mistake — and
//     corrections are entered when somebody notices, not when the error
//     happened.
//
//   node tests/half_totals_check.js

const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'view.html');
const raw = fs.readFileSync(FILE, 'utf8');
const live = raw.replace(/<!--[\s\S]*?-->/g, '');

// The logic under test, lifted from view.html so the test exercises the
// real expressions rather than a paraphrase of them.
function extract(name) {
  const m = new RegExp('const ' + name + ' = ([^;]+);').exec(live);
  if (!m) throw new Error('could not find ' + name + ' in view.html');
  return m[1];
}

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

// ---- the source-level guarantees --------------------------------------
chk(/const firstHalfPlays = plays\.filter\(p => \(p\.quarter \|\| 0\) <= 2\)/.test(live),
    'the first half is quarters 1 and 2 — overtime is not folded in');
chk(/const halfBox = computeBoxScore\(firstHalfPlays\)/.test(live),
    'the halftime figures are RECOMPUTED from the plays, not snapshotted');
chk(/const showHalf = plays\.some\(p => \(p\.quarter \|\| 0\) >= 3\)/.test(live),
    'the bracket appears on the first second-half PLAY, not at the quarter change');
chk(!/Comp \/ Pass Yds|Att \/ Rush Yds/.test(live),
    'comp and att are off these tiles');
chk(/'Pass Yards'/.test(live) && /'Rush Yards'/.test(live),
    'and the labels say what is left');
// SIZED AS A RATIO OF THE VALUE IT SITS BESIDE, not as a fixed number.
// A hardcoded 19 here failed the moment Andy asked for it 30% larger --
// the check was pinning an implementation detail rather than the thing
// that matters, which is that the bracket stays clearly subordinate to the
// figure it annotates while still being readable across a room.
const tileSize = Number(/\.stat-tile-value \{[^}]*font-size:(\d+)px/.exec(live)[1]);
const halfSize = Number(/\.stat-tile-half \{[^}]*font-size:(\d+)px/.exec(live)[1]);
const ratio = halfSize / tileSize;
chk(ratio > 0.4 && ratio < 0.85,
    'the halftime figure is subordinate but legible — ' + halfSize + 'px against ' +
    tileSize + 'px is ' + Math.round(ratio * 100) + '% (want 40-85%)');

// ---- the behaviour, RUN rather than read -----------------------------
// Every assertion above is a text match, and text matches are what let
// three separate bugs through earlier today. These lift the real
// expressions out of view.html and execute them against synthetic plays.
const evalIn = (expr, scope) =>
  new Function(...Object.keys(scope), 'return (' + expr + ');')(...Object.values(scope));

const filterSrc  = extract('firstHalfPlays');
const showSrc    = extract('showHalf');
const withHalfSrc = /const withHalf = \(val, half\) => ([\s\S]*?);\n/.exec(live)[1];

// A game: 3 first-half plays, 1 third-quarter, 1 overtime.
const PLAYS = [
  { quarter: 1 }, { quarter: 2 }, { quarter: 2 },
  { quarter: 3 },
  { quarter: 5 },              // OT
];

const half = evalIn(filterSrc, { plays: PLAYS });
chk(half.length === 3 && half.every(p => p.quarter <= 2),
    'first-half filter keeps only Q1 and Q2 (' + half.length + ' of ' + PLAYS.length + ')');
chk(!half.some(p => p.quarter >= 5),
    'and OVERTIME is not counted as first half — the bracket must not move in OT');

chk(evalIn(showSrc, { plays: PLAYS }) === true,
    'with a Q3 play present, the bracket shows');
chk(evalIn(showSrc, { plays: [{ quarter: 1 }, { quarter: 2 }] }) === false,
    'with no second-half play, it does not — no "284 [284]" at the Q3 kickoff');
chk(evalIn(showSrc, { plays: [{ quarter: 5 }] }) === true,
    'and an OT play counts as being past halftime');

// The rendered string, both branches.
const render = (showHalf, val, h) =>
  evalIn(withHalfSrc, { showHalf, val, half: h });
chk(render(true, 487, 284) === '487<span class="stat-tile-half">[284]</span>',
    'second half renders "total [halftime]" (' + render(true, 487, 284) + ')');
chk(render(false, 284, 284) === '284',
    'first half renders the total alone (' + render(false, 284, 284) + ')');
chk(render(true, 0, 0) === '0<span class="stat-tile-half">[0]</span>',
    'a shut-out still shows both figures rather than blanking');

// ---- the three tiles actually use it ----------------------------------
['totalYds, halfTotal', 'passYds, halfPass', 'rushYds, halfRush'].forEach(pair => {
  chk(new RegExp('withHalf\\(' + pair.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\)').test(live),
      'the ' + pair.split(',')[0] + ' tile uses withHalf');
});

// ---- and the halftime figures are summed the same way as the totals ---
chk(/const halfPass\s+= yardsOf\(hs\.passing\)/.test(live) &&
    /const halfRush\s+= yardsOf\(hs\.rushing\)/.test(live) &&
    /const halfTotal = halfPass \+ halfRush/.test(live),
    'halftime pass/rush/total are summed exactly as the game figures are');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
