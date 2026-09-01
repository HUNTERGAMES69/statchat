// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// A deleted game must not still claim to be on air
// ===============================================
// delete_game() stamped deleted_at and nothing else, so a game deleted while
// it was the broadcast game kept is_broadcast = true for good. 035 clears it
// in the same statement and backfills the rows that got there first.
//
// THIS FILE ASSERTS THE CALLERS, NOT THE MIGRATION. The SQL was proved
// against a real PostgreSQL 16 before it shipped -- the delete, the restore,
// the partial unique index on (tenant_id) where is_broadcast, the backfill
// and the DOWN. None of that can run here, and re-asserting it in JavaScript
// against a mock would prove only that the mock agrees with itself.
//
// What CAN rot here is the other half: the service-key endpoints hold
// BYPASSRLS and each carries a hand-written deleted_at filter. Those filters
// were load-bearing while the flag lied; with 035 applied they are
// belt-and-braces. Belt-and-braces is worth keeping -- an endpoint added
// later against an unmigrated database, or a restore that goes wrong, still
// has to fail closed. So the filters must stay, and this file is what says
// so out loud.
//
//   node tests/broadcast_flag_delete_check.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const chk = (l, ok, det) => { if (ok) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + (det ? '\n         ' + det : '')); } };

console.log('=== Deleted games and the on-air flag ===\n');

// ---- the migration says what it does ----------------------------------
const mig = read('sql/035_delete_game_clears_broadcast.sql');
chk('035 clears is_broadcast inside delete_game',
    /update public\.games\s*\n\s*set deleted_at\s*=\s*now\(\),\s*\n\s*is_broadcast\s*=\s*false/.test(mig));
chk('...in the SAME statement as the delete, so it cannot half-apply',
    (mig.match(/update public\.games/g) || []).length === 2,
    'one UPDATE in the function, one for the backfill');
chk('035 backfills the rows that were already in that state',
    /update public\.games\s*\n\s*set is_broadcast = false\s*\n\s*where is_broadcast\s*\n\s*and deleted_at is not null/.test(mig));
// The permission checks are the whole risk of replacing a SECURITY DEFINER
// function. They must survive verbatim.
['public.is_super_admin()', 'public.current_tenant_id()', 'public.current_user_role()',
 "array['admin','game_entry']", 'Not permitted to delete that game.'].forEach(needle =>
  chk('035 keeps 012\'s guard: ' + needle, mig.includes(needle)));
chk('035 is still SECURITY DEFINER with a pinned search_path',
    /security definer set search_path to 'public'/.test(mig));
chk('035 leaves the broadcast audit columns alone',
    !/broadcast_set_by\s*=/.test(mig) && !/broadcast_set_at\s*=/.test(mig),
    'deleting is not the decision those columns record');
chk('a DOWN exists and restores the old function',
    fs.existsSync(path.join(ROOT, 'sql/035_delete_game_clears_broadcast_DOWN.sql')) &&
    /create or replace function public\.delete_game/.test(
      read('sql/035_delete_game_clears_broadcast_DOWN.sql')));

// ---- the service-key readers keep failing closed ----------------------
// BYPASSRLS means nothing filters these for us. Each reads the on-air game
// and must also require it to be undeleted.
[['api/feed.js', 'feed'], ['api/gamedata.js', 'gamedata']].forEach(([f, label]) => {
  const s = read(f);
  const i = s.indexOf("eq('is_broadcast', true)");
  chk(label + ': looks up the on-air game', i > -1);
  if (i > -1) {
    // Window the enclosing statement rather than a fixed character count --
    // a fixed look-back is how overlay_key_check produced a false positive
    // once the code around it was refactored.
    const stmt = s.slice(Math.max(0, i - 700), i + 700);
    chk(label + ': ...and still requires deleted_at to be null',
        /\.is\('deleted_at',\s*null\)/.test(stmt),
        stmt.slice(600, 900).replace(/\s+/g, ' '));
  }
});

// ---- and the tenant scoping that has to travel with it ----------------
chk('feed scopes the on-air lookup to one tenant',
    /eq\('is_broadcast', true\)[\s\S]{0,200}eq\('tenant_id'/.test(read('api/feed.js')) ||
    /eq\('tenant_id'[\s\S]{0,200}eq\('is_broadcast', true\)/.test(read('api/feed.js')));

console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
if (fail) console.log('\n' + fail + ' FAILURES');
process.exitCode = fail ? 1 : 0;
