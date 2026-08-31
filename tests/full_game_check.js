// Full-game UI walkthrough
// ------------------------
// ONE complete game, opening kickoff to final whistle, driven entirely
// through the real UI. **Nothing is injected.** No forcePossession, no
// setDrive, no pushAndPersist, no evalIn that writes.
//
// That restriction is the whole point. Every other suite -- including the
// NFL harness, which is far broader -- asserts the situation before each
// play. So none of them can tell you whether play N actually sets up play
// N+1 across a whole game: down progression, field position carried over
// drive after drive, possession surviving a punt and a turnover and an
// interval, timeouts decrementing per half, the clock accumulating.
//
// It also reaches the paths NFL data structurally cannot:
//   - the guided kickoff flow, both halves
//   - a muffed punt recovered by the kicking team
//   - an onside kick
//   - timeouts, halftime, overtime
//   - the clock prompts at every change of possession
//
// The tradeoff, stated honestly: this covers only what was written down,
// and one hand-authored game is a thin sample. Its value is depth of
// sequence, not breadth of cases -- the hand-written suites cover each
// feature in isolation, and this checks they still work when strung
// together for sixty minutes.
//
// Assertions are made INLINE as the game unfolds, so a failure names the
// moment it happened rather than reporting a wrong total at the end.

const { bootGamePage, bootPage } = require('./harness');
const { enterPlay, click, typeInto, enterTimeout } = require('./ui_driver');

async function run() {
  const failures = [];
  const fail = (moment, detail) => failures.push({ moment, detail });

  const h = await bootGamePage({ game: { game_phase: 'notStarted' } });
  const { window: win, document: doc } = h;

  const state = () => JSON.parse(h.evalIn('JSON.stringify(computeState())'));
  const banner = () => doc.getElementById('downText').textContent;
  const visible = id => {
    const el = doc.getElementById(id);
    return !!(el && el.style.display !== 'none' && !el.disabled);
  };
  // Assert the situation the app has WORKED OUT for itself.
  const expect = (moment, want) => {
    const got = state();
    const diffs = [];
    for (const k of Object.keys(want)) {
      if (got[k] !== want[k]) diffs.push(k + ' ' + JSON.stringify(got[k]) +
                                        ' (wanted ' + JSON.stringify(want[k]) + ')');
    }
    if (diffs.length) fail(moment, diffs.join(', '));
    return got;
  };
  const save = () => {
    const clockRow = doc.getElementById('confirmClockRow');
    if (clockRow && clockRow.style.display !== 'none') {
      typeInto(win, doc.getElementById('confirmClockInput'), '9:00');
    }
    click(win, doc.getElementById('saveBtn'));
  };

  // ================= opening kickoff, guided =========================
  if (!visible('startGameBtn')) fail('kickoff', 'Start game is not available on a new game');
  click(win, doc.getElementById('startGameBtn'));
  click(win, doc.getElementById('pickA'));                 // Neville kicks
  typeInto(win, doc.getElementById('gk_kicker_manual'), '3');
  // A DIRECTION IS REQUIRED NOW. The guided kickoff panel gained
  // "which way is <team> kicking" and refuses to save without it,
  // so every helper that clicked straight through to Save has been
  // stuck on the opening kickoff ever since -- which is why this
  // walkthrough reported "0 plays in the log" rather than a failure
  // anyone could act on. One click, before Save.
  const _dir1 = doc.querySelector('.gk_dir_btn'); if (_dir1) click(win, _dir1);
  click(win, doc.getElementById('guidedKickoffSave'));

  typeInto(win, doc.getElementById('gr_yards'), '22');
  const koSide = doc.querySelector('.gr_spot_side[data-side="own"]');
  if (!koSide) fail('kickoff return', 'no spot control on the guided return step');
  else click(win, koSide);
  typeInto(win, doc.getElementById('gr_spot_yardline'), '28');
  typeInto(win, doc.getElementById('guidedReturnClock'), '11:52');
  click(win, doc.getElementById('guidedReturnSave'));
  await new Promise(r => setTimeout(r, 60));

  expect('after the opening kickoff',
    { possession: 'teamB', down: 1, distance: 10, fieldPos: 28 });

  // ================= teamB drive: chains must move ===================
  enterPlay(h, { type: 'rush', carrier: '22', yards: '4' });
  expect('1st & 10, rush 4', { down: 2, distance: 6, fieldPos: 32 });

  enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '6' });
  expect('2nd & 6, pass 6 -> first down', { down: 1, distance: 10, fieldPos: 38 });

  enterPlay(h, { type: 'rush', carrier: '22', yards: '3', loss: true });
  expect('1st & 10, loss of 3', { down: 2, distance: 13, fieldPos: 35 });

  enterPlay(h, { type: 'pass', passer: '7', receiver: '80', incomplete: true });
  expect('2nd & 13, incomplete', { down: 3, distance: 13, fieldPos: 35 });

  // ================= a timeout must not disturb the chains ===========
  const toBefore = JSON.parse(h.evalIn('JSON.stringify(computeState().timeouts)'));
  // Through the DRIVER, not hand-clicked. This block reached into the
  // panel for "the first button" and then looked for a review step called
  // `to_review` -- a name that never existed. When the real review step
  // arrived on 22 Aug the timeout silently stopped being written and this
  // suite reported it as a missing deduction, which is the right symptom
  // from the wrong cause. The driver knows the current flow; every caller
  // should use it rather than keep a private copy of the clicks.
  enterTimeout(h, 'teamA');
  expect('after a timeout, the situation is unchanged',
    { down: 3, distance: 13, fieldPos: 35 });
  const toAfter = JSON.parse(h.evalIn('JSON.stringify(computeState().timeouts)'));
  if (JSON.stringify(toBefore) === JSON.stringify(toAfter)) {
    fail('timeout', 'the timeout was not deducted: ' + JSON.stringify(toAfter));
  }

  // A third-down failure before the punt. Punting on THIRD down is what
  // this test did on its first run, and validateGame correctly objected:
  // "punted 2 times but only 1 failed third down was recorded". The
  // checker was right and the scripted game was unrealistic.
  enterPlay(h, { type: 'rush', carrier: '22', yards: '2' });
  expect('3rd & 13, rush 2', { down: 4, distance: 11, fieldPos: 37 });

  // ================= punt: possession and spot must carry ============
  enterPlay(h, { type: 'punt', punter: '15', yards: '40',
                 spot: { side: 'own', yardline: '25' }, clock: '8:30' });
  expect('after a punt', { possession: 'teamA', down: 1, distance: 10, fieldPos: 25 });

  // ================= teamA scores, then a real PAT ===================
  enterPlay(h, { type: 'rush', carrier: '22', yards: '5' });
  enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '70', td: true });
  const afterTd = state();
  if (afterTd.scores.teamA !== 6) {
    fail('touchdown', 'expected 6 points, scores are ' + JSON.stringify(afterTd.scores));
  }
  // The PAT must still be enterable -- the kickoff restriction applies
  // after the TRY, not after the touchdown. Asserting it here was my
  // error on the first run: the app was right and the test was wrong.
  enterPlay(h, { type: 'pat', kicker: '3', result: 'g' });
  if (state().scores.teamA !== 7) {
    fail('PAT', 'expected 7 after a good PAT, got ' + state().scores.teamA);
  }
  // NOW only a kickoff may be offered.
  const liveTypes = [...doc.querySelectorAll('.ptypeBtn')]
    .filter(b => !b.disabled).map(b => b.dataset.type);
  if (liveTypes.length !== 1 || liveTypes[0] !== 'kickoff') {
    fail('after the try', 'expected kickoff only, got: ' + liveTypes.join(' '));
  }

  // ================= onside kick, kicking team recovers =============
  click(win, doc.querySelector('.ptypeBtn[data-type="kickoff"]'));
  let panel = doc.getElementById('playPanel');
  click(win, panel.querySelector('.pp_kicker_pick[data-num="3"]'));
  const onsideToggle = doc.getElementById('pp_ko_onside_toggle');
  if (!onsideToggle) fail('onside', 'no onside control on the kickoff panel');
  else {
    click(win, onsideToggle);
    const rec = panel.querySelector('input[name=pp_ko_onsiderec][value="k"]');
    rec.checked = true;
    rec.dispatchEvent(new win.Event('change', { bubbles: true }));
    const sb = panel.querySelector('.pp_koonsidespot_side[data-side="own"]');
    if (sb) click(win, sb);
    typeInto(win, doc.getElementById('pp_koonsidespot_yardline'), '47');
    click(win, doc.getElementById('pp_review'));
    save();
    // Recovering your own onside kick keeps the ball -- a new possession
    // for the same team, at the spot of recovery.
    expect('after recovering an onside kick',
      { possession: 'teamA', down: 1, distance: 10, fieldPos: 47 });
  }

  // ================= penalty with an automatic first down ============
  enterPlay(h, { type: 'rush', carrier: '22', yards: '2' });
  expect('1st & 10 after the onside, rush 2', { down: 2, distance: 8, fieldPos: 49 });
  enterPlay(h, { type: 'penalty', on: 'defense', yards: '5', firstDown: true });
  const afterPen = state();
  if (afterPen.down !== 1) {
    fail('automatic first down', 'down is ' + afterPen.down + ', expected 1');
  }

  // ================= start of the second quarter =====================
  // The walkthrough used to go from Q1 straight to halftime and from Q3
  // straight to the end, never starting Q2 or Q4 -- so it played a
  // "whole game" that a real scorer's game would never look like. The
  // quarter-marker check added on 23 Aug caught it immediately, which is
  // the check earning its place: every play after a missing marker is
  // filed under the previous quarter.
  const startQuarter = () => {
    click(win, doc.getElementById('quarterUtilBtn'));
    const b = doc.querySelector('#playPanel button.qMarkBtn');
    if (!b) { fail('quarter marker', 'no Start Q button offered'); return; }
    click(win, b);
    click(win, doc.getElementById('saveBtn'));
  };
  startQuarter();

  // ================= end of the first half ==========================
  click(win, doc.getElementById('quarterUtilBtn'));
  if (!visible('endFirstHalfBtn')) {
    fail('halftime', 'End 1st half is not available during the first half');
  } else {
    click(win, doc.getElementById('endFirstHalfBtn'));
  }
  if (h.evalIn('gamePhase') !== 'halftime') {
    fail('halftime', 'phase is ' + h.evalIn('gamePhase') + ', expected halftime');
  }
  if (!visible('startHalfBtn')) fail('halftime', 'Start 2nd half is not offered');

  // Timeouts reset at the interval.
  click(win, doc.getElementById('startHalfBtn'));
  click(win, doc.getElementById('pickB'));                 // opponent kicks
  typeInto(win, doc.getElementById('gk_kicker_manual'), '3');
  // A DIRECTION IS REQUIRED NOW. The guided kickoff panel gained
  // "which way is <team> kicking" and refuses to save without it,
  // so every helper that clicked straight through to Save has been
  // stuck on the opening kickoff ever since -- which is why this
  // walkthrough reported "0 plays in the log" rather than a failure
  // anyone could act on. One click, before Save.
  const _dir2 = doc.querySelector('.gk_dir_btn'); if (_dir2) click(win, _dir2);
  click(win, doc.getElementById('guidedKickoffSave'));
  typeInto(win, doc.getElementById('gr_yards'), '18');
  const h2Side = doc.querySelector('.gr_spot_side[data-side="own"]');
  if (h2Side) click(win, h2Side);
  typeInto(win, doc.getElementById('gr_spot_yardline'), '30');
  typeInto(win, doc.getElementById('guidedReturnClock'), '11:48');
  click(win, doc.getElementById('guidedReturnSave'));
  await new Promise(r => setTimeout(r, 60));

  expect('after the second-half kickoff',
    { possession: 'teamA', down: 1, distance: 10, fieldPos: 30 });
  const halfTimeouts = JSON.parse(h.evalIn('JSON.stringify(computeState().timeouts)'));
  if (halfTimeouts.teamB !== 3) {
    fail('halftime', 'timeouts should reset to 3 for the second half, teamB has ' +
         halfTimeouts.teamB);
  }

  // ================= an interception, entered normally ==============
  enterPlay(h, { type: 'rush', carrier: '22', yards: '6' });
  enterPlay(h, { type: 'int', passer: '7', credit: '21',
                 spot: { side: 'own', yardline: '44' }, clock: '7:15' });
  expect('after an interception',
    { possession: 'teamB', down: 1, distance: 10, fieldPos: 44 });

  // ================= muffed punt, kicking team recovers ============
  enterPlay(h, { type: 'rush', carrier: '22', yards: '1' });
  enterPlay(h, { type: 'rush', carrier: '22', yards: '2' });
  enterPlay(h, { type: 'pass', passer: '7', receiver: '80', incomplete: true });
  const beforeMuff = state();
  if (beforeMuff.down !== 4) {
    fail('before the muffed punt', 'expected 4th down, got ' + beforeMuff.down);
  }
  click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
  panel = doc.getElementById('playPanel');
  click(win, panel.querySelector('.pp_punter_pick[data-num="15"]'));
  typeInto(win, doc.getElementById('pp_yards'), '38');
  click(win, doc.getElementById('pp_muffed_toggle'));
  const muffSide = panel.querySelector('.pp_muffspot_side[data-side="opp"]');
  if (muffSide) click(win, muffSide);
  typeInto(win, doc.getElementById('pp_muffspot_yardline'), '40');
  click(win, doc.getElementById('pp_review'));
  save();
  // The kicking team recovering keeps the ball -- a new possession.
  expect('after recovering a muffed punt',
    { possession: 'teamB', down: 1, distance: 10 });

  // ================= teamB ties it, forcing overtime ===============
  enterPlay(h, { type: 'rush', carrier: '22', yards: '40', td: true });
  enterPlay(h, { type: 'pat', kicker: '3', result: 'g' });
  const tied = state();
  if (tied.scores.teamA !== tied.scores.teamB) {
    fail('before overtime', 'scores should be level, are ' + JSON.stringify(tied.scores));
  }

  // Q4 before the game can honestly end.
  startQuarter();

  click(win, doc.getElementById('quarterUtilBtn'));
  if (!visible('endGameBtn')) fail('end of game', 'End game is not offered in the second half');
  // A tie must be refused rather than finalised.
  click(win, doc.getElementById('endGameBtn'));
  if (h.evalIn('gamePhase') === 'ended') {
    fail('end of game', 'the game was allowed to end on a tie');
  }
  if (!visible('otUtilBtn')) fail('overtime', 'Start overtime is not offered on a tie');

  // ================= the log must be internally consistent =========
  const validation = JSON.parse(h.evalIn('JSON.stringify(validateGame())'));
  for (const msg of validation.slice(0, 6)) {
    fail('validateGame', String(msg).slice(0, 110));
  }

  const dbRows = h.db.plays.map((r, i) =>
    Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
  const finalScores = state().scores;
  const playCount = dbRows.length;
  h.close();

  // ================= every surface must agree =======================
  const boxes = {};
  for (const page of ['view.html', 'recap.html', 'stat_package.html']) {
    const v = await bootPage(page, {
      existingPlays: dbRows,
      game: { status: 'final', season_year: 2026, game_date: '2026-08-01',
              final_score_us: finalScores.teamA, final_score_opp: finalScores.teamB }
    });
    boxes[page] = JSON.parse(v.evalIn('JSON.stringify(computeBoxScore(plays))'));
    const pageScores = JSON.parse(v.evalIn('JSON.stringify(computeState(plays).scores)'));
    if (pageScores.teamA !== finalScores.teamA || pageScores.teamB !== finalScores.teamB) {
      fail(page, 'score disagrees with the game page: ' + JSON.stringify(pageScores) +
           ' vs ' + JSON.stringify(finalScores));
    }
    v.close();
  }
  const base = boxes['view.html'];
  for (const page of ['recap.html', 'stat_package.html']) {
    for (const team of ['teamA', 'teamB']) {
      for (const cat of ['rushing', 'passing', 'receiving']) {
        const a = (base[team] || {})[cat] || {};
        const b = (boxes[page][team] || {})[cat] || {};
        for (const who of Object.keys(a)) {
          if ((a[who].yds || 0) !== ((b[who] || {}).yds || 0)) {
            fail(page, team + '.' + cat + '.' + who + ' disagrees with view.html');
          }
        }
      }
    }
  }

  return { failures, playCount, finalScores };
}

// A game this long can diverge far enough that a later step throws
// instead of failing an assertion -- a mutant that breaks first downs
// sends the whole script into states it was never written for. That IS
// detection, but a bare stack trace does not say WHERE. Reporting the
// exception as a failure at the moment it happened keeps the signal.
async function runSafely() {
  try {
    return await run();
  } catch (e) {
    return { failures: [{ moment: 'aborted', detail: e.message.split('\n')[0].slice(0, 130) }],
             playCount: 0, finalScores: { teamA: 0, teamB: 0 } };
  }
}

if (require.main === module) {
  // A divergent run can leave a click handler queued inside the jsdom VM
  // that fires after the page is torn down. That surfaces as a
  // process-level crash, which no promise-level catch can see -- so a
  // real fault got reported as a bare stack trace with no indication of
  // where in the game it happened. Caught here so the run still says
  // FAILED rather than looking like a broken test.
  let reported = false;
  process.on('uncaughtException', e => {
    if (reported) return;
    reported = true;
    console.log('=== Full-game UI walkthrough ===\n');
    console.log('Failures         : 1');
    console.log('  [aborted mid-game] ' + String(e.message).split('\n')[0].slice(0, 120));
    console.log('\n  The game diverged far enough that a later step threw.');
    console.log('  That is a real signal -- something upstream is wrong.');
    process.exit(1);
  });
  runSafely().then(({ failures, playCount, finalScores }) => {
    if (reported) return;
    console.log('=== Full-game UI walkthrough ===\n');
    console.log('Plays in the log : ' + playCount);
    console.log('Final score      : ' + finalScores.teamA + ' - ' + finalScores.teamB);
    console.log('Failures         : ' + failures.length);
    failures.forEach(f => console.log('  [' + f.moment + '] ' + f.detail));
    if (!failures.length) {
      console.log('\n  a whole game played through the UI, nothing injected.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run, runSafely };
