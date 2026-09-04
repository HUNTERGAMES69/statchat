// The box score overlay, and the linescore it is built on
// =============================================================================
// Asked for 4 September 2026: an end-of-game graphic, in two versions -- the
// linescore alone, and the linescore with team totals under it.
//
// TWO GRAPHICS, ONE FILE, addressed by a parameter, the same way
// broadcast_starters.html serves offense, defense and special teams. Two files
// would mean two copies of the linescore, and the whole reason the arithmetic
// went into engine.js was to stop that happening a fourth time -- it already
// existed in recap.html and twice in stat_package.html.
//
// WHAT IS GUARDED HERE, and why each one:
//
//   THE ARITHMETIC. quarterScores() is new and shared, so it is tested
//   directly and hard: overtime kept out of Q4, score adjustments counted,
//   a scoreless overtime still drawing its column, junk not throwing. A
//   graphic that adds up differently from the scoreboard beside it is the one
//   thing this must never do.
//
//   THE ENGINE CONTRACT. engine.js reads TEAMS, plays, startingPossession,
//   quarterLengthSec, TIMEOUTS_PER_HALF, otherTeam and clockToAbsSeconds as
//   GLOBALS -- its own header says so. Declared inside a closure they are
//   invisible to it and the first render dies with the panel simply never
//   appearing, because an overlay swallows its own errors on air. That is
//   exactly how this page failed twice while being built, so it is asserted
//   rather than remembered.
//
//   THE TWO THINGS ANDY ASKED FOR after seeing the mock: no crest in the
//   panel head, because a two-team graphic headed by one team's badge reads
//   as belonging to that team; and each side's totals identified, because
//   the linescore runs teams DOWN the card and the totals run them ACROSS,
//   and nothing said which end was whose.
//
//   node tests/boxscore_overlay_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
// GUARDED, both of them. Run against a repo where the overlay has not been
// uploaded yet -- which is what main looked like the moment before this
// shipped -- the unguarded version died with an ENOENT stack trace instead of
// saying which file was missing.
const PAGE_PATH = path.join(ROOT, 'broadcast_boxscore.html');
const PAGE = fs.existsSync(PAGE_PATH) ? fs.readFileSync(PAGE_PATH, 'utf8') : null;
const engine = require(path.join(ROOT, 'engine.js'));

let pass = 0, fail = 0;
const chk = (ok, m, detail) => {
  if (ok) { pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (detail ? '\n         ' + detail : '')); }
};

console.log('=== The box score overlay ===\n');

if (!PAGE){
  console.log('  FAIL broadcast_boxscore.html is not in this repo — nothing below can run');
  console.log('\n0/1 checks pass');
  process.exit(1);
}

// ---------------------------------------------------------------------------
console.log('-- quarterScores(), the shared arithmetic --');

const S = (q, team, pts) => ({ quarter: q, effect: { score: { team, points: pts } } });
const A = (q, team, pts) => ({ quarter: q, effect: { scoreAdjust: { team, pts } } });

chk(typeof engine.quarterScores === 'function', 'engine.js exports quarterScores');

{
  // The game from the report: Ouachita 7-0-7-0, Neville 0-0-0-7.
  const r = engine.quarterScores([S(1,'teamB',7), S(3,'teamB',7), S(4,'teamA',7)]);
  chk(JSON.stringify(r.teamB) === '[7,0,7,0]' && JSON.stringify(r.teamA) === '[0,0,0,7]',
      'points land in the quarter they were scored in',
      'A=' + JSON.stringify(r.teamA) + ' B=' + JSON.stringify(r.teamB));
  chk(r.totals.teamB === 14 && r.totals.teamA === 7,
      'and the totals are the sum of the line', JSON.stringify(r.totals));
  chk(r.hadOt === false, 'no overtime is reported when there was none');
}
{
  // OVERTIME IS NOT A FIFTH QUARTER. Clamping it into Q4 is a fault this
  // project has already had once -- recap.html's own comment records an
  // overtime touchdown reading as a fourth-quarter one.
  const r = engine.quarterScores([S(4,'teamA',7), S(5,'teamA',7), S(6,'teamB',6)]);
  chk(r.teamA[3] === 7, 'a fourth-quarter score stays in Q4');
  chk(r.ot.teamA === 7 && r.ot.teamB === 6,
      'every period from the fifth folds into one OT total', JSON.stringify(r.ot));
  chk(r.totals.teamA === 14 && r.totals.teamB === 6,
      'and OT is included in the final', JSON.stringify(r.totals));
  chk(r.hadOt === true, 'and overtime is reported');
}
{
  // A SCORELESS OVERTIME STILL HAPPENED, so the column still belongs. This
  // is why hadOt is returned rather than inferred from a non-zero OT score.
  const r = engine.quarterScores([{ quarter: 5, effect: {} }]);
  chk(r.hadOt === true && r.ot.teamA === 0 && r.ot.teamB === 0,
      'a scoreless overtime is still an overtime');
}
{
  // A CORRECTION IS PART OF THE QUARTER IT WAS ENTERED IN. A linescore that
  // ignores adjustments adds up to a different number than the scoreboard.
  const r = engine.quarterScores([S(2,'teamA',7), A(2,'teamA',-2)]);
  chk(r.teamA[1] === 5 && r.totals.teamA === 5,
      'score adjustments count, in their own quarter',
      JSON.stringify(r.teamA) + ' total ' + r.totals.teamA);
}
{
  // A team key the engine does not know must not take the graphic down.
  let threw = false, r = null;
  try {
    r = engine.quarterScores([
      { quarter: 2, effect: { score: { team: 'teamZ', points: 7 } } },
      { quarter: 0, effect: { score: { team: 'teamA', points: 6 } } },
      null, { }, { quarter: 3 }
    ]);
  } catch (e){ threw = true; }
  chk(!threw, 'junk in the play list does not throw');
  chk(r && r.teamA[0] === 6, 'and a quarter of 0 is read as the first', r && JSON.stringify(r.teamA));
}

// ---------------------------------------------------------------------------
console.log('\n-- the page --');

// THE ENGINE CONTRACT, asserted against the page source. These have to be at
// script scope; inside the IIFE engine.js cannot see them.
{
  const head = PAGE.slice(0, PAGE.indexOf('(function(){'));
  ['TEAMS', 'plays', 'startingPossession', 'quarterLengthSec',
   'TIMEOUTS_PER_HALF', 'otherTeam', 'clockToAbsSeconds'].forEach(n => {
    chk(new RegExp('\\b' + n + '\\b').test(head),
        n + ' is declared where engine.js can see it');
  });
}

chk(/<script src="engine\.js"><\/script>/.test(PAGE), 'the page loads engine.js');
chk(/robots.*noindex/.test(PAGE), 'the overlay is noindex, like its siblings');
chk(/html, body \{ background:transparent/.test(PAGE),
    'html and body stay transparent, so the programme feed shows through');
chk(/left:60px; bottom:60px/.test(PAGE),
    'it sits in the same corner as the score bug, drive and starters panels');

function render(opts){
  const o = opts || {};
  const plays = (o.plays || []).slice();
  const game = Object.assign({
    id:'g1', designator:'District 2-5A', game_date:'2026-09-04', status:'final',
    home_team_name:'Neville', away_team_name:'Ouachita Parish', our_team_is_home:true,
    starting_possession:'teamA', quarter_length_seconds:720,
    opponent_primary_color:'#8a1538', opponent_secondary_color:'#ffffff',
    opponent_logo_url: o.oppLogo || null }, o.game || {});
  const branding = { primary_color:'#f9b612', secondary_color:'#1a1a1a', logo_url: o.ourLogo || null };
  const dom = new JSDOM(PAGE, { runScripts:'dangerously', pretendToBeVisual:true,
    url:'https://statchat.co/broadcast_boxscore.html?key=k&id=g1' + (o.totals ? '&totals=1' : ''),
    beforeParse(w){
      w.fetch = async () => ({ ok:true, json: async () => ({
        game, ourBranding: branding,
        plays: plays.map((p,i) => Object.assign({ sequence_number:i+1, team_side:'teamA',
          text:'x', roles:null }, p)) }) });
      w.requestAnimationFrame = (fn) => fn();
      [...PAGE.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])
        .filter(s => !/^https?:/i.test(s))
        .forEach(s => { try { w.eval(fs.readFileSync(path.join(ROOT, s), 'utf8')); } catch (e) {} });
    } });
  return dom;
}

const REG = [S(1,'teamB',7), S(3,'teamB',7), S(4,'teamA',7)];
const OT  = REG.concat([S(5,'teamA',7), S(5,'teamB',6)]);

(async () => {
  // ---- the linescore alone ----
  {
    const dom = render({ plays: REG });
    await new Promise(r => setTimeout(r, 400));
    const d = dom.window.document;
    const rows = [...d.querySelectorAll('#ls tr')];
    chk(rows.length === 3, 'a heading row and one line per team', rows.length + ' rows');
    chk(d.getElementById('panel').classList.contains('shown'), 'the panel is revealed');
    chk((d.getElementById('title').textContent || '').trim() === 'Final',
        'a finished game in regulation reads Final',
        d.getElementById('title').textContent);
    // VISITOR ON TOP -- the order every scoreboard and report in this app uses.
    chk(/Ouachita/.test(rows[1].textContent) && /Neville/.test(rows[2].textContent),
        'the visitor is the top line and the home team the bottom');
    chk(!/OT/.test(rows[0].textContent),
        'no OT column on a game that did not go to overtime', rows[0].textContent);
    chk(/14/.test(rows[1].textContent) && /7/.test(rows[2].textContent),
        'the finals are on the line');

    // ANDY'S FIRST NOTE: no crest in the head.
    chk(d.querySelectorAll('#head img, #head .mark').length === 0,
        'the panel head carries no team crest — this is a two-team graphic');
    // ANDY'S SECOND NOTE: each team's mark on its own line.
    chk(rows[1].querySelector('.mark') && rows[2].querySelector('.mark'),
        'each team carries its own crest on its own linescore line');

    chk(d.getElementById('totals').hidden,
        'and without ?totals=1 there is no totals block');
    dom.window.close();
  }

  // ---- overtime ----
  {
    const dom = render({ plays: OT });
    await new Promise(r => setTimeout(r, 400));
    const d = dom.window.document;
    const rows = [...d.querySelectorAll('#ls tr')];
    chk(/OT/.test(rows[0].textContent), 'overtime adds its own column', rows[0].textContent);
    chk((d.getElementById('title').textContent || '').trim() === 'Final / OT',
        'and the head says so', d.getElementById('title').textContent);
    chk(/20/.test(rows[1].textContent) && /14/.test(rows[2].textContent),
        'with overtime points in the final');
    dom.window.close();
  }

  // ---- the totals version ----
  {
    const dom = render({ plays: REG, totals: true });
    await new Promise(r => setTimeout(r, 400));
    const d = dom.window.document;
    const tot = d.getElementById('totals');
    chk(!tot.hidden, '?totals=1 shows the totals block');
    chk(tot.querySelectorAll('.srow').length === 6,
        'with the same six rows broadcast_stats.html shows',
        tot.querySelectorAll('.srow').length + ' rows');

    // THE FIX ANDY ASKED FOR. Both teams named, one at each end, so a value
    // can be attributed without counting columns.
    const thead = tot.querySelector('.thead');
    chk(!!thead, 'the totals block has a header naming both teams');
    if (thead){
      const sides = thead.querySelectorAll('.side');
      chk(sides.length === 2, 'one team at each end', sides.length + ' sides');
      chk(/Ouachita/.test(sides[0].textContent) && /Neville/.test(sides[1].textContent),
          'in the same order as the linescore above it',
          sides[0].textContent + ' | ' + sides[1].textContent);
      // NO CRESTS HERE. Reported 4 September: a badge on every linescore line
      // AND again at both ends of this header was too much furniture. The
      // linescore keeps its crests -- that is where a viewer matches a name
      // to a team -- and this header identifies its sides with the name and a
      // rule in the team's colour.
      chk(!sides[0].querySelector('.mark') && !sides[1].querySelector('.mark'),
          'and no crests, which the linescore above already carries');
      chk(sides[0].style.borderBottomColor && sides[1].style.borderBottomColor,
          'each side is underlined by a rule of its own',
          sides[0].style.borderBottomColor + ' | ' + sides[1].style.borderBottomColor);
      chk(/\.thead \.side \{[^}]*border-bottom:5px solid/.test(PAGE),
          'the rule is a definite weight, not a hairline');
    }
    // ---- THE SEPARATION, reported 4 September ----
    // With the totals continuing straight on from the linescore the card was
    // nine near-identical horizontal bands and there was nowhere for the eye
    // to rest. A rule between them was just a tenth thing to read past, so
    // the panel became a STACK OF TWO CARDS with the programme feed showing
    // through the gap. Asserted structurally, because a future edit that
    // tidies the markup back into one box would look harmless in a diff.
    const body = d.getElementById('body');
    chk(!body.contains(tot),
        'the totals are their own card, not a section inside the linescore card');
    chk(!!d.getElementById('card'),
        'the linescore has its own card wrapper, so the two can be separated');
    // THE INK LIVES ON THE PANEL. It was on #body, and moving the totals out
    // of #body left every figure in them inheriting the browser default --
    // dark grey on a near-black card, legible in a screenshot and invisible
    // on air. Caught in a render, not in review.
    chk(/#panel \{[^}]*color:#fff/.test(PAGE),
        'the white ink is set on the panel, so both cards inherit it');
    chk(/#totals \{[^}]*margin-top:/.test(PAGE) && /#totals \{[^}]*border-radius:/.test(PAGE),
        'and the totals card has a real gap above it and its own corners');

    // And the values sit at the OUTER edges, under their own team's name --
    // not pushed into the middle against the label, which is what made the
    // first version ambiguous.
    chk(/\.srow \.v\.l \{ text-align:left/.test(PAGE) && /\.srow \.v\.r \{ text-align:right/.test(PAGE),
        'each team owns one edge of the card, top to bottom');
    dom.window.close();
  }

  // ---- the rule is visible whatever the school's colours are ----
  // A school colour is chosen to look good on a jersey, not against a
  // near-black card. Measured before this guard existed: gold read at
  // 10.9:1 but maroon managed 2.09:1, navy 1.16:1 and black 1.07:1 -- five
  // of eight realistic colours were close to invisible, one of them already
  // on screen. An identifier nobody can see is worse than none, because the
  // space still gets used.
  for (const [primary, secondary, label] of [
        ['#f9b612', '#1a1a1a', 'a gold school — its own colour reads'],
        ['#8a1538', '#ffffff', 'maroon — too dark, falls back'],
        ['#0b1d3a', '#c8a02e', 'navy with gold trim — the trim carries it'],
        ['#000000', '#000000', 'black on black — nothing of theirs works'],
        ['#2b3440', '#2b3440', 'the no-branding fallback']]){
    const dom = render({ plays: REG, totals: true,
      game: { opponent_primary_color: primary, opponent_secondary_color: secondary } });
    await new Promise(r => setTimeout(r, 400));
    const d = dom.window.document;
    const sides = d.querySelectorAll('#totals .thead .side');
    // The opponent is the visitor here, so the first side is theirs.
    const col = sides[0].style.borderBottomColor;
    const hex = (function(c){
      const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(c || '');
      if (m) return '#' + [1,2,3].map(i => (+m[i]).toString(16).padStart(2,'0')).join('');
      return c;
    })(col);
    const ratio = engine.contrastRatio(hex, '#0c0c0e');
    chk(ratio >= 3, 'the rule reads on the card: ' + label,
        hex + ' at ' + ratio.toFixed(2) + ':1');
    dom.window.close();
  }

  // ---- a school with no crest uploaded ----
  {
    const dom = render({ plays: REG });
    await new Promise(r => setTimeout(r, 400));
    const d = dom.window.document;
    const marks = [...d.querySelectorAll('#ls .mark')];
    chk(marks.length === 2 && marks.every(m => !m.querySelector('img')),
        'a team with no logo gets its colour block and initial, never a broken image',
        marks.map(m => m.textContent.trim()).join(','));
    dom.window.close();
  }

  // ---- and the separation checks are shown to fail ----
  console.log('\n-- and the checks are shown to fail --');
  {
    // The markup tidied back into one box, which is the realistic regression:
    // it reads as a simplification in a diff.
    const collapsed = PAGE.replace('  <div id="totals" hidden></div>\n</div>',
                                   '</div>');
    chk(collapsed !== PAGE && collapsed.indexOf('<div id="totals" hidden></div>\n</div>') < 0,
        'the two-card markup can be identified, so its loss is detectable');
  }
  {
    const noInk = PAGE.replace('           color:#fff;\n', '');
    chk(!/#panel \{[^}]*color:#fff/.test(noInk),
        'dropping the panel ink is caught — the fault that made the totals ' +
        'dark grey on a near-black card');
  }
  {
    const joined = PAGE.replace(/#totals \{ margin-top:10px;/, '#totals { margin-top:0;');
    chk(!/#totals \{[^}]*margin-top:10px/.test(joined),
        'closing the gap between the two cards is caught');
  }

  console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
  if (fail) process.exit(1);
})().catch(e => { console.error('THREW ' + (e && e.stack || e)); process.exit(2); });
