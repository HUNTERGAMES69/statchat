// End 1st half / End game: the closing 0:00 clock entry and possession
// time
// -----------------------------------------------------------------------
// Reported directly, 21 Aug 2026: pressing END OF HALF made no clock
// entry and no time-of-possession update. Both handlers had ALWAYS
// written the closing entry -- the failure was upstream of it, and was
// reproduced exactly before anything changed: clockToAbsSeconds(
// state.quarter, '0:00') trusts the DERIVED quarter, and the Q2/Q4
// markers are the only manual ones (Q1 and Q3 come free with Start
// game / Start 2nd half). With a Q2 marker never pressed, the 0:00
// computed a full quarter early, landed BEFORE clock time already
// recorded, and tripped the backwards-clock dialog -- where Cancel,
// the reasonable answer to a wrong-looking value, silently aborted the
// ENTIRE half close. OK was no better: a backwards entry pairing to
// zero possession time.
//
// The fix (halfEndClock in game.html): a half's own 0:00 can never
// legitimately come before clock time the game has already recorded,
// so when the derived quarter lags, the boundary snaps forward to the
// end of the quarter the LAST RECORDED CLOCK actually sits in. With
// the markers correctly in, nothing changes at all -- asserted here,
// not assumed.

const { bootGamePage } = require('./harness');
const { enterPlay, setDrive, click } = require('./ui_driver');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1. The reported failure, fixed: Q2 marker missing, possession
  // clock open at Q2 5:00. End 1st half must close the half in ONE
  // dialog (its own confirmation -- never the backwards-clock one),
  // write the closing entry at the REAL half end, and credit the
  // possession.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    h.evalIn("pushAndPersist({ id: nextId++, text: 'Clock', effect: { clockEvent: { type: 'start', team: 'teamA', absSec: 1140 } }, quarter: 2 })");
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    h.evalIn('window.__confirms = []; window.confirm = msg => { window.__confirms.push(msg); return true; };');
    click(win, doc.getElementById('quarterUtilBtn'));
    click(win, doc.getElementById('endFirstHalfBtn'));
    const dialogs = h.evalIn('window.__confirms.length');
    if (dialogs !== 1) fail('missing-q2-dialogs', 'expected exactly one dialog (the end-half confirm), got ' + dialogs + ' -- the backwards-clock dialog means the 0:00 computed a quarter early again');
    const ev = JSON.parse(h.evalIn('JSON.stringify(plays[plays.length-2].effect.clockEvent || null)'));
    if (!ev || ev.type !== 'end' || ev.absSec !== 1440) fail('missing-q2-entry', 'expected the closing clock entry at Q2 0:00 (absSec 1440), got: ' + JSON.stringify(ev));
    if (h.evalIn('gamePhase') !== 'halftime') fail('missing-q2-phase', 'expected the half actually closed, got phase: ' + h.evalIn('gamePhase'));
    const pt = JSON.parse(h.evalIn('JSON.stringify(computeState().possessionTime)'));
    if (pt.teamA !== 300) fail('missing-q2-top', 'expected 5:00 (300s) of possession credited, got: ' + JSON.stringify(pt));
    h.close();
  }

  // --- 2. With the marker correctly in, behavior is IDENTICAL to what
  // it always was -- the snap must never move a boundary that was
  // already right.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    h.evalIn("pushAndPersist({ id: nextId++, text: 'Quarter marker — start of Q2', effect: { setQuarter: 2 }, quarter: 2 })");
    h.evalIn("pushAndPersist({ id: nextId++, text: 'Clock', effect: { clockEvent: { type: 'start', team: 'teamA', absSec: 1140 } }, quarter: 2 })");
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    click(win, doc.getElementById('quarterUtilBtn'));
    click(win, doc.getElementById('endFirstHalfBtn'));
    const ev = JSON.parse(h.evalIn('JSON.stringify(plays[plays.length-2].effect.clockEvent || null)'));
    if (!ev || ev.absSec !== 1440) fail('markers-in-unchanged', 'expected the same absSec 1440 as always with the marker in, got: ' + JSON.stringify(ev));
    const pt = JSON.parse(h.evalIn('JSON.stringify(computeState().possessionTime)'));
    if (pt.teamA !== 300) fail('markers-in-top', 'expected 300s credited, got: ' + JSON.stringify(pt));
    h.close();
  }

  // --- 3. End game, Q4 marker missing: same fix, same reasoning --
  // the possession open at Q4 3:00 closes at the game's real 0:00.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '25', td: true });
    enterPlay(h, { type: 'pat', kicker: '3', result: 'g' });
    enterPlay(h, { type: 'kickoff', kicker: '3', credit: '21', retyds: '20', spot: { side: 'own', yardline: 30 } });
    h.evalIn("gamePhase = 'secondHalf'; pushAndPersist({ id: nextId++, text: 'Quarter marker — start of Q3', effect: { setQuarter: 3 }, quarter: 3 })");
    h.evalIn("pushAndPersist({ id: nextId++, text: 'Clock', effect: { clockEvent: { type: 'start', team: 'teamB', absSec: 2700 } }, quarter: 4 })");
    enterPlay(h, { type: 'rush', carrier: '30', yards: '5' });
    h.evalIn('updatePhaseUI()');
    click(win, doc.getElementById('endGameBtn'));
    await new Promise(r => setTimeout(r, 300));
    const ev = JSON.parse(h.evalIn('JSON.stringify(plays[plays.length-2].effect.clockEvent || null)'));
    if (!ev || ev.type !== 'end' || ev.absSec !== 2880) fail('endgame-missing-q4', 'expected the closing entry at Q4 0:00 (absSec 2880), got: ' + JSON.stringify(ev));
    const pt = JSON.parse(h.evalIn('JSON.stringify(computeState().possessionTime)'));
    if (pt.teamB !== 180) fail('endgame-missing-q4-top', 'expected 3:00 (180s) credited to the possessing team, got: ' + JSON.stringify(pt));
    if (h.evalIn('gamePhase') !== 'ended') fail('endgame-phase', 'expected the game actually finalized, got phase: ' + h.evalIn('gamePhase'));
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Half/game-end clock entry and possession time ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  ending a half or the game closes the open possession at the REAL 0:00 boundary and credits its time, whether or not the quarter marker was remembered -- and changes nothing when it was.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
