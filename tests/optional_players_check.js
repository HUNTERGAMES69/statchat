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

const { bootGamePage, bootPage, defaultRoster } = require('./harness');
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
  // The ensuing spot became REQUIRED on kickoffs and punts on 13 Aug 2026.
  // It is not a PLAYER, so it does not belong to what this suite is
  // testing -- but without it Review is refused and the failure reads as
  // "the returner was not optional", which is the wrong diagnosis
  // entirely. Filled on every kick case so the only thing left out is the
  // player.
  const fillSpot = (yardline) => {
    const p = doc.getElementById('playPanel');
    const side = p.querySelector('.pp_spot_side[data-side="own"]');
    if (side) click(win, side);
    const yl = doc.getElementById('pp_spot_yardline');
    if (yl) typeInto(win, yl, String(yardline));
  };
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
    fillSpot(25);
  }, ['kicks off', 'returned for 20']);

  attempt('punt, no returner', () => {
    open('punt');
    const p = doc.getElementById('playPanel');
    click(win, p.querySelector('.pp_punter_pick[data-num="15"]'));
    typeInto(win, doc.getElementById('pp_yards'), '40');
    typeInto(win, doc.getElementById('pp_retyds'), '12');
    fillSpot(30);
  }, ['punts 40', 'returned for 12']);

  attempt('blocked punt, no recoverer', () => {
    open('punt');
    const p = doc.getElementById('playPanel');
    click(win, p.querySelector('.pp_punter_pick[data-num="15"]'));
    click(win, doc.getElementById('pp_blocked_toggle'));
    typeInto(win, doc.getElementById('pp_blockretyds'), '8');
    fillSpot(35);
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

  // --- NAMING AN UNKNOWN NUMBER DURING THE GAME --------------------------
  // Added 14 Aug 2026. A number that is not on the roster is ordinary --
  // a call-up, an out-of-date programme, an opponent list typed from
  // memory. The play always recorded correctly against the number, but
  // every log line and stat line then read "#77", and a stat sheet full
  // of bare numbers is most of the way to useless.
  //
  // The three things that make it worth having are all asserted here,
  // because any one of them missing would leave a control that LOOKS like
  // it worked: the row reaches game_rosters (so it survives a reload and
  // reaches the view page on another device), later plays use the name,
  // and plays entered BEFORE the naming pick it up too -- those carry no
  // name of their own, so they resolve through the roster at render time.
  {
    const h = await bootGamePage({ roster: defaultRoster() });
    const { window: win, document: doc } = h;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '77', yards: '11' });

    click(win, doc.querySelector('.ptypeBtn[data-type="rush"]'));
    typeInto(win, doc.getElementById('pp_carrier_manual'), '77');
    const input = doc.getElementById('addPlayerName_77');
    const btn = doc.getElementById('addPlayerBtn_77');
    if (!input || !btn){
      fail('name an unknown number', 'typing a number that is not on the roster offers no ' +
           'way to name the player — the whole game then reads "#77"');
      h.close();
      return failures;
    }
    typeInto(win, input, 'Ty Knight');
    click(win, btn);
    await new Promise(r => setTimeout(r, 150));

    const saved = h.db.roster.filter(r => String(r.jersey_number) === '77');
    if (saved.length !== 1 || saved[0].player_name !== 'Ty Knight'){
      fail('name an unknown number', 'the player was not written to game_rosters: ' +
           JSON.stringify(saved) + ' — in memory only, it would not survive a reload and ' +
           'the view page on another device would still show #77');
    }
    if (saved.length && saved[0].team_side !== 'teamA'){
      fail('name an unknown number', 'saved against the wrong team: ' + saved[0].team_side);
    }

    typeInto(win, doc.getElementById('pp_yards'), '6');
    click(win, doc.getElementById('pp_review'));
    click(win, doc.getElementById('saveBtn'));
    const after = h.db.plays[h.db.plays.length - 1];
    if (!/Ty Knight/.test(after.text)){
      fail('name an unknown number', 'the next play still logs the number: ' + after.text);
    }

    // Retrospective: the box score must merge both plays under the name.
    const plays = h.db.plays.map((p, i) =>
      Object.assign({}, p, { sequence_number: p.sequence_number || i + 1 }));
    const roster = h.db.roster.slice();
    h.close();
    const v = await bootPage('view.html', { existingPlays: plays, roster });
    await new Promise(r => setTimeout(r, 250));
    const rush = JSON.parse(v.evalIn('JSON.stringify(computeBoxScore(plays).teamA.rushing)'));
    v.close();
    if (!rush['Ty Knight'] || rush['Ty Knight'].att !== 2){
      fail('name an unknown number', 'the play entered BEFORE the naming did not pick up the ' +
           'name — expected Ty Knight with 2 carries, got ' + JSON.stringify(rush) +
           '. A player named mid-game must not end up as two stat lines');
    }
  }

  // OPTIONAL CREDITS COLLAPSE, and the returner is one of them. A full
  // picker grid plus a manual box, on every punt and every kickoff, for a
  // field whose own label says optional -- it was the largest block on
  // the punt tree's ordinary path.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 4, distance: 8, side: 'own', yardline: 30 });
    click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
    const rb = [...doc.querySelectorAll('#playPanel .opt-block')]
      .find(b => /Returned/.test(b.textContent));
    // NOTE: since 22 Aug this matches the OUTER return group rather than a
    // returner-only block -- the whole group now collapses as one. The
    // assertion still holds: something labelled "Returned" collapses, is
    // closed by default, and opens on a tap.
    const rbBody = rb && rb.querySelector('.opt-body');
    const rbToggle = rb && rb.querySelector('.opt-toggle');
    if (!rb || !rbBody || !rbToggle) {
      // Guarded rather than clicked blind: the driver THROWS on a missing
      // element, which stops the suite and reports nothing useful.
      fail('returner:collapse', 'the optional returner should collapse behind a button');
    } else {
      if (win.getComputedStyle(rbBody).display !== 'none') {
        fail('returner:closed', 'it should start closed');
      }
      click(win, rbToggle);
      if (win.getComputedStyle(rbBody).display === 'none') {
        fail('returner:opens', 'tapping the button should reveal the picker');
      }
    }
    h.close();
  }

  // THE PASSER GRID FOLDS to a chip once a passer is committed, and the
  // chip is a way back INTO the list rather than a way to lose the pick.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    const chip = doc.querySelector('.passer-chip');
    const grid = doc.getElementById('pp_passer_grid');
    const row = grid && (grid.closest('.pick-row') || grid.parentElement);
    if (!chip || !grid) { fail('passer:chip', 'no folded passer control'); h.close(); return failures; }
    // NOT folded on the suggestion -- that is the app's guess, and the
    // grid is how it gets corrected.
    if (win.getComputedStyle(chip).display !== 'none') {
      fail('passer:premature', 'the grid should stay open until a passer is committed');
    }
    click(win, doc.querySelector('.pp_passer_pick'));
    await new Promise(r => setTimeout(r, 60));
    if (win.getComputedStyle(chip).display === 'none' || win.getComputedStyle(row).display !== 'none') {
      fail('passer:fold', 'the grid should fold once a passer is picked');
    }
    click(win, chip);
    if (win.getComputedStyle(row).display === 'none') fail('passer:reopen', 'tapping the chip should bring the grid back');
    if (!grid.querySelector('button.picked')) fail('passer:keeps-pick', 'reopening must not clear the pick');
    h.close();
  }

  // THE WHOLE PUNT RETURN GROUP COLLAPSES, not just the returner picker.
  // "+ Returned by" used to hide only the picker, while return yards, the
  // returned-to calculator and the fumble toggle stayed open whatever
  // happened -- and on a punt that was fair-caught, downed or touchbacked
  // none of them apply, which is most punts.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 4, distance: 8, side: 'own', yardline: 30 });
    click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
    const grp = doc.getElementById('pp_punt_normal');
    if (!grp) { fail('punt:group', 'no return group'); h.close(); return failures; }
    if (!grp.classList.contains('opt-block')) {
      fail('punt:collapsible', 'the return group should collapse as one');
    }
    const body = grp.querySelector('.opt-body');
    if (!body || win.getComputedStyle(body).display !== 'none') {
      fail('punt:closed', 'the return group should start closed');
    }
    // ALL THREE fields live inside it -- a collapse that hides only the
    // picker is the thing this replaced.
    ['pp_ret_yds_wrap2', 'pp_retto_wrap', 'pp_ret_fumbled_toggle'].forEach(id => {
      const el = doc.getElementById(id);
      if (!el) { fail('punt:missing:' + id, id + ' not found'); return; }
      if (!grp.contains(el)) fail('punt:outside:' + id, id + ' should be inside the collapsed group');
    });
    // Opening reveals them together.
    // GUARDED: clicking a missing toggle THROWS in the driver, which stops
    // the suite and reports nothing. A test that crashes is worse than one
    // that fails -- the same fault was found and fixed in
    // entry_integrity_check the same day.
    const toggle = grp.querySelector('.opt-toggle');
    if (!toggle) fail('punt:toggle', 'the return group has no toggle to open it');
    else {
      click(win, toggle);
      await new Promise(r => setTimeout(r, 80));
      if (body && win.getComputedStyle(body).display === 'none') fail('punt:opens', 'the group did not open');
    }

    // THE GREEN HINT BAR IS GONE until it has something to say. The label
    // above now carries the instruction, so a bar repeating it was a
    // second copy of the same sentence taking a row.
    const ro = doc.getElementById('pp_retto_readout');
    if (!toggle) { h.close(); return failures; }
    if (ro && win.getComputedStyle(ro).display !== 'none') {
      fail('punt:hint', 'the readout should stay hidden until a spot is entered: ' + JSON.stringify(ro.textContent));
    }
    // But it must still report once the calculator can compute.
    click(win, doc.querySelector('.calcSide[data-side="opp"]'));
    typeInto(win, doc.getElementById('pp_calc_yardline'), '40');
    await new Promise(r => setTimeout(r, 120));
    click(win, doc.querySelector('.rettoSide[data-side="opp"]'));
    typeInto(win, doc.getElementById('pp_retto_yardline'), '30');
    await new Promise(r => setTimeout(r, 150));
    if (ro && win.getComputedStyle(ro).display === 'none') {
      fail('punt:hint-back', 'the readout should speak once both spots are known');
    }
    h.close();
  }

  // THE KICKOFF RETURN GROUP COLLAPSES TOO, same as the punt tree. The
  // returner, return yards, both calculators and the fumble toggle are
  // one question -- what happened to the return -- and on a touchback,
  // onside kick, muff or kick out of bounds there is no return at all.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    click(win, doc.querySelector('.ptypeBtn[data-type="kickoff"]'));
    const grp = doc.getElementById('pp_ko_return_group');
    if (!grp) { fail('ko:group', 'no kickoff return group'); h.close(); return failures; }
    const body = grp.querySelector('.opt-body'), toggle = grp.querySelector('.opt-toggle');
    if (!body || !toggle) { fail('ko:parts', 'the group needs a toggle and a body'); h.close(); return failures; }
    // CLOSED BY DEFAULT. It auto-opened at first: the seeded test matched
    // any button.picked, and this group holds a spot calculator whose
    // side is pre-selected -- so the collapse never took effect.
    if (win.getComputedStyle(body).display !== 'none') {
      fail('ko:closed', 'the kickoff return group should start closed');
    }
    ['pp_ko_ret_wrap', 'pp_ret_yds_wrap'].forEach(id => {
      const el = doc.getElementById(id);
      if (el && !grp.contains(el)) fail('ko:outside:' + id, id + ' should be inside the group');
    });
    click(win, toggle);
    await new Promise(r => setTimeout(r, 80));
    if (win.getComputedStyle(body).display === 'none') fail('ko:opens', 'the group did not open');

    // A touchback hides the whole group -- refreshKoMode drives the outer
    // wrapper, not the two blocks inside it, or the two would disagree.
    click(win, doc.getElementById('pp_ko_touchback_toggle'));
    await new Promise(r => setTimeout(r, 80));
    if (win.getComputedStyle(grp).display !== 'none') {
      fail('ko:touchback', 'a touchback should hide the return group entirely');
    }
    h.close();
  }

  // AND THE GUIDED KICKOFF IS UNTOUCHED. It builds its own panel and
  // shares none of this markup; Andy asked specifically that it not
  // change.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    click(win, doc.getElementById('startGameBtn'));
    await new Promise(r => setTimeout(r, 80));
    click(win, doc.getElementById('pickA'));
    await new Promise(r => setTimeout(r, 80));
    click(win, doc.querySelector('.gk_kicker_pick'));
    const dir = doc.querySelector('.gk_dir_btn');
    if (dir) click(win, dir);
    click(win, doc.getElementById('guidedKickoffSave'));
    await new Promise(r => setTimeout(r, 250));
    if (doc.querySelectorAll('#guidedPanel .opt-block').length) {
      fail('guided:collapsed', 'the guided kickoff should have no collapsed groups');
    }
    const rg = doc.getElementById('gr_returner_grid');
    if (!rg || win.getComputedStyle(rg).display === 'none') {
      fail('guided:returner', 'the guided returner picker should stay visible');
    }
    h.close();
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
