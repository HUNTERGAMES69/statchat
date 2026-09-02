// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// The dashboard must not boot in a long serial chain
// ==================================================
// Reported 2 Sep 2026: "there is definitely now a 'pause' going from sub
// pages back to the dashboard, its now 2-4 seconds and used to be instant."
//
// It was true and it was measurable. With a fixed-latency stub in place of
// Supabase, the boot was a chain NINE round trips deep:
//
//   auth event -> profiles -> profiles -> mfa -> teams -> players -> games
//                          -> profiles -> release_state
//
//   25 Aug (97bdb47)   6 round trips   settled 1010ms at 200ms/call
//    2 Sep (e050852)  11 round trips   settled 1827ms at 200ms/call
//                                      settled 3184ms at 350ms/call
//
// 3.2 seconds is exactly the pause described. Nothing was slow; things had
// simply been added one after another, each waiting for the last.
//
// TWO CAUSES, both guarded below.
//
// ONE. THE SAME `profiles` ROW, FETCHED FOUR TIMES -- is_super_admin, then
// role, then display_name/avatar_url, then last_seen_release. Same table,
// same primary key, two of them on the critical path.
//
// TWO. A SUPABASE QUERY DOES NOT START WHEN YOU BUILD IT. PostgrestBuilder
// is a thenable; nothing is sent until something calls .then(). So
//
//     const a = client.from('teams').select('*');
//     const b = client.from('players').select('*');
//     await a; await b;
//
// reads as parallel and runs in series. The first attempt at this fix made
// exactly that mistake and the measurement caught it. `start()` wraps a
// query in Promise.resolve, which adopts the thenable and puts the request
// on the wire.
//
//   node tests/dashboard_boot_check.js

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
// Comments describe the old shape at length; a check reading them would pass
// on the explanation of the bug it is meant to catch.
const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Dashboard boot chain ===\n');

// ---- one profile read ----------------------------------------------------
{
  const reads = (code.match(/\.from\('profiles'\)\s*\n?\s*\.select\(/g) || []).length;
  chk(reads === 1,
      'the `profiles` row is SELECTed exactly once on this page (found ' + reads + ')');

  const boot = /\.from\('profiles'\)\s*\n\s*\.select\(([^;]*?)\)\s*\n\s*\.eq\('id', session\.user\.id\)/
    .exec(code);
  chk(!!boot, 'the one read happens at boot, keyed on the session user');
  if (boot) {
    ['role', 'is_super_admin', 'display_name', 'avatar_url', 'last_seen_release',
     'mfa_prompt_first_shown_at'].forEach(c =>
      chk(boot[1].indexOf(c) !== -1,
          '  and it carries ' + c + ' — every column something on this page used to ask for separately'));
  }
  chk(/let bootProfile = null;/.test(code), 'the row is cached as bootProfile');
  chk(/const profile = bootProfile \|\| \{\};/.test(code),
      'the account menu reads the cache instead of querying again');
  chk(/seen = \(bootProfile && bootProfile\.last_seen_release\)/.test(code),
      'the release card reads the cache instead of querying again');
}

// ---- nothing needless is awaited before the page loads -------------------
{
  chk(!/function loadIsAdmin/.test(code),
      'loadIsAdmin is gone — the role arrives with the boot read, so nothing waits on a query for it');
  chk(/function applyRole\(/.test(code),
      'applyRole is synchronous DOM work');

  // The MFA check is an auth round trip that decides ONE tick on a checklist.
  // It must not sit between sign-in and the dashboard.
  const bootBlock = /const viewingAs = new URLSearchParams[\s\S]*?\n        \}\)\(\);/.exec(code);
  chk(!!bootBlock, 'found the boot block');
  if (bootBlock) {
    chk(!/await[^\n]*mfa/i.test(bootBlock[0]),
        'the MFA check is NOT awaited on the critical path');
    chk(/loadMfaState\(\);/.test(bootBlock[0]),
        'it runs beside everything else');
    chk(/gamesP\(\);/.test(bootBlock[0]),
        'the games list — the thing people came to look at — starts at boot');
    chk(/releaseStateP\(\);/.test(bootBlock[0]),
        'and so does the release-note state');
  }
}

// ---- queries that should run together actually do ------------------------
{
  chk(/const start = \(q\) => Promise\.resolve\(q\);/.test(code),
      'start() exists — Promise.resolve adopts the thenable, which is what sends the request');

  chk(/const teamsP = start\(/.test(code), 'teamsP is started, not merely built');
  // playersP is CONDITIONAL now -- only an admin ever needs it -- but when it
  // does run it must still be started rather than merely built.
  chk(/const playersP = currentIsAdmin\s*\n?\s*\?\s*start\(/.test(code),
      'playersP is started when it runs, and only runs for an admin');
  chk(/:\s*null;/.test(code),
      'and is null otherwise — a non-admin makes no players request at all');

  chk(/_gamesP = start\(gamesQuery\(\)\)/.test(code), 'the games query is started');
  chk(/_releaseStateP = start\(/.test(code),          'the release-state query is started');

  // The trap this whole check exists for: assigning a query without start().
  const lazy = (code.match(/const \w+P = supabaseClient\s*\n?\s*\.from\(/g) || []);
  chk(lazy.length === 0,
      'no query is assigned to a variable WITHOUT start() — that reads as parallel and runs in series'
      + (lazy.length ? ' — found ' + lazy.length : ''));
}

// ---- the memoized games query must not break Refresh ---------------------
// gamesP() hands back the request made when the page opened. The Refresh
// button asking for that would do nothing at all, for ever, and look like it
// had worked.
{
  chk(/async function fetchGames\(fresh\)/.test(code), 'fetchGames takes a `fresh` flag');
  chk(/fresh \? await start\(gamesQuery\(\)\) : await gamesP\(\)/.test(code),
      'fresh:true goes to the database; otherwise the boot request is reused');
  const refresh = /async function refreshGames\(\)\{[\s\S]*?\n  \}/.exec(code);
  chk(refresh && /fetchGames\(true\)/.test(refresh[0]),
      'the Refresh button passes fresh:true — otherwise it silently shows the page-load data for ever');
  const loadGames = /async function loadGames\(defaultSeasonYear\)\{[\s\S]*?\n  \}/.exec(code);
  chk(loadGames && /await fetchGames\(\)/.test(loadGames[0]),
      'the first load reuses the request already in flight');
}

// ---- the getting-started card has ONE readiness signal -------------------
// Two paths feed it and they finish in either order. A section redrawn by
// whichever path happens to finish is the shape that produced three separate
// bugs in the broadcast starters section.
{
  chk(/let gsMfaResolved = false;/.test(code) && /let gsDataResolved = false;/.test(code),
      'both feeding paths record that they are done');
  chk(/if \(!gsDataResolved \|\| !gsMfaResolved \|\| !gsState\) return;/.test(code),
      'and the card draws only when BOTH are in — not whenever one finishes');
  const direct = (code.match(/(?<!function )\brenderGettingStarted\(/g) || []).length;
  chk(/drawGettingStartedWhenReady\(\)/.test(code),
      'the two paths call the shared redraw');
}

// ---- renderGettingStarted stays a pure function of `state` ---------------
// Two existing tests eval this function on its own. When it briefly reached
// out to module scope and wrote to the database, both blew up immediately.
{
  const fn = /function renderGettingStarted\(state\)\{[\s\S]*?\n  \}/.exec(code);
  chk(!!fn, 'renderGettingStarted is present');
  if (fn) {
    chk(!/mfaPromptExpired\(/.test(fn[0]),
        'it does not call mfaPromptExpired — the caller decides and passes showMfaStep in');
    chk(!/stampMfaPromptShown\(/.test(fn[0]),
        'and it does not write to the database; a render function renders');
    chk(!/supabaseClient/.test(fn[0]),
        'and it makes no query of any kind');
  }
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
