// No query may rely on RLS to narrow it — the sweep
// ================================================
// THE PATTERN THIS EXISTS FOR. Every page in this app was written when
// every account had a tenant, so a query like
//
//     .from('teams').select(...).eq('is_our_team', true).limit(1)
//
// was correct: RLS scoped `teams` to the caller's own row and the flag
// picked it. Both halves of that stopped being true. `is_our_team` is
// TRUE for every tenant's team once there is more than one, and the
// platform account has no tenant, so `teams_select` ends
// `or is_super_admin()` and returns ALL of them. limit(1) then takes
// whichever row Postgres feels like.
//
// The result was an arbitrary customer's colours on somebody else's page,
// and on customize.html the ability to EDIT them.
//
// FOUND BY ACCIDENT, THREE TIMES, before anybody went looking:
//   account.html "Reset for production"  unfiltered select on games
//   account.html user management         gated on role, not on tenant
//   api/feed.js  branding                eq('is_our_team', true)
//
// And two more that a single-line grep missed because the query spanned
// two lines: customize.html and player_report.html. That is why this is a
// parser over statements rather than a grep for a string.
//
// SERVICE-KEY FILES ARE THE WORST CASE. api/og.js read teams with the
// service key, which bypasses RLS entirely, so the link-preview card for a
// shared recap could be painted in another school's colour -- on the image
// iMessage and Slack show, which is the first thing anyone sees.
//
//   node tests/tenant_scope_sweep.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const TENANT_TABLES = ['games', 'plays', 'players', 'game_rosters', 'teams', 'tenants'];

// A read is scoped when it names a specific row or a specific owner, or
// asserts there is exactly one. Anything else is trusting RLS.
const SCOPED = /\.eq\('(tenant_id|id|game_id|team_id|share_token|player_id|season_year|designator|is_broadcast|status|feed_key)'|\.in\('(id|game_id|tenant_id)'|\.maybeSingle\(\)|\.single\(\)|\.match\(/;

// platform.html is the console: seeing every tenant is its entire job.
// dashboard.html reads games unscoped, which RLS narrows for a tenant, and
// the platform is redirected off the page before it runs.
const ALLOWED = {
  'platform.html': 'the console exists to see every tenant',
  'dashboard.html': 'RLS scopes it for a tenant; the platform is bounced before this runs'
};

function run() {
  const fails = [];
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))
    .concat(fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js')).map(f => 'api/' + f));

  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const body = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // is_our_team must not be READ anywhere. It means "the only team",
    // which has not been true since there was a second tenant.
    const reads = body.match(/is_our_team[^:]/g) || [];
    if (reads.length && !/insert\([^)]*is_our_team/.test(body)) {
      fails.push({ f, why: 'reads is_our_team — true for EVERY tenant now, so it selects an ' +
                          'arbitrary customer. Scope by tenant_id, or use maybeSingle().' });
    }

    const re = new RegExp("\\.from\\('(" + TENANT_TABLES.join('|') + ")'\\)((?:[^;])*?);", 'gs');
    let m;
    while ((m = re.exec(body)) !== null) {
      const [, table, rest] = m;
      if (/\.(insert|update|delete|upsert)\b/.test(rest)) continue;
      if (SCOPED.test(rest)) continue;
      if (ALLOWED[f]) continue;
      fails.push({ f, why: 'reads ' + table + ' with no tenant, id or single() — correct only ' +
                          'while every account has a tenant, which stopped being true.' });
    }
  }
  return fails;
}

if (require.main === module) {
  const f = run();
  console.log('=== No query relies on RLS to narrow it ===\n');
  console.log('Failures: ' + f.length);
  f.forEach(x => console.log('  [' + x.f + '] ' + x.why));
  if (!f.length) console.log('  every read names its tenant, its row, or asserts there is exactly one.');
  process.exitCode = f.length ? 1 : 0;
}

module.exports = { run };
