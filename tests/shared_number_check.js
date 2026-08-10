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

const { bootGamePage, defaultRoster } = require('./harness');
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
