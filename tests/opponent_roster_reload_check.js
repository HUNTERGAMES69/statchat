// Opponent roster reload on edit
// ---------------------------------
// Reported directly, with a screenshot: a coach uploaded an opponent
// roster, named five likely starters, and the picker correctly matched
// all five (green checkmarks, real names). Reopening the SAME game's
// setup later showed every one of those five as "not on the roster
// loaded here" -- even though "Currently saved: 5 opponent player(s)"
// was printed on the very same screen, from the very same saved data.
// This did not happen for the coach's own team.
//
// The asymmetry: "our" team's roster is reloaded fresh from the
// `players` table every time this page opens, because that table
// exists independently of any one game. The opponent roster has no
// such table -- game_rosters IS the only record of it for a given game
// -- and the block that used to run here only ever fetched a COUNT
// (`select id`), never the actual jersey numbers and names oppResolved
// needs to match a seeded starter against. So oppResolved stayed at
// its initial {} on every reopen, and every seeded number came up
// empty, regardless of whether the roster was still saved.
//
// Fixed by giving the opponent side the same real reload "our" team's
// own saved-conflict-override logic already gets a few lines below:
// read the full saved game_rosters rows and feed them through
// resolveByNumber, with explicitUnit set from what was actually saved
// so nothing has to re-guess a unit from a position that may never
// have existed.

const { bootPage } = require('./harness');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1. The exact reported scenario: five seeded starters, a saved
  // opponent roster, reopened for editing.
  {
    const opts = {
      query: '?edit=test-game-1',
      game: { seed_starters: { teamA: {}, teamB: { QB: '7', RB1: '6', RB2: '14', WR1: '1', WR2: '4' } } },
      roster: [
        { team_side: 'teamB', jersey_number: '7', player_name: 'O Quarterback', unit: 'offense', position: 'QB' },
        { team_side: 'teamB', jersey_number: '6', player_name: 'O Runningback', unit: 'offense', position: 'RB' },
        { team_side: 'teamB', jersey_number: '14', player_name: 'O Halfback', unit: 'offense', position: 'RB' },
        { team_side: 'teamB', jersey_number: '1', player_name: 'O Receiver', unit: 'offense', position: 'WR' },
        { team_side: 'teamB', jersey_number: '4', player_name: 'O Receiver Two', unit: 'offense', position: 'WR' }
      ]
    };
    const w = await bootPage('create_game.html', opts);
    const html = w.document.getElementById('oppStarterResolve').innerHTML;
    ['O Quarterback', 'O Runningback', 'O Halfback', 'O Receiver', 'O Receiver Two'].forEach(name => {
      if (!html.includes(name)) fail('reported-scenario', 'expected ' + name + ' to be matched, got: ' + html);
    });
    if (html.includes('not on the roster loaded here')) {
      fail('reported-scenario', 'at least one seeded starter still reads as unmatched: ' + html);
    }
    // Untouched, so save-time logic leaves the existing roster alone --
    // this reload must not look like a coach editing the roster.
    if (w.evalIn('oppRosterTouched') !== false) {
      fail('reported-scenario-touched', 'oppRosterTouched should stay false after a reload, not a real edit');
    }
    w.close();
  }

  // --- 2. No opponent roster saved at all -- must not crash, and must
  // say so plainly rather than silently showing nothing.
  {
    const w = await bootPage('create_game.html', { query: '?edit=test-game-1', roster: [] });
    const note = w.document.getElementById('currentOppRosterNote').textContent;
    if (!/No opponent roster currently saved/.test(note)) {
      fail('no-roster', 'expected the "no roster saved" message, got: ' + note);
    }
    w.close();
  }

  // --- 3. The player count in "Currently saved: N opponent player(s)"
  // still reflects the real saved roster, not just whether it's empty.
  {
    const opts = {
      query: '?edit=test-game-1',
      roster: [
        { team_side: 'teamB', jersey_number: '7', player_name: 'O Quarterback', unit: 'offense', position: 'QB' },
        { team_side: 'teamB', jersey_number: '55', player_name: 'O Linebacker', unit: 'defense', position: 'LB' }
      ]
    };
    const w = await bootPage('create_game.html', opts);
    const note = w.document.getElementById('currentOppRosterNote').textContent;
    if (!/Currently saved: 2 opponent player/.test(note)) {
      fail('saved-count', 'expected "Currently saved: 2 opponent player(s)", got: ' + note);
    }
    w.close();
  }

  // --- 4. A NEW game (no editGameId at all) is unaffected -- oppResolved
  // starts empty, as it always did, since nothing has been saved yet.
  {
    const w = await bootPage('create_game.html', { query: '?nothing=1' });
    const keys = JSON.parse(w.evalIn('JSON.stringify(Object.keys(oppResolved))'));
    if (keys.length !== 0) {
      fail('new-game', 'a brand-new game should start with an empty oppResolved, got keys: ' + keys.join(','));
    }
    w.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Opponent roster reload on edit ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  a saved opponent roster and its seeded starters are both recognized again on reopening an existing game, without touching the save-time "roster untouched" logic.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
