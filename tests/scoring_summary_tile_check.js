// The scoring summary takes the drive quad at halftime and at final
// -----------------------------------------------------------------------
// Requested directly, 22 Aug 2026. Neither drive card says anything
// useful at those two moments -- there is no current drive, and the
// previous one is a single play from minutes ago -- while the question a
// spectator arrives with is how the score got there.
//
// Keyed on the same `phase` the banner reads, so the two can never
// disagree about what moment this is. Deliberately NOT shown for
// 'NOT STARTED': that state already hands the bottom-left tile to season
// stats, and an empty Scoring card would say nothing at all.

const { bootGamePage, bootPage } = require('./harness');
const { enterPlay, setDrive } = require('./ui_driver');

async function scoringGame() {
  const h = await bootGamePage();
  setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 25 });
  enterPlay(h, { type: 'rush', carrier: '22', yards: '25', td: true });
  enterPlay(h, { type: 'pat', kicker: '3', result: 'g' });
  enterPlay(h, { type: 'kickoff', kicker: '3', credit: '21', retyds: '20', spot: { side: 'own', yardline: 30 } });
  enterPlay(h, { type: 'rush', carrier: '30', yards: '5' });
  const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
  h.close();
  return rows;
}

const view = async (rows, game) => {
  const opts = { existingPlays: rows,
    readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML !== undefined };
  if (game) opts.game = game;
  const w = await bootPage('view.html', opts);
  await new Promise(r => setTimeout(r, 200));
  return w;
};
const shown = (w, sel) => w.window.getComputedStyle(w.document.querySelector(sel)).display !== 'none';

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });
  const rows = await scoringGame();

  // --- 1. Mid-game: the drive cards own the quad, scoring is hidden.
  {
    const w = await view(rows);
    if (!shown(w, '.drive-current')) fail('in-play:current', 'the Current Drive card must stay while the game is live');
    if (shown(w, '#scoringCard')) fail('in-play:scoring', 'the scoring summary must not appear mid-game');
    w.close();
  }

  // --- 2. Halftime: the swap, and the summary carries real content.
  {
    const half = rows.concat([{ id: 'h1', text: 'End of 1st half', effect: {}, is_divider: true, quarter: 2, sequence_number: 99 }]);
    const w = await view(half);
    if (shown(w, '.drive-current')) fail('halftime:current', 'the Current Drive card should be hidden at halftime');
    if (shown(w, '.drive-previous')) fail('halftime:previous', 'the Previous Drive card should be hidden at halftime');
    if (!shown(w, '#scoringCard')) fail('halftime:scoring', 'the scoring summary should take the quad at halftime');
    const head = w.document.getElementById('scoringHeading').textContent;
    if (!/first half/i.test(head)) fail('halftime:heading', 'expected a first-half heading, got: ' + head);
    const rowsEl = w.document.querySelectorAll('.score-row');
    if (rowsEl.length !== 1) fail('halftime:rows', 'expected one scoring play, got ' + rowsEl.length);
    const txt = w.document.getElementById('scoringBody').textContent;
    if (!/TOUCHDOWN/.test(txt)) fail('halftime:text', 'the scoring play text is missing: ' + txt);
    if (!/kick good/.test(txt)) fail('halftime:try', 'the try result should be shown against the touchdown: ' + txt);
    // The running score is the column a spectator scans -- the play text
    // alone does not say whether it tied the game or extended a lead.
    // Queried defensively: when this feature is switched off the card is
    // empty, and reading .textContent off a null threw a TypeError that
    // killed the whole run -- a crash reports far less than a failure
    // list does, especially to whoever broke it months from now.
    const tally = w.document.querySelector('.score-tally');
    if (!tally) fail('halftime:tally', 'no running score column rendered at all');
    else if (!/7/.test(tally.textContent)) {
      fail('halftime:tally', 'expected a running score, got: ' + tally.textContent);
    }
    w.close();
  }

  // --- 3. Final, reached by game status rather than a divider.
  {
    const w = await view(rows, { id: 'test-game-1', status: 'final', season_year: 2026 });
    if (!shown(w, '#scoringCard')) fail('final:scoring', 'the scoring summary should take the quad at final');
    const head = w.document.getElementById('scoringHeading').textContent;
    if (!/final/i.test(head)) fail('final:heading', 'expected a final heading, got: ' + head);
    w.close();
  }

  // --- 4. A scoreless game must say so rather than render an empty card.
  {
    const none = [{ id: 'x', text: 'N Runningback (Neville) rush for 3 — 2nd & 7',
      effect: { isStat: true, statYds: 3 },
      roles: { carrier: { team: 'teamA', num: '22', yards: 3 }, playType: 'rush' },
      team_side: 'teamA', quarter: 1, sequence_number: 1 }];
    const w = await view(none, { id: 'test-game-1', status: 'final', season_year: 2026 });
    const body = w.document.getElementById('scoringBody').textContent.trim();
    if (!/no scoring yet/i.test(body)) fail('final:empty', 'a scoreless final should say so, got: ' + JSON.stringify(body));
    w.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Scoring summary at halftime and final ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  the drive cards hold the quad while the game is live and hand it to the scoring summary at halftime and at the final whistle, with the running score against each play.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
