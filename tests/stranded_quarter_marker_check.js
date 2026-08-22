// Undoing back across the interval takes the stranded Q3 marker with it
// -----------------------------------------------------------------------
// "Start 2nd half" writes "Quarter marker — start of Q3" and nothing else.
// Undoing the opening plays of the half used to leave that marker behind
// with no real play after it: derivePhase() reads the log and correctly
// says halftime, but the marker still says Q3.
//
// That was harmless while view.html also required a real play before it
// would leave HALFTIME. It stopped being harmless on 22 Aug 2026, when
// view.html was changed to end its HALFTIME card on the marker so the
// second-half kickoff no longer runs under a HALFTIME banner -- at which
// point a stranded marker would have had the two pages disagreeing about
// the same log.
//
// Removing the residue is the fix rather than teaching each reader to
// ignore it: a marker for a half with no plays in it is not a fact about
// the game, it is left-over state.

const { bootGamePage } = require('./harness');
const { enterPlay, setDrive, click, typeInto } = require('./ui_driver');

const q3count = h => h.evalIn('plays.filter(p=>p.effect&&p.effect.setQuarter>=3).length');

async function toHalftime() {
  const h = await bootGamePage();
  const doc = h.window.document, win = h.window;
  h.evalIn('window.confirm = () => true;');
  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
  enterPlay(h, { type: 'rush', carrier: '22', yards: '6' });
  click(win, doc.getElementById('quarterUtilBtn'));
  click(win, doc.getElementById('endFirstHalfBtn'));
  await new Promise(r => setTimeout(r, 200));
  return h;
}

// Start 2nd half, then run the guided kickoff through to a real play.
async function runSecondHalfKickoff(h) {
  const doc = h.window.document, win = h.window;
  click(win, doc.getElementById('startHalfBtn'));
  await new Promise(r => setTimeout(r, 200));
  click(win, doc.getElementById('pickA'));
  await new Promise(r => setTimeout(r, 120));
  click(win, doc.querySelector('.gk_kicker_pick'));
  const dir = doc.querySelector('.gk_dir_btn');
  if (dir) click(win, dir);
  click(win, doc.getElementById('guidedKickoffSave'));
  await new Promise(r => setTimeout(r, 200));
  typeInto(win, doc.getElementById('gr_returner_manual'), '44');
  typeInto(win, doc.getElementById('gr_yards'), '18');
  typeInto(win, doc.getElementById('gr_spot_yardline'), '28');
  click(win, doc.getElementById('guidedReturnSave'));
  await new Promise(r => setTimeout(r, 250));
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1. Undo immediately after Start 2nd half: the marker is the last
  //     row, and it goes.
  {
    const h = await toHalftime();
    const doc = h.window.document, win = h.window;
    click(win, doc.getElementById('startHalfBtn'));
    await new Promise(r => setTimeout(r, 200));
    if (q3count(h) !== 1) fail('start:marker', 'Start 2nd half should write one Q3 marker, got ' + q3count(h));
    click(win, doc.getElementById('undoBtn'));
    await new Promise(r => setTimeout(r, 250));
    if (q3count(h) !== 0) fail('undo-immediate', 'undoing straight after Start 2nd half left the marker behind: ' + q3count(h));
    if (h.evalIn('derivePhase()') !== 'halftime') fail('undo-immediate:phase', 'expected halftime, got ' + h.evalIn('derivePhase()'));
    h.close();
  }

  // --- 2. The case that actually caused the disagreement: a completed
  //     second-half kickoff, undone back across the interval.
  {
    const h = await toHalftime();
    const doc = h.window.document, win = h.window;
    await runSecondHalfKickoff(h);
    if (h.evalIn('derivePhase()') !== 'secondHalf') fail('setup', 'expected the second half to be underway');
    for (let i = 0; i < 8 && h.evalIn('derivePhase()') !== 'halftime'; i++) {
      click(win, doc.getElementById('undoBtn'));
      await new Promise(r => setTimeout(r, 180));
    }
    if (h.evalIn('derivePhase()') !== 'halftime') fail('undo-back:phase', 'could not get back to halftime by undoing');
    if (q3count(h) !== 0) {
      fail('undo-back:marker', 'undoing back to halftime left a stranded Q3 marker -- view.html would insist the second half had begun: ' + q3count(h));
    }
    h.close();
  }

  // --- 3. A marker with real plays behind it is a genuine record of when
  //     the quarter turned, and must NOT be touched.
  {
    const h = await toHalftime();
    const doc = h.window.document, win = h.window;
    await runSecondHalfKickoff(h);
    enterPlay(h, { type: 'rush', carrier: '30', yards: '4' });
    click(win, doc.getElementById('undoBtn'));
    await new Promise(r => setTimeout(r, 220));
    if (h.evalIn('derivePhase()') !== 'secondHalf') fail('keep:phase', 'still in the second half after undoing one play');
    if (q3count(h) !== 1) fail('keep:marker', 'a Q3 marker with plays after it must survive an undo, got ' + q3count(h));
    h.close();
  }

  // --- 4. Redo puts it back. It travels with the play it was removed
  //     alongside, so the log is restored exactly.
  {
    const h = await toHalftime();
    const doc = h.window.document, win = h.window;
    await runSecondHalfKickoff(h);
    for (let i = 0; i < 8 && h.evalIn('derivePhase()') !== 'halftime'; i++) {
      click(win, doc.getElementById('undoBtn'));
      await new Promise(r => setTimeout(r, 180));
    }
    if (q3count(h) !== 0) fail('redo:precondition', 'marker should be gone before redo');
    click(win, doc.getElementById('redoBtn'));
    await new Promise(r => setTimeout(r, 250));
    if (q3count(h) !== 1) fail('redo:marker', 'Redo last must put the Q3 marker back with the play it left with, got ' + q3count(h));
    if (h.evalIn('derivePhase()') !== 'secondHalf') fail('redo:phase', 'expected the second half again after redo, got ' + h.evalIn('derivePhase()'));
    h.close();
  }

  // --- 5. AN ORDINARY UNDO SAYS NOTHING. "Back in the first half." was
  //     meant for undoing back ACROSS the interval, but its condition
  //     could not tell that apart from any other undo: with no divider in
  //     the log yet, halfEnded is false and afterHalf is false too, so
  //     all three tests passed on every first-half undo. A notice that
  //     appears on a routine action trains the reader to ignore the one
  //     that does carry news.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    h.evalIn('window.confirm = () => true;');
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '4' });
    click(win, doc.getElementById('undoBtn'));
    await new Promise(r => setTimeout(r, 250));
    const msg = doc.getElementById('gameMsg').textContent.trim();
    if (msg) fail('undo:quiet', 'an ordinary first-half undo should say nothing, got: ' + JSON.stringify(msg));
    h.close();
  }

  // --- 6. ...but undoing back ACROSS the interval still does, because
  //     that one tells you Start 2nd half has to be run again.
  {
    const h = await toHalftime();
    const doc = h.window.document, win = h.window;
    await runSecondHalfKickoff(h);
    for (let i = 0; i < 8 && h.evalIn('derivePhase()') !== 'halftime'; i++) {
      click(win, doc.getElementById('undoBtn'));
      await new Promise(r => setTimeout(r, 200));
    }
    const msg = doc.getElementById('gameMsg').textContent;
    if (!/Back to halftime/.test(msg)) {
      fail('undo:halftime-msg', 'undoing back across the interval should still say so, got: ' + JSON.stringify(msg.trim()));
    }
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Stranded second-half quarter marker ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  undoing back across the interval clears the Q3 marker so both pages read halftime; a marker with plays behind it survives, and Redo restores one that was removed.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
