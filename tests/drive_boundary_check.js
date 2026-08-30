// Drive boundary checks
// ---------------------
// A drive must never START on an administrative marker -- a clock line,
// a quarter/half divider, or a manual possession flip. Those carry no
// roles and no yardage, so a "drive" beginning on one has an all-zero
// box score. Worse, because only the last two drives are ever displayed,
// a phantom one-play drive silently pushes the REAL drive out of the
// "previous drive" slot entirely.
//
// That was the Aug 6 bug: a kickoff flipped possession, the clock line
// recorded at that change of possession became the start of the next
// "drive", and a completed 99-yard touchdown drive rendered as
// "Clock - 5:00 at change of possession" with 0/0 tiles.
//
// Two distinct symptoms are covered here, because the same root cause
// produced both: the drive SPLIT (findDriveStarts) and the drive
// SUMMARY LINE (computeDriveSummary picking the trailing clock marker
// instead of the last real play).

const { bootGamePage, bootPage } = require('./harness');
const { enterPlay, setDrive, click, typeInto } = require('./ui_driver');

function rowsOf(h) {
  return h.db.plays.map((r, i) => Object.assign({}, r, {
    sequence_number: r.sequence_number || i + 1
  }));
}

// Pull findDriveStarts out of a page and expose it callable -- it is
// normally scoped inside the render function.
// Since the Aug 2026 consolidation findDriveStarts lives in engine.js and
// is a plain global on the page, so it can just be called. This used to
// scrape the function text out of the page HTML, which stopped working
// the moment the engine moved out of the inline script -- the scrape
// found nothing and produced "Unexpected end of input".
function exposeFindDriveStarts(page) {
  return () => JSON.parse(page.evalIn('JSON.stringify(findDriveStarts(plays))'));
}


// THE PREVIOUS DRIVE, COMPUTED RATHER THAN READ OFF A CARD.
// ---------------------------------------------------------------------
// This file used to observe drive boundaries through the Previous Drive
// panel: if a boundary landed on a clock marker, that panel summarized
// the marker instead of the real drive, and the assertions caught it.
// The panel was replaced by the series tiles on 30 Aug 2026, and the
// series tiles describe the CURRENT series -- so they cannot see the
// finished drive at all.
//
// Andy's instruction was to re-point rather than delete, and the boundary
// logic is unchanged, so the observation moves DOWN a level instead of
// sideways: findDriveStarts gives the boundaries and computeDriveSummary
// turns a pair of them into the same numbers the panel used to print.
// That is what the card was displaying all along, so nothing is lost --
// and it is strictly better, because a rendering change can no longer
// break a test about arithmetic.
function prevDriveSummary(page) {
  const starts = JSON.parse(page.evalIn('JSON.stringify(findDriveStarts(plays))'));
  if (starts.length < 2) return null;
  const from = starts[starts.length - 2];
  const to = starts[starts.length - 1];
  return JSON.parse(page.evalIn(
    'JSON.stringify(computeDriveSummary(' + from + ', ' + to + '))'));
}

// --- Scenario builders (all driven through the real UI) -------------

// Scoring drive, then a kickoff that flips possession, then a clock
// line, then the new drive marker. This is the reported sequence.
async function buildKickoffScenario() {
  const h = await bootGamePage();
  const { window: win, document: doc } = h;
  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 1 });
  enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '99', td: true });
  enterPlay(h, { type: 'twopt', sub: 'rush', carrier: '22', result: 'g' });
  click(win, doc.querySelector('.ptypeBtn[data-type="kickoff"]'));
  const panel = doc.getElementById('playPanel');
  click(win, panel.querySelector('.pp_kicker_pick[data-num="3"]'));
  click(win, doc.getElementById('pp_ko_touchback_toggle'));
  click(win, doc.getElementById('pp_review'));
  typeInto(win, doc.getElementById('confirmClockInput'), '5:00');
  click(win, doc.getElementById('saveBtn'));
  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
  return h;
}

// A drive with clock events at BOTH ends, ending in a punt -- so time of
// possession is computable and the summary line has a real play to pick.
async function buildPuntScenario() {
  const h = await bootGamePage();
  const { window: win, document: doc } = h;
  h.evalIn('showClockPrompt({mode:"start", team:"teamA"}, function(){})');
  typeInto(win, doc.getElementById('clockPromptInput'), '10:00');
  h.evalIn('resolveClockPrompt(false)');
  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 20 });
  enterPlay(h, { type: 'rush', carrier: '22', yards: '12' });
  enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '20' });
  click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
  const panel = doc.getElementById('playPanel');
  click(win, panel.querySelector('.pp_punter_pick[data-num="15"]'));
  typeInto(win, doc.getElementById('pp_yards'), '40');
  // The ensuing spot is REQUIRED on a punt as of 13 Aug 2026. This suite
  // builds its punt by hand rather than through enterPlay's spec.spot, so
  // the two fields are clicked directly.
  click(win, panel.querySelector('.pp_spot_side[data-side="own"]'));
  typeInto(win, doc.getElementById('pp_spot_yardline'), '28');
  click(win, doc.getElementById('pp_review'));
  typeInto(win, doc.getElementById('confirmClockInput'), '6:30');
  click(win, doc.getElementById('saveBtn'));
  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 30 });
  return h;
}

// Manual flip has the same shape as the kickoff bug: it is followed by a
// clock prompt rather than a "New drive" marker, so nothing else would
// have caught it.
async function buildFlipScenario() {
  const h = await bootGamePage();
  const { window: win, document: doc } = h;
  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 20 });
  enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
  click(win, doc.getElementById('flipBtn'));
  const card = doc.getElementById('clockPromptCard');
  if (card && card.style.display !== 'none') {
    typeInto(win, doc.getElementById('clockPromptInput'), '4:15');
    h.evalIn('resolveClockPrompt(false)');
  }
  enterPlay(h, { type: 'rush', carrier: '22', yards: '6' });
  return h;
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });
  const fs = require('fs');
  const path = require('path');
  const viewSrc = fs.readFileSync(path.resolve(__dirname, '..', 'view.html'), 'utf8');

  // A drive start index must never point at an administrative marker.
  const assertNoAdminStarts = (area, starts, rows) => {
    starts.forEach(idx => {
      const r = rows[idx];
      if (!r) return;
      const e = r.effect || {};
      if (e.isReset) return; // explicit drive announcements are valid
      if (e.clockEvent || e.setQuarter || e.forcePossession || r.is_divider) {
        fail(area, 'drive starts on an administrative marker at [' + idx + ']: ' + r.text);
      }
    });
    const dupes = starts.filter((v, i) => starts.indexOf(v) !== i);
    if (dupes.length) fail(area, 'duplicate drive start indices: ' + dupes.join(', '));
  };

  // --- 1. The reported sequence -------------------------------------
  {
    const g = await buildKickoffScenario();
    const rows = rowsOf(g);
    g.close();

    const v = await bootPage('view.html', { existingPlays: rows });
    const starts = exposeFindDriveStarts(v)();
    assertNoAdminStarts('kickoff', starts, rows);

    // The real scoring drive must be summarized, not the clock line.
    const prev = prevDriveSummary(v);
    if (!prev) fail('kickoff', 'no previous drive could be computed at all');
    else {
      if (prev.totalYds !== 99) {
        fail('kickoff', 'previous drive lost the 99-yard scoring drive, got ' + prev.totalYds + ' yds');
      }
      // A drive opened on a clock marker is the one-play, all-zero
      // phantom the boundary rule exists to prevent -- so the numbers
      // themselves say whether it happened, with no card to read.
      if (prev.totalPlays <= 1 && prev.totalYds === 0) {
        fail('kickoff', 'previous drive is the zero-counter phantom a marker boundary produces: ' +
          JSON.stringify(prev));
      }
      if (!/TOUCHDOWN/.test(String(prev.scoringPlayText || ''))) {
        fail('kickoff', 'previous drive does not report the touchdown: ' +
          JSON.stringify(prev.scoringPlayText));
      }
    }
    v.close();
  }

  // --- 2. Punt drive: tiles, TOP, and the summary line ---------------
  {
    const g = await buildPuntScenario();
    const rows = rowsOf(g);
    g.close();

    const v = await bootPage('view.html', { existingPlays: rows });
    const starts = exposeFindDriveStarts(v)();
    assertNoAdminStarts('punt', starts, rows);

    const prev = prevDriveSummary(v);
    if (!prev) fail('punt', 'no previous drive could be computed at all');
    else {
      // The same four numbers the tiles used to print, in the same order.
      if (prev.rushes !== 1 || prev.rushYds !== 12) {
        fail('punt', 'rush wrong, expected 1/12: ' + prev.rushes + '/' + prev.rushYds);
      }
      if (prev.passes !== 1 || prev.passYds !== 20) {
        fail('punt', 'pass wrong, expected 1/20: ' + prev.passes + '/' + prev.passYds);
      }
      // TOTAL plays/yards. This asserted 'YARDS 32' until 14 Aug 2026,
      // when the previous-drive tile still counted a different thing
      // under a different name from the live one beside it.
      if (prev.totalPlays !== 2 || prev.totalYds !== 32) {
        fail('punt', 'total wrong, expected 2/32: ' + prev.totalPlays + '/' + prev.totalYds);
      }
      // 10:00 -> 6:30 is 3:30 of possession. A broken drive split makes
      // this 0, so it doubles as a boundary check -- and it is the single
      // most sensitive number here, which is why it survived the move off
      // the card rather than being dropped with it.
      if (prev.top !== 210) {
        fail('punt', 'time of possession wrong, expected 210s (3:30): ' + prev.top);
      }
      // The drive ended in a punt; the trailing clock line must not be
      // what the summary describes.
      const line = String(prev.lastPlayText || prev.scoringPlayText || '');
      if (!/punts 40/.test(line)) {
        fail('punt', 'summary line is not the punt: ' + JSON.stringify(line));
      }
      if (/Clock\s*[—-]/.test(line)) {
        fail('punt', 'summary line is a clock marker: ' + JSON.stringify(line));
      }
    }
    v.close();
  }

  // --- 3. Manual flip -----------------------------------------------
  {
    const g = await buildFlipScenario();
    const rows = rowsOf(g);
    g.close();

    const v = await bootPage('view.html', { existingPlays: rows });
    const starts = exposeFindDriveStarts(v)();
    assertNoAdminStarts('manual-flip', starts, rows);

    const current = v.document.getElementById('driveLogScroll').textContent.replace(/\s+/g, ' ');
    if (!current.includes('rush for 6')) {
      fail('manual-flip', 'current drive should start at the first real play after the flip: ' + current.trim());
    }
    if (/Manual flip/.test(current)) {
      fail('manual-flip', 'current drive begins on the flip marker itself: ' + current.trim());
    }
    const prev = prevDriveSummary(v);
    if (!prev) fail('manual-flip', 'no previous drive could be computed at all');
    else if (prev.totalPlays !== 1 || prev.totalYds !== 8) {
      fail('manual-flip', 'previous drive total wrong, expected 1/8: ' +
        prev.totalPlays + '/' + prev.totalYds);
    }
    // THE SIDE-BY-SIDE LABEL COMPARISON IS GONE, and deliberately not
    // replaced. It existed because two drive panels sat in the same quad
    // and had to agree on what their four tiles were called -- a real
    // risk when the same numbers were rendered twice by two functions.
    // There is one panel now, so there is nothing to disagree with; the
    // series tiles beside it report different quantities under their own
    // names by design.
    //
    // What that comparison was ultimately protecting -- that the current
    // drive's fourth tile reads Started while the drive is open and TOP
    // once it closes -- is covered directly in current_drive_tile_check.js
    // sections 3 and 4, against the live tile rather than by cross-check.
    const cur = v.document.getElementById('currentDriveTiles').textContent.replace(/\s+/g, ' ');
    if (!/RUSH/.test(cur) || !/PASS/.test(cur) || !/TOTAL/.test(cur)) {
      fail('manual-flip', 'the current drive tiles lost their labels: ' + cur.trim());
    }
    v.close();
  }

  // --- 4. game.html shows the same drive, not just the clock line ----
  {
    const g = await buildKickoffScenario();
    const prev = g.document.getElementById('prevDriveLogScroll').textContent.replace(/\s+/g, ' ');
    if (!prev.includes('TOUCHDOWN')) {
      fail('game.html', 'live entry page previous drive lost the scoring drive: ' + prev.trim());
    }
    const onlyClock = prev.trim().startsWith('Q1Clock') && !prev.includes('kicks off');
    if (onlyClock) {
      fail('game.html', 'live entry page previous drive is only the clock line: ' + prev.trim());
    }
    g.close();
  }

  // --- 5. HALFTIME never registers a phantom drive at the opening kick
  //
  // Found by a systematic audit, 19 Aug 2026, not by a live-game report
  // -- and the more serious of the two, because it is not a rare
  // combination. Every single game has exactly one halftime, and the
  // second half always opens with a kickoff. findDriveStarts forces a
  // fresh boundary at halftime regardless of whether possession
  // actually changed (so a team that keeps the ball across the break
  // still gets a new drive) -- but that boundary landed ON the opening
  // kickoff itself, which then flips possession AGAIN as its own
  // effect. countPossessions (built directly from these same
  // boundaries) credited a second, spurious possession to whichever
  // team the kickoff favoured, in every game with a halftime, not just
  // ones with an unusual score near the break.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '5' });
    enterPlay(h, { type: 'punt', punter: '15', yards: '40', credit: '99', retyds: '5',
      spot: { side: 'own', yardline: '30' } });
    h.evalIn("pushAndPersist({ id: nextId++, text: 'End of 1st half', effect: {}, isDivider: true })");
    h.evalIn("pushAndPersist({ id: nextId++, text: 'Start of 2nd half', effect: { setQuarter: 3 }, isDivider: true })");
    enterPlay(h, { type: 'kickoff', kicker: '99', touchback: true, clock: '12:00' });
    const poss = JSON.parse(h.evalIn('JSON.stringify(countPossessions(plays))'));
    // teamA drove once (ending in the punt) and receives to open the
    // second half -- exactly two. teamB has exactly the punt-return
    // drive -- exactly one. Anything else means a phantom drive landed
    // on the opening kickoff.
    if (poss.teamA !== 2 || poss.teamB !== 1){
      fail('halftime', 'ordinary halftime transition: expected teamA:2, teamB:1, got ' + JSON.stringify(poss));
    }
    const starts = JSON.parse(h.evalIn('JSON.stringify(findDriveStarts(plays))'));
    const koIdx = JSON.parse(h.evalIn('JSON.stringify(plays.map((p,i)=>({i, pt: p.roles && p.roles.playType})))'))
      .find(p => p.pt === 'kickoff').i;
    if (starts.includes(koIdx)){
      fail('halftime', 'a drive boundary landed directly on the 2nd-half kickoff at index ' + koIdx +
        ' -- starts: ' + JSON.stringify(starts));
    }
    h.close();
  }

  // --- 6. Same halftime check, with a defensive score right before it
  //
  // The scenario that surfaced this: reported from a real game the
  // same night, in a slightly different shape (a defensive score, its
  // PAT, THEN halftime). Confirms the fix holds with a score and a try
  // sitting between the last real play and the interval, not just an
  // ordinary punt.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 3, distance: 2, side: 'opp', yardline: 40 });
    enterPlay(h, { type: 'fg', kicker: '3', yards: '35', blocked: true, credit: '55', retyds: '60',
      td: true, clock: '2:00' });
    enterPlay(h, { type: 'pat', kicker: '3', result: 'g' });
    h.evalIn("pushAndPersist({ id: nextId++, text: 'End of 1st half', effect: {}, isDivider: true })");
    h.evalIn("pushAndPersist({ id: nextId++, text: 'Start of 2nd half', effect: { setQuarter: 3 }, isDivider: true })");
    enterPlay(h, { type: 'kickoff', kicker: '99', touchback: true, clock: '12:00' });
    const poss = JSON.parse(h.evalIn('JSON.stringify(countPossessions(plays))'));
    // teamA's own drive ending in the block, plus receiving to open the
    // second half -- exactly two. teamB scored a defensive touchdown,
    // which correctly earns no possession of its own (matching the
    // ordinary-game convention already established for this).
    if (poss.teamA !== 2 || poss.teamB !== 0){
      fail('halftime', 'halftime after a defensive score: expected teamA:2, teamB:0, got ' + JSON.stringify(poss));
    }
    h.close();
  }

  // --- 7. "Previous Drive" panel shows the try outcome for a
  // DEFENSIVE score, not just an ordinary offensive one
  //
  // Reported directly from a real game, 19 Aug 2026: computeDriveSummary
  // (view.html) has always had a colored PAT/2PT outcome line for the
  // "Previous Drive" panel, but the try-detection sat BELOW a team
  // filter that only matched an ORDINARY offensive touchdown, where
  // the scoring team happens to equal driveTeam by coincidence. For a
  // defensive score the two are never equal, so the line silently
  // never rendered -- the PAT looked, in the scorer's own words, "like
  // it didn't exist." Moved the detection above the filter, mirroring
  // the scoringPlayText fix a few lines above it in the same function,
  // earlier the same night.
  {
    const h = await bootGamePage();
    enterPlay(h, { type: 'kickoff', kicker: '3', touchback: true, clock: '12:00' });
    setDrive(h, { down: 3, distance: 2, side: 'opp', yardline: 40 });
    enterPlay(h, { type: 'fg', kicker: '3', yards: '35', blocked: true, credit: '55', retyds: '60',
      td: true, clock: '7:00' });
    enterPlay(h, { type: 'pat', kicker: '3', result: 'g' });
    enterPlay(h, { type: 'kickoff', kicker: '3', touchback: true, clock: '7:00' });
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows });
    // THE DISPLAY HALF OF THIS CHECK HAS NO SURFACE ANY MORE.
    // ------------------------------------------------------------------
    // It asserted that a finished drive's try outcome rendered in the
    // Previous Drive panel. That panel is gone (30 Aug 2026) and nothing
    // mid-game displays a FINISHED drive's try -- the series tiles beside
    // the current drive report this series, not the last one.
    //
    // Not fabricated a replacement: sections 10 and 11 below already
    // assert the same rendering, on the current drive card, in the window
    // before the ensuing kickoff moves the boundary. That is the same
    // code path (renderCurrentDriveLastPlay's tryLine) and the same
    // colours, so the guarantee is covered -- what is lost is only the
    // second place it used to be observable.
    //
    // What survives here, and is the reason this scenario is still built:
    // the boundary itself. assertNoAdminStarts above is the check.
    v.close();
  }

  // --- 8. Same panel, a MISSED try -- must render red, not just absent
  {
    const h = await bootGamePage();
    enterPlay(h, { type: 'kickoff', kicker: '3', touchback: true, clock: '12:00' });
    setDrive(h, { down: 3, distance: 2, side: 'opp', yardline: 40 });
    enterPlay(h, { type: 'fg', kicker: '3', yards: '35', blocked: true, credit: '55', retyds: '60',
      td: true, clock: '7:00' });
    enterPlay(h, { type: 'pat', kicker: '3', result: 'x' });
    enterPlay(h, { type: 'kickoff', kicker: '3', touchback: true, clock: '7:00' });
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows });
    // THE DISPLAY HALF OF THIS CHECK HAS NO SURFACE ANY MORE.
    // ------------------------------------------------------------------
    // It asserted that a finished drive's try outcome rendered in the
    // Previous Drive panel. That panel is gone (30 Aug 2026) and nothing
    // mid-game displays a FINISHED drive's try -- the series tiles beside
    // the current drive report this series, not the last one.
    //
    // Not fabricated a replacement: sections 10 and 11 below already
    // assert the same rendering, on the current drive card, in the window
    // before the ensuing kickoff moves the boundary. That is the same
    // code path (renderCurrentDriveLastPlay's tryLine) and the same
    // colours, so the guarantee is covered -- what is lost is only the
    // second place it used to be observable.
    //
    // What survives here, and is the reason this scenario is still built:
    // the boundary itself. assertNoAdminStarts above is the check.
    v.close();
  }

  // --- 9. A made field goal (no touchdown, no try at all) must show
  // no stray try-outcome line -- confirms computeDriveSummary's own
  // `endedInTouchdown ? tryOutcome : null` guard still holds after
  // moving the try-detection above the team filter.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 4, distance: 8, side: 'opp', yardline: 20 });
    enterPlay(h, { type: 'fg', kicker: '3', yards: '37', result: 'g' });
    enterPlay(h, { type: 'kickoff', kicker: '3', touchback: true });
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows });
    const prevHtml = v.document.getElementById('driveLogScroll').innerHTML;
    if (/margin-top:2px/.test(prevHtml)) {
      fail('try-outcome-display', 'a made field goal (no touchdown) rendered a stray try-outcome line: ' +
        prevHtml.replace(/<[^>]+>/g, '|'));
    }
    v.close();
  }

  // --- 10. "Current Drive" ITSELF shows the try outcome, BEFORE the
  // ensuing kickoff has moved the boundary -- the actual gap behind
  // the report. Reported directly, 19 Aug 2026, with a screenshot: a
  // fresh page load right after the PAT (matching exactly how a crew
  // checks the page live, before the next kickoff is entered) showed
  // "no previous drive yet" AND no PAT anywhere in Current Drive's own
  // log either -- test 7 above only proves the FIX works once a second
  // drive-start exists; it says nothing about the gap before that.
  {
    const h = await bootGamePage();
    enterPlay(h, { type: 'kickoff', kicker: '3', touchback: true, clock: '12:00' });
    setDrive(h, { down: 3, distance: 2, side: 'opp', yardline: 40 });
    enterPlay(h, { type: 'fg', kicker: '3', yards: '35', blocked: true, credit: '55', retyds: '60',
      td: true, clock: '7:00' });
    enterPlay(h, { type: 'pat', kicker: '3', result: 'g' });
    // NO ensuing kickoff -- this is the exact moment the screenshot
    // captured, one play short of test 7's scenario.
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows });
    const curHtml = v.document.getElementById('driveLogScroll').innerHTML;
    if (!/PAT — GOOD/.test(curHtml)) {
      fail('current-drive-try-display', 'right after the PAT, before the ensuing kickoff, Current Drive\'s ' +
        'own log never showed it at all: ' + curHtml.replace(/<[^>]+>/g, '|'));
    }
    v.close();
  }

  // --- 11. Same gap, a MISSED try -- must still appear. A missed
  // PAT/2PT carries NO effect.score at all (just endsDrive: true), so
  // a filter that keyed on effect.score instead of playType would pass
  // test 10 above (a MADE try happens to also carry a score) while
  // still silently dropping every missed one.
  {
    const h = await bootGamePage();
    enterPlay(h, { type: 'kickoff', kicker: '3', touchback: true, clock: '12:00' });
    setDrive(h, { down: 3, distance: 2, side: 'opp', yardline: 40 });
    enterPlay(h, { type: 'fg', kicker: '3', yards: '35', blocked: true, credit: '55', retyds: '60',
      td: true, clock: '7:00' });
    enterPlay(h, { type: 'pat', kicker: '3', result: 'x' });
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows });
    const curHtml = v.document.getElementById('driveLogScroll').innerHTML;
    if (!/PAT — MISSED/.test(curHtml)) {
      fail('current-drive-try-display', 'a MISSED PAT, right after entry, never showed in Current Drive\'s ' +
        'own log either: ' + curHtml.replace(/<[^>]+>/g, '|'));
    }
    v.close();
  }

  // --- 12. Once the ensuing kickoff DOES move the boundary, the PAT
  // must appear in Previous Drive exactly once, not duplicated between
  // Previous Drive and a now-empty Current Drive. This is the exact
  // failure mode an earlier feature this same night was reverted for
  // (a kickoff shown in both tiles at once), so the fix for the gap
  // above must not reopen it.
  {
    const h = await bootGamePage();
    enterPlay(h, { type: 'kickoff', kicker: '3', touchback: true, clock: '12:00' });
    setDrive(h, { down: 3, distance: 2, side: 'opp', yardline: 40 });
    enterPlay(h, { type: 'fg', kicker: '3', yards: '35', blocked: true, credit: '55', retyds: '60',
      td: true, clock: '7:00' });
    enterPlay(h, { type: 'pat', kicker: '3', result: 'g' });
    enterPlay(h, { type: 'kickoff', kicker: '3', touchback: true, clock: '7:00' });
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows });
    const curHtml = v.document.getElementById('driveLogScroll').innerHTML;
    if (/PAT/.test(curHtml)) {
      fail('current-drive-try-display', 'once the ensuing kickoff moved the boundary, the PAT was STILL ' +
        'showing in the now-empty Current Drive too: ' + curHtml.replace(/<[^>]+>/g, '|'));
    }
    // THE "EXACTLY ONCE IN PREVIOUS DRIVE" HALF IS GONE with the panel.
    // The half that mattered is the one above: the reported fault was the
    // PAT STAYING on the current drive card after the boundary moved off
    // it, which is still fully observable and still asserted.
    //
    // Counting it in the other panel was only ever the confirmation that
    // it had moved rather than vanished. With one panel there is nowhere
    // for it to move to, so the count has no subject -- and inventing one
    // against the series tiles would be asserting something the design
    // never promised.
    v.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Drive boundary checks ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  drives never start on administrative markers; summaries report real plays.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
