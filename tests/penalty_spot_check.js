// A penalty enforced from the spot of the foul
// ============================================
// Every penalty marked off from where the ball currently is -- the previous
// spot -- which is right for most fouls and wrong for a foul during a run.
//
// Under "all but one" the basic spot for a running play is the END of the
// run, and a foul behind that basic spot is enforced from where it happened.
// A back runs 8 from the 30 and holding is called at the 34: the basic spot
// is the 38, the foul is behind it, so ten yards come off the 34 and the
// ball goes to the 24. Net SIX, not ten.
//
// Reproducing that meant Adjust Down/Distance first, which writes a play
// into the log saying the down was adjusted -- so the record read as a
// correction rather than a penalty.
//
// THE PLAY ITSELF IS STILL NULLIFIED. No rushing attempt, no yards, not even
// up to the foul. The spot governs where the ball is marked off from, not
// how much of the play survives.
//
//   node tests/penalty_spot_check.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Penalty enforced from the spot of the foul ===\n');

// ---- the control ---------------------------------------------------------
chk(/id="pen_spot_toggle"/.test(src), 'the toggle exists');
chk(/id="pen_spot_yardline"/.test(src), 'and a yard line to go with it');
chk(/id="pen_spot_fields" style="display:none;/.test(src),
    'the spot fields start hidden — this is behind a toggle, not always shown');

// NOT KEYED OFF THE PENALTY TYPE, which is optional: choosing nothing would
// have hidden the row exactly when it was wanted.
chk(!/pen_type[\s\S]{0,200}pen_spot_fields/.test(src),
    'and not revealed by the penalty type, which can be left blank');

// ---- it conflicts with Dead Ball and nothing else -------------------------
// A dead-ball foul happens after the play is over, so there is no
// spot-of-foul enforcement to do. But defensive holding is commonly BOTH
// spot-enforced and an automatic first down, and an illegal forward pass is
// spot-enforced and carries loss of down.
{
  const w = /\(function wirePenSpot\(\)\{[\s\S]*?\n    \}\)\(\);/.exec(src);
  chk(!!w, 'the toggle is wired');
  if (w) {
    chk(/if \(on\) setToggle\('pen_no_down', false\);/.test(w[0]),
        'turning it on clears Dead Ball');
    chk(/setToggle\('pen_spot', false\)/.test(w[0]),
        'and turning Dead Ball on clears it — neither can strand the other');
    chk(!/pen_first_down|pen_lod/.test(w[0]),
        'it does NOT exclude automatic first down or loss of down: defensive ' +
        'holding is routinely spot-enforced AND an automatic first down');
  }
}

// ---- the token ------------------------------------------------------------
chk(/spotTok = ' sp:' \+ abs;/.test(src),
    'the spot travels as an absolute 0-100 from the offense goal line, the ' +
    'same scale state.fieldPos uses, so the parser need not know whose side');
{
  // THE STRING EXISTING IS NOT THE GUARD RUNNING. Replacing the condition
  // with `if (false)` left this green.
  const g = /if \(!penSpotSide \|\| isNaN\(yl\)\)\{[\s\S]{0,320}?return;\s*\n\s*\}/.exec(src);
  chk(!!g, 'a half-filled spot is refused — no side, or no yard line');
  if (g) {
    chk(/showReviewMsg\(/.test(g[0]),
        'and says so rather than the button quietly doing nothing');
    chk(/return;/.test(g[0]),
        'and returns, so no code is built from half an answer');
  }
}

// ---- the arithmetic -------------------------------------------------------
{
  // EXTRACTED FROM THE SOURCE, not reimplemented. A first version copied
  // these three lines into the test, so changing them in game.html left the
  // test green: it was checking its own arithmetic, not the app's.
  const grab = (re, what) => {
    const m = re.exec(src);
    if (!m) { chk(false, 'could not find ' + what + ' in game.html'); return null; }
    return m[0];
  };
  const enforceSrc = grab(/const enforceFrom = \(foulSpot[\s\S]*?state\.fieldPos;/, 'the enforcement base');
  const posSrc = grab(/const newFieldPos = enforceFrom !== null\s*\n\s*\?[^;]*;/, 'the new field position');
  const netSrc = grab(/const netMove = \(newFieldPos[\s\S]*?fieldDelta;/, 'the net move');

  const calc = (state, which, yds, spot) => {
    const fieldDelta = which === 'po' ? -yds : yds;
    const body = 'const foulSpot = spot;\n' + enforceSrc + '\n' + posSrc + '\n' + netSrc +
                 '\nreturn { newFieldPos, netMove };';
    const { newFieldPos, netMove } =
      new Function('state', 'spot', 'fieldDelta', body)(state, spot, fieldDelta);
    let newDown = state.down;
    let newDistance = state.distance !== null ? state.distance - netMove : null;
    if (newDistance !== null && newDistance <= 0) {
      newDown = 1;
      newDistance = newFieldPos !== null ? Math.max(1, Math.min(10, 100 - newFieldPos)) : 10;
    }
    return { pos: newFieldPos, down: newDown, dist: newDistance };
  };

  const a = calc({ fieldPos: 30, distance: 10, down: 1 }, 'po', 10, 34);
  chk(a.pos === 24 && a.down === 1 && a.dist === 16,
      'the worked example: 1st and 10 from the 30, holding at the 34 -> ' +
      '1st and 16 from the 24 (net six, not ten)');

  const b = calc({ fieldPos: 30, distance: 10, down: 1 }, 'po', 10, null);
  chk(b.pos === 20 && b.dist === 20,
      'and with NO spot given it still marks off from the previous spot, ' +
      'which is the behaviour every other penalty has always had');

  // DISTANCE FOLLOWS THE BALL, not the penalty yardage. Normally those agree;
  // with a foul spot the base moved too, so measuring by fieldDelta would
  // put the marker in the wrong place.
  chk(a.dist === 16 && a.dist !== 20,
      'the marker is measured against where the ball ENDED, not against the ' +
      'penalty yardage — those differ the moment the base moves');

  const c = calc({ fieldPos: 30, distance: 10, down: 2 }, 'pd', 10, 38);
  chk(c.pos === 48 && c.down === 1,
      'a defensive foul works the same way and still reaches a first down');

  const d = calc({ fieldPos: 95, distance: 5, down: 1 }, 'pd', 15, 97);
  chk(d.pos === 100,
      'and the clamp holds at the goal line — half the distance is the real ' +
      'rule there, and the panel already has a button for it');
}

// ---- the log text ---------------------------------------------------------
chk(/foulSpot !== null \? ' from the spot of the foul' : ''/.test(src),
    'the play text says where it was enforced from');
chk(!/spot of the foul[\s\S]{0,40}markerLabel|spot of the foul.{0,30}yardline/i.test(src),
    'and does NOT name the yard line — Andy\'s call, the log stays short');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
