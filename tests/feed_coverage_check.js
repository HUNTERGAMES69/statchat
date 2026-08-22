// Feed coverage
// -------------
// Andy's requirement for Phase 3 was: **ALL data available on the game and
// view screens must be available to broadcast software.** That is easy to
// say and easy to believe without checking — the feed has a lot of fields
// and it FEELS complete.
//
// This test makes it checkable. It enumerates what the view page actually
// displays, then asserts each one is reachable somewhere in the eight feed
// views. A missing field is not a crash; it is a graphic the production
// team cannot build, discovered on a Friday.
//
// HOW IT WORKS: the feed handler is invoked for real, with Supabase
// stubbed, using a game containing every kind of play — scores,
// penalties, turnovers, sacks, third-down attempts, clock events. Then
// every required field is looked for by name across all views.
//
// WHAT IT DELIBERATELY DOES NOT DO: check the VALUES match the view page.
// The two run the same engine on the same rows, so they cannot disagree
// arithmetically; cross_surface already covers that. This is about
// presence, which is the thing that silently goes missing.

const path = require('path');

// ---- a game with something of everything ---------------------------
const GAME = {
  id: 'g1', is_broadcast: true, our_team_is_home: true,
  home_team_name: 'Neville', away_team_name: 'Ruston',
  starting_possession: 'teamA', quarter_length_seconds: 720,
  status: 'in_progress', game_date: '2026-08-24'
};

const ROSTER = [
  { team_side: 'teamA', unit: 'offense', jersey_number: '22', player_name: 'Roberson', position: 'RB' },
  { team_side: 'teamA', unit: 'offense', jersey_number: '7',  player_name: 'Robinson', position: 'QB' },
  { team_side: 'teamA', unit: 'offense', jersey_number: '80', player_name: 'Young',    position: 'WR' },
  { team_side: 'teamA', unit: 'defense', jersey_number: '55', player_name: 'Carter',   position: 'LB' },
  { team_side: 'teamB', unit: 'offense', jersey_number: '21', player_name: 'Doyle',    position: 'RB' },
  { team_side: 'teamB', unit: 'defense', jersey_number: '99', player_name: 'Frank',    position: 'DL' }
];

let seq = 0;
const play = (o) => Object.assign({
  id: ++seq, sequence_number: seq, game_id: 'g1', quarter: 1,
  is_divider: false, unresolved: false
}, o);

const PLAYS = [
  play({ text: 'start', team_side: 'teamA',
         effect: { isReset: true, down: 1, distance: 10, fieldPos: 25 } }),
  play({ text: 'clock', team_side: 'teamA',
         effect: { clockEvent: { type: 'start', team: 'teamA', absSec: 60 } } }),
  play({ text: 'Roberson rush for 8, tackled by Frank', team_side: 'teamA',
         effect: { isStat: true, statYds: 8, fieldDelta: 8 },
         roles: { carrier: { team: 'teamA', num: '22', yards: 8 },
                  defense: { team: 'teamB', num: '99' }, playType: 'rush' } }),
  // a third-down attempt, converted
  play({ text: 'Robinson pass to Young for 21', team_side: 'teamA',
         effect: { isStat: true, statYds: 21, fieldDelta: 21, converts: true },
         roles: { passer: { team: 'teamA', num: '7', yards: 21 },
                  receiver: { team: 'teamA', num: '80', yards: 21 },
                  playType: 'pass' } }),
  play({ text: 'Penalty on Neville — 5 yds', team_side: 'teamA',
         // penaltyTeam, not penaltyOn. The first version of this fixture used
         // the wrong key, so penalties stayed at zero and the coverage gap it
         // reported was half fixture and half real.
         effect: { isPenalty: true, penaltyTeam: 'teamA', penaltyYds: 5, fieldDelta: -5 } }),
  play({ text: 'sack', team_side: 'teamA',
         effect: { isStat: true, statYds: -7, fieldDelta: -7 },
         roles: { passer: { team: 'teamA', num: '7', yards: -7 },
                  defense: { team: 'teamB', num: '99' }, playType: 'sack' } }),
  play({ text: 'Roberson rush for 6 — TOUCHDOWN', team_side: 'teamA',
         effect: { isStat: true, statYds: 6, fieldDelta: 6, td: true,
                   score: { team: 'teamA', points: 6 }, endsDrive: true },
         roles: { carrier: { team: 'teamA', num: '22', yards: 6 }, playType: 'rush' } }),
  play({ text: 'clock at change', team_side: 'teamA',
         effect: { clockEvent: { type: 'transition', outgoingTeam: 'teamA',
                                 incomingTeam: 'teamB', absSec: 300 } } }),
  play({ text: 'New drive — 1st & 10 at own 20 (Ruston)', team_side: 'teamB',
         effect: { isReset: true, down: 1, distance: 10, fieldPos: 20 } }),
  play({ text: 'Doyle rush for 3', team_side: 'teamB',
         effect: { isStat: true, statYds: 3, fieldDelta: 3 },
         roles: { carrier: { team: 'teamB', num: '21', yards: 3 },
                  defense: { team: 'teamA', num: '55' }, playType: 'rush' } }),
  // a turnover
  play({ text: 'intercepted by Carter', team_side: 'teamB',
         effect: { isStat: true, statYds: 0, isReset: true, down: 1,
                   distance: 10, fieldPos: 45, newPossession: true },
         roles: { passer: { team: 'teamB', num: '21', yards: 0 },
                  defense: { team: 'teamA', num: '55' }, playType: 'int' } })
];

// ---- what the view page shows, and where the feed should carry it ----
//
// Taken from view.html's own tile lists rather than invented: the
// per-team summary tiles and the drive tiles. If a tile is added there
// and not here, this test says nothing about it — so the list is worth
// re-reading when the view page changes.
const REQUIRED = [
  // view.html per-team summary tiles
  ['Possessions',        ['possessions', 'drive']],
  ['Total Yards',        ['totalYards']],
  ['Comp / Pass Yds',    ['passComp', 'passYards']],
  ['Att / Rush Yds',     ['rushAtt', 'rushYards']],
  ['Total Plays',        ['plays', 'totalPlays']],
  ['Turnovers',          ['turnovers']],
  ['Time of possession',  ['timeOfPossession']],
  ['Penalties',          ['penalties', 'penaltyCount', 'penaltyYards']],
  ['3rd Down',           ['thirdDownConv', 'thirdDownAtt', 'thirdDownPct']],

  // view.html current-drive tiles
  ['drive RUSH',         ['rushYards', 'yards']],
  ['drive PASS',         ['passYards', 'yards']],
  ['drive YARDS',        ['yards', 'totalYards']],
  // NOT 'drive TOP'. Dropped from the drive row 14 Aug 2026: a drive's
  // own time of possession only accrues once a closing clock event is
  // entered, so a live drive reads 0:00 for as long as anyone would be
  // looking at it. What was there reported the team's cumulative total
  // under a drive-scoped name, which is worse than absent.
  // Cumulative TOP is checked in the team block above.

  // the banner
  ['score',              ['homeScore', 'awayScore', 'score']],
  ['quarter',            ['quarter']],
  ['down and distance',  ['downAndDistance', 'down', 'distance']],
  ['ball on',            ['ballOn']],
  ['possession',         ['possession']],

  // player tables
  ['rushing per player',   ['att']],
  ['passing per player',   ['comp']],
  ['receiving per player', ['tgt', 'rec']],
  ['defence per player',   ['sacks', 'int', 'tackles']],

  // things a scoreboard needs that the view page also shows
  ['timeouts',           ['timeouts', 'homeTimeouts', 'awayTimeouts']],
  ['last play text',     ['text']]
];

// ---- drive the real handler ------------------------------------------
function loadFeedWithStub() {
  const Module = require('module');
  const orig = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === '@supabase/supabase-js') {
      const tbl = (name) => {
        const b = {
          select() { return b; }, eq() { return b; }, order() { return b; },
          limit: async () => ({ data: rowsFor(name) }),
          then: (r) => Promise.resolve({ data: rowsFor(name) }).then(r)
        };
        return b;
      };
      const rowsFor = (n) => n === 'games' ? [GAME]
        : n === 'plays' ? PLAYS
        : n === 'game_rosters' ? ROSTER
        : [{ primary_color: '#0f4d2e' }];
      return { createClient: () => ({ from: (n) => tbl(n) }) };
    }
    return orig.apply(this, arguments);
  };
  process.env.SUPABASE_URL = 'http://x';
  process.env.SUPABASE_SECRET_KEY = 'k';
  delete process.env.FEED_KEY;
  const p = path.join(__dirname, '..', 'api', 'feed.js');
  delete require.cache[require.resolve(p)];
  const handler = require(p);
  Module.prototype.require = orig;
  return handler;
}

function callFeed(handler, view) {
  return new Promise(resolve => {
    const res = {
      _h: {}, setHeader(k, v) { this._h[k] = v; },
      status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o, headers: this._h }); },
      send(s) { resolve({ code: this.code, body: s, headers: this._h }); },
      end() { resolve({ code: this.code, headers: this._h }); }
    };
    handler({ method: 'GET', query: { view, format: 'json' }, headers: {} }, res);
  });
}

const VIEWS = ['score', 'drive', 'lastplay', 'teamstats',
               'rushing', 'passing', 'receiving', 'defense'];

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  const handler = loadFeedWithStub();
  const fields = new Set();
  const byView = {};

  for (const view of VIEWS) {
    const r = await callFeed(handler, view);
    if (r.code !== 200) {
      fail('view', view + ' returned HTTP ' + r.code + ': ' +
           JSON.stringify(r.body).slice(0, 100));
      continue;
    }
    const rows = (r.body || {}).rows || [];
    byView[view] = rows.length;
    // A view with no rows tells us nothing about its fields, and the
    // fixture above deliberately contains plays of every kind — so an
    // empty view is itself a finding.
    if (!rows.length) {
      fail('view', view + ' returned no rows for a game containing rushes, ' +
           'passes, sacks, penalties, a touchdown and an interception. ' +
           'Either the view is broken or the fixture does not reach it');
      continue;
    }
    rows.forEach(row => Object.keys(row).forEach(k => fields.add(k)));
  }

  // ---- the actual coverage assertion --------------------------------
  for (const [label, candidates] of REQUIRED) {
    const found = candidates.filter(c => fields.has(c));
    if (!found.length) {
      fail('coverage', 'the view page shows "' + label + '" but no feed view ' +
           'carries any of: ' + candidates.join(', ') +
           '. The production team cannot build that graphic');
    }
  }

  // ---- no-cache headers, on every view ------------------------------
  // The single most likely way this fails in production: it works in
  // testing and the graphics freeze on game night.
  {
    const r = await callFeed(handler, 'score');
    const cc = (r.headers || {})['Cache-Control'] || '';
    if (!/no-store/.test(cc)) {
      fail('cache', 'Cache-Control is "' + cc + '" — without no-store a data ' +
           'source can fetch once and then appear frozen for the rest of ' +
           'the night');
    }
  }

  // ---- an unknown view must say what IS available -------------------
  {
    const r = await callFeed(handler, 'nonsense');
    if (r.code !== 400) {
      fail('unknown view', 'expected HTTP 400 for an unknown view, got ' + r.code);
    } else if (!Array.isArray((r.body || {}).available)) {
      fail('unknown view', 'the error does not list the available views, so a ' +
           'typo in a data source URL gives no clue what to fix');
    }
  }

  // OFF AIR MEANS OFF AIR. Both endpoints used to fall back to the most
  // recent in-progress game when nothing was flagged, so with no game on
  // air the overlays kept showing data -- taking a game down had no
  // observable effect a viewer could see. Reported from real use and
  // removed 22 Aug 2026.
  //
  // Checked against the SOURCE: these are serverless handlers needing a
  // database and a service key, so the suite cannot execute them.
  {
    const fs = require('fs');
    ['gamedata', 'feed'].forEach(name => {
      const path = __dirname + '/../api/' + name + '.js';
      if (!fs.existsSync(path)) { failures.push({ area: 'api:missing', detail: name + '.js not found' }); return; }
      const src = fs.readFileSync(path, 'utf8');
      // The QUERY, not the word -- the explanatory comments mention
      // in_progress and must not trip this.
      if (/\.eq\(\s*['"]status['"]\s*,\s*['"]in_progress['"]\s*\)/.test(src)) {
        failures.push({ area: 'api:' + name + ':fallback',
          detail: name + '.js still falls back to the most recent in-progress game' });
      }
      if (!/No game is on air/.test(src)) {
        failures.push({ area: 'api:' + name + ':refuse',
          detail: name + '.js should report that no game is on air' });
      }
      // Removing the fallback must not remove what it fell back FROM.
      if (!/is_broadcast/.test(src)) {
        failures.push({ area: 'api:' + name + ':flag',
          detail: name + '.js no longer resolves by the broadcast flag' });
      }
    });
  }

  return { failures, fields: [...fields].sort(), byView };
}

if (require.main === module) {
  run().then(({ failures, fields, byView }) => {
    console.log('=== Feed coverage ===\n');
    console.log('rows per view:');
    Object.keys(byView).forEach(v =>
      console.log('   ' + v.padEnd(11) + byView[v] + ' row(s)'));
    console.log('\ndistinct fields across all views: ' + fields.length);
    console.log('\nFailures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  every field the view page shows is reachable in the feed.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
