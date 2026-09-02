// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// The platform counter must count REAL football, in the RIGHT week
// ================================================================
// Four numbers go on the brochure site and into social posts, so they have
// to be a claim that survives somebody asking what they mean. Two ways that
// breaks, and this file guards both.
//
// ONE. THE EXCLUSIONS GO MISSING. Demo schools, the SAMPLE game seeded into
// every new account, soft-deleted games, deleted schools and period dividers
// are all excluded. Drop any one and the number silently inflates -- and an
// inflated number is not a bug anybody notices, it is a bug that gets
// printed.
//
// TWO. THE WEEK DRIFTS. The window is Monday to Sunday, US Central. In UTC
// it is not the same window: Sunday 11:40pm Central is Monday 04:40 UTC, so
// a UTC boundary files Sunday night under a week that has not started.
// (Friday nights are safe either way -- measured, not assumed.)
//
//   node tests/activity_totals_check.js
//
// WHAT THIS FILE CANNOT DO. It reads the migration; it does not run it.
// The behaviour was verified on 2 Sep 2026 against a real PostgreSQL 16
// with a seeded world holding one of every exclusion and games placed either
// side of the boundary: expected 2/3/3/5, got 2/3/3/5, and one second before
// Monday 00:00 Central correctly fell out of the week. Re-run that by hand
// if the function body changes shape.

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Platform activity totals ===\n');

const sql = read('sql/041_activity_totals.sql');
// Only the executable half. The comments explain the exclusions at length,
// so a check reading the whole file would pass on the prose alone -- which
// is the failure mode that let a test "prove" a feed row existed by matching
// an unrelated table.
const exec = sql.replace(/--[^\n]*/g, '');

const fn = /create or replace function public\.statchat_activity_totals\(\)([\s\S]*?)\$function\$;/i.exec(exec);
chk(!!fn, 'found the totals function');
const body = fn ? fn[1] : '';

// ---- the five exclusions -------------------------------------------------
[
  [/t\.is_demo\s*=\s*false/i,                   'demo schools are excluded (tenants.is_demo)'],
  [/coalesce\(g\.is_sample,\s*false\)\s*=\s*false/i,
                                                'the seeded SAMPLE game is excluded, null-safe'],
  [/g\.deleted_at is null/i,                    'soft-deleted games are excluded'],
  [/t\.deleted_at is null/i,                    'deleted schools are excluded'],
  [/p\.is_divider\s*=\s*false/i,                'period dividers are not counted as plays'],
].forEach(([re, msg]) => chk(re.test(body), msg));

// ---- the week ------------------------------------------------------------
chk(/date_trunc\('week'/i.test(body), "the week starts with date_trunc('week') — Monday in Postgres");
chk((body.match(/America\/Chicago/g) || []).length >= 2,
    "the boundary is built in America/Chicago on both sides of the conversion");
chk(!/at time zone 'UTC'/i.test(body),
    'the boundary is not computed in UTC — that would file Sunday night in the wrong week');
chk(/interval '7 days'/.test(body), 'the window is seven days wide');
// Half-open, or a game at exactly midnight Monday lands in both weeks.
// BOTH ends of BOTH counts, and `<` must not be `<=`: the first version of
// this check used /< win\.we/, which matches inside `<= win.we`, so making
// the window inclusive passed. It also tested only one of the two counts.
// Caught by mutating and watching it stay green.
{
  const lower = (body.match(/>=\s*win\.ws/g) || []).length;
  const upper = (body.match(/<(?!=)\s*win\.we/g) || []).length;
  const bad   = (body.match(/<=\s*win\.we/g)   || []).length;
  chk(lower === 2 && upper === 2 && bad === 0,
      'both counts use a half-open window [start, end) — no game lands in two weeks'
      + ((lower === 2 && upper === 2 && bad === 0) ? ''
         : ' — found ' + lower + ' lower, ' + upper + ' strict upper, ' + bad + ' inclusive upper'));
}

// ---- one definition, four numbers ---------------------------------------
// Writing the filter twice is how the weekly figure and the total drift
// apart, and the drift is invisible until somebody adds them up.
chk(/real_games as \(/.test(body) && /real_plays as \(/.test(body),
    'the "real game" filter is defined ONCE and reused by all four counts');
chk((body.match(/is_demo/g) || []).length === 1,
    'the exclusion list appears exactly once — no second copy to fall out of step');

// ---- who may run it ------------------------------------------------------
chk(/revoke all on function public\.statchat_activity_totals\(\) from public, anon, authenticated/i.test(exec),
    'anon and authenticated are revoked — cross-tenant totals are not a customer read');
chk(/grant execute on function public\.statchat_activity_totals\(\) to service_role/i.test(exec),
    'service_role may run it');
chk(!/security definer/i.test(exec),
    'NOT security definer — the service role already bypasses RLS, so a definer would add an escalation route and buy nothing');

// ---- the verify prints a row --------------------------------------------
chk(/from public\.statchat_activity_totals\(\)/.test(exec) && /\bcommit;/.test(exec),
    'the migration verifies itself by calling the function and printing a row');

// ---- the endpoint --------------------------------------------------------
{
  const api = read('api/stats.js');
  chk(/is_super_admin/.test(api), 'api/stats.js: platform admin only');
  chk(/res\.status\(403\)/.test(api), 'api/stats.js: refuses a non-platform admin with 403');
  chk(/SUPABASE_SECRET_KEY/.test(api),
      'api/stats.js: uses the service key — no browser query can see across tenants');
  chk(/rpc\('statchat_activity_totals'\)/.test(api), 'api/stats.js: calls the function');
  // supabase-js returns { data, error }; it does not throw. A try/catch
  // around it catches nothing, which is how a failed query renders as zero.
  chk(/if \(error\)/.test(api),
      'api/stats.js: checks the returned error — supabase-js does not throw on a query error');
}

// ---- the card states its own terms --------------------------------------
// A crop of this card is going on a brochure page. If the footnote goes, the
// number becomes an unqualified claim.
{
  const ui = read('platform.html');
  chk(/id="panelNumbers"/.test(ui), 'platform: the Numbers panel exists');
  chk(/'numbers'\]/.test(ui) || /, 'numbers'\]/.test(ui), 'platform: numbers is wired into TABS');
  chk(/Real football only/.test(ui) && /demo schools/.test(ui) && /sample game/.test(ui),
      'platform: the card carries the footnote saying what it excludes');
  chk(/Monday to Sunday, US Central/.test(ui),
      'platform: the card states the week window');
  chk(/#7cb518/.test(ui) && /#ffc72c/.test(ui),
      "platform: the card uses the logo's own green and gold");
  chk(/#scNumbers \{/.test(ui) && !/:root\s*\{[^}]*--n-ink/.test(ui),
      'platform: the card defines its palette on ITSELF, not :root — a light console stays light');
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
