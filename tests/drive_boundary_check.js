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

    const prev = v.document.getElementById('prevDriveLogScroll').textContent.replace(/\s+/g, ' ');
    // The real scoring drive must be summarized, not the clock line.
    if (!prev.includes('99')) {
      fail('kickoff', 'previous drive lost the 99-yard scoring drive: ' + prev.trim());
    }
    if (/Clock\s*[—-]/.test(prev)) {
      fail('kickoff', 'previous drive is summarized by a clock marker: ' + prev.trim());
    }
    if (!prev.includes('TOUCHDOWN')) {
      fail('kickoff', 'previous drive does not report the touchdown: ' + prev.trim());
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

    const prev = v.document.getElementById('prevDriveLogScroll').textContent.replace(/\s+/g, ' ');
    if (!/RUSH\s*1\/12/.test(prev)) fail('punt', 'rush tile wrong: ' + prev.trim());
    if (!/PASS\s*1\/20/.test(prev)) fail('punt', 'pass tile wrong: ' + prev.trim());
    // TOTAL plays/yards, matching the Current Drive tile. This asserted
    // 'YARDS 32' until 14 Aug 2026, when the previous-drive tile still
    // counted a different thing under a different name from the live one
    // beside it -- the same four tiles in the same order, and only three
    // of them comparable.
    if (!/TOTAL\s*2\/32/.test(prev)) fail('punt', 'total tile wrong, expected 2/32: ' + prev.trim());
    // 10:00 -> 6:30 is 3:30 of possession. A broken drive split makes
    // this 0:00, so it doubles as a boundary check.
    if (!/TOP\s*3:30/.test(prev)) fail('punt', 'time of possession wrong: ' + prev.trim());
    // The drive ended in a punt; the trailing clock line must not be
    // what gets shown as the summary.
    if (!prev.includes('punts 40')) {
      fail('punt', 'summary line is not the punt: ' + prev.trim());
    }
    if (/Clock\s*[—-]/.test(prev)) {
      fail('punt', 'summary line is a clock marker: ' + prev.trim());
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
    const prev = v.document.getElementById('prevDriveLogScroll').textContent.replace(/\s+/g, ' ');
    if (!/TOTAL\s*1\/8/.test(prev)) fail('manual-flip', 'previous drive total wrong, expected 1/8: ' + prev.trim());
    // The two panels must carry the SAME labels. That is the requirement;
    // the values above only demonstrate it on one drive.
    const cur = v.document.getElementById('currentDriveTiles').textContent.replace(/\s+/g, ' ');
    const labelsOf = t => (t.match(/RUSH|PASS|TOTAL|YARDS|TOP/g) || []).join(',');
    if (cur && labelsOf(cur) !== labelsOf(prev)){
      fail('manual-flip', 'the current and previous drive tiles do not match: current [' +
           labelsOf(cur) + '] vs previous [' + labelsOf(prev) + '] — two drives side by ' +
           'side are there to be compared');
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
    const prevHtml = v.document.getElementById('prevDriveLogScroll').innerHTML;
    if (!/PAT — GOOD/.test(prevHtml)) {
      fail('try-outcome-display', 'a defensive score\'s own PAT never rendered in the Previous Drive ' +
        'panel: ' + prevHtml.replace(/<[^>]+>/g, '|'));
    }
    if (!/color:#1a7a4c/.test(prevHtml.split('PAT — GOOD')[0].slice(-120))) {
      fail('try-outcome-display', 'the PAT line rendered but not in the expected "good" green');
    }
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
    const prevHtml = v.document.getElementById('prevDriveLogScroll').innerHTML;
    if (!/PAT — MISSED/.test(prevHtml)) {
      fail('try-outcome-display', 'a defensive score\'s own MISSED PAT never rendered in the Previous ' +
        'Drive panel: ' + prevHtml.replace(/<[^>]+>/g, '|'));
    }
    if (!/color:#a32d2d/.test(prevHtml.split('PAT — MISSED')[0].slice(-120))) {
      fail('try-outcome-display', 'the missed PAT line rendered but not in the expected red');
    }
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
    const prevHtml = v.document.getElementById('prevDriveLogScroll').innerHTML;
    if (/margin-top:2px/.test(prevHtml)) {
      fail('try-outcome-display', 'a made field goal (no touchdown) rendered a stray try-outcome line: ' +
        prevHtml.replace(/<[^>]+>/g, '|'));
    }
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
