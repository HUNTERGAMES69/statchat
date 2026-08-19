// Guided kickoff flow -- calculator and fumble-during-return
// -------------------------------------------------------------
// Reported directly, 19 Aug 2026: the guided flow (used for the opening
// kickoff and every 2nd-half kickoff) never gained the "fielded at /
// returned to" calculator, or the "fumbled during the return" outcome,
// that the ordinary play panel's kickoff already had. It is a
// completely separate, hand-maintained implementation -- it never goes
// through parseInput at all -- which is exactly why it drifted.
//
// No existing fuzzer exercises this: ui_driver.js's enterPlay/setDrive
// never drive the guided flow, only the ordinary panel. Everything here
// was manually verified once, through the real UI, before this file
// existed -- this pins it down so it stays true.

const { bootGamePage } = require('./harness');
const { click, typeInto } = require('./ui_driver');

async function startAndKickoff(h) {
  h.evalIn("startGuided(1, 'firstHalf')");
  click(h.window, h.document.getElementById('pickA')); // teamA kicks
  const kickerBtn = h.document.querySelector('.gk_kicker_pick');
  if (kickerBtn) click(h.window, kickerBtn);
  else typeInto(h.window, h.document.getElementById('gk_kicker_manual'), '3');
  click(h.window, h.document.getElementById('guidedKickoffSave'));
}

// A REAL down/distance BEFORE the kickoff, not a fresh game's null
// state -- setDrive establishes it, standing in for a first half that
// ended mid-drive, which is exactly when a second-half kickoff would
// have something stale to actually clear. Missing this made the FIRST
// version of tests 4 and 5 below pass regardless of whether endsDrive
// was even present: down/distance/fieldPos start at null on a fresh
// game and stay null with nothing to leave behind, so a test that
// starts cold cannot tell a working fix from a missing one. Found by
// deliberately reverting the fix and watching the test stay green
// instead of failing -- the same discipline every other fixture
// tonight was held to, applied here one step later than it should
// have been.
async function establishStaleDrive(h) {
  const { setDrive } = require('./ui_driver');
  setDrive(h, { down: 2, distance: 6, side: 'own', yardline: 35 });
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1. the calculator computes return yards and fills the spot ----
  {
    const h = await bootGamePage();
    await startAndKickoff(h);
    typeInto(h.window, h.document.getElementById('gr_kofielded_yardline'), '30');
    click(h.window, h.document.querySelector('.gr_kofieldedSide[data-side="opp"]'));
    typeInto(h.window, h.document.getElementById('gr_koretto_yardline'), '45');
    click(h.window, h.document.querySelector('.gr_koretSide[data-side="opp"]'));
    const yds = h.document.getElementById('gr_yards').value;
    const spot = h.document.getElementById('gr_spot_yardline').value;
    if (yds !== '15') fail('calculator', 'fielded at opp 30, returned to opp 45 should compute 15 return yards, got ' + yds);
    if (spot !== '45') fail('calculator', 'the takeover spot should auto-fill to 45, got ' + spot);
    h.close();
  }

  // --- 2. fumble during the return, receiving team recovers ----------
  {
    const h = await bootGamePage();
    await startAndKickoff(h);
    click(h.window, h.document.getElementById('gr_ko_ret_fumbled_toggle'));
    typeInto(h.window, h.document.getElementById('gr_koret_fumrec_credit'), '99');
    typeInto(h.window, h.document.getElementById('gr_yards'), '10');
    typeInto(h.window, h.document.getElementById('gr_spot_yardline'), '35');
    click(h.window, h.document.querySelector('.gr_spot_side[data-side="own"]'));
    click(h.window, h.document.getElementById('guidedReturnSave'));
    const st = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
    const poss = JSON.parse(h.evalIn('JSON.stringify(countPossessions(plays))'));
    if (st.possession !== 'teamB') fail('fumble-receiving-recovers', 'expected teamB to end up with the ball, got ' + st.possession);
    if (poss.teamB !== 1) fail('fumble-receiving-recovers', 'expected teamB to have exactly 1 possession, got ' + JSON.stringify(poss));
    h.close();
  }

  // --- 3. fumble during the return, KICKING team recovers (turnover) -
  {
    const h = await bootGamePage();
    await startAndKickoff(h);
    click(h.window, h.document.getElementById('gr_ko_ret_fumbled_toggle'));
    click(h.window, h.document.querySelector('input[name=gr_koret_fumrec][value="k"]'));
    typeInto(h.window, h.document.getElementById('gr_koret_fumrec_credit'), '55');
    typeInto(h.window, h.document.getElementById('gr_yards'), '5');
    typeInto(h.window, h.document.getElementById('gr_koretfumspot_yardline'), '40');
    click(h.window, h.document.querySelector('.gr_koretfumspot_side[data-side="own"]'));
    click(h.window, h.document.getElementById('guidedReturnSave'));
    const st = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
    const poss = JSON.parse(h.evalIn('JSON.stringify(countPossessions(plays))'));
    if (st.possession !== 'teamA') fail('fumble-kicking-recovers', 'expected teamA (the kicking team) to end up with the ball, got ' + st.possession);
    if (poss.teamA !== 1 || poss.teamB !== 0) fail('fumble-kicking-recovers', 'expected teamA:1, teamB:0, got ' + JSON.stringify(poss));
    h.close();
  }

  // --- 4. touchdown through the fumble path, kicking team recovers ---
  // The exact case a pre-existing bug (found while building this,
  // shared by the onside/muffed branches too) needed endsDrive for:
  // with no flip firing (the kicking team never gave up the ball, so
  // recovering it back is not a flip), nothing else clears the OLD
  // down and distance once a score is added.
  {
    const h = await bootGamePage();
    await establishStaleDrive(h);
    await startAndKickoff(h);
    click(h.window, h.document.getElementById('gr_ko_ret_fumbled_toggle'));
    click(h.window, h.document.querySelector('input[name=gr_koret_fumrec][value="k"]'));
    typeInto(h.window, h.document.getElementById('gr_koret_fumrec_credit'), '55');
    typeInto(h.window, h.document.getElementById('gr_yards'), '95');
    click(h.window, h.document.getElementById('gr_td_toggle'));
    click(h.window, h.document.getElementById('guidedReturnSave'));
    const st = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
    if (st.down !== null || st.distance !== null || st.fieldPos !== null) {
      fail('endsDrive', 'a touchdown through the kicking-team-recovers fumble path left the PRIOR drive\'s down/distance/fieldPos set: ' +
        JSON.stringify({ down: st.down, distance: st.distance, fieldPos: st.fieldPos }) + ' (started at 2nd & 6, own 35)');
    }
    if (st.scores.teamA !== 6) fail('endsDrive', 'expected teamA to be credited with the touchdown, scores: ' + JSON.stringify(st.scores));
    h.close();
  }

  // --- 5. the SAME endsDrive fix, on the pre-existing onside branch ---
  // Confirms the fix (a single shared line) actually covers the
  // branch it was found in, not only the new one added alongside it.
  {
    const h = await bootGamePage();
    await establishStaleDrive(h);
    await startAndKickoff(h);
    click(h.window, h.document.getElementById('gr_onside_toggle'));
    click(h.window, h.document.querySelector('input[name=gr_muffrec][value="k"]'));
    typeInto(h.window, h.document.getElementById('gr_muff_rec'), '3');
    click(h.window, h.document.getElementById('gr_td_toggle'));
    click(h.window, h.document.getElementById('guidedReturnSave'));
    const st = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
    if (st.down !== null || st.distance !== null || st.fieldPos !== null) {
      fail('endsDrive-onside', 'an onside-kick touchdown with the kicking team recovering left the PRIOR drive\'s state uncleared: ' +
        JSON.stringify({ down: st.down, distance: st.distance, fieldPos: st.fieldPos }) + ' (started at 2nd & 6, own 35)');
    }
    h.close();
  }

  // --- 6. ordinary return (no fumble) still works, untouched by this -
  {
    const h = await bootGamePage();
    await startAndKickoff(h);
    typeInto(h.window, h.document.getElementById('gr_kofielded_yardline'), '25');
    click(h.window, h.document.querySelector('.gr_kofieldedSide[data-side="opp"]'));
    typeInto(h.window, h.document.getElementById('gr_koretto_yardline'), '40');
    click(h.window, h.document.querySelector('.gr_koretSide[data-side="opp"]'));
    click(h.window, h.document.getElementById('guidedReturnSave'));
    const st = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
    if (st.possession !== 'teamB' || st.fieldPos === null) {
      fail('ordinary-return', 'expected teamB with a live drive, got possession=' + st.possession + ' fieldPos=' + st.fieldPos);
    }
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Guided kickoff flow: calculator and fumble-during-return ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) console.log('  the calculator, both fumble-recovery outcomes, and the endsDrive fix all hold.');
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
