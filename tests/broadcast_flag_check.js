// ON AIR broadcast flag
// ---------------------
// One flag decides which game vMix is reading. Getting it wrong mid-game
// repoints every graphic, live, and the person who did it may not
// realise — so the protections matter more than the feature.
//
// WHAT IS PROTECTED, and why each one exists:
//
//   * The prompts NAME the game. The whole risk is picking the wrong
//     one, and a generic "are you sure?" does nothing about that.
//   * Taking a game OFF air is harder than putting one on. Off air means
//     the feed falls back to "most recent in-progress", which may be
//     nothing — so the graphics can simply go blank.
//   * A game IN PROGRESS needs more. Before kickoff a mistake is a setup
//     error; during play it is a visible failure. Taking a live game off
//     air requires TYPING "OFF AIR", not clicking.
//   * Exclusivity is enforced in the DATABASE, not here. Two laptops
//     doing "clear all, then set mine" can interleave and leave two
//     games flagged or none. `set_broadcast_game()` does it in one
//     transaction, behind a partial unique index.
//
// The tests below drive the real handler with confirm/prompt stubbed, so
// they assert what a person is actually asked — not what the code
// intends to ask.

const { bootPage, bootGamePage } = require('./harness');
const { click } = require('./ui_driver');

const GAME = { id: 'g1', opponent: 'Ruston', game_date: '2026-08-24',
               season_year: 2026 };

// Boot with confirm and prompt recorded, and answerable per call.
async function boot(gameOpts, answers) {
  const p = await bootPage('dashboard.html', {
    game: Object.assign({}, GAME, gameOpts),
    readyWhen: w => (w.document.getElementById('gamesBody') || {}).innerHTML
  });
  const asked = { confirms: [], prompts: [] };
  let ci = 0, pi = 0;
  p.window.confirm = (msg) => {
    asked.confirms.push(String(msg));
    const a = (answers.confirm || [])[ci++];
    return a === undefined ? true : a;
  };
  p.window.prompt = (msg) => {
    asked.prompts.push(String(msg));
    const a = (answers.prompt || [])[pi++];
    return a === undefined ? null : a;
  };
  // The mock records RPC calls, so `supabaseClient` need not be reachable
  // from the test -- it is a page-scoped const, not a global.
  return { p, asked, calls: p.db.rpcCalls };
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });
  const settle = () => new Promise(r => setTimeout(r, 200));

  // --- the markers ----------------------------------------------------
  for (const on of [true, false]) {
    const p = await bootPage('dashboard.html', {
      game: Object.assign({}, GAME, { status: 'in_progress', is_broadcast: on }),
      readyWhen: w => (w.document.getElementById('gamesBody') || {}).innerHTML
    });
    const badge = p.document.querySelector('.onair-badge');
    if (on && !badge) {
      fail('marker', 'a flagged game shows no ON AIR badge on the dashboard ' +
           'row. Not realising which game is flagged is the likeliest ' +
           'accident there is');
    }
    if (!on && badge) {
      fail('marker', 'an unflagged game is showing an ON AIR badge');
    }
    p.close();
  }
  {
    const h = await bootGamePage({ game: { is_broadcast: true } });
    if (h.document.getElementById('onAirBanner').style.display === 'none') {
      fail('marker', 'the game page shows no ON AIR banner. The scorer ' +
           'needs to know their typing is going out live');
    }
    h.close();
    const h2 = await bootGamePage({ game: { is_broadcast: false } });
    if (h2.document.getElementById('onAirBanner').style.display !== 'none') {
      fail('marker', 'the ON AIR banner is showing on a game that is not on air');
    }
    h2.close();
  }

  // --- putting a game ON AIR names it ---------------------------------
  {
    const { p, asked, calls } = await boot(
      { status: 'not_started', is_broadcast: false }, { confirm: [true] });
    click(p.window, p.document.querySelector('.broadcastBtn'));
    await settle();
    if (!asked.confirms.length) {
      fail('confirm', 'a game was put on air with NO confirmation at all');
    } else {
      // It must name the MATCHUP, whatever the teams are called. The
      // harness's fixture is "Neville vs TEST OPP", so asserting a
      // literal opponent name would only be testing the fixture.
      const el = p.document.querySelector('.game-matchup');
      const shown = el ? el.textContent.replace(/●\s*ON AIR/, '').trim() : '';
      if (asked.confirms[0].indexOf(shown) === -1) {
        fail('confirm', 'the prompt does not name the game ("' + shown +
             '"). Choosing the wrong game is the entire risk, and a ' +
             'generic prompt does nothing about it. Asked: "' +
             asked.confirms[0].slice(0, 70) + '"');
      }
    }
    if (!calls.length || calls[0].fn !== 'set_broadcast_game') {
      fail('rpc', 'expected set_broadcast_game, got ' + JSON.stringify(calls));
    }
    p.close();
  }

  // --- declining must do nothing --------------------------------------
  {
    const { p, calls } = await boot(
      { status: 'not_started', is_broadcast: false }, { confirm: [false] });
    click(p.window, p.document.querySelector('.broadcastBtn'));
    await settle();
    if (calls.length) {
      fail('confirm', 'the flag was changed after the confirmation was ' +
           'DECLINED: ' + JSON.stringify(calls));
    }
    p.close();
  }

  // --- a live game asks twice -----------------------------------------
  {
    const { p, asked, calls } = await boot(
      { status: 'in_progress', is_broadcast: false }, { confirm: [true, true] });
    click(p.window, p.document.querySelector('.broadcastBtn'));
    await settle();
    if (asked.confirms.length < 2) {
      fail('live guard', 'switching a game that is IN PROGRESS asked only ' +
           asked.confirms.length + ' time(s). During play this changes what ' +
           'viewers see immediately');
    } else if (!/in progress/i.test(asked.confirms[1])) {
      fail('live guard', 'the second prompt does not say the game is live: "' +
           asked.confirms[1].slice(0, 70) + '"');
    }
    if (!calls.length) fail('live guard', 'both confirmations accepted but nothing happened');
    p.close();
  }

  // --- declining the SECOND prompt must also do nothing ---------------
  {
    const { p, calls } = await boot(
      { status: 'in_progress', is_broadcast: false }, { confirm: [true, false] });
    click(p.window, p.document.querySelector('.broadcastBtn'));
    await settle();
    if (calls.length) {
      fail('live guard', 'declining the live-game warning still changed the flag');
    }
    p.close();
  }

  // --- taking a LIVE game off air requires TYPING ---------------------
  // The strictest gate in the app, deliberately. This must not be
  // possible by reflex during a broadcast.
  {
    const { p, asked, calls } = await boot(
      { status: 'in_progress', is_broadcast: true },
      { confirm: [true], prompt: ['OFF AIR'] });
    click(p.window, p.document.querySelector('.broadcastBtn'));
    await settle();
    if (!asked.prompts.length) {
      fail('off air', 'taking a LIVE game off air did not require typing ' +
           'anything. A click is too easy during a broadcast');
    }
    if (!calls.length || calls[0].fn !== 'clear_broadcast_game') {
      fail('off air', 'typing the confirmation did not clear the flag: ' +
           JSON.stringify(calls));
    }
    p.close();
  }

  // --- the wrong text must not work -----------------------------------
  {
    for (const typed of ['yes', 'off air please', '', null]) {
      const { p, calls } = await boot(
        { status: 'in_progress', is_broadcast: true },
        { confirm: [true], prompt: [typed] });
      click(p.window, p.document.querySelector('.broadcastBtn'));
      await settle();
      if (calls.length) {
        fail('off air', 'typing ' + JSON.stringify(typed) + ' was accepted ' +
             'as confirmation to take a live game off air');
      }
      p.close();
    }
    // ...and the right text must, regardless of case or spacing.
    const { p, calls } = await boot(
      { status: 'in_progress', is_broadcast: true },
      { confirm: [true], prompt: ['  off air  '] });
    click(p.window, p.document.querySelector('.broadcastBtn'));
    await settle();
    if (!calls.length) {
      fail('off air', 'a correct confirmation with different case/spacing ' +
           'was rejected — that is just annoying, not safer');
    }
    p.close();
  }

  // --- a game NOT in progress does not need typing --------------------
  // Protection has to be proportionate, or people learn to click through it.
  {
    const { p, asked, calls } = await boot(
      { status: 'final', is_broadcast: true }, { confirm: [true] });
    click(p.window, p.document.querySelector('.broadcastBtn'));
    await settle();
    if (asked.prompts.length) {
      fail('proportionality', 'taking a FINISHED game off air demanded typed ' +
           'confirmation. Over-prompting teaches people to click through');
    }
    if (!calls.length) fail('off air', 'a finished game could not be taken off air');
    p.close();
  }

  // --- the page must not reset itself afterwards ----------------------
  // Reported from real use, 12 Aug: setting a 2025 game ON AIR worked,
  // then dumped the dashboard to "undefined season" with no games listed.
  // Cause: the handler called `loadGames()` with no argument. loadGames
  // takes a default season year, and bare it unshifted `undefined` into
  // the season list and selected it. `refreshGames()` keeps whatever
  // season is selected, which is what a refresh after an action should do.
  {
    const { p, calls } = await boot(
      { status: 'in_progress', is_broadcast: false, season_year: 2025,
        game_date: '2025-08-15' }, { confirm: [true, true] });
    const picker = p.document.getElementById('seasonPicker');
    picker.value = '2025';
    picker.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    const gamesBefore = p.document.querySelectorAll('.game-row').length;

    click(p.window, p.document.querySelector('.broadcastBtn'));
    await new Promise(r => setTimeout(r, 400));

    const after = p.document.getElementById('seasonPicker');
    if (after.value !== '2025') {
      fail('season reset', 'the season became "' + after.value + '" after ' +
           'setting a game ON AIR. A past season must stay selected — ' +
           'otherwise the page appears to lose every game');
    }
    if (p.document.querySelectorAll('.game-row').length !== gamesBefore) {
      fail('season reset', 'the game list changed length after setting ON ' +
           'AIR: ' + gamesBefore + ' -> ' +
           p.document.querySelectorAll('.game-row').length);
    }
    if (!calls.length) fail('season reset', 'setup failed — no rpc was made');
    p.close();
  }

  // --- the Broadcast setup link is reachable --------------------------
  // It was only in the avatar menu at first, which is not where anyone
  // looks for something the production team needs.
  {
    const p = await bootPage('dashboard.html', {
      game: Object.assign({}, GAME, { status: 'in_progress' }),
      readyWhen: w => (w.document.getElementById('gamesBody') || {}).innerHTML
    });
    const hdr = p.document.getElementById('broadcastLink');
    if (!hdr) {
      fail('discoverability', 'no Broadcast button in the dashboard header');
    } else if (hdr.style.display === 'none') {
      fail('discoverability', 'the Broadcast button is hidden for an admin');
    }
    p.close();
  }

  // --- it goes through the database function --------------------------
  // Not an UPDATE from the page: two laptops doing "clear all, then set
  // mine" can interleave and leave two games flagged, or none.
  {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'dashboard.html'), 'utf8');
    // The HANDLER, not the markup -- the first occurrence is the button.
    const i = src.indexOf("querySelectorAll('.broadcastBtn')");
    const region = i === -1 ? '' : src.slice(i, i + 4000);
    if (!/\.rpc\(/.test(region)) {
      fail('atomicity', 'the broadcast flag is not set through an RPC. ' +
           'Exclusivity must be enforced in one transaction in the ' +
           'database, not by the page clearing other rows');
    }
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== ON AIR broadcast flag ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) {
      console.log('  marked clearly, and hard to change by accident.');
    }
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
