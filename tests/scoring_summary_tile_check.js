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

  // --- 5. HALFTIME ENDS WHEN "START 2ND HALF" IS PRESSED, not when the
  //     kickoff is finally entered. Requested directly: the guided
  //     kickoff takes a while to fill in, and this page sat on a HALFTIME
  //     card throughout it while the teams were visibly lining up.
  //     "Start 2nd half" writes a Q3 quarter marker and nothing else, so
  //     that marker is the signal.
  {
    const half = rows.concat([{ id: 'hh', text: 'End of 1st half', effect: {}, is_divider: true, quarter: 2, sequence_number: 900 }]);
    let w = await view(half);
    if (!/HALFTIME/.test(w.document.getElementById('quarterText').textContent)) {
      fail('halftime:banner', 'expected the HALFTIME banner at the interval');
    }
    // The header carries the phase and nothing else.
    const head = w.document.getElementById('quarterText').textContent;
    if (/kicks off/.test(head)) {
      fail('halftime:header-clean', 'the kicker belongs under the scoring summary, not in the banner: ' + JSON.stringify(head));
    }
    // WHO KICKS OFF NEXT lives at the foot of the scoring card, bold, and
    // LAST -- after the scoring rows, not among them. Whoever kicked off
    // to start the GAME receives now, so it is the other team.
    const body = w.document.getElementById('scoringBody');
    if (!/kicks off/.test(body.textContent)) {
      fail('halftime:kicker', 'expected the second-half kicker under the scoring summary, got: ' + JSON.stringify(body.textContent));
    }
    if (!/kicks off\s*$/.test(body.textContent)) {
      fail('halftime:kicker-last', 'the kicker line should come after the scoring rows, got: ' + JSON.stringify(body.textContent));
    }
    const kickEl = [...body.children].pop();
    if (!kickEl || !/font-weight:8/.test(kickEl.getAttribute('style') || '')) {
      fail('halftime:kicker-bold', 'the kicker line should be bold, got: ' + (kickEl && kickEl.getAttribute('style')));
    }
    w.close();

    const started = half.concat([{ id: 'q3', text: 'Quarter marker — start of Q3', effect: { setQuarter: 3 }, quarter: 3, sequence_number: 901 }]);
    w = await view(started);
    const after = w.document.getElementById('quarterText').textContent;
    if (/HALFTIME/.test(after)) {
      fail('halftime:cleared', 'pressing Start 2nd half must clear the HALFTIME card without waiting for the kickoff, got: ' + JSON.stringify(after));
    }
    // And the drive cards come back with it.
    if (shown(w, '#scoringCard')) fail('halftime:scoring-cleared', 'the scoring card should hand the quad back once the half has started');
    if (!shown(w, '.drive-current')) fail('halftime:drive-back', 'the Current Drive card should return once the half has started');
    w.close();
  }

  // --- 6. No next kickoff at FINAL, so no line. The card is a record of
  //     the game at that point, not a cue for something about to happen.
  {
    const w = await view(rows, { id: 'test-game-1', status: 'final', season_year: 2026 });
    if (/kicks off/.test(w.document.getElementById('scoringBody').textContent)) {
      fail('final:no-kicker', 'there is no next kickoff at final -- the line should not appear');
    }
    w.close();
  }

  // --- 7. THE DRIVE CARDS DO NOT REACH BACK ACROSS THE INTERVAL.
  //     Reported from a real game: at the start of Q3 the Current Drive
  //     card headlined "Quarter marker — start of Q3" and carried the
  //     last FIRST-HALF drive's rush/pass/total tiles and its down line,
  //     with a first-half punt under Previous Drive. A drive does not
  //     span halftime, so none of it described the game any more.
  {
    const { click, typeInto } = require('./ui_driver');
    const build = async (stopAfter) => {
      const h = await bootGamePage();
      const doc = h.window.document, win = h.window;
      h.evalIn('window.confirm = () => true;');
      setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
      enterPlay(h, { type: 'rush', carrier: '22', yards: '6' });
      enterPlay(h, { type: 'punt', punter: '3', puntyds: '40', credit: '21', retyds: '5', spot: { side: 'own', yardline: 35 } });
      // A REAL PLAY in the last first-half drive. Without one the drive
      // that the interval interrupts is empty, its tiles read 0/0, and
      // the check below cannot tell a clamped card from an unclamped one
      // -- the first version of this test passed with the clamp removed.
      enterPlay(h, { type: 'rush', carrier: '30', yards: '9' });
      click(win, doc.getElementById('quarterUtilBtn'));
      click(win, doc.getElementById('endFirstHalfBtn'));
      await new Promise(r => setTimeout(r, 200));
      click(win, doc.getElementById('startHalfBtn'));
      await new Promise(r => setTimeout(r, 200));
      if (stopAfter !== 'marker'){
        click(win, doc.getElementById('pickA'));
        await new Promise(r => setTimeout(r, 150));
        click(win, doc.querySelector('.gk_kicker_pick'));
        const dir = doc.querySelector('.gk_dir_btn');
        if (dir) click(win, dir);
        click(win, doc.getElementById('guidedKickoffSave'));
        await new Promise(r => setTimeout(r, 220));
      }
      const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
      h.close();
      return rows;
    };

    // (a) Start 2nd half pressed, nothing entered: the card says where the
    //     game is and nothing else.
    let w = await view(await build('marker'));
    let head = w.document.getElementById('driveLogScroll').textContent;
    if (!/Start of Q3/.test(head)) fail('half-reset:headline', 'expected "Start of Q3", got: ' + JSON.stringify(head.trim()));
    if (/Quarter marker/.test(head)) fail('half-reset:marker', 'a quarter marker is not a play and must not headline the drive tile');
    if (w.document.getElementById('currentDriveTiles').textContent.trim()) {
      fail('half-reset:tiles', 'the tiles still carry first-half figures: ' + w.document.getElementById('currentDriveTiles').textContent.trim());
    }
    if (!/no previous drive/i.test(w.document.getElementById('prevDriveLogScroll').textContent)) {
      fail('half-reset:previous', 'Previous Drive should not show a first-half drive after the interval');
    }
    // THE BANNER TOO. computeState() keeps the down, distance and spot the
    // first half ended on, so the black bar read "3rd & 16 at own 12"
    // while the teams lined up to kick. Reported from a real game.
    if (w.document.getElementById('downText').textContent.trim()) {
      fail('half-reset:banner', 'the banner is still showing the situation the interval interrupted: ' +
        JSON.stringify(w.document.getElementById('downText').textContent.trim()));
    }
    w.close();

    // (b) Kickoff entered: it becomes the headline. It belongs to the
    //     KICKING team, so the drive-team filter would otherwise hide it
    //     and leave "no active drive yet" with the kick sitting in the log.
    w = await view(await build('kickoff'));
    head = w.document.getElementById('driveLogScroll').textContent;
    if (!/kicks off/.test(head)) fail('half-reset:kickoff', 'expected the kickoff as the headline, got: ' + JSON.stringify(head.trim()));
    if (/punts|rush for 9/.test(head)) fail('half-reset:stale', 'a first-half play is showing on a second-half card: ' + JSON.stringify(head.trim()));
    // Still blank through the kick: a kickoff sets no down, so there is
    // nothing to report until a snap or a drive marker lands.
    if (w.document.getElementById('downText').textContent.trim()) {
      fail('half-reset:banner-kickoff', 'the banner should stay blank during the kickoff, got: ' +
        JSON.stringify(w.document.getElementById('downText').textContent.trim()));
    }
    // AND IN THE TILE, which builds its own copy of that line -- fixing
    // the banner alone left "3rd & 16 at own 12" sitting under the
    // kickoff here. Reported from a real game after the banner was fixed.
    if (/\d+(st|nd|rd|th) & /.test(head)) {
      fail('half-reset:tile-downline', 'the drive tile is still showing a down from the first half: ' +
        JSON.stringify(head.trim()));
    }
    // THE TILES ARE THE REAL TEST. The first half's last drive had a
    // 9-yard rush in it; if the card still measures from before the
    // interval those yards appear here, on a half in which nothing has
    // been run yet.
    const tiles = w.document.getElementById('currentDriveTiles').textContent;
    if (/9/.test(tiles)) {
      fail('half-reset:tiles-stale', 'the tiles are counting first-half yardage on a second-half card: ' + JSON.stringify(tiles.trim()));
    }
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
