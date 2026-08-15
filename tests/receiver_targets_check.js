// NOTE (Aug 7, 2026): box-score buckets are keyed by DISPLAY NAME, not by
// jersey number. Numbers are not identity -- two players can wear one, and
// keying on the number merged their lines. Lookups here use names.
// Receiver target checks
// ----------------------
// A target is a pass thrown AT a receiver, caught or not. It is the
// companion stat to catches: 2 from 3 says something 2 catches alone does
// not, and catch rate falls out of it.
//
// Two rulings were settled on 2026-08-07 and are asserted here so they
// are not quietly reversed:
//
//   - An INTERCEPTION counts as a target for the intended receiver. The
//     interception panel gained an optional "Intended receiver" field for
//     exactly this; before that, targets undercounted on precisely the
//     throws a coach most wants to look back at.
//   - A TWO-POINT CONVERSION pass does NOT count, matching NFHS practice
//     of keeping conversion attempts out of season passing and receiving
//     totals.
//
// Mutation-tested 2026-08-07. All five ways this can break are caught:
//   1. interception dropped from the target condition
//   2. two-point conversions wrongly included
//   3. the incomplete branch stops recording the receiver
//   4. the interception branch stops recording the receiver
//   5. completions stop counting as targets
//
// Known and accepted: the receiver is optional, and on an incompletion it
// is often genuinely unknown. Targets are therefore a FLOOR, not a count.
// The unnamed case is asserted below so that stays a deliberate choice
// rather than something discovered later.

const { bootGamePage, bootPage } = require('./harness');
const { enterPlay, setDrive, click, typeInto } = require('./ui_driver');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  const h = await bootGamePage();
  const { window: win, document: doc } = h;

  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 30 });
  enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '14' });      // catch
  enterPlay(h, { type: 'pass', passer: '7', receiver: '80', incomplete: true }); // target only
  enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '9' });       // catch
  enterPlay(h, { type: 'pass', passer: '7', receiver: '84', incomplete: true }); // target only
  enterPlay(h, { type: 'pass', passer: '7', incomplete: true });                 // nobody named

  // Interception with an intended receiver, entered through the panel.
  //
  // The reset below is load-bearing. Four incompletions in the preamble
  // run the offense out of downs, so possession has already flipped by
  // this point -- an interception entered here would be thrown BY the
  // other team, and the target credited to their receiver. The app does
  // that correctly; an earlier version of this test did not account for
  // it and blamed the app.
  h.evalIn('pushAndPersist({id:nextId++,text:"reset",effect:{forcePossession:"teamA"},quarter:1}); renderAll();');
  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 30 });

  click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
  click(win, [...doc.getElementById('playPanel').querySelectorAll('.pp-outcome-switch')]
    .find(x => x.textContent.trim() === 'Intercepted'));
  const intPanel = doc.getElementById('playPanel');
  const intendedField = doc.getElementById('pp_receiver_manual');
  if (!intendedField) {
    fail('interception', 'the interception panel has no intended-receiver field');
  }
  typeInto(win, doc.getElementById('pp_passer_manual'), '7');
  if (intendedField) typeInto(win, intendedField, '84');
  typeInto(win, doc.getElementById('pp_credit_manual'), '21');
  click(win, intPanel.querySelector('.pp_spot_side[data-side="own"]'));
  typeInto(win, doc.getElementById('pp_spot_yardline'), '42');
  click(win, doc.getElementById('pp_review'));
  const intClock = doc.getElementById('confirmClockRow');
  if (intClock && intClock.style.display !== 'none') {
    typeInto(win, doc.getElementById('confirmClockInput'), '7:00');
  }
  click(win, doc.getElementById('saveBtn'));

  // The throw must be recorded against the team that made it.
  const intRoles = JSON.parse(h.evalIn(
    'JSON.stringify(plays.filter(x => x.roles && x.roles.playType === "int").map(x => x.roles))'));
  if (!intRoles.length) {
    fail('interception', 'the interception did not save at all');
  } else if (!intRoles[0].receiver) {
    fail('interception', 'the interception saved without the intended receiver');
  } else if (intRoles[0].receiver.team !== 'teamA') {
    fail('interception', 'the intended receiver was credited to ' +
         intRoles[0].receiver.team + ', not the throwing team');
  }

  // A two-point conversion pass, which must NOT be counted. Possession
  // flipped on the interception, so it has to come back first.
  h.evalIn('pushAndPersist({id:nextId++,text:"reset",effect:{forcePossession:"teamA"},quarter:1}); renderAll();');
  setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 3 });
  enterPlay(h, { type: 'rush', carrier: '22', yards: '3', td: true });
  click(win, doc.querySelector('.ptypeBtn[data-type="twopt"]'));
  click(win, doc.getElementById('pp_2pt_pass_btn'));
  typeInto(win, doc.getElementById('pp_passer_manual'), '7');
  typeInto(win, doc.getElementById('pp_receiver_manual'), '80');
  click(win, doc.getElementById('pp_review'));
  click(win, doc.getElementById('saveBtn'));

  // AN UNNAMED COMPLETION -- the case the Unknown bucket exists for.
  // Without one in the fixture, dropping the bucket entirely still
  // reconciles (there is no unattributed yardage to lose) and the
  // reconciliation assertions below pass while proving nothing. Verified
  // by mutation: removing the bucket must fail this file.
  h.evalIn('pushAndPersist({id:nextId++,text:"reset",effect:{forcePossession:"teamA"},quarter:1}); renderAll();');
  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 30 });
  click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
  typeInto(win, doc.getElementById('pp_passer_manual'), '7');
  typeInto(win, doc.getElementById('pp_yards'), '26');
  click(win, doc.getElementById('pp_review'));
  click(win, doc.getElementById('saveBtn'));

  const rows = h.db.plays.map((r, i) =>
    Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
  h.close();

  // #80: 2 catches, 3 targets (the 2PT is excluded)
  // #84: 0 catches, 2 targets (one incompletion, one interception)
  // Keyed by NAME, not number -- see the note at the top of this file.
  const EXPECTED = { 'N Receiver': { rec: 2, tgt: 3 }, 'N Receiver Two': { rec: 0, tgt: 2 } };

  for (const page of ['view.html', 'recap.html', 'stat_package.html']) {
    const v = await bootPage(page, { existingPlays: rows });
    const recv = JSON.parse(v.evalIn('JSON.stringify(computeBoxScore(plays))')).teamA.receiving;
    for (const who of Object.keys(EXPECTED)) {
      const got = recv[who] || {};
      const want = EXPECTED[who];
      if ((got.tgt || 0) !== want.tgt) {
        fail(page, who + ' should have ' + want.tgt + ' targets, has ' + (got.tgt || 0));
      }
      if ((got.rec || 0) !== want.rec) {
        fail(page, who + ' should have ' + want.rec + ' catches, has ' + (got.rec || 0));
      }
    }
    // AN UNNAMED PASS GOES TO 'Unknown', AND NOWHERE ELSE.
    // ------------------------------------------------------------------
    // This originally asserted that an unnamed pass created NO receiving
    // row at all. That was right about the danger and wrong about the
    // remedy: the danger is a REAL PLAYER being credited with a throw
    // nobody saw him take, and leaving the row out entirely bought that
    // safety at the price of the check a stat sheet lives by -- passing
    // yards equalling the sum of receiving yards. A coach comparing
    // Passing 245 with Receiving 198 cannot tell a missing entry from a
    // bug.
    //
    // Changed 14 Aug 2026 on Andy's call: unnamed passes bucket to
    // 'Unknown', so the columns reconcile and the gap is stated instead
    // of hidden. The original intent survives intact -- no real player is
    // credited, which is what the assertion below still enforces.
    const phantom = Object.keys(recv).filter(n => !EXPECTED[n] && n !== 'Unknown');
    if (phantom.length) {
      fail(page, 'an unnamed pass credited a real player: ' + phantom.join(',') +
           " -- it must go to 'Unknown' or nowhere");
    }

    // THE CHECK THE WHOLE THING EXISTS FOR: the two columns reconcile.
    const box = JSON.parse(v.evalIn('JSON.stringify(computeBoxScore(plays))')).teamA;
    const sum = (o, k) => Object.keys(o).reduce((t, n) => t + (o[n][k] || 0), 0);
    if (sum(box.passing, 'yds') !== sum(box.receiving, 'yds')) {
      fail(page, 'passing yards (' + sum(box.passing, 'yds') + ') do not equal receiving yards (' +
           sum(box.receiving, 'yds') + ') — that equality is the first thing anyone checks on a stat sheet');
    }
    if (sum(box.passing, 'att') !== sum(box.receiving, 'tgt')) {
      fail(page, 'attempts (' + sum(box.passing, 'att') + ') do not equal targets (' +
           sum(box.receiving, 'tgt') + ')');
    }
    if (sum(box.passing, 'comp') !== sum(box.receiving, 'rec')) {
      fail(page, 'completions (' + sum(box.passing, 'comp') + ') do not equal receptions (' +
           sum(box.receiving, 'rec') + ')');
    }
    v.close();
  }

  // A target alone must not put a receiver on the LIVE VIEW. That panel
  // auto-shrinks to fit, so a row for someone with no catches costs size
  // on the rows that matter. The detailed reports still list them.
  {
    const v = await bootPage('view.html', { existingPlays: rows });
    const shown = [...v.document.querySelectorAll('td')].map(e => e.textContent.trim());
    // #84 has 2 targets and no catches in this fixture.
    const name84 = 'N Receiver Two';
    if (shown.indexOf(name84) !== -1) {
      fail('view.html', '#84 has targets but no catches and should not appear in the live tile');
    }
    const name80 = 'N Receiver';
    if (shown.indexOf(name80) === -1) {
      fail('view.html', '#80 caught two and must still appear');
    }
    v.close();
  }
  // ...but recap keeps them, since it is not size-constrained.
  {
    const r = await bootPage('recap.html', { existingPlays: rows });
    const shown = [...r.document.querySelectorAll('td')].map(e => e.textContent.trim());
    const name84 = 'N Receiver Two';
    if (shown.indexOf(name84) === -1) {
      fail('recap.html', '#84 should still be listed in the full report');
    }
    r.close();
  }

  // The column has to actually reach the page, not just the box score.
  {
    const v = await bootPage('view.html', { existingPlays: rows });
    const headers = [...v.document.querySelectorAll('th')].map(e => e.textContent.trim());
    if (headers.indexOf('Tgt') === -1) {
      fail('view.html', 'no Tgt column in the rendered receiving table');
    }
    v.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Receiver target checks ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) console.log('  targets counted on catches, incompletions and interceptions; 2PT excluded.');
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
