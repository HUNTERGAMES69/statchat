// Box score leader highlight -- halftime and final only
// -------------------------------------------------------
// Requested directly, 19 Aug 2026: highlight the leader in each
// Passing/Receiving/Rushing tile with a light tint of the team's own
// colour, matching the drive tiles' own mixHex(bg, white, 0.88) -- but
// ONLY at halftime or final, never during live play.
//
// This scope matters specifically because an earlier version of a
// leader highlight on these same tables was built and then deliberately
// removed (see the history preserved in view.html's own comments): with
// rows already sorted leader-first, a highlight during live play said
// nothing the order did not already say, and read as though it might
// mean something else on a panel that changes every snap. The halftime/
// final scope answers both objections -- the leader is fixed at a
// summary moment, not about to change, and calling it out there reads
// as a headline rather than a live signal. These tests exist to hold
// that scope exactly where it was asked to sit, not wider.

const { bootGamePage, bootPage } = require('./harness');
const { enterPlay, setDrive } = require('./ui_driver');

function endFirstHalf(h) {
  h.evalIn("pushAndPersist({ id: nextId++, text: 'End of 1st half', effect: {}, isDivider: true })");
}
function startSecondHalf(h) {
  h.evalIn("pushAndPersist({ id: nextId++, text: 'Start of 2nd half', effect: { setQuarter: 3 }, isDivider: true })");
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1. At halftime: leader highlighted in all three categories, on
  // the correct row, in the correct colour -- and never on the second-
  // place row, never on Special Teams.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '20' });
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 45 });
    enterPlay(h, { type: 'rush', carrier: '28', yards: '3' });
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 48 });
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '10' });
    enterPlay(h, { type: 'fg', kicker: '3', yards: '35', result: 'g' });
    endFirstHalf(h);
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows });
    const html = v.document.getElementById('boxScoreTeamA').innerHTML;
    const expectedTint = v.evalIn("mixHex(TEAMS.teamA.bg, '#ffffff', 0.88)");
    v.close();

    const count = (html.match(new RegExp('background:' + expectedTint.replace('#', '#'), 'g')) || []).length;
    if (count !== 3) {
      fail('halftime-count', 'expected exactly 3 highlighted rows (Passing, Rushing, Receiving), got ' + count);
    }
    if (!new RegExp('style="background:' + expectedTint + ';"><td>N Runningback').test(html)) {
      fail('halftime-rushing-leader', 'the 20-yard rusher (leader) was not the highlighted row');
    }
    if (new RegExp('style="background:' + expectedTint + ';"><td>N Halfback').test(html)) {
      fail('halftime-rushing-second', 'the 3-yard rusher (not the leader) was highlighted instead');
    }
    if (/FG Att[\s\S]*background:#[0-9a-f]{6}/.test(html) || /background:#[0-9a-f]{6}[\s\S]*N Kicker/.test(html)) {
      // Loose sanity check only -- the precise assertion is that no
      // highlight style appears anywhere near the kicker's own row.
      const kickerRowMatch = html.match(/<tr[^>]*><td>N Kicker<\/td>/);
      if (kickerRowMatch && /style="background/.test(kickerRowMatch[0])) {
        fail('halftime-special-teams', 'Special Teams got a leader highlight, which was never asked for there');
      }
    }
    h.close();
  }

  // --- 2. Live second half: no highlight anywhere, even though the
  // same leader is still the same leader.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '20' });
    endFirstHalf(h);
    startSecondHalf(h);
    enterPlay(h, { type: 'kickoff', kicker: '3', touchback: true });
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '2' });
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows });
    const phaseNow = v.evalIn('phase');
    const html = v.document.getElementById('boxScoreTeamA').innerHTML;
    v.close();

    if (phaseNow !== null) fail('live-phase', 'expected phase to be null (live) once the 2nd half starts, got ' + phaseNow);
    if (/style="background:#[0-9a-f]{6};"/.test(html)) {
      fail('live-no-highlight', 'a highlight appeared during live play, after the 2nd half had already started');
    }
  }

  // --- 3. Final: highlight reappears.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '20' });
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows, game: { status: 'final' } });
    const phaseNow = v.evalIn('phase');
    const html = v.document.getElementById('boxScoreTeamA').innerHTML;
    v.close();

    if (phaseNow !== 'FINAL') fail('final-phase', 'expected phase to be FINAL, got ' + phaseNow);
    if (!/style="background:#[0-9a-f]{6};"><td>N Runningback/.test(html)) {
      fail('final-highlight', 'the leader highlight did not reappear once the game was marked final');
    }
  }

  // --- 4. A category with only a bookkeeping bucket (TEAM), no
  // individually-credited player at all, must not highlight TEAM even
  // as the only row, even at halftime.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'sack', passer: '7', yards: '5', credit: '55' });
    endFirstHalf(h);
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows });
    const html = v.document.getElementById('boxScoreTeamA').innerHTML;
    v.close();

    const teamRowMatch = html.match(/<tr[^>]*><td>TEAM<\/td>/);
    if (teamRowMatch && /style="background/.test(teamRowMatch[0])) {
      fail('bookkeeping-row', 'the TEAM bucket (a sack, not a player) was highlighted as though it were a leader');
    }
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Box score leader highlight (halftime/final only) ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  the leader highlight appears only at halftime/final, on the right row, never on bookkeeping or special teams.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
