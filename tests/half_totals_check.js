// Total / Pass / Rush tiles carry the SECOND-HALF figure
// ======================================================
// Andy's spec, 25 Aug 2026, REVISED 30 Aug 2026: from the second half
// onward each of the three yardage tiles shows the game total followed by
// the bracket — 487 [203].
//
// THE BRACKET CHANGED MEANING ON 30 AUGUST. It used to be the figure at
// halftime; it is now the figure SINCE the break. Same rendering, opposite
// number, which is exactly the kind of change that leaves a test passing
// while asserting the wrong thing — so the names in view.html were changed
// with it (`halfBox` -> `secondHalfBox`, `withHalf` -> `withSecondHalf`)
// and this file follows them deliberately rather than by search-and-replace.
//
// THREE DECISIONS, each of which this pins down because each has a wrong
// answer that looks reasonable:
//
//   * FROM THE FIRST SECOND-HALF PLAY, not from the quarter changing. At
//     the Q3 kickoff the bracket would read "[0]", which states a fact
//     about a period that has not started.
//   * THE SECOND HALF IS QUARTERS 3 AND 4, ONLY. Overtime accrues into the
//     game total and leaves the bracket alone. Andy's call, 30 Aug: OT
//     yardage does not count toward the second-half figure. A reference
//     point that keeps moving is not one.
//   * RECOMPUTED, NOT SNAPSHOTTED. Running computeBoxScore over the
//     second-half plays means a play corrected later is reflected. A
//     stored running total would freeze the mistake — and corrections are
//     entered when somebody notices, not when the error happened.
//
//   node tests/half_totals_check.js

const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'view.html');
const raw = fs.readFileSync(FILE, 'utf8');
const live = raw.replace(/<!--[\s\S]*?-->/g, '');

// The logic under test, lifted from view.html so the test exercises the
// real expressions rather than a paraphrase of them.
//
// BRACE-AWARE, not `[^;]+`. The old extractor stopped at the first
// semicolon, which was fine while every declaration was a one-line
// expression. `secondHalfPlays` is a multi-line arrow with a `return`
// inside it, so the old pattern captured half a statement and the test
// died with "could not find" — a failure that reads like the variable is
// missing when it is only shaped differently.
function extract(name) {
  const start = live.indexOf('const ' + name + ' =');
  if (start < 0) throw new Error('could not find ' + name + ' in view.html');
  let i = live.indexOf('=', start) + 1;
  let depth = 0;
  const from = i;
  for (; i < live.length; i++) {
    const c = live[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ';' && depth === 0) break;
  }
  return live.slice(from, i).trim();
}

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

// ---- the source-level guarantees --------------------------------------
chk(/const secondHalfPlays = plays\.filter\(/.test(live) &&
    /q >= 3 && q <= 4/.test(live),
    'the bracket period is quarters 3 and 4 — overtime is excluded at both ends');
chk(/const secondHalfBox = computeBoxScore\(secondHalfPlays\)/.test(live),
    'the bracket figures are RECOMPUTED from the plays, not snapshotted');
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
    'the bracket is subordinate but legible — ' + halfSize + 'px against ' +
    tileSize + 'px is ' + Math.round(ratio * 100) + '% (want 40-85%)');

// ---- the behaviour, RUN rather than read -----------------------------
// Every assertion above is a text match, and text matches are what let
// three separate bugs through on 25 August. These lift the real
// expressions out of view.html and execute them against synthetic plays.
const evalIn = (expr, scope) =>
  new Function(...Object.keys(scope), 'return (' + expr + ');')(...Object.values(scope));

const filterSrc = extract('secondHalfPlays');
const showSrc   = extract('showHalf');
const withSecondHalfSrc = extract('withSecondHalf');

// A game: 3 first-half plays, 1 third-quarter, 1 fourth-quarter, 1 overtime.
const PLAYS = [
  { quarter: 1 }, { quarter: 2 }, { quarter: 2 },
  { quarter: 3 },
  { quarter: 4 },
  { quarter: 5 },              // OT
];

const second = evalIn(filterSrc, { plays: PLAYS });
chk(second.length === 2 && second.every(p => p.quarter >= 3 && p.quarter <= 4),
    'second-half filter keeps only Q3 and Q4 (' + second.length + ' of ' + PLAYS.length + ')');
// THE ONE THAT WOULD HAVE CAUGHT THE OLD BEHAVIOUR. A filter written as
// `q >= 3` alone passes every other check in this file and silently folds
// overtime into the bracket, which is the exact thing Andy asked to have
// removed.
chk(!second.some(p => p.quarter >= 5),
    'and OVERTIME is excluded — the bracket must stop moving once OT starts');
chk(!second.some(p => p.quarter <= 2),
    'and the first half is not in it either');

chk(evalIn(showSrc, { plays: PLAYS }) === true,
    'with a Q3 play present, the bracket shows');
chk(evalIn(showSrc, { plays: [{ quarter: 1 }, { quarter: 2 }] }) === false,
    'with no second-half play, it does not — no "[0]" at the Q3 kickoff');
chk(evalIn(showSrc, { plays: [{ quarter: 5 }] }) === true,
    'and an OT play still counts as being past halftime, so the bracket stays visible');

// The rendered string, both branches.
//
// withSecondHalf is an ARROW FUNCTION in view.html, so the extractor
// returns the function expression rather than its body — evaluating it
// yields a function, not a string. The old test's regex captured only the
// text after `=>`, which worked but silently depended on the declaration
// staying a one-liner. Building the real function and CALLING it is both
// closer to what the page does and indifferent to how it is written.
const withSecondHalf = (showHalf) => evalIn(withSecondHalfSrc, { showHalf });
const render = (showHalf, val, sh) => withSecondHalf(showHalf)(val, sh);
chk(render(true, 487, 203) === '487<span class="stat-tile-half">[203]</span>',
    'second half renders "total [since the break]" (' + render(true, 487, 203) + ')');
chk(render(false, 284, 0) === '284',
    'first half renders the total alone (' + render(false, 284, 0) + ')');
chk(render(true, 0, 0) === '0<span class="stat-tile-half">[0]</span>',
    'a shut-out still shows both figures rather than blanking');

// ---- the three tiles actually use it ----------------------------------
[['totalYds', 'secondHalfTotal'],
 ['passYds', 'secondHalfPass'],
 ['rushYds', 'secondHalfRush']].forEach(([val, sh]) => {
  chk(new RegExp('withSecondHalf\\(' + val + ', ' + sh + '\\)').test(live),
      'the ' + val + ' tile uses withSecondHalf');
});

// ---- and the bracket figures are summed the same way as the totals ----
chk(/const secondHalfPass\s+= yardsOf\(hs\.passing\)/.test(live) &&
    /const secondHalfRush\s+= yardsOf\(hs\.rushing\)/.test(live) &&
    /const secondHalfTotal = secondHalfPass \+ secondHalfRush/.test(live),
    'bracket pass/rush/total are summed exactly as the game figures are');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
