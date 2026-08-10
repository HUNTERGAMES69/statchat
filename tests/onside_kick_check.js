// Onside kick checks
// ------------------
// Added Aug 7, 2026. Before that there was no way to record one: the
// closest path was "muffed kickoff, kicking team recovers", which gets
// the STATE right but logs a deliberate call as somebody's mistake. That
// misreads the game in the recap and in anyone's notes afterwards.
//
// Structurally an onside kick is the same shape as a muffed kickoff -- a
// live ball either side can recover -- so it reuses that machinery rather
// than duplicating it. What differs is the wording, and the DEFAULT
// recovering side: a muff assumes the kicking team recovered, because
// that is the unusual outcome worth asking about, while an onside assumes
// the receiving team did, because most onside kicks fail.
//
// Both entry trees are covered here, because they are separate code paths
// and a fix to one has repeatedly missed the other.

const { bootGamePage } = require('./harness');
const { setDrive, click, typeInto } = require('./ui_driver');

// --- manual kickoff panel ---------------------------------------------
async function manualOnside(recoveringSide, spotYardline) {
  const h = await bootGamePage();
  const { window: win, document: doc } = h;
  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 35 });
  click(win, doc.querySelector('.ptypeBtn[data-type="kickoff"]'));
  const panel = doc.getElementById('playPanel');
  click(win, panel.querySelector('.pp_kicker_pick[data-num="3"]'));
  click(win, doc.getElementById('pp_ko_onside_toggle'));

  const radio = panel.querySelector('input[name=pp_ko_onsiderec][value="' + recoveringSide + '"]');
  if (!radio) { h.close(); return { error: 'no onside recovery radio on the manual panel' }; }
  radio.checked = true;
  radio.dispatchEvent(new win.Event('change', { bubbles: true }));
  typeInto(win, doc.getElementById('pp_ko_onside_rec'), recoveringSide === 'k' ? '55' : '21');

  const sideBtn = panel.querySelector('.pp_koonsidespot_side[data-side="own"]');
  if (sideBtn) click(win, sideBtn);
  typeInto(win, doc.getElementById('pp_koonsidespot_yardline'), spotYardline);

  click(win, doc.getElementById('pp_review'));
  const parsed = doc.getElementById('parsedText').textContent;
  const clockRow = doc.getElementById('confirmClockRow');
  if (clockRow && clockRow.style.display !== 'none') {
    typeInto(win, doc.getElementById('confirmClockInput'), '10:00');
  }
  const flip = doc.getElementById('flipCheck');
  if (flip && !flip.checked) click(win, flip);
  click(win, doc.getElementById('saveBtn'));
  const banner = doc.getElementById('downText').textContent;
  h.close();
  return { parsed, banner };
}

// --- guided kickoff flow ----------------------------------------------
async function guidedOnside(recoveringSide, spotPrefix, spotYardline) {
  const h = await bootGamePage({ game: { game_phase: 'notStarted' } });
  const { window: win, document: doc } = h;
  click(win, doc.getElementById('startGameBtn'));
  click(win, doc.getElementById('pickA'));
  typeInto(win, doc.getElementById('gk_kicker_manual'), '3');
  click(win, doc.getElementById('guidedKickoffSave'));

  const toggle = doc.getElementById('gr_onside_toggle');
  if (!toggle) { h.close(); return { error: 'no onside toggle in the guided flow' }; }
  click(win, toggle);

  const radio = doc.querySelector('input[name=gr_muffrec][value="' + recoveringSide + '"]');
  radio.checked = true;
  radio.dispatchEvent(new win.Event('change', { bubbles: true }));
  typeInto(win, doc.getElementById('gr_muff_rec'), recoveringSide === 'k' ? '55' : '21');

  const sideBtn = doc.querySelector('.' + spotPrefix + '_side[data-side="own"]');
  if (sideBtn) click(win, sideBtn);
  typeInto(win, doc.getElementById(spotPrefix + '_yardline'), spotYardline);
  typeInto(win, doc.getElementById('guidedReturnClock'), '11:50');
  click(win, doc.getElementById('guidedReturnSave'));
  await new Promise(r => setTimeout(r, 60));

  const logged = JSON.parse(h.evalIn(
    'JSON.stringify(plays.filter(p => /ONSIDE/.test(p.text)).map(p => p.text))'))[0] || null;
  const banner = doc.getElementById('downText').textContent;
  h.close();
  return { parsed: logged, banner };
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  const cases = [
    ['manual, kicking recovers',   () => manualOnside('k', '48'), 'own 48', true],
    ['manual, receiving recovers', () => manualOnside('r', '45'), 'own 45', false],
    ['guided, kicking recovers',   () => guidedOnside('k', 'gr_kickspot', '48'), 'own 48', true],
    ['guided, receiving recovers', () => guidedOnside('r', 'gr_spot', '42'), 'own 42', false]
  ];

  for (const [label, fn, expectedSpot, kickingKeeps] of cases) {
    const r = await fn();
    if (r.error) { fail(label, r.error); continue; }
    if (!r.parsed) {
      fail(label, 'the play did not save at all');
      continue;
    }
    // Logged as an onside kick, NOT as a muff.
    if (!/ONSIDE/i.test(r.parsed)) {
      fail(label, 'not logged as an onside kick: "' + r.parsed + '"');
    }
    if (/MUFF/i.test(r.parsed)) {
      fail(label, 'a deliberate onside kick was logged as a muff: "' + r.parsed + '"');
    }
    // The ball must end up where it was recovered, with the right team.
    if (r.banner.indexOf(expectedSpot) === -1) {
      fail(label, 'expected the ball at ' + expectedSpot + ', banner reads "' + r.banner + '"');
    }
    if (r.banner.indexOf('needs to kick off') !== -1) {
      fail(label, 'a recovered onside kick should hand the ball straight over, ' +
           'banner reads "' + r.banner + '"');
    }
    // Recovering your own onside kick keeps possession.
    const keptByKicker = /Neville ball/.test(r.banner);
    if (kickingKeeps !== keptByKicker) {
      fail(label, kickingKeeps
        ? 'the kicking team recovered and should keep the ball, banner: "' + r.banner + '"'
        : 'the receiving team recovered and should have the ball, banner: "' + r.banner + '"');
    }
  }

  // --- one outcome at a time -------------------------------------------
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 35 });
    click(win, doc.querySelector('.ptypeBtn[data-type="kickoff"]'));
    click(win, doc.getElementById('pp_ko_onside_toggle'));
    click(win, doc.getElementById('pp_ko_touchback_toggle'));
    if (doc.getElementById('pp_ko_onside').checked) {
      fail('exclusivity', 'ticking Touchback should clear Onside — a kick cannot be both');
    }
    click(win, doc.getElementById('pp_ko_onside_toggle'));
    if (doc.getElementById('pp_ko_touchback').checked) {
      fail('exclusivity', 'ticking Onside should clear Touchback');
    }
    if (doc.getElementById('pp_ko_muffed').checked) {
      fail('exclusivity', 'ticking Onside should clear Muffed');
    }
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Onside kick checks ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) console.log('  onside kicks record on both trees, either side recovering.');
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
