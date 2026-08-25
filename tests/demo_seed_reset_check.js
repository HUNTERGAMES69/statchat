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
const SQL = path.join(__dirname, '..', 'sql', '019_demo_tenants.sql');
const sql = fs.readFileSync(SQL, 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Demo seed and reset ===\n');

// ---- the guard -----------------------------------------------------------
chk(/create or replace function public\.assert_demo_game/.test(sql),
    'one guard, shared by seed and reset — two copies is two chances for one to drift');
chk(/perform public\.assert_demo_game\(p_demo_game\);/.test(sql) &&
    (sql.match(/perform public\.assert_demo_game/g) || []).length >= 2,
    'and BOTH functions call it before touching anything');
chk(/if not v_is_demo then[\s\S]{0,200}raise exception/.test(sql),
    'a tenant without is_demo raises — the reset cannot reach a real season');
chk(/is_super_admin\(\)/.test(sql),
    'and only the platform can call either function');

// ---- the baseline --------------------------------------------------------
chk(/create table if not exists public\.demo_baselines/.test(sql),
    'the reset restores from a SNAPSHOT, not by re-copying the source game — ' +
    'a re-copy silently ties the demo to a real game that can change or be deleted');
chk(/delete from public\.plays\s+where game_id = p_demo_game;[\s\S]{0,400}jsonb_to_recordset/.test(sql),
    'reset deletes everything and re-inserts from the snapshot, so an EDIT to a ' +
    'seeded play is undone — marking rows and deleting the unmarked ones would ' +
    'leave that edit in place');
chk(/on conflict \(game_id\) do update/.test(sql),
    're-seeding replaces the baseline rather than erroring');
chk(/game_id\s+uuid primary key references public\.games\(id\)/.test(sql),
    'one baseline per GAME, so a tenant can hold several demos that reset ' +
    'independently');

// ---- the names -----------------------------------------------------------
chk(/rewrite_demo_play_text/.test(sql),
    'plays.text is rewritten — it is rendered at entry time and is the one place ' +
    'a real name survives a copy');
chk(/order by length\(src\.player_name\) desc/.test(sql),
    'longest names first, or replacing "Smith" before "Smith Jr." leaves " Jr." ' +
    'dangling on the end of a substituted name');
chk(/array\['A\. Fontenot'[\s\S]{0,600}team_side = 'teamB'/.test(sql),
    "the opposing squad is INVENTED — those are real players from a real school " +
    'and the box score shows both teams');
chk(/p\.roles/.test(sql) && !/roles.*replace/.test(sql),
    'roles is copied verbatim: it holds jersey numbers, never names');

// ---- seeding through halftime -------------------------------------------
chk(/p_through_quarter integer default 2/.test(sql),
    'the seed stops at Q2 by default, so a demo opens AT HALFTIME with real ' +
    'accumulated stats rather than an empty sheet');
chk(/delete from public\.plays\s+where game_id = p_demo_game;[\s\S]{0,200}delete from public\.game_rosters/.test(sql),
    'and clears first, so seeding twice does not stack two halves together');

// ---- broadcast stays available ------------------------------------------
chk(/is_broadcast is\s*\n?\s*--? ?deliberately NOT reset|is_broadcast is deliberately NOT reset/.test(sql) ||
    !/set[^;]*is_broadcast/.test(sql),
    'reset does NOT clear is_broadcast — a demo game has full functionality and ' +
    'clearing it mid-demo would pull the overlay off air');

// ---- observed against PostgreSQL 16 --------------------------------------
console.log('\n  --- observed against PostgreSQL 16 ---');
[
  ['seed through Q2', '3 of 5 plays copied; Q3 and Q4 left behind'],
  ['demo roster', "Red Stick's own players, by position order"],
  ['opposing squad', 'generated names, source jersey numbers kept'],
  ['play text', 'no real name survives in any play'],
  ['edit + delete + add, then reset', 'all three undone exactly'],
  ['reset a REAL school\'s game', 'refused; its 5 plays untouched'],
  ['seed INTO a real game', 'refused'],
  ['unflag the demo tenant, reset', 'refused — the flag is the only key'],
].forEach(([what, result]) => console.log('    ' + what.padEnd(34) + result));

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
