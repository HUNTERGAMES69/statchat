// NOTE (Aug 7, 2026): box-score buckets are keyed by DISPLAY NAME, not by
// jersey number. Numbers are not identity -- two players can wear one, and
// keying on the number merged their lines. Lookups here use names.
// Optional-player checks (Aug 6, 2026 session)
// --------------------------------------------
// A coach frequently cannot read the jersey number on a return, an
// interception or the bottom of a fumble pile. Every one of these fields
// is now optional. Two distinct failure modes were fixed:
//
//  * Kickoff and punt returners were already skippable, but the return
//    YARDAGE was silently discarded along with the unknown returner --
//    the coach typed 20 and got a play recorded as no return at all.
//  * The interceptor, the fumble recoverer (standalone and in the
//    rush/pass/sack sub-flows), the blocked-punt recoverer and the
//    guided-kickoff returner all HARD-BLOCKED the Review button with no
//    message, so the play simply could not be entered.
//
// The critical invariant when nobody is named: the play and its yardage
// still record, the turnover still counts, and NO phantom player appears
// in the box score or in any future picker.

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

  const h = await bootGamePage();
  const { window: win, document: doc } = h;

  const attempt = (label, build, expect) => {
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 40 });
    build();
    click(win, doc.getElementById('pp_review'));
    const cc = doc.getElementById('confirmCard');
    if (!cc || cc.style.display === 'none') {
      fail(label, 'Review was blocked -- the player must be optional');
      return;
    }
    const text = doc.getElementById('parsedText').textContent;
    click(win, doc.getElementById('saveBtn'));
    (expect || []).forEach(sub => {
      if (!text.includes(sub)) fail(label, 'log line missing "' + sub + '": ' + text);
    });
  };

  const open = t => click(win, doc.querySelector('.ptypeBtn[data-type="' + t + '"]'));
  const passSwitch = label => {
    open('pass');
    const p = doc.getElementById('playPanel');
    click(win, [...p.querySelectorAll('.pp-outcome-switch')]
      .find(x => x.textContent.trim() === label));
  };

  // --- kick / punt returns -------------------------------------------
  attempt('kickoff, no returner', () => {
    open('kickoff');
    const p = doc.getElementById('playPanel');
    click(win, p.querySelector('.pp_kicker_pick[data-num="3"]'));
    typeInto(win, doc.getElementById('pp_retyds'), '20');
  }, ['kicks off', 'returned for 20']);

  attempt('punt, no returner', () => {
    open('punt');
    const p = doc.getElementById('playPanel');
    click(win, p.querySelector('.pp_punter_pick[data-num="15"]'));
    typeInto(win, doc.getElementById('pp_yards'), '40');
    typeInto(win, doc.getElementById('pp_retyds'), '12');
  }, ['punts 40', 'returned for 12']);

  attempt('blocked punt, no recoverer', () => {
    open('punt');
    const p = doc.getElementById('playPanel');
    click(win, p.querySelector('.pp_punter_pick[data-num="15"]'));
    click(win, doc.getElementById('pp_blocked_toggle'));
    typeInto(win, doc.getElementById('pp_blockretyds'), '8');
  }, ['punt BLOCKED', 'returned 8']);

  // --- turnovers ------------------------------------------------------
  attempt('interception, no interceptor', () => {
    passSwitch('Intercepted');
    typeInto(win, doc.getElementById('pp_passer_manual'), '7');
    typeInto(win, doc.getElementById('pp_yards'), '15');
  }, ['intercepted', 'returned 15']);

  attempt('standalone fumble, no recoverer', () => {
    open('fumble');
    typeInto(win, doc.getElementById('pp_carrier_manual'), '22');
    const r = doc.querySelector('input[name=pp_fumrec][value=opp]');
    r.checked = true; click(win, r);
    typeInto(win, doc.getElementById('pp_yards'), '10');
  }, ['fumble', 'recovered by the defense']);

  attempt('rush + fumble lost, no recoverer', () => {
    open('rush');
    typeInto(win, doc.getElementById('pp_carrier_manual'), '22');
    typeInto(win, doc.getElementById('pp_yards'), '4');
    click(win, doc.getElementById('pp_rush_fumbled_toggle'));
    const r = doc.querySelector('input[name=pp_rush_fumrec][value=opp]');
    r.checked = true; click(win, r);
  }, ['recovered by the defense']);

  // The kicker and punter themselves are NOT optional.
  for (const [label, type] of [['kickoff', 'kickoff'], ['punt', 'punt']]) {
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 40 });
    open(type);
    // Kickoffs no longer have a distance field; punts still do.
    const yf = doc.getElementById('pp_yards');
    if (yf) typeInto(win, yf, '40');
    click(win, doc.getElementById('pp_review'));
    const cc = doc.getElementById('confirmCard');
    if (cc && cc.style.display !== 'none') {
      fail(label, 'the kicker/punter must still be required');
      click(win, doc.getElementById('saveBtn'));
    }
  }

  const rows = rowsOf(h);
  h.close();

  // --- no phantom players, and turnovers still count ------------------
  const v = await bootPage('view.html', { existingPlays: rows });
  const box = JSON.parse(v.evalIn('JSON.stringify(computeBoxScore(plays))'));
  for (const team of ['teamA', 'teamB']) {
    const d = box[team].defense || {};
    // TEAM is legitimate: an unnamed sack, interception or lost fumble
    // is credited to the team so the event is not lost entirely. What
    // must never appear is a JERSEY NUMBER nobody actually entered.
    const phantom = Object.keys(d).filter(k => k !== 'TEAM');
    if (phantom.length) {
      fail('phantom player', team + ' has per-player defensive stats though nobody was named: ' +
           JSON.stringify(phantom));
    }
  }
  // Two lost fumbles and one interception were entered, all unnamed.
  // roles.lost is what keeps an unnamed fumble counting as a turnover;
  // without it these silently drop to zero.
  const to = JSON.parse(v.evalIn('JSON.stringify(countTurnovers(plays))'));
  const total = (to.teamA || 0) + (to.teamB || 0);
  if (total !== 3) {
    fail('turnovers', 'expected 3 turnovers (1 int + 2 lost fumbles) with nobody named, got ' +
         total + ' ' + JSON.stringify(to));
  }
  v.close();

  // --- named players must still be credited ---------------------------
  {
    const g = await bootGamePage();
    setDrive(g, { down: 1, distance: 10, side: 'own', yardline: 40 });
    enterPlay(g, { type: 'int', passer: '7', credit: '21', yards: '15' });
    setDrive(g, { down: 1, distance: 10, side: 'own', yardline: 40 });
    enterPlay(g, { type: 'fumble', carrier: '22', credit: '99', yards: '5' });
    const r2 = rowsOf(g);
    g.close();
    const v2 = await bootPage('view.html', { existingPlays: r2 });
    const b2 = JSON.parse(v2.evalIn('JSON.stringify(computeBoxScore(plays))'));
    // Buckets are keyed by the DISPLAY name playerName() produces, which
    // is the bare roster name -- nameInDefense() appends the team and so
    // would not match.
    const INT_NAME = v2.evalIn('playerName("teamB", "21", "defense")');
    const FUM_NAME = v2.evalIn('playerName("teamA", "99", "defense")');
    if (!(b2.teamB.defense && b2.teamB.defense[INT_NAME] && b2.teamB.defense[INT_NAME].int === 1)) {
      fail('named credit', 'a named interceptor lost their INT: ' + JSON.stringify(b2.teamB.defense));
    }
    if (!(b2.teamA.defense && b2.teamA.defense[FUM_NAME] && b2.teamA.defense[FUM_NAME].fumRec === 1)) {
      fail('named credit', 'a named recoverer lost their fumble recovery: ' +
           JSON.stringify(b2.teamA.defense));
    }
    v2.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Optional-player checks ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) console.log('  returners/interceptors/recoverers optional; yardage and turnovers still counted.');
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
