// Current Drive tile: last play only, larger, with down/distance/spot;
// TOP becomes SOP while the drive is still open
// ---------------------------------------------------------------------
// Requested directly, 21 Aug 2026, mocked up and approved before any
// code changed. Two related changes to view.html's top-right "Current
// Drive" tile, Previous Drive deliberately untouched by both:
//
// 1. Instead of listing every play in the drive, only the most recent
//    one is shown, at 30px, with the down/distance/spot it resulted in
//    directly underneath -- built from the exact same `state` and
//    `distDisplay` the page's own banner already uses, so the two can
//    never disagree.
//
// 2. The fourth small tile (RUSH/PASS/TOTAL/_) reads SOP -- the clock
//    exactly as logged at the start of the still-open possession --
//    for as long as the drive has no closing clock event yet. The
//    moment one is entered, it reverts to TOP with the real elapsed
//    duration, unchanged from before. Required exposing
//    pendingClockStart on computeState's returned object (engine.js),
//    which existed internally already but was never handed back, and
//    porting absSecToClockStr from game.html into view.html to turn
//    that raw value back into a displayable clock reading.

const { bootGamePage, bootPage } = require('./harness');
const { enterPlay, setDrive, enterTimeout, click, typeInto } = require('./ui_driver');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1. Only the last play shows, at the larger size, with the
  // down/distance/spot line underneath, matching the banner's own
  // format exactly.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '12' });
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    const html = v.document.getElementById('driveLogScroll').innerHTML;
    if (!/font-size:36px/.test(html)) fail('last-play-size', 'expected the last play at 36px, got: ' + html);
    if (!/pass to N Receiver for 12/.test(html)) fail('last-play-is-last', 'expected only the SECOND (most recent) play to show, got: ' + html);
    if (/rush for 8/.test(html)) fail('last-play-not-both', 'expected the FIRST play to be absent -- only the last play should show, got: ' + html);
    // Named, not own/opp: the spectator page uses team names -- see the
    // markerLabelNamed block at the foot of this file.
    if (!/1st &amp; 10 at Neville 45/.test(html)) fail('down-distance-line', 'expected "1st & 10 at Neville 45" underneath the play, got: ' + html);
    v.close();
  }

  // --- 2. Empty state: no plays in the current drive at all.
  {
    const v = await bootPage('view.html', { existingPlays: [], readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML !== undefined });
    await new Promise(r => setTimeout(r, 150));
    const html = v.document.getElementById('driveLogScroll').innerHTML;
    if (!/no active drive yet/.test(html)) fail('empty-state', 'expected the unchanged empty-state message, got: ' + html);
    v.close();
  }

  // --- 3. SOP: a logged start-of-possession clock, no closing event yet.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    // absSec 36 in a 720-second (12-minute) quarter is 11:24 remaining.
    h.evalIn("pushAndPersist({ id: nextId++, text: 'Clock', effect: { clockEvent: { type: 'start', team: 'teamA', absSec: 36 } }, isDivider: false })");
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '12' });
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('currentDriveTiles') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    const html = v.document.getElementById('currentDriveTiles').innerHTML;
    if (!/SOP/.test(html)) fail('sop-label', 'expected the fourth tile to read SOP while the drive is open, got: ' + html);
    if (!/11:24/.test(html)) fail('sop-value', 'expected the logged start-of-possession clock 11:24, got: ' + html);
    if (/<span class="stat-label"[^>]*>TOP/.test(html)) fail('sop-not-top', 'must not still read TOP while the drive has no closing clock event, got: ' + html);
    // THE TILE MATCHES ITS NEIGHBOURS; ONLY THE LABEL IS BADGED. The
    // whole tile used to be amber, which made the quad look uneven for
    // what is simply a fourth reading, and tinted the clock value along
    // with it. What needs saying is that SOP is a different KIND of
    // number from TOP -- where the possession started, not how long it
    // has run -- so the mark goes on the word that changes between the
    // two states.
    const win = v.window;
    const items = [...v.document.querySelectorAll('#currentDriveTiles .inline-stat-item')];
    if (items.length !== 4) fail('sop-tiles', 'expected four tiles, got ' + items.length);
    const bgs = new Set(items.map(i => win.getComputedStyle(i).backgroundColor));
    if (bgs.size !== 1) {
      fail('sop-styling', 'the SOP tile should match its neighbours, got backgrounds: ' + [...bgs].join(', '));
    }
    const sopLabel = items.map(i => i.querySelector('.stat-label'))
      .find(l => l && /SOP/.test(l.textContent));
    if (!sopLabel) fail('sop-badge-missing', 'no SOP label found');
    else {
      if (!sopLabel.classList.contains('stat-label-badge')) {
        fail('sop-badge', 'the SOP label should carry the badge that marks it as not a live stat');
      }
      // Boxed, not merely tinted: at label size a colour change alone is
      // easy to miss.
      const lc = win.getComputedStyle(sopLabel);
      if (lc.backgroundColor === 'rgba(0, 0, 0, 0)') fail('sop-badge-fill', 'the badge needs a fill');
      if (parseFloat(lc.borderTopWidth) <= 0) fail('sop-badge-border', 'the badge needs its outline');
      // And the other three labels must NOT be badged.
      items.map(i => i.querySelector('.stat-label'))
        .filter(l => l && !/SOP/.test(l.textContent))
        .forEach(l => {
          if (l.classList.contains('stat-label-badge')) {
            fail('sop-badge-spread', l.textContent + ' should not be badged');
          }
        });
    }
    v.close();
  }

  // --- 4. TOP returns once a closing clock event is entered, with the
  // correct elapsed duration.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    h.evalIn("pushAndPersist({ id: nextId++, text: 'Clock', effect: { clockEvent: { type: 'start', team: 'teamA', absSec: 36 } }, isDivider: false })");
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '12' });
    // 120 - 36 = 84 seconds = 1:24 elapsed.
    h.evalIn("pushAndPersist({ id: nextId++, text: 'Clock', effect: { clockEvent: { type: 'end', team: 'teamA', absSec: 120 } }, isDivider: false })");
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('currentDriveTiles') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    const html = v.document.getElementById('currentDriveTiles').innerHTML;
    if (!/<span class="stat-label"[^>]*>TOP/.test(html)) fail('top-returns-label', 'expected the fourth tile to read TOP again once closed, got: ' + html);
    if (!/1:24/.test(html)) fail('top-returns-value', 'expected the real elapsed duration 1:24, got: ' + html);
    if (/SOP/.test(html)) fail('top-not-sop', 'must not still read SOP once the drive has a closing clock event, got: ' + html);
    v.close();
  }

  // --- 5. Previous Drive is completely unaffected by any of the
  // above -- still shows all four ORIGINAL tiles (TOP, never SOP,
  // since a finished drive by definition has a closing clock event or
  // none logged at all), and the full renderDriveSummary() format.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '20' });
    enterPlay(h, { type: 'punt', punter: '15', yards: '40', spot: { side: 'own', yardline: 28 } });
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 30 });
    enterPlay(h, { type: 'rush', carrier: '28', yards: '5' });
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('prevDriveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    const html = v.document.getElementById('prevDriveLogScroll').innerHTML;
    if (!/RUSH/.test(html) || !/PASS/.test(html) || !/TOTAL/.test(html) || !/TOP/.test(html)) {
      fail('previous-drive-tiles-unaffected', 'expected all four original tiles (RUSH/PASS/TOTAL/TOP), got: ' + html);
    }
    if (/SOP/.test(html)) fail('previous-drive-no-sop', 'Previous Drive must never show SOP -- it is always a finished drive, got: ' + html);
    if (!/punts 40/.test(html)) fail('previous-drive-summary-unchanged', 'expected the unchanged summary-line format, got: ' + html);
    v.close();
  }

  // === Follow-up requests, same tile, 21 Aug 2026 -- mocked up and
  // approved before any of this was built ===

  // --- 6. The redundant trailing down/distance already baked into the
  // play's own stored text ("... — 2nd & 9", or "... — 1st down" for a
  // conversion) is stripped from what THIS widget shows, since the
  // standalone down/distance line now says the same thing -- but only
  // here. The stored text itself, and every other reader of it, is
  // untouched (covered separately, by inspecting db.plays directly).
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '12' });
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    const storedText = rows[rows.length - 1].text;
    h.close();

    if (!/— 1st down$/.test(storedText)) {
      fail('stored-text-untouched', 'expected the STORED play text to still carry its own trailing down/distance phrase unmodified, got: ' + storedText);
    }

    const v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    const html = v.document.getElementById('driveLogScroll').innerHTML;
    if (/1st down/.test(html)) fail('suffix-stripped-conversion', 'expected the redundant "— 1st down" suffix stripped from THIS widget only, got: ' + html);
    v.close();
  }

  // --- 7. TOUCHDOWN and turnover-on-downs are NOT stripped -- neither
  // is duplicated by the standalone down/distance line (a drive that
  // just ended has no next down to repeat), so removing them would
  // delete information this widget states nowhere else.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 6 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '6', td: true });
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    const html = v.document.getElementById('driveLogScroll').innerHTML;
    if (!/TOUCHDOWN/.test(html)) fail('touchdown-not-stripped', 'TOUCHDOWN must remain -- it is not duplicated by any standalone line, got: ' + html);
    v.close();
  }

  // --- 8. The down/distance line is larger (22px, up from 19px), and
  // there is now visible spacing above the play text itself (18px),
  // separating it from the tiles row above it.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    const html = v.document.getElementById('driveLogScroll').innerHTML;
    if (!/font-size:24px/.test(html)) fail('down-distance-larger', 'expected the down/distance line at 24px, got: ' + html);
    if (!/margin-top:16px/.test(html)) fail('play-text-spacing', 'expected margin-top:16px above the play text, got: ' + html);
    v.close();
  }

  // --- 9. Previous Drive's own outcome text is larger too (16px, up
  // from 13px) -- readable, but still well short of Current Drive's
  // 30px headline, since this is a summary of a finished drive, not
  // the thing the page is live for. Tested directly against
  // renderDriveSummary() with a hand-built touchdown+PAT summary,
  // rather than fighting a full possession-change UI sequence for a
  // check that only needs the function's own output.
  {
    const v = await bootPage('view.html', { existingPlays: [], readyWhen: win => (win.document.getElementById('prevDriveLogScroll') || {}).innerHTML !== undefined });
    await new Promise(r => setTimeout(r, 100));
    const summary = {
      team: 'teamA', rushes: 4, rushYds: 22, passes: 2, passYds: 18, totalPlays: 6, totalYds: 40, top: 165,
      scoringPlayText: 'TOUCHDOWN, N Runningback 6 yd run', lastPlayText: null,
      tryOutcome: { text: 'N Kicker (Neville) PAT good', good: true }
    };
    const html = v.evalIn('renderDriveSummary(' + JSON.stringify(summary) + ')');
    if (!/font-size:20px/.test(html)) fail('prev-drive-outcome-larger', 'expected the outcome line at 20px, got: ' + html);
    if (/font-size:36px/.test(html)) fail('prev-drive-not-as-large-as-current', 'Previous Drive\'s outcome text must stay well under Current Drive\'s 36px, got: ' + html);
    if (!/PAT good/.test(html)) fail('prev-drive-try-line', 'expected the PAT sub-line to still render, got: ' + html);
    // Requested directly in the same follow-up: the PAT/try sub-line
    // was still too small next to the now-larger outcome line above
    // it -- bumped from 12px to 15px, still visibly the smaller of the
    // two on purpose.
    if (!/font-size:16px/.test(html)) fail('prev-drive-try-line-larger', 'expected the PAT sub-line at 16px, got: ' + html);
    v.close();
  }

  // --- 10. Previous Drive sits a fixed, moderate distance below
  // Current Drive's own content -- changed from margin-top:auto
  // (which pinned it to the absolute bottom edge, but pushed ALL the
  // tile's leftover space above it instead) to a fixed gap, so
  // whatever space remains falls below it near the tile's own bottom
  // edge, where padding-bottom already accounts for it. Still has a
  // visible divider above it either way.
  {
    const v = await bootPage('view.html', { existingPlays: [], readyWhen: win => (win.document.getElementById('prevDriveLogScroll') || {}).innerHTML !== undefined });
    await new Promise(r => setTimeout(r, 100));
    const el = v.document.querySelector('.drive-previous');
    const style = v.window.getComputedStyle(el);
    if (style.marginTop !== '30px') fail('moderate-gap-above', 'expected a fixed 30px gap above Previous Drive, not margin-top:auto (which pins to the absolute bottom instead), got: ' + style.marginTop);
    // Reported directly from a live screenshot: at desktop width the
    // stacked tiles' text read too small against tiles stretched that
    // wide -- bumped to 28px values with 13px labels, checked as
    // computed styles rather than markup so a stray override anywhere
    // else in the stylesheet would still be caught.
    v.evalIn('document.getElementById("prevDriveLogScroll").innerHTML = renderDriveSummary({ team: "teamA", rushes: 1, rushYds: 5, passes: 1, passYds: 8, totalPlays: 2, totalYds: 13, top: 60, scoringPlayText: null, lastPlayText: "x", tryOutcome: null })');
    const val = v.document.querySelector('.inline-stat-item .stat-value');
    const lab = v.document.querySelector('.inline-stat-item .stat-label');
    if (v.window.getComputedStyle(val).fontSize !== '28px') fail('tile-value-size', 'expected tile values at 28px, got: ' + v.window.getComputedStyle(val).fontSize);
    if (v.window.getComputedStyle(lab).fontSize !== '13px') fail('tile-label-size', 'expected tile labels at 13px, got: ' + v.window.getComputedStyle(lab).fontSize);
    if (!/1px solid/.test(style.borderTop)) fail('divider-above', 'expected a visible border-top divider above Previous Drive, got: ' + style.borderTop);
    // Requested directly, same follow-up: the content sat flush against
    // the tile's bottom edge with no breathing room once pinned there.
    if (style.paddingBottom !== '16px') fail('bottom-spacing', 'expected 16px of padding below Previous Drive\'s own content, got: ' + style.paddingBottom);
    v.close();
  }

  // --- 11. Requested directly: when a drive ends in a touchdown, the
  // try (PAT/2PT) that follows must not REPLACE the touchdown as the
  // headline. The touchdown stays locked in place and the try's own
  // result renders as a colored sub-line beneath it -- green when
  // good, red otherwise -- the same pairing Previous Drive's summary
  // presents. The moment the next drive actually registers (kickoff +
  // its first play), the display moves on to the new play with no
  // residue.
  {
    // (a) TD alone -- shows the touchdown, no sub-line yet.
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '25', td: true });
    let rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    let v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    let html = v.document.getElementById('driveLogScroll').innerHTML;
    if (!/TOUCHDOWN/.test(html)) fail('td-lock-stage1', 'expected the touchdown as the headline before the try, got: ' + html);
    if (/PAT/.test(html)) fail('td-lock-stage1', 'no try has been entered yet, nothing about a PAT should show, got: ' + html);
    v.close();

    // (b) Made PAT entered -- touchdown stays the headline, PAT is a
    // green sub-line, in that order.
    enterPlay(h, { type: 'pat', kicker: '3', result: 'g' });
    rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    html = v.document.getElementById('driveLogScroll').innerHTML;
    if (!/font-size:36px[^<]*"[^>]*>[^<]*rush for 25/.test(html)) fail('td-lock-stage2', 'expected the TOUCHDOWN still as the 36px headline after the PAT, got: ' + html);
    if (!/PAT — GOOD/.test(html)) fail('td-lock-stage2', 'expected the PAT result as its own line, got: ' + html);
    if (!/color:#1a7a4c[^>]*>[^<]*PAT — GOOD/.test(html)) fail('td-lock-stage2-color', 'expected the made PAT sub-line in green, got: ' + html);
    if (html.indexOf('TOUCHDOWN') > html.indexOf('PAT — GOOD')) fail('td-lock-stage2-order', 'the touchdown must come BEFORE the PAT sub-line, got: ' + html);
    v.close();

    // (c) Next drive underway -- kickoff plus the new drive's first
    // play. The lock releases on its own; the new play shows normally.
    enterPlay(h, { type: 'kickoff', kicker: '3', credit: '21', retyds: '20', spot: { side: 'own', yardline: 30 } });
    enterPlay(h, { type: 'rush', carrier: '30', yards: '5' });
    rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();
    v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    html = v.document.getElementById('driveLogScroll').innerHTML;
    if (/TOUCHDOWN|PAT/.test(html)) fail('td-lock-stage3', 'expected the display to move on once the next drive registered, got: ' + html);
    if (!/rush for 5/.test(html)) fail('td-lock-stage3', 'expected the new drive\'s own play, got: ' + html);
    v.close();
  }

  // --- 12. A MISSED try renders red, and a 2PT is handled the same
  // way a PAT is -- detected by playType, exactly like
  // computeDriveSummary, never by .result alone.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '25', td: true });
    enterPlay(h, { type: 'pat', kicker: '3', result: 'x' });
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();
    const v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    const html = v.document.getElementById('driveLogScroll').innerHTML;
    if (!/TOUCHDOWN/.test(html)) fail('missed-try-lock', 'expected the touchdown still locked as the headline, got: ' + html);
    if (!/color:#a32d2d[^>]*>[^<]*PAT — MISSED/.test(html)) fail('missed-try-red', 'expected the missed PAT sub-line in red, got: ' + html);
    v.close();
  }
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 25 });
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '25', td: true });
    enterPlay(h, { type: 'twopt', sub: 'rush', carrier: '22', result: 'g' });
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();
    const v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    const html = v.document.getElementById('driveLogScroll').innerHTML;
    if (!/TOUCHDOWN/.test(html)) fail('twopt-lock', 'expected the touchdown still locked as the headline after a 2PT, got: ' + html);
    if (!/color:#1a7a4c[^>]*>[^<]*2PT[^<]*GOOD/.test(html)) fail('twopt-green', 'expected the good 2PT sub-line in green, got: ' + html);
    v.close();
  }

  // --- 13. Requested directly: an ordinary kickoff was invisible in
  // BOTH drive tiles -- filed under the kicking team at the tail of
  // the OLD segment, with the new segment starting at the "New drive"
  // marker right after it, so the window between the kickoff and the
  // receiving team's first snap read "no active drive yet". Now that
  // window shows the kickoff itself, with the resulting drive start
  // beneath it. Display only, with the possession count explicitly
  // asserted unchanged -- the one stat the request specifically
  // demanded be protected.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '25', td: true });
    enterPlay(h, { type: 'pat', kicker: '3', result: 'g' });
    enterPlay(h, { type: 'kickoff', kicker: '3', credit: '21', retyds: '20', spot: { side: 'own', yardline: 30 } });
    let rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));

    // (a) The window: kickoff shows, drive-start line beneath it.
    let v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    let html = v.document.getElementById('driveLogScroll').innerHTML;
    if (!/kicks off/.test(html)) fail('kickoff-window', 'expected the kickoff shown in the window before the first snap, got: ' + html);
    // The receiving team's own 30, named. After a kickoff possession has
    // passed to them, so their name is the one on the spot.
    if (!/1st &amp; 10 at TEST OPP 30/.test(html)) fail('kickoff-window-downline', 'expected the resulting drive start beneath the kickoff, got: ' + html);

    // (b) Possession count and box score: byte-identical plays array
    // after a full render pass that runs this exact branch, and the
    // expected possession numbers -- one each, the kickoff having
    // handed the ball over exactly once.
    const before = v.evalIn('JSON.stringify(plays)');
    v.evalIn('renderAll()');
    const after = v.evalIn('JSON.stringify(plays)');
    if (before !== after) fail('kickoff-window-no-mutation', 'the render pass modified the plays array every stat computes from');
    const poss = JSON.parse(v.evalIn('JSON.stringify(countPossessions(plays))'));
    if (poss.teamA !== 1 || poss.teamB !== 1) fail('kickoff-window-possessions', 'expected possessions 1/1 during the window, got: ' + JSON.stringify(poss));
    v.close();

    // (c) The window closes: the first snap replaces the kickoff.
    enterPlay(h, { type: 'rush', carrier: '30', yards: '5' });
    rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();
    v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    html = v.document.getElementById('driveLogScroll').innerHTML;
    if (/kicks off/.test(html)) fail('kickoff-window-closes', 'expected the kickoff replaced once the first snap landed, got: ' + html);
    if (!/rush for 5/.test(html)) fail('kickoff-window-closes', 'expected the new drive\'s own play, got: ' + html);
    const poss2 = JSON.parse(v.evalIn('JSON.stringify(countPossessions(plays))'));
    if (poss2.teamA !== 1 || poss2.teamB !== 1) fail('kickoff-window-possessions-after', 'expected possessions still 1/1 after the snap, got: ' + JSON.stringify(poss2));
    v.close();
  }

  // --- 14. Requested directly: a timeout must be ADDITIVE to the last
  // play, never replace it as the headline -- the same principle as
  // the touchdown/try lock. Trailing timeouts render as amber
  // sub-lines after the down/distance line; the play stays put. Also
  // composes with BOTH earlier features: a timeout after a PAT leaves
  // the touchdown+try pairing intact, and a timeout in the kickoff
  // window pairs with the kickoff instead of replacing it.
  {
    // (a) Mid-drive: play headline, down/distance, then the timeout.
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    enterTimeout(h, 'teamA');
    let rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    let v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    let html = v.document.getElementById('driveLogScroll').innerHTML;
    if (!/font-size:36px[^>]*>[^<]*rush for 8/.test(html)) fail('timeout-additive', 'expected the rush still as the headline, got: ' + html);
    if (!/color:#7a5c00[^>]*>Timeout — /.test(html)) fail('timeout-line', 'expected the timeout as an amber sub-line, got: ' + html);
    if (html.indexOf('rush for 8') > html.indexOf('Timeout')) fail('timeout-order', 'the play must come BEFORE the timeout line, got: ' + html);
    v.close();

    // (b) A second consecutive timeout stacks beneath the first.
    enterTimeout(h, 'teamA');
    rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    html = v.document.getElementById('driveLogScroll').innerHTML;
    if ((html.match(/Timeout — /g) || []).length !== 2) fail('timeout-consecutive', 'expected both consecutive timeouts shown, got: ' + html);
    v.close();

    // (c) The next snap clears them.
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '12' });
    rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();
    v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    html = v.document.getElementById('driveLogScroll').innerHTML;
    if (/Timeout/.test(html)) fail('timeout-clears', 'expected the timeouts gone once the next snap landed, got: ' + html);
    if (!/pass to N Receiver for 12/.test(html)) fail('timeout-clears', 'expected the new play as the headline, got: ' + html);
    v.close();
  }
  {
    // (d) After a PAT: the touchdown+try lock survives, timeout beneath.
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '25', td: true });
    enterPlay(h, { type: 'pat', kicker: '3', result: 'g' });
    enterTimeout(h, 'teamA');
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();
    const v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    const html = v.document.getElementById('driveLogScroll').innerHTML;
    if (!/TOUCHDOWN/.test(html)) fail('timeout-after-try-lock', 'expected the touchdown still locked as the headline, got: ' + html);
    if (!/PAT — GOOD/.test(html)) fail('timeout-after-try-lock', 'expected the PAT line preserved, got: ' + html);
    if (!/Timeout — /.test(html)) fail('timeout-after-try-line', 'expected the timeout beneath the pair, got: ' + html);
    v.close();
  }
  {
    // (e) In the kickoff window: kickoff headline, timeout beneath --
    // not the timeout replacing the kickoff.
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '25', td: true });
    enterPlay(h, { type: 'pat', kicker: '3', result: 'g' });
    enterPlay(h, { type: 'kickoff', kicker: '3', credit: '21', retyds: '20', spot: { side: 'own', yardline: 30 } });
    enterTimeout(h, 'teamA');
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();
    const v = await bootPage('view.html', { existingPlays: rows, readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    const html = v.document.getElementById('driveLogScroll').innerHTML;
    if (!/kicks off/.test(html)) fail('timeout-kickoff-window', 'expected the kickoff still as the headline, got: ' + html);
    if (!/Timeout — /.test(html)) fail('timeout-kickoff-window', 'expected the timeout beneath the kickoff, got: ' + html);
    if (html.indexOf('kicks off') > html.indexOf('Timeout')) fail('timeout-kickoff-order', 'the kickoff must come BEFORE the timeout line, got: ' + html);
    v.close();
  }

  // A LONG PLAY BREAKS AT ITS OWN CLAUSES rather than wherever the tile
  // runs out of width. A kickoff with a return and a tackler passes 90
  // characters, and wrapping on width splits a person's name as often as
  // not. The play text has natural seams -- each trailing clause is
  // introduced by a comma and a fixed phrase -- so the break goes there.
  {
    const h = await bootPage('view.html', { existingPlays: [],
      readyWhen: win => !!win.document.getElementById('driveLogScroll') });
    // Let the page's own deferred init run before touching or closing it.
    // readyWhen fires as soon as the element exists, which is earlier than
    // init's timer -- closing in between left that timer reading location
    // off a torn-down window and crashing the run after it had passed.
    await new Promise(r => setTimeout(r, 200));
    const t = str => h.evalIn('breakPlayText(' + JSON.stringify(str) + ')');
    const clauses = out => (out.match(/play-clause/g) || []).length;

    const two = t('N Kicker kicks off, returned by Kayden Jones for 45, tackled by #22');
    if (clauses(two) !== 2) fail('break:two', 'a return and a tackler are two clauses, got ' + clauses(two) + ': ' + two);
    // SIBLINGS, not nested. Wrapping one clause at a time put each span
    // inside the last, so the second indented twice for no visible reason.
    if (/play-clause[^>]*>[^<]*<span class="play-clause"/.test(two)) {
      fail('break:nested', 'clauses must be siblings, not nested: ' + two);
    }
    if (!/kicks off<span/.test(two)) fail('break:comma', 'the comma should go with the break: ' + two);

    const inc = t("Parker Robinson pass incomplete, intended for Ze'Land Young");
    if (clauses(inc) !== 1) fail('break:intended', 'an incompletion should break before "intended for": ' + inc);

    const muff = t('Trey Johnson punts 56 — MUFFED, recovered by Neville');
    if (clauses(muff) !== 1) fail('break:recovered', 'a recovery should break onto its own line: ' + muff);

    // A short play is left exactly as it was.
    const short = 'JaMarion Roberson rush for 7';
    if (t(short) !== short) fail('break:short', 'a short play should be untouched, got ' + t(short));
    h.close();
  }

  // A PENALTY SHOWS IN THE TILE whoever it was called on. The row is
  // stamped with the PENALISED team, not the team whose drive it happened
  // in, so a flag on the defence during our drive carried the other
  // team's side and the drive-team filter dropped it -- the flag simply
  // vanished from the tile. Reported from a real game.
  {
    const build = async (side) => {
      const g = await bootGamePage();
      const doc = g.window.document, win = g.window;
      setDrive(g, { down: 1, distance: 10, side: 'own', yardline: 25 });
      enterPlay(g, { type: 'rush', carrier: '22', yards: '8' });
      click(win, doc.getElementById('penUtilBtn'));
      click(win, doc.querySelector('.penTeamBtn[data-team="' + side + '"]'));
      typeInto(win, doc.getElementById('pen_yds'), '5');
      click(win, doc.getElementById('pen_review'));
      await new Promise(r => setTimeout(r, 120));
      click(win, doc.getElementById('saveBtn'));
      await new Promise(r => setTimeout(r, 200));
      const rows = g.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
      g.close();
      return rows;
    };
    // BOTH DIRECTIONS. A flag on the offence carries the drive team's own
    // side and was never affected, so testing only that one would pass
    // with the fix removed.
    for (const side of ['def', 'off']) {
      const w = await bootPage('view.html', { existingPlays: await build(side),
        readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML !== undefined });
      await new Promise(r => setTimeout(r, 250));
      const txt = w.document.getElementById('driveLogScroll').textContent;
      if (!/PENALTY/.test(txt)) {
        fail('penalty:' + side, 'a penalty on the ' + (side === 'def' ? 'defence' : 'offence') +
          ' is missing from the Current Drive tile: ' + JSON.stringify(txt.trim()));
      }
      w.close();
    }
  }

  // TEAM NAMES, NOT own/opp, ON THE SPECTATOR PAGE. "at opp 45" asks the
  // reader to work out whose 45 that is, and a screen watched from across
  // a room by people who did not enter the play gives them nothing to
  // work it out from.
  //
  // engine.js's markerLabel is deliberately untouched: it is shared with
  // the entry page and the reports, where own/opp is the right register.
  {
    const h = await bootPage('view.html', { existingPlays: [],
      readyWhen: win => !!win.document.getElementById('driveLogScroll') });
    await new Promise(r => setTimeout(r, 200));
    const t = (fp, poss) => h.evalIn('markerLabelNamed(' + fp + ', ' + JSON.stringify(poss) + ')');
    if (!/Neville 25/.test(t(25, 'teamA'))) fail('marker:own', 'own territory should name the team with the ball, got ' + t(25, 'teamA'));
    if (!/TEST OPP 45/.test(t(55, 'teamA'))) fail('marker:opp', 'opponent territory should name the other team, got ' + t(55, 'teamA'));
    // Possession decides which side is which.
    if (!/TEST OPP 25/.test(t(25, 'teamB'))) fail('marker:flip', 'the sides should follow possession, got ' + t(25, 'teamB'));
    // The 50 belongs to neither side, so it keeps its own name.
    if (t(50, 'teamA') !== 'the 50') fail('marker:fifty', 'the 50 should not be given to a team, got ' + t(50, 'teamA'));
    if (t(null, 'teamA') !== '') fail('marker:null', 'an unknown spot should render blank');
    if (/\bown\b|\bopp\b/.test(t(25, 'teamA') + t(75, 'teamA'))) {
      fail('marker:wording', 'own/opp should not survive on the spectator page');
    }
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Current Drive tile: last play, larger, with SOP/TOP ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  only the most recent play shows, at the larger size, with the down/distance/spot it resulted in beneath it; the fourth tile correctly reads SOP while a drive is open and TOP once closed; Previous Drive is untouched throughout.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
