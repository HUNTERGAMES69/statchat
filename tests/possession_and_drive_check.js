// Possession, drive and down-conversion checks (Aug 6, 2026 session)
// ------------------------------------------------------------------
// Covers four fixes that all concern how drives and downs are counted:
//
//  * countPossessions used to reimplement drive-boundary logic instead
//    of deriving it, and double-counted every drive that began with a
//    detected possession change followed by an explicit reset marker.
//    A brand-new game where each side had had the ball once reported
//    2 possessions apiece.
//  * "Adjust Down/Distance" (formerly "New drive / correct down") must
//    not register a possession. Using it twice inside one drive used to
//    register two.
//  * The Current Drive panel gained a TOP tile.
//  * The 3rd/4th-down conversion loop omitted 'incomplete' from its play
//    type list, so an incomplete pass on 3rd down -- the single most
//    common 3rd-down outcome in football -- was not even counted as an
//    ATTEMPT.

const { bootGamePage, bootPage } = require('./harness');
const { enterPlay, setDrive, click, typeInto } = require('./ui_driver');

function rowsOf(h) {
  return h.db.plays.map((r, i) => Object.assign({}, r, {
    sequence_number: r.sequence_number || i + 1
  }));
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1. A normal kickoff -> drive -> punt -> drive is 1 each -------
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    click(win, doc.querySelector('.ptypeBtn[data-type="kickoff"]'));
    const panel = doc.getElementById('playPanel');
    click(win, panel.querySelector('.pp_kicker_pick[data-num="3"]'));
    click(win, doc.getElementById('pp_ko_touchback_toggle'));
    click(win, doc.getElementById('pp_review'));
    typeInto(win, doc.getElementById('confirmClockInput'), '11:45');
    click(win, doc.getElementById('saveBtn'));

    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 27 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '0' });
    click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
    const p2 = doc.getElementById('playPanel');
    click(win, p2.querySelector('.pp_punter_pick[data-num="15"]'));
    typeInto(win, doc.getElementById('pp_yards'), '40');
    // Required as of 13 Aug 2026: a punt with no ensuing spot is refused,
    // so without these two clicks the punt never saved and possession
    // never changed hands -- which is what this check is counting.
    click(win, p2.querySelector('.pp_spot_side[data-side="own"]'));
    typeInto(win, doc.getElementById('pp_spot_yardline'), '25');
    click(win, doc.getElementById('pp_review'));
    typeInto(win, doc.getElementById('confirmClockInput'), '10:34');
    click(win, doc.getElementById('saveBtn'));
    setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 48 });

    const rows = rowsOf(h);
    h.close();
    const v = await bootPage('view.html', { existingPlays: rows });
    const poss = JSON.parse(v.evalIn('JSON.stringify(countPossessions(plays))'));
    if (poss.teamA !== 1 || poss.teamB !== 1) {
      fail('possessions', 'kickoff/drive/punt/drive should be 1 each, got ' + JSON.stringify(poss));
    }
    // Possessions and drives are the same thing and must never disagree.
    const starts = JSON.parse(v.evalIn('JSON.stringify(findDriveStarts(plays))'));
    if (starts.length !== poss.teamA + poss.teamB) {
      fail('possessions', 'possession total ' + (poss.teamA + poss.teamB) +
           ' does not match drive count ' + starts.length);
    }
    v.close();
  }

  // --- 2. Adjust Down/Distance registers no possession --------------
  {
    const h = await bootGamePage();
    const label = h.document.getElementById('driveUtilBtn').textContent.trim();
    if (label !== 'Adjust Down/Distance') {
      fail('adjust', 'button should read "Adjust Down/Distance", reads "' + label + '"');
    }
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 17 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '5' });
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 12 });
    const rows = rowsOf(h);
    h.close();
    const v = await bootPage('view.html', { existingPlays: rows });
    const poss = JSON.parse(v.evalIn('JSON.stringify(countPossessions(plays))'));
    if (poss.teamA !== 1 || poss.teamB !== 0) {
      fail('adjust', 'two adjustments inside one drive should still be 1 possession, got ' +
           JSON.stringify(poss));
    }
    v.close();
  }

  // --- 3. Turnover on downs still counts (must not regress) ---------
  {
    const h = await bootGamePage();
    setDrive(h, { down: 4, distance: 10, side: 'own', yardline: 40 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '2' });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '6' });
    const rows = rowsOf(h);
    h.close();
    const v = await bootPage('view.html', { existingPlays: rows });
    const poss = JSON.parse(v.evalIn('JSON.stringify(countPossessions(plays))'));
    if (poss.teamA !== 1 || poss.teamB !== 1) {
      fail('turnover on downs', 'an unmarked possession change must still count, got ' +
           JSON.stringify(poss));
    }
    v.close();
  }

  // --- 4. Current Drive shows a TOP tile ----------------------------
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    h.evalIn('showClockPrompt({mode:"start", team:"teamA"}, function(){})');
    typeInto(win, doc.getElementById('clockPromptInput'), '11:37');
    h.evalIn('resolveClockPrompt(false)');
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 47 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '36' });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '11', td: true });
    h.evalIn('showClockPrompt({mode:"end", team:"teamA"}, function(){})');
    typeInto(win, doc.getElementById('clockPromptInput'), '10:14');
    h.evalIn('resolveClockPrompt(false)');
    const rows = rowsOf(h);
    h.close();
    const v = await bootPage('view.html', { existingPlays: rows });
    const tiles = v.document.getElementById('currentDriveTiles').textContent.replace(/\s+/g, ' ');
    if (!/TOP/.test(tiles)) fail('TOP tile', 'Current Drive has no TOP tile: ' + tiles.trim());
    // 11:37 -> 10:14 is 1:23.
    if (!/TOP\s*1:23/.test(tiles)) {
      fail('TOP tile', 'Current Drive TOP should be 1:23, tiles read: ' + tiles.trim());
    }
    v.close();
  }

  // --- 5. Down conversions, including the incomplete-pass case ------
  {
    const cases = [
      ['3rd down converted by a completed pass', 4, 3, 5,
       h => enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '12' }),
       { d3att: 1, d3conv: 1 }],
      ['3rd down FAILED by an incomplete pass', 4, 3, 5,
       h => enterPlay(h, { type: 'pass', passer: '7', receiver: '80', incomplete: true }),
       { d3att: 1, d3conv: 0 }],
      ['4th down FAILED by an incomplete pass', 4, 4, 3,
       h => enterPlay(h, { type: 'pass', passer: '7', receiver: '80', incomplete: true }),
       { d4att: 1, d4conv: 0 }],
      ['3rd down sack (was already counted)', 4, 3, 5,
       h => enterPlay(h, { type: 'sack', passer: '7', yards: '6', credit: '55' }),
       { d3att: 1, d3conv: 0 }],
      ['3rd down PUNT is not an attempt', 4, 3, 5,
       // The ensuing spot is REQUIRED on a punt as of 13 Aug 2026 -- a
       // half-filled or absent one is now refused instead of silently
       // dropped, so a punt with no spot never saves and possession
       // never changes hands.
       h => enterPlay(h, { type: 'punt', punter: '15', yards: '40',
                           spot: { side: 'own', yardline: '25' } }),
       { d3att: 0 }]
    ];
    for (const [label, , down, distance, act, want] of cases) {
      const h = await bootGamePage();
      setDrive(h, { down, distance, side: 'own', yardline: 40 });
      act(h);
      const rows = rowsOf(h);
      h.close();
      const v = await bootPage('view.html', { existingPlays: rows });
      const box = JSON.parse(v.evalIn('JSON.stringify(computeBoxScore(plays))'));
      // A team's own conversions live on the OTHER team's oppDowns.
      const own = box.teamB.oppDowns;
      for (const k of Object.keys(want)) {
        if ((own[k] || 0) !== want[k]) {
          fail('down conversion', label + ': ' + k + ' should be ' + want[k] +
               ', got ' + (own[k] || 0));
        }
      }
      v.close();
    }
  }

  // --- A MUFFED PUNT RECOVERED BY THE KICKING TEAM IS A TURNOVER ---------
  // Reported from a real game, 14 Aug 2026: the ball changed hands and
  // nothing was counted. countTurnovers only looked at playType 'int' and
  // 'fumble', and a muff is playType 'punt'.
  //
  // Charged to the RECEIVING team -- they lost it. The punting team's
  // drive ended with the punt as it always does, so charging them would
  // count one turnover twice.
  //
  // The three neighbours are asserted alongside it because they all end a
  // drive and none of them is a turnover, and the rule has to tell them
  // apart: a muff the receiving team recovers themselves, a BLOCKED punt
  // (which records no `recovery` role at all, whichever side gets it),
  // and an ordinary punt.
  {
    const { typeInto } = require('./ui_driver');
    const punt = async (fill) => {
      const h = await bootGamePage();
      const { window: win, document: doc } = h;
      setDrive(h, { down: 4, distance: 8, side: 'own', yardline: 30 });
      click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
      typeInto(win, doc.getElementById('pp_punter_manual'), '15');
      fill(win, doc);
      click(win, doc.getElementById('pp_review'));
      click(win, doc.getElementById('saveBtn'));
      const t = JSON.parse(h.evalIn('JSON.stringify(countTurnovers(plays))'));
      h.close();
      return t;
    };

    const muffKicking = await punt((w, d) => {
      typeInto(w, d.getElementById('pp_yards'), '40');
      click(w, d.getElementById('pp_muffed_toggle'));
      click(w, d.querySelector('input[name=pp_punt_muffrec][value="k"]'));
      typeInto(w, d.getElementById('pp_muff_rec'), '55');
      click(w, d.querySelector('.pp_muffspot_side[data-side="opp"]'));
      typeInto(w, d.getElementById('pp_muffspot_yardline'), '30');
    });
    if (muffKicking.teamB !== 1){
      fail('muffed punt', 'a punt muffed and recovered by the KICKING team charged the ' +
           'receiving team ' + muffKicking.teamB + ' turnovers, expected 1 — the ball ' +
           'changed hands and nothing counted it');
    }
    if (muffKicking.teamA !== 0){
      fail('muffed punt', 'the punting team was charged ' + muffKicking.teamA + ' — their ' +
           'drive ended with the punt, as every punt does, so this double counts');
    }

    const muffReceiving = await punt((w, d) => {
      typeInto(w, d.getElementById('pp_yards'), '40');
      click(w, d.getElementById('pp_muffed_toggle'));
      click(w, d.querySelector('input[name=pp_punt_muffrec][value="r"]'));
      typeInto(w, d.getElementById('pp_muff_rec'), '21');
      click(w, d.querySelector('.pp_spot_side[data-side="own"]'));
      typeInto(w, d.getElementById('pp_spot_yardline'), '30');
    });
    if (muffReceiving.teamA || muffReceiving.teamB){
      fail('muffed punt', 'a muff the RECEIVING team recovered itself was counted as a ' +
           'turnover — they keep the ball, exactly as they would have anyway');
    }

    const blocked = await punt((w, d) => {
      click(w, d.getElementById('pp_blocked_toggle'));
      click(w, d.querySelector('input[name=pp_punt_blockrec][value="own"]'));
      click(w, d.querySelector('.pp_spot_side[data-side="own"]'));
      typeInto(w, d.getElementById('pp_spot_yardline'), '22');
    });
    if (blocked.teamA || blocked.teamB){
      fail('muffed punt', 'a BLOCKED punt recovered by the kicking team was counted as a ' +
           'turnover — nobody lost the ball');
    }

    const plain = await punt((w, d) => {
      typeInto(w, d.getElementById('pp_yards'), '40');
      click(w, d.querySelector('.pp_spot_side[data-side="own"]'));
      typeInto(w, d.getElementById('pp_spot_yardline'), '30');
    });
    if (plain.teamA || plain.teamB){
      fail('muffed punt', 'an ordinary punt was counted as a turnover');
    }
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Possession / drive / down-conversion checks ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) console.log('  possessions match drives; adjustments are free; downs count incompletes.');
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
