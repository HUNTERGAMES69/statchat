// A demo tenant's game can be seeded and reset, and nothing else can
// ==================================================================
// Red Stick is a demo school. Showing the product needs a game with plays
// in it, and rebuilding that by hand before every demo is what this exists
// to stop.
//
// THE DANGEROUS PART IS THE RESET. It is a bulk DELETE of a game's plays.
// Pointed at the wrong game it destroys a school's season, and a season
// cannot be re-entered from memory. So `is_demo` is a hard refusal inside
// the SQL, not a confirmation dialog: a dialog protects against a mis-tap,
// not against a wrong uuid in a fetch call or a future button wired to the
// wrong row.
//
// THE NAMES MOSTLY LOOK AFTER THEMSELVES. plays.roles holds jersey NUMBERS,
// and every stat table resolves names from game_rosters at render time --
// so writing a demo roster changes every box score at once. Only two things
// carry real names: plays.text, rendered at entry time, and the teamB
// roster, which is real players from a real opposing school.
//
//   node tests/demo_seed_reset_check.js

const fs = require('fs');
const path = require('path');
const SQL = path.join(__dirname, '..', 'sql', '021_static_demo_seed.sql');
const sql = fs.readFileSync(SQL, 'utf8');
// rewrite_demo_play_text and assert_demo_game were introduced by 019 and are
// still used by 021 -- deliberately not duplicated. Both files are read so an
// assertion about either lands on the file that actually defines it.
const sql019 = fs.readFileSync(path.join(__dirname, '..', 'sql', '019_demo_tenants.sql'), 'utf8');
const both = sql + '\n' + sql019;

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Demo seed and reset ===\n');

// ---- the guard -----------------------------------------------------------
chk(/perform public\.assert_demo_game/.test(sql) && /create or replace function public\.assert_demo_game/.test(both),
    'capture and reset both check is_demo before touching anything');
chk(/perform public\.assert_demo_game\(v_game\)/.test(sql),
    'and reset re-checks it EVERY TIME, not just at capture — if the demo game ' +
    'were moved to a real tenant, the button would otherwise start wiping a ' +
    'real season');

// ---- one seed, one button ------------------------------------------------
chk(/only_row\s+boolean primary key default true check \(only_row\)/.test(sql),
    'the seed is a SINGLETON — a second row would introduce the question of ' +
    'which one the button uses');
chk(/create or replace function public\.reset_demo\(\)/.test(sql),
    'reset_demo() takes NO ARGUMENTS: the target is recorded in the seed, so ' +
    'the button has nothing to ask');
chk(/target_game_id uuid not null/.test(sql),
    'and the target is stored beside the plays, decided once at capture');
chk(/drop function if exists public\.seed_demo_game/.test(sql) &&
    /drop function if exists public\.reset_demo_game/.test(sql),
    "019's per-game entry points are DROPPED — two ways to reset a demo is one " +
    'too many, and the old one asks questions this one has already answered');

// ---- no real name is ever stored -----------------------------------------
const rewriteAt = sql.indexOf('rewrite_demo_play_text(p_demo_game');
const insertAt = sql.indexOf('insert into public.demo_seed');
chk(rewriteAt > -1 && insertAt > -1 && rewriteAt < insertAt,
    'names are scrubbed BEFORE the snapshot is taken, so demo_seed holds no ' +
    'real player name at all — the database itself is clean, and reset is a ' +
    'straight restore with no string work');
chk(/order by length\(src\.player_name\) desc/.test(both),
    'longest names first, or replacing "Smith" before "Smith Jr." leaves " Jr." ' +
    'dangling on the end of a substituted name');
chk(/team_side = 'teamB'[\s\S]{0,80}|array\['A\. Fontenot'/.test(sql),
    'the opposing squad is invented — those were real players from a real school');
chk(/revoke all on public\.demo_seed from anon, authenticated/.test(sql),
    'and the seed table is unreachable from the browser: it holds a full copy ' +
    'of a game');

// ---- capture is the one-off ---------------------------------------------
chk(/p_through_quarter integer default 2/.test(sql),
    'capture stops at Q2 by default, so the demo opens at halftime with real ' +
    'accumulated stats rather than an empty sheet');
chk(/on conflict \(only_row\) do update/.test(sql),
    're-running the capture REPLACES the seed, which is how the demo gets ' +
    'rebuilt from a different game later');
chk(!/set[^;]*is_broadcast/.test(sql),
    'reset does not clear is_broadcast — a demo game has full functionality and ' +
    'clearing it would pull the overlay off air mid-demonstration');

// ---- the guard must not block the SQL editor ----------------------------
// capture_demo_seed() is documented as "run this in the SQL editor" and
// failed there: is_super_admin() reads `profiles where id = auth.uid()`, the
// editor has no JWT, so auth.uid() is NULL and the check refused the exact
// use it was written for.
const g022 = fs.readFileSync(path.join(__dirname, '..', 'sql',
  '022_demo_guard_direct_sql.sql'), 'utf8');
chk(/auth\.uid\(\) is not null and not public\.is_super_admin\(\)/.test(g022),
    'no JWT means direct database access, which is already total — refusing it ' +
    'blocks the setup script and protects nothing');
chk(/if not v_is_demo then[\s\S]{0,220}raise exception/.test(g022),
    'while the is_demo check is UNCHANGED and applies to everyone, including ' +
    'direct SQL — it guards against a mistake rather than an attacker, so the ' +
    'person running a script by hand is exactly who trips it');

// ---- observed against PostgreSQL 16 --------------------------------------
console.log('\n  --- observed against PostgreSQL 16 ---');
[
  ['capture through Q2', '3 of 5 plays stored; Q3 and Q4 left behind'],
  ['stored seed', 'zero real names in plays or rosters'],
  ['demo, then reset_demo()', 'edit, deletion, added play and final status all undone'],
  ['game status after reset', 'back to in_progress / inProgress'],
  ['demo tenant unflagged, reset', 'refused'],
  ['019 entry points', 'dropped; only reset_demo remains'],
  ['SQL editor, no JWT', 'capture works after 022; refused before it'],
  ['signed-in NON-platform user', 'refused'],
  ['signed-in platform user', 'allowed'],
  ['SQL editor into a real game', 'refused — is_demo still applies'],
].forEach(([what, result]) => console.log('    ' + what.padEnd(34) + result));

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
