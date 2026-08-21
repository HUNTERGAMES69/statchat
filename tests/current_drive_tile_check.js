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
const { enterPlay, setDrive } = require('./ui_driver');

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
    if (!/font-size:30px/.test(html)) fail('last-play-size', 'expected the last play at 30px, got: ' + html);
    if (!/pass to N Receiver for 12/.test(html)) fail('last-play-is-last', 'expected only the SECOND (most recent) play to show, got: ' + html);
    if (/rush for 8/.test(html)) fail('last-play-not-both', 'expected the FIRST play to be absent -- only the last play should show, got: ' + html);
    if (!/1st &amp; 10 at own 45/.test(html)) fail('down-distance-line', 'expected "1st & 10 at own 45" underneath the play, got: ' + html);
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
    if (/<b[^>]*>TOP/.test(html)) fail('sop-not-top', 'must not still read TOP while the drive has no closing clock event, got: ' + html);
    // The distinct amber styling from the approved mockup -- deliberate,
    // not incidental: it is a clock reading, not an accumulated stat,
    // and looking identical to the other three tiles would read as a
    // real duration before one exists.
    if (!/background:#fff3cd/.test(html)) fail('sop-styling', 'expected the SOP tile\'s distinct amber background, got: ' + html);
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
    if (!/<b[^>]*>TOP/.test(html)) fail('top-returns-label', 'expected the fourth tile to read TOP again once closed, got: ' + html);
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
