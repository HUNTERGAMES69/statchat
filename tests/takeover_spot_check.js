// Takeover spot checks
// --------------------
// Every play that hands the ball to the other team must let the coach say
// WHERE they take over, and that spot must survive into the log as a
// "New drive" marker. When it does not, field position is simply unset:
// the banner reads SPOT NOT SET, the field strip has nothing to draw, and
// every subsequent yardage check is disabled until someone notices.
//
// Three separate causes were found on 2026-08-07, all invisible from the
// panel because the field looked filled in:
//
//   1. No spot field at all on the rush / pass / sack fumble paths. Only
//      the dedicated Fumble play type had one, and the toggle on a rush
//      is how a fumble usually gets entered.
//   2. The recovery radio defaults to "recovered by opponent" but its
//      handler only runs on CHANGE, so opening the fumble fields never
//      installed the spot getter and the typed spot read back as null.
//   3. Switching the pass panel to "Sacked" re-renders it, discarding the
//      click listeners wireStartingSpot had attached, so the side button
//      recorded nothing.
//
// Each of those produced a filled-in form that quietly returned null, so
// these assert the SAVED RESULT rather than the presence of the fields.
//
// NOT covered, deliberately: muffed holds on a PAT or field goal. The play
// and the possession are dead where they stand and field position is
// established by the ensuing kick, so there is no takeover spot to ask
// for. Adding one there would invent a decision the coach does not make.

const { bootGamePage } = require('./harness');
const { setDrive, click, typeInto } = require('./ui_driver');

// Fill a starting-spot widget by its id prefix.
function setSpot(win, doc, panel, prefix, side, yardline) {
  const btn = panel.querySelector('.' + prefix + '_side[data-side="' + side + '"]');
  if (!btn) throw new Error('no spot widget "' + prefix + '" in this panel');
  click(win, btn);
  typeInto(win, doc.getElementById(prefix + '_yardline'), yardline);
}

const CASES = [
  ['rush fumble lost', 'own 41', (h, win, doc) => {
    setDrive(h, { down: 2, distance: 6, side: 'own', yardline: 34 });
    click(win, doc.querySelector('.ptypeBtn[data-type="rush"]'));
    const p = doc.getElementById('playPanel');
    typeInto(win, doc.getElementById('pp_carrier_manual'), '22');
    typeInto(win, doc.getElementById('pp_yards'), '5');
    click(win, doc.getElementById('pp_rush_fumbled_toggle'));
    setSpot(win, doc, p, 'pp_rushfum_spot', 'own', '41');
  }],
  ['pass fumble lost', 'own 41', (h, win, doc) => {
    setDrive(h, { down: 2, distance: 6, side: 'own', yardline: 34 });
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    const p = doc.getElementById('playPanel');
    typeInto(win, doc.getElementById('pp_passer_manual'), '7');
    typeInto(win, doc.getElementById('pp_receiver_manual'), '80');
    typeInto(win, doc.getElementById('pp_yards'), '5');
    click(win, doc.getElementById('pp_pass_fumbled_toggle'));
    setSpot(win, doc, p, 'pp_passfum_spot', 'own', '41');
  }],
  ['sack fumble lost', 'own 23', (h, win, doc) => {
    setDrive(h, { down: 2, distance: 8, side: 'own', yardline: 30 });
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    const p = doc.getElementById('playPanel');
    click(win, [...p.querySelectorAll('.pp-outcome-switch')].find(x => x.textContent.trim() === 'Sacked'));
    typeInto(win, doc.getElementById('pp_passer_manual'), '7');
    typeInto(win, doc.getElementById('pp_yards'), '7');
    click(win, doc.getElementById('pp_sack_fumbled_toggle'));
    setSpot(win, doc, p, 'pp_sackfum_spot', 'own', '23');
  }],
  ['interception', 'own 44', (h, win, doc) => {
    setDrive(h, { down: 2, distance: 6, side: 'own', yardline: 30 });
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    const p = doc.getElementById('playPanel');
    click(win, [...p.querySelectorAll('.pp-outcome-switch')].find(x => x.textContent.trim() === 'Intercepted'));
    typeInto(win, doc.getElementById('pp_passer_manual'), '7');
    setSpot(win, doc, p, 'pp_spot', 'own', '44');
  }],
  ['fumble play type, lost', 'own 38', (h, win, doc) => {
    setDrive(h, { down: 2, distance: 6, side: 'own', yardline: 30 });
    click(win, doc.querySelector('.ptypeBtn[data-type="fumble"]'));
    const p = doc.getElementById('playPanel');
    typeInto(win, doc.getElementById('pp_carrier_manual'), '22');
    setSpot(win, doc, p, 'pp_spot', 'own', '38');
  }],
  ['punt', 'own 30', (h, win, doc) => {
    setDrive(h, { down: 4, distance: 9, side: 'own', yardline: 30 });
    click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
    const p = doc.getElementById('playPanel');
    click(win, p.querySelector('.pp_punter_pick[data-num="15"]'));
    typeInto(win, doc.getElementById('pp_yards'), '40');
    setSpot(win, doc, p, 'pp_spot', 'own', '30');
  }],
  ['punt muff, kicking recovers', 'opp 35', (h, win, doc) => {
    setDrive(h, { down: 4, distance: 9, side: 'own', yardline: 30 });
    click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
    const p = doc.getElementById('playPanel');
    click(win, p.querySelector('.pp_punter_pick[data-num="15"]'));
    typeInto(win, doc.getElementById('pp_yards'), '35');
    click(win, doc.getElementById('pp_muffed_toggle'));
    setSpot(win, doc, p, 'pp_muffspot', 'opp', '35');
  }],
  ['kickoff muff, kicking recovers', 'own 42', (h, win, doc) => {
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 35 });
    click(win, doc.querySelector('.ptypeBtn[data-type="kickoff"]'));
    const p = doc.getElementById('playPanel');
    click(win, p.querySelector('.pp_kicker_pick[data-num="3"]'));
    click(win, doc.getElementById('pp_ko_muffed_toggle'));
    setSpot(win, doc, p, 'pp_komuffspot', 'own', '42');
  }],
  ['missed field goal', 'own 20', (h, win, doc) => {
    setDrive(h, { down: 4, distance: 8, side: 'opp', yardline: 25 });
    click(win, doc.querySelector('.ptypeBtn[data-type="fg"]'));
    const p = doc.getElementById('playPanel');
    click(win, p.querySelector('.pp_kicker_pick[data-num="3"]'));
    typeInto(win, doc.getElementById('pp_yards'), '42');
    const r = p.querySelector('input[name=pp_fgres][value="x"]');
    r.checked = true;
    r.dispatchEvent(new win.Event('change', { bubbles: true }));
  }],
  ['bad snap, defense recovers', 'own 28', (h, win, doc) => {
    setDrive(h, { down: 2, distance: 7, side: 'own', yardline: 35 });
    click(win, doc.getElementById('badSnapUtilBtn'));
    const p = doc.getElementById('playPanel');
    typeInto(win, doc.getElementById('badsnap_yds'), '11');
    const r = p.querySelector('input[name=bs_rec][value="d"]');
    r.checked = true;
    r.dispatchEvent(new win.Event('change', { bubbles: true }));
    setSpot(win, doc, p, 'bs_spot', 'own', '28');
  }]
];

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  for (const [label, expectedSpot, build] of CASES) {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    try {
      build(h, win, doc);
    } catch (e) {
      fail(label, 'could not reach the spot field: ' + e.message);
      h.close();
      continue;
    }
    const reviewBtn = doc.getElementById('pp_review') || doc.getElementById('badsnap_review');
    click(win, reviewBtn);
    const clockRow = doc.getElementById('confirmClockRow');
    if (clockRow && clockRow.style.display !== 'none') {
      typeInto(win, doc.getElementById('confirmClockInput'), '7:00');
    }
    const flip = doc.getElementById('flipCheck');
    if (flip && !flip.checked) click(win, flip);
    click(win, doc.getElementById('saveBtn'));

    const tail = JSON.parse(h.evalIn('JSON.stringify(plays.slice(-3).map(p => p.text))')).join(' | ');
    const banner = doc.getElementById('downText').textContent;
    if (!/New drive|New series/.test(tail)) {
      fail(label, 'no takeover spot recorded — banner reads "' + banner + '"');
    } else if (banner.indexOf(expectedSpot) === -1) {
      fail(label, 'expected the ball at ' + expectedSpot + ', banner reads "' + banner + '"');
    }
    h.close();
  }
  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Takeover spot checks ===\n');
    console.log('Cases: ' + CASES.length + '   Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) console.log('  every change of possession records where the ball was taken over.');
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
