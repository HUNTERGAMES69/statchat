// Shared jersey number checks
// ---------------------------
// Two players wearing the same number is a fact about the team, not a
// data problem. Before Aug 7, 2026 it was treated as one in two places
// at once, and the two failures compounded:
//
//   1. `create_game.html` detected the collision at import and made the
//      coach PICK ONE. Only that player was written to game_rosters, so
//      the other simply did not exist for the whole game.
//   2. `game.html` built its roster maps keyed by jersey number, so even
//      if both rows had been saved the second would have overwritten the
//      first. The pickers had always READ `ambiguousOffense` and offered
//      a choice, but nothing ever WROTE it -- the mechanism was dead
//      code that had presumably never fired.
//
// Both are fixed: setup keeps every player, and the game page records
// the collision and offers each of them with a "?" so the coach picks
// per play. These assertions cover both halves.

const { bootGamePage, bootPage, defaultRoster } = require('./harness');
const { setDrive, click, typeInto } = require('./ui_driver');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');

// Pull the two pure functions out of create_game.html and exercise them
// directly -- the page needs a live Supabase session to boot, and these
// are the only parts that matter here.
function loadSetupFns() {
  const src = fs.readFileSync(path.join(REPO, 'create_game.html'), 'utf8');
  const code = (src.match(/<script>([\s\S]*?)<\/script>/g) || []).join('\n').replace(/<\/?script>/g, '');
  const posToUnit = p => {
    p = (p || '').toUpperCase();
    if (/QB|RB|WR|TE|OL|C|G|T|FB|HB/.test(p)) return 'offense';
    if (/DB|LB|DL|DE|CB|S|NT/.test(p)) return 'defense';
    if (/^K$|^P$|KR|PR|LS/.test(p)) return 'special';
    return null;
  };
  const resolveByNumber = new Function('posToUnit',
    code.match(/function resolveByNumber[\s\S]*?\n  }/)[0] + '\nreturn resolveByNumber;')(posToUnit);
  const buildGameRosterRows = new Function(
    code.match(/function buildGameRosterRows[\s\S]*?\n  }/)[0] + '\nreturn buildGameRosterRows;')();
  return { resolveByNumber, buildGameRosterRows };
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- setup: a shared number must not force a choice -----------------
  {
    const { resolveByNumber, buildGameRosterRows } = loadSetupFns();
    const { resolved, conflicts } = resolveByNumber([
      { number: '5', name: 'Reddick', position: 'RB' },
      { number: '5', name: 'Powell',  position: 'WR' },
      { number: '5', name: 'Stone',   position: 'DB' },   // different unit, no clash
      { number: '7', name: 'Solo',    position: 'QB' }
    ]);

    if (conflicts.length) {
      fail('setup', 'a shared number should no longer be raised as a conflict, got ' +
           conflicts.length);
    }
    const offNames = (resolved['5'].offense || []).map(e => e.name);
    if (offNames.length !== 2 || offNames.indexOf('Powell') === -1) {
      fail('setup', '#5 should keep BOTH offensive players, kept: ' + offNames.join(','));
    }

    const rows = buildGameRosterRows(resolved, 'teamB');
    const five = rows.filter(r => r.jersey_number === '5');
    if (five.length !== 3) {
      fail('setup', 'expected 3 rows for #5 (two offense, one defense), got ' + five.length);
    }
    // A number with no collision must still produce exactly one row.
    if (rows.filter(r => r.jersey_number === '7').length !== 1) {
      fail('setup', 'an unshared number should produce exactly one row');
    }
  }

  // --- game page: both offered, and the choice sticks to the play -----
  {
    const roster = defaultRoster().concat([
      { team_side: 'teamA', unit: 'offense', jersey_number: '5', player_name: 'Reddick', position: 'RB' },
      { team_side: 'teamA', unit: 'offense', jersey_number: '5', player_name: 'Powell',  position: 'WR' }
    ]);
    const h = await bootGamePage({ roster });
    const { window: win, document: doc } = h;

    const amb = JSON.parse(h.evalIn('JSON.stringify(TEAMS.teamA.ambiguousOffense)'));
    if (!amb['5'] || amb['5'].length !== 2) {
      fail('game page', 'the shared number was not recorded as ambiguous: ' + JSON.stringify(amb));
    }

    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 30 });
    click(win, doc.querySelector('.ptypeBtn[data-type="rush"]'));
    const fives = [...doc.querySelectorAll('.pp_carrier_pick')]
      .filter(b => /#5\s/.test(b.textContent));

    if (fives.length !== 2) {
      fail('game page', 'expected two #5 buttons, got ' + fives.length + ': ' +
           fives.map(b => b.textContent.trim()).join(' , '));
    }
    // Exactly two, and no bare third: a plain "#5 Reddick" alongside them
    // would silently mean whichever roster row loaded second.
    if (fives.some(b => !/\?/.test(b.textContent))) {
      fail('game page', 'a shared number must not also appear as a single resolved button');
    }

    const powell = fives.find(b => /Powell/.test(b.textContent));
    if (!powell) {
      fail('game page', 'Powell is not offered');
    } else {
      click(win, powell);
      const yards = doc.getElementById('pp_yards');
      yards.value = '7';
      yards.dispatchEvent(new win.Event('input', { bubbles: true }));
      click(win, doc.getElementById('pp_review'));
      const text = doc.getElementById('parsedText').textContent;
      if (text.indexOf('Powell') === -1) {
        fail('game page', 'picking Powell logged someone else: "' + text + '"');
      }
    }
    h.close();
  }

  // --- a number that is NOT shared must not be disturbed --------------
  {
    const h = await bootGamePage();
    const amb = JSON.parse(h.evalIn('JSON.stringify(TEAMS.teamA.ambiguousOffense)'));
    if (Object.keys(amb).length) {
      fail('game page', 'an ordinary roster should raise no ambiguity, got ' + JSON.stringify(amb));
    }
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 30 });
    click(h.window, h.document.querySelector('.ptypeBtn[data-type="rush"]'));
    const marked = [...h.document.querySelectorAll('.pp_carrier_pick')]
      .filter(b => /\?/.test(b.textContent));
    if (marked.length) {
      fail('game page', 'no player should be marked ambiguous on a clean roster');
    }
    h.close();
  }

  // --- the stats must follow the PLAYER, not the number ---------------
  // The bug that surfaced this: the log read "Dalen Powell rush for 3"
  // while the rushing tile credited Jayden Reddick. The play stored only
  // the number, so the box score resolved it back through the roster map
  // -- which holds one name per number -- and picked whichever row
  // loaded last. Worse than a display slip: both players' lines merged
  // into one row.
  {
    const roster = defaultRoster().concat([
      { team_side: 'teamA', unit: 'offense', jersey_number: '5', player_name: 'Reddick', position: 'RB' },
      { team_side: 'teamA', unit: 'offense', jersey_number: '5', player_name: 'Powell',  position: 'WR' }
    ]);
    const h = await bootGamePage({ roster });
    const { window: win, document: doc } = h;

    const rushAs = (who, yds) => {
      setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 20 });
      click(win, doc.querySelector('.ptypeBtn[data-type="rush"]'));
      const btn = [...doc.querySelectorAll('.pp_carrier_pick')]
        .find(x => new RegExp(who).test(x.textContent));
      click(win, btn);
      const y = doc.getElementById('pp_yards');
      y.value = yds;
      y.dispatchEvent(new win.Event('input', { bubbles: true }));
      click(win, doc.getElementById('pp_review'));
      click(win, doc.getElementById('saveBtn'));
    };
    rushAs('Powell', '3');
    rushAs('Reddick', '8');
    rushAs('Powell', '5');

    const rows = h.db.plays.map((r, i) =>
      Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    for (const page of ['view.html', 'recap.html', 'stat_package.html']) {
      const v = await bootPage(page, { existingPlays: rows });
      const rushing = JSON.parse(v.evalIn('JSON.stringify(computeBoxScore(plays).teamA.rushing)'));
      const keys = Object.keys(rushing);
      if (keys.length !== 2) {
        fail(page, 'two players on #5 should keep two rushing lines, got ' +
             keys.length + ': ' + keys.join(' , '));
      }
      const powell = keys.find(k => /Powell/.test(k));
      const reddick = keys.find(k => /Reddick/.test(k));
      if (!powell || !reddick) {
        fail(page, 'expected a line each for Powell and Reddick, got ' + keys.join(' , '));
      } else {
        if (rushing[powell].att !== 2 || rushing[powell].yds !== 8) {
          fail(page, 'Powell should be 2 for 8, got ' + JSON.stringify(rushing[powell]));
        }
        if (rushing[reddick].att !== 1 || rushing[reddick].yds !== 8) {
          fail(page, 'Reddick should be 1 for 8, got ' + JSON.stringify(rushing[reddick]));
        }
      }
      v.close();
    }

    // ...and the rendered table must name them, not show "#5" twice.
    const v = await bootPage('view.html', { existingPlays: rows });
    const shown = [...v.document.querySelectorAll('td')].map(e => e.textContent.trim());
    if (!shown.some(t => /Powell/.test(t)) || !shown.some(t => /Reddick/.test(t))) {
      fail('view.html', 'both names should appear in the rushing tile');
    }
    v.close();
  }

  // --- a shared number does NOT escape the position filter ------------
  // Injecting every ambiguous entry into every picker turned the pass
  // panel into a wall of question marks: two linemen in the passer list,
  // three defenders pre-populating "Tackled by" on zero credits. A
  // shared number is a disambiguation problem, not a licence to ignore
  // what position someone plays.
  {
    const roster = defaultRoster().filter(r => r.team_side === 'teamA').concat([
      { team_side: 'teamB', unit: 'offense', jersey_number: '5',  player_name: 'Powell',   position: 'WR' },
      { team_side: 'teamB', unit: 'offense', jersey_number: '5',  player_name: 'Reddick',  position: 'RB' },
      { team_side: 'teamB', unit: 'offense', jersey_number: '70', player_name: 'Rochelle', position: 'OL' },
      { team_side: 'teamB', unit: 'offense', jersey_number: '70', player_name: 'Millican', position: 'OL' },
      { team_side: 'teamB', unit: 'offense', jersey_number: '7',  player_name: 'Hartwell', position: 'QB' },
      { team_side: 'teamB', unit: 'defense', jersey_number: '3',  player_name: 'Brice',    position: 'LB' },
      { team_side: 'teamB', unit: 'defense', jersey_number: '3',  player_name: 'Jones',    position: 'DB' }
    ]);
    const h = await bootGamePage({ roster });
    const { window: win, document: doc } = h;
    h.evalIn('pushAndPersist({id:nextId++,text:"flip",effect:{forcePossession:"teamB"},quarter:1}); renderAll();');
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 30 });
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));

    const texts = sel => [...doc.querySelectorAll(sel)].map(b => b.textContent);
    const passers = texts('.pp_passer_pick');
    if (passers.some(t => /Rochelle|Millican/.test(t))) {
      fail('position filter', 'linemen appeared in the passer picker: ' + passers.join(' , '));
    }
    if (!passers.some(t => /Hartwell/.test(t))) {
      fail('position filter', 'the quarterback is missing from the passer picker');
    }
    // The receiving pair still has to be offered -- both play skill
    // positions, so both are legitimate answers.
    const receivers = texts('.pp_receiver_pick');
    if (!receivers.some(t => /Powell/.test(t)) || !receivers.some(t => /Reddick/.test(t))) {
      fail('position filter', 'both #5s should still be offered as receivers');
    }
    if (receivers.some(t => /Rochelle|Millican/.test(t))) {
      fail('position filter', 'linemen appeared in the receiver picker');
    }
    // Defence never pre-populates: it builds from actual credits.
    const tacklers = texts('.pp_credit_pick');
    if (tacklers.length) {
      fail('position filter', '"Tackled by" should start empty, offers: ' + tacklers.join(' , '));
    }
    h.close();
  }

  // --- THE CHOICE MUST SURVIVE A RELOAD ---------------------------------
  // Added 13 Aug 2026. Picking the right player made the LOG TEXT right
  // and nothing else: the saved play carried the jersey number alone, so
  // every later reader resolved it back through the roster map -- which
  // holds one name per number and keeps whichever row loaded last. The
  // log said one man, the box score said the other, and only after a
  // reload, so it was invisible during the game that produced it.
  //
  // Both entry routes are covered, because they were separately broken:
  // tapping the grid recorded the name, TYPING the number did not. And
  // both sides of the ball, because the carrier and the tackler are built
  // in different places and were fixed hours apart.
  //
  // Asserting after bootPage('view.html', ...) is the point of the test.
  // Checking the live page proves nothing: the temporary roster override
  // is still in memory there, so the wrong-man bug reads as correct right
  // up until the page is reloaded.
  {
    const roster = defaultRoster().filter(r => r.team_side === 'teamA').concat([
      { team_side: 'teamA', unit: 'offense', jersey_number: '7',  player_name: 'Alpha Ates',  position: 'RB' },
      { team_side: 'teamA', unit: 'offense', jersey_number: '7',  player_name: 'Bravo Boone', position: 'RB' },
      { team_side: 'teamB', unit: 'defense', jersey_number: '55', player_name: 'Dane Dorsey', position: 'LB' },
      { team_side: 'teamB', unit: 'defense', jersey_number: '55', player_name: 'Earl Eady',   position: 'LB' }
    ]);
    const h = await bootGamePage({ roster });
    const { window: win, document: doc } = h;

    // Whoever the roster map resolves to by default is the man we must
    // NOT end up crediting -- picking the default would pass either way.
    const defaultCarrier = h.evalIn('TEAMS.teamA.rosterOffense["7"]');
    const defaultTackler = h.evalIn('TEAMS.teamB.rosterDefense["55"]');

    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    click(win, doc.querySelector('.ptypeBtn[data-type="rush"]'));
    typeInto(win, doc.getElementById('pp_carrier_manual'), '7');
    const carrierAlts = [...doc.querySelectorAll('.nameConfirmAlt')];
    if (!carrierAlts.length) {
      // The roster maps hold one name per number, so before 13 Aug the
      // second same-unit player was not offered at all and was reachable
      // only by tapping the grid.
      fail('shared number', 'typing #7 offered no alternative — the other #7 is unreachable by hand');
    } else {
      click(win, carrierAlts[0]);
    }
    typeInto(win, doc.getElementById('pp_yards'), '4');
    typeInto(win, doc.getElementById('pp_credit_manual'), '55');
    const tacklerAlts = [...doc.querySelectorAll('.nameConfirmAlt')];
    if (!tacklerAlts.length) {
      fail('shared number', 'typing tackler #55 offered no alternative');
    } else {
      click(win, tacklerAlts[0]);
    }
    click(win, doc.getElementById('pp_review'));
    click(win, doc.getElementById('saveBtn'));

    const saved = h.db.plays[h.db.plays.length - 1];
    const wantCarrier = saved && saved.roles && saved.roles.carrier && saved.roles.carrier.name;
    const wantTackler = saved && saved.roles && saved.roles.defense && saved.roles.defense.name;
    if (!wantCarrier) {
      fail('shared number', 'the saved play records no carrier NAME, only #' +
           (saved && saved.roles && saved.roles.carrier && saved.roles.carrier.num) +
           ' — the disambiguation was thrown away');
    }
    if (!wantTackler) {
      fail('shared number', 'the saved play records no tackler NAME, only #' +
           (saved && saved.roles && saved.roles.defense && saved.roles.defense.num));
    }
    if (wantCarrier && wantCarrier === defaultCarrier) {
      fail('shared number', 'test is not proving anything: it picked the roster default (' +
           defaultCarrier + '), which would pass even unfixed');
    }

    const plays = h.db.plays.map((p, i) =>
      Object.assign({}, p, { sequence_number: p.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: plays, roster });
    await new Promise(r => setTimeout(r, 250));
    const box = JSON.parse(v.evalIn('JSON.stringify(computeBoxScore(plays))'));
    const rushNames = Object.keys((box.teamA || {}).rushing || {}).filter(n => n !== 'TEAM');
    const tackNames = Object.keys((box.teamB || {}).defense || {});
    if (wantCarrier && rushNames.indexOf(wantCarrier) === -1) {
      fail('shared number', 'after a reload the carry is credited to ' +
           (rushNames.join(', ') || 'nobody') + ', not to ' + wantCarrier +
           ' — the box score fell back to the roster map');
    }
    if (wantTackler && tackNames.indexOf(wantTackler) === -1) {
      fail('shared number', 'after a reload the tackle is credited to ' +
           (tackNames.join(', ') || 'nobody') + ', not to ' + wantTackler);
    }
    v.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Shared jersey number checks ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) console.log('  both players kept at setup, both offered in game, choice sticks.');
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
