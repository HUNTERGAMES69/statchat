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
{
  const fn = /function spotIsMissing\(\)\{[\s\S]*?\n  \}/.exec(src)[0];
  const tdAt = fn.indexOf('tdChecked');
  const stateAt = fn.indexOf('currentSpotGetter.state()');
  chk(tdAt > -1 && stateAt > tdAt,
      'the touchdown exemption is checked BEFORE the state, so a score never ' +
      'even asks the question');
}

// ---- refused at review, not at save --------------------------------------
// GUARDED AT THE CHOKE POINT, not at one panel. The first version guarded
// buildAndReview, which is only the main play panel -- bad snap, QB kneel,
// penalty and drive-adjust each have their own Review button and went
// straight past it. Bad snap sets currentSpotGetter like everything else,
// so it was refusing nothing.
chk(/function showConfirm\(\)\{\s*\n\s*if \(spotIsMissing\(\)\) return;/.test(src),
    'the guard runs in showConfirm, the one point every Review button reaches');
chk((src.match(/function spotIsMissing/g) || []).length === 1,
    'defined once, so no panel can drift onto a stale copy');
{
  // every review handler must reach it, directly or through buildAndReview
  const L = src.split('\n');
  const paths = ['drive_review','pen_review','badsnap_review','kneel_review','pp_review'];
  const missed = paths.filter(id => {
    const i = L.findIndex(l => l.includes("getElementById('" + id + "')") && /addEventListener/.test(l));
    if (i < 0) return true;
    const win = L.slice(i, i + 90).join('\n');
    return !/showConfirm\(\)/.test(win) && !/buildAndReview\(/.test(win);
  });
  chk(missed.length === 0,
      'and every Review button reaches it' + (missed.length ? ' — missed: ' + missed.join(', ') : ''));
}
// OVERTIME is the exception: it has its own local getter, so it cannot call
// spotIsMissing. It already refused an incomplete spot -- but SILENTLY,
// which is the same complaint that produced this whole guard.
chk(/if \(!reset\)\{[\s\S]{0,400}showReviewMsg/.test(src),
    'overtime states what is missing rather than refusing silently');
// REPORTED THE SAME WAY A MISSING RUSHER IS. The first version wrote into
// gameMsg -- which is exactly what the comment on missingPlayer warns
// against: writing there grows the top of the document and shoves the panel
// out from under the scorer's thumb at the moment they are reading a
// refusal.
{
  const guard = /function spotIsMissing\(\)\{[\s\S]*?\n  \}/.exec(src)[0];
  chk(guard.indexOf("showReviewMsg('Nothing has been saved") !== -1,
      'the refusal reads like the missing-rusher one and sits beside Review ' +
      'play, not at the top of the page');
  chk(/markRowGap\(/.test(guard),
      'and the field itself is marked, so the message is not the only clue');
  chk(!/showMsg\('gameMsg'/.test(guard),
      'and NOT written into gameMsg, which grows the top of the document and ' +
      'moves the panel under the scorer at the worst moment');
  chk(/confirmCard/.test(guard),
      'the confirm card is hidden, so a stale review from a previous attempt ' +
      'is not left on screen looking like this play was accepted');
}

// ---- THE GUARD ACTUALLY REFUSES -----------------------------------------
// Every assertion above checks a PIECE -- the state function, the exemption,
// the placement. Replacing the guard's condition with `if (false)` left all
// of them passing: the parts were all present and the behaviour was gone.
{
  const guard = /function spotIsMissing\(\)\{[\s\S]*?\n  \}/.exec(src);
  chk(!!guard, 'the guard block is present');
  if (guard) {
    const g = guard[0];
    chk(/spotState !== 'noSide' && spotState !== 'noYardline' && spotState !== 'empty'/.test(g),
        'and its condition names the three refusable states — not a constant, ' +
        'and not a subset');
    chk(/showReviewMsg\(/.test(g) && /return true;/.test(g),
        'it reports and returns TRUE, so showConfirm stops');
    const showAt = g.indexOf('showReviewMsg(');
    const retAt = g.indexOf('return true;', showAt);
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
