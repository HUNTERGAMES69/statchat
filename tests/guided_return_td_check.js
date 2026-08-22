// Guided kickoff returned for a touchdown: the game must still be
// playable afterwards
// -----------------------------------------------------------------------
// Reported directly, 22 Aug 2026: a kickoff returned for a touchdown
// through the GUIDED flow left the game in "no man's land". Reproduced
// exactly: every play-type button was disabled, the guided panel had
// already closed, and nothing could advance the game short of Undo.
//
// Two gates fired at once. awaitingKickoff greys everything except
// Kickoff; awaitingTry greys everything except PAT and 2PT. Their
// whitelists have nothing in common, so together they disable the lot.
//
// It is reachable only from the guided flow because that branch sets
// endsDrive alongside the six points -- it has to, since when the
// kicking team recovers there is no flip and the old down and distance
// would otherwise survive the score. The play-panel kickoff does not
// set endsDrive, which is the only reason the same touchdown entered
// the other way still let the try through. That is why this looked like
// a guided-only fault when it was really a collision between two flags.
//
// Resolved in favour of the try, which is what football does next; the
// kickoff gate then fires on its own once the try is in.

const { bootPage } = require('./harness');
const { click, typeInto, enterPlay } = require('./ui_driver');

async function guidedReturnTD(page) {
  const h = await bootPage(page, {});
  const doc = h.window.document, win = h.window;
  click(win, doc.getElementById('startGameBtn'));
  await new Promise(r => setTimeout(r, 60));
  click(win, doc.getElementById('pickA'));
  await new Promise(r => setTimeout(r, 60));
  click(win, doc.querySelector('.gk_kicker_pick'));
  const dir = doc.querySelector('.gk_dir_btn');
  if (dir) click(win, dir);
  click(win, doc.getElementById('guidedKickoffSave'));
  await new Promise(r => setTimeout(r, 80));
  // The returner grid can be empty on a fixture with no listed returners;
  // the manual box is always there and is what a scorer would reach for.
  typeInto(win, doc.getElementById('gr_returner_manual'), '21');
  typeInto(win, doc.getElementById('gr_yards'), '95');
  click(win, doc.getElementById('gr_td_toggle'));
  click(win, doc.getElementById('guidedReturnSave'));
  await new Promise(r => setTimeout(r, 150));
  return h;
}

const liveTypes = doc => Array.from(doc.querySelectorAll('.ptypeBtn'))
  .filter(b => !b.disabled).map(b => b.dataset.type);

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  for (const page of ['game.html', 'gametest3.html']) {
    const h = await guidedReturnTD(page);
    const doc = h.window.document;

    // 1. The try, and ONLY the try, is enterable -- not nothing at all.
    const live = liveTypes(doc);
    if (!live.length) {
      fail(page + ':deadlock', 'every play type is disabled after a guided kickoff return touchdown -- the game cannot be advanced at all');
    }
    if (!live.includes('pat') || !live.includes('twopt')) {
      fail(page + ':try-available', 'expected the try to be enterable after the touchdown, got: ' + (live.join(' ') || '(none)'));
    }
    if (live.includes('rush') || live.includes('kickoff')) {
      fail(page + ':try-only', 'only the try should be legal before it is taken, got: ' + live.join(' '));
    }
    if (h.evalIn('JSON.stringify(computeState().scores)').indexOf('6') === -1) {
      fail(page + ':score', 'the return touchdown did not score six: ' + h.evalIn('JSON.stringify(computeState().scores)'));
    }

    // 2. Once the try is in, the kickoff gate takes over on its own.
    enterPlay(h, { type: 'pat', kicker: '5', result: 'g' });
    await new Promise(r => setTimeout(r, 80));
    const after = liveTypes(doc);
    if (!after.includes('kickoff')) {
      fail(page + ':kickoff-next', 'expected the kickoff to be enterable once the try was taken, got: ' + (after.join(' ') || '(none)'));
    }
    if (after.includes('pat') || after.includes('twopt')) {
      fail(page + ':try-consumed', 'the try should no longer be offered once it has been taken, got: ' + after.join(' '));
    }
    const scores = JSON.parse(h.evalIn('JSON.stringify(computeState().scores)'));
    if (scores.teamB !== 7) fail(page + ':final-score', 'expected 7 after the return touchdown and its PAT, got: ' + JSON.stringify(scores));
    h.close();
  }

  // 3. The ordinary post-touchdown case must be unchanged: a scrimmage
  //    touchdown still offers the try and nothing else.
  {
    const h = await bootPage('game.html', {});
    const doc = h.window.document;
    const { setDrive } = require('./ui_driver');
    setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '25', td: true });
    await new Promise(r => setTimeout(r, 60));
    const live = liveTypes(doc);
    if (!live.includes('pat') || live.includes('rush')) {
      fail('scrimmage-td-unchanged', 'a scrimmage touchdown should still offer the try only, got: ' + (live.join(' ') || '(none)'));
    }
    h.close();
  }

  // 4. THE VIEW PAGE must show the return touchdown in its Current
  //    drive tile. Reported directly: both drive tiles read "no active
  //    drive yet" after a guided return touchdown -- the score and its
  //    try were nowhere on the spectator page at all. No "New drive"
  //    marker is written when the return scores, so there was no drive
  //    segment for the tile to draw from.
  {
    const h = await guidedReturnTD('game.html');
    enterPlay(h, { type: 'pat', kicker: '5', result: 'g' });
    await new Promise(r => setTimeout(r, 80));
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows,
      readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML !== undefined });
    await new Promise(r => setTimeout(r, 200));
    const html = v.document.getElementById('driveLogScroll').innerHTML;
    if (/no active drive/.test(html)) {
      fail('view:blank', 'the view page shows no active drive after a return touchdown -- the score is invisible to spectators: ' + html);
    }
    if (!/TOUCHDOWN/.test(html)) fail('view:td', 'expected the return touchdown as the headline, got: ' + html);
    if (!/PAT/.test(html)) fail('view:try', 'expected the try paired beneath the touchdown, got: ' + html);
    if (html.indexOf('TOUCHDOWN') > html.indexOf('PAT')) {
      fail('view:order', 'the touchdown must come before the try, got: ' + html);
    }
    // The ruling: a return touchdown is NOT a possession, and neither is
    // a punt return. Asserted so the display fix can never quietly turn
    // into a scoring-drive credit.
    const poss = JSON.parse(v.evalIn('JSON.stringify(countPossessions(plays))'));
    if (poss.teamB !== 0) {
      fail('view:possession', 'a kickoff returned for a touchdown must not count as a possession, got: ' + JSON.stringify(poss));
    }
    v.close();
  }

  // 5. The scoring summary the report pages read must carry it too.
  {
    const h = await guidedReturnTD('game.html');
    enterPlay(h, { type: 'pat', kicker: '5', result: 'g' });
    await new Promise(r => setTimeout(r, 80));
    const sum = JSON.parse(h.evalIn('JSON.stringify(scoringSummary(plays))'));
    const td = sum.find(x => x.points === 6 && x.team === 'teamB');
    if (!td) fail('summary:missing', 'the return touchdown is absent from the scoring summary: ' + JSON.stringify(sum));
    else {
      if (!/TOUCHDOWN/.test(td.text)) fail('summary:text', 'expected the return text, got: ' + td.text);
      if (td.detail !== 'kick good') fail('summary:try', 'expected the try recorded against it, got: ' + td.detail);
      if (td.teamB !== 7) fail('summary:running', 'expected a running score of 7, got: ' + td.teamB);
    }
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Guided kickoff returned for a touchdown ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  a kickoff returned for a touchdown through the guided flow scores, offers the try, and hands off to the kickoff once the try is taken -- in both the live page and the prototype.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
