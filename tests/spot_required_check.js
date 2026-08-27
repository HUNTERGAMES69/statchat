// A possession change must carry a spot
// =====================================
// wireStartingSpot's getter returned a bare null for three different
// situations -- nothing entered, a yard line with no side, a side with no
// yard line -- and the save path reads null as "no spot needed". So a
// scorer could type 22, never say whose 22, and save a change of possession
// with no field position at all.
//
// THE COUNTING STATS SURVIVE THAT. A rush for 8 is still 8, because statYds
// comes off the play. What does not survive is every check that depends on
// knowing where the ball is: validateGame skips its impossible-gain test
// when fieldPos is null, and the null propagates to every later play, so
// wrong numbers stop being caught for the rest of the drive.
//
// validateGame already counts these and reports at END OF GAME -- the right
// concern at the wrong moment, when the drive is being rebuilt from memory
// rather than fixed in the ten seconds after the play.
//
//   node tests/spot_required_check.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== A spot is required on a possession change ===\n');

// ---- the getter reports WHY ----------------------------------------------
chk(/getReset\.state = function\(\)/.test(src),
    'the spot getter reports its state, so the caller can tell "nothing ' +
    'entered" from "half entered" — one bare null could not');
chk(/getReset\.prefix = idPrefix/.test(src),
    'and which field it belongs to, so the message can focus the right one');

// ---- run the real state function -----------------------------------------
const fnSrc = /getReset\.state = function\(\)\{[\s\S]*?\n    \};/.exec(src);
if (!fnSrc) { chk(false, 'could not extract state() to run it'); }
else {
  const state = (side, yl, visible) => {
    const doc = { getElementById: () => (yl === null ? null
      : { value: yl, offsetParent: visible ? {} : null }) };
    return new Function('document', 'side', 'idPrefix',
      fnSrc[0].replace('getReset.state =', 'const f =') + '; return f;')(doc, side, 'pp_spot')();
  };
  const BLOCKS = s => ['noSide', 'noYardline', 'empty'].includes(s);

  chk(state(null, '22', true) === 'noSide' && BLOCKS('noSide'),
      'a yard line with NO SIDE is refused — this is the reported bug: 22 ' +
      'entered, nobody said whose 22, possession changed with no spot');
  chk(state('own', '', true) === 'noYardline' && BLOCKS('noYardline'),
      'and a side with no yard line');
  chk(state(null, '', true) === 'empty' && BLOCKS('empty'),
      'and a spot left entirely blank — the labels have said "(required)" ' +
      'on seven of these fields all along with nothing enforcing it');
  chk(state('own', '22', true) === 'ok',
      'a complete spot passes');

  // A HIDDEN FIELD IS NOT A MISTAKE. Several of these live in wrappers the
  // panel shows or hides by toggle -- an onside kick, a kicking-team
  // recovery -- and refusing those would block plays that are correct.
  chk(state(null, '', false) === 'hidden' && !BLOCKS('hidden'),
      'a HIDDEN spot field is skipped — several are toggled out of view and ' +
      'are not something the scorer failed to fill in');
  chk(state(null, '22', false) === 'hidden',
      'even with a stale value left in it from a previous toggle state');
}

// ---- the touchdown exemption ---------------------------------------------
// The panel does NOT hide the spot on a touchdown; it only hides it for an
// onside kick or a kicking-team recovery. The save path already skips the
// reset when td is set, so blocking here would refuse a kickoff returned
// for a score.
chk(/const tdChecked = !!\(document\.getElementById\('pp_td'\)/.test(src),
    'a TOUCHDOWN is exempt — there is no takeover spot on a score, and the ' +
    'panel leaves the field visible, so this would otherwise refuse a good play');
chk(/!tdChecked && currentSpotGetter/.test(src),
    'and the exemption is checked BEFORE the state, not after');

// ---- refused at review, not at save --------------------------------------
const guardAt = src.indexOf('A POSSESSION CHANGE HAS TO CARRY A SPOT');
const fnAt = src.indexOf('function buildAndReview');
chk(guardAt > -1 && fnAt > -1 && guardAt > fnAt && guardAt - fnAt < 400,
    'refused at Review play, where the scorer is already looking at the ' +
    'panel and the field needing attention is still in front of them');
chk(/el\.scrollIntoView\(\{ block: 'center' \}\); el\.focus\(\)/.test(src),
    'and the offending field is scrolled to and focused, not just named');

// ---- THE GUARD ACTUALLY REFUSES -----------------------------------------
// Every assertion above checks a PIECE -- the state function, the exemption,
// the placement. Replacing the guard's condition with `if (false)` left all
// of them passing: the parts were all present and the behaviour was gone.
{
  const guard = /A POSSESSION CHANGE HAS TO CARRY A SPOT[\s\S]*?\n    \}\n/.exec(src);
  chk(!!guard, 'the guard block is present');
  if (guard) {
    const g = guard[0];
    chk(/if \(st === 'noSide' \|\| st === 'noYardline' \|\| st === 'empty'\)/.test(g),
        'and its condition names the three refusable states — not a constant, ' +
        'and not a subset');
    chk(/showMsg\('gameMsg'/.test(g) && /return;/.test(g),
        'it reports and RETURNS, so the play is not built');
    const showAt = g.indexOf("showMsg('gameMsg'");
    const retAt = g.indexOf('return;', showAt);
    chk(showAt > -1 && retAt > showAt,
        'in that order — a return before the message would refuse silently');
  }
}

// ---- the end-of-game backstop stays --------------------------------------
chk(/plays were.{0,40}no field position|noSpot\+\+/.test(src),
    "validateGame's end-of-game count is kept as the backstop for anything " +
    'that still slips through');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
