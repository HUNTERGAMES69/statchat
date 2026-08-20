// Sack-fumble defense credit
// -----------------------------
// Reported directly, 20 Aug 2026: a sack for a loss of 0, that then
// resulted in a fumble recovered by the defense, showed the fumble
// recovery but not the sack -- on the defense's own table specifically.
// Confirmed it was not about the yardage (identical gap at 7 lost, not
// just 0); it was a conflict with the fumble.
//
// The passer's own "Sacked" column already had an exception for this
// exact shape (a fumble carrying attempt: 'sack'). A SEPARATE place in
// engine.js tracks sacks on the defense's own table, and that one never
// got the same exception when the sack-fumble merge was built -- its
// own check only ever tested type === 'sack' directly.
//
// The fix credits the TEAM total on defense, never the named recoverer
// personally. roles.defense on a fumble play is who picked the ball up,
// not who made the sack, and those are frequently different players --
// crediting the recoverer directly would repeat the exact mistake
// already fixed for tackles on 13 Aug 2026 (a linebacker with three
// tackles when he had made two). It also applies whether the defense
// recovers or the offense keeps its own fumble, since the sack happened
// either way.

const { bootGamePage } = require('./harness');
const { click, setDrive, typeInto } = require('./ui_driver');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  async function sackFumble(yards, recSide, credit) {
    const h = await bootGamePage();
    setDrive(h, { down: 2, distance: 8, side: 'own', yardline: 30 });
    h.evalIn("renderPlayPanel('sack')");
    typeInto(h.window, h.document.getElementById('pp_passer_manual'), '7');
    typeInto(h.window, h.document.getElementById('pp_yards'), String(yards));
    click(h.window, h.document.getElementById('pp_sack_fumbled_toggle'));
    click(h.window, h.document.querySelector('input[name=pp_sack_fumrec][value=' + recSide + ']'));
    if (credit && recSide === 'opp') {
      typeInto(h.window, h.document.getElementById('pp_credit_manual_sackfum'), credit);
    }
    click(h.window, h.document.getElementById('pp_review'));
    click(h.window, h.document.getElementById('saveBtn'));
    const box = JSON.parse(h.evalIn('JSON.stringify(computeBoxScore(plays))'));
    h.close();
    return box;
  }

  // --- 1. The exact reported case: loss of 0, opponent recovers, named.
  {
    const box = await sackFumble(0, 'opp', '55');
    const teamBDef = box.teamB.defense;
    if (!teamBDef.TEAM || teamBDef.TEAM.sacks !== 1) {
      fail('reported-case', 'expected teamB.defense.TEAM.sacks === 1 at 0 lost yards, got ' + JSON.stringify(teamBDef));
    }
    if (!teamBDef['O Linebacker'] || teamBDef['O Linebacker'].fumRec !== 1) {
      fail('reported-case-fumrec', 'expected the named recoverer to still have fumRec === 1, got ' + JSON.stringify(teamBDef));
    }
    // The named recoverer must NOT also carry the sack -- he recovered
    // the ball, which is a different act from making the sack.
    if (teamBDef['O Linebacker'] && teamBDef['O Linebacker'].sacks) {
      fail('reported-case-not-recoverer', 'the named recoverer was credited with the sack directly, which he may not have made');
    }
  }

  // --- 2. Not about the yardage -- identical result at a nonzero loss.
  {
    const box = await sackFumble(7, 'opp', '55');
    if (!box.teamB.defense.TEAM || box.teamB.defense.TEAM.sacks !== 1) {
      fail('nonzero-yardage', 'expected the same sacks credit at 7 lost yards, got ' + JSON.stringify(box.teamB.defense));
    }
  }

  // --- 3. Offense recovers its own fumble -- the sack still happened
  // and defense still gets credit, even though the offense kept the
  // ball and there is no fumRec at all on this play.
  {
    const box = await sackFumble(3, 'own', null);
    if (!box.teamB.defense.TEAM || box.teamB.defense.TEAM.sacks !== 1) {
      fail('own-recovers', 'expected the defense to still get sack credit when the offense recovers its own fumble, got ' + JSON.stringify(box.teamB.defense));
    }
  }

  // --- 4. Nobody named as the recoverer -- team bucket gets both.
  {
    const box = await sackFumble(3, 'opp', null);
    const t = box.teamB.defense.TEAM;
    if (!t || t.sacks !== 1 || t.fumRec !== 1) {
      fail('unnamed-recoverer', 'expected TEAM to carry both sacks:1 and fumRec:1 when nobody is named, got ' + JSON.stringify(box.teamB.defense));
    }
  }

  // --- 5. Regression: a plain sack, no fumble, is unaffected --
  // sack credit still goes to the named sacker directly, as before.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 2, distance: 8, side: 'own', yardline: 30 });
    h.evalIn("renderPlayPanel('sack')");
    typeInto(h.window, h.document.getElementById('pp_passer_manual'), '7');
    typeInto(h.window, h.document.getElementById('pp_yards'), '5');
    typeInto(h.window, h.document.getElementById('pp_credit_manual'), '55');
    click(h.window, h.document.getElementById('pp_review'));
    click(h.window, h.document.getElementById('saveBtn'));
    const box = JSON.parse(h.evalIn('JSON.stringify(computeBoxScore(plays))'));
    h.close();
    if (!box.teamB.defense['O Linebacker'] || box.teamB.defense['O Linebacker'].sacks !== 1) {
      fail('plain-sack-regression', 'a plain sack with a named sacker no longer credits him directly: ' + JSON.stringify(box.teamB.defense));
    }
    if (box.teamB.defense.TEAM) {
      fail('plain-sack-no-team-duplicate', 'a plain, named sack should not ALSO add a TEAM sacks credit: ' + JSON.stringify(box.teamB.defense));
    }
  }

  // --- 6. Regression: an unrelated rush fumble (not a sack) must not
  // pick up a spurious sacks credit.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 2, distance: 8, side: 'own', yardline: 30 });
    h.evalIn("renderPlayPanel('rush')");
    typeInto(h.window, h.document.getElementById('pp_carrier_manual'), '22');
    typeInto(h.window, h.document.getElementById('pp_yards'), '8');
    click(h.window, h.document.getElementById('pp_rush_fumbled_toggle'));
    typeInto(h.window, h.document.getElementById('pp_credit_manual_rushfum') || h.document.getElementById('pp_credit_manual'), '55');
    click(h.window, h.document.getElementById('pp_review'));
    click(h.window, h.document.getElementById('saveBtn'));
    const box = JSON.parse(h.evalIn('JSON.stringify(computeBoxScore(plays))'));
    h.close();
    const anySacks = Object.values(box.teamB.defense).some(p => p.sacks);
    if (anySacks) {
      fail('rush-fumble-no-sack', 'a rush fumble (unrelated to a sack) picked up a spurious sacks credit: ' + JSON.stringify(box.teamB.defense));
    }
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Sack-fumble defense credit ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  a sack that ends in a fumble credits the team\'s sacks total regardless of yardage or who recovers, never the named recoverer directly.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
