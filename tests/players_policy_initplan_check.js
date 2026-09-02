// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// The players policy must evaluate its helpers ONCE, not per row
// ==============================================================
// The dashboard's roster count took 3,591ms in Andy's browser on 2 Sep 2026
// while its six sibling queries finished inside a second. Sixty-five rows.
//
// players_select read:
//     using (tenant_id = public.current_tenant_id() or public.is_super_admin())
//
// Both helpers are `stable security definer`, which is correct and is not
// enough: STABLE does not hoist a call out of a row filter, and the OR makes
// the predicate unindexable. So Postgres sequentially scanned every player
// row on the platform and called BOTH functions for each one -- each of them
// a lookup into `profiles`.
//
// Measured on PostgreSQL 16, 32 schools and 2,080 players:
//     before   20,433 shared buffer hits to return 65 rows
//     after         124
//
// Wrapping each call in a scalar subquery makes it an InitPlan: computed
// once, then compared as a constant. `(select f())` returns exactly what
// `f()` returns for a STABLE function, so nothing about who-sees-what
// changes -- verified by counting visible rows for all 32 seeded users under
// both policies (identical) and for a platform admin (all 2,080).
//
//   node tests/players_policy_initplan_check.js

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const sqlDir = path.join(root, 'sql');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== players policy: InitPlan, not per-row ===\n');

const file = 'sql/043_players_policy_initplan.sql';
const raw = fs.readFileSync(path.join(root, file), 'utf8');
const exec = raw.replace(/--[^\n]*/g, '');

// ---- the shape of the fix ------------------------------------------------
chk(/alter policy players_select on public\.players/i.test(exec),
    '043 alters players_select');
chk(/alter policy players_write on public\.players/i.test(exec),
    '043 alters players_write');

// ALTER, not drop-and-create. A dropped policy is an open table, even for the
// instant inside a transaction, and recreating from a file is how a later
// migration's changes get reverted.
chk(!/drop policy/i.test(exec),
    'it ALTERs rather than dropping and recreating — the policy is never absent, '
    + 'and nothing is retyped from an outdated source');

// Every helper call must be wrapped. An unwrapped one left behind keeps the
// whole predicate per-row, so a partial fix is no fix.
{
  const bare = exec.match(/(?<!\(\s*select\s)\bpublic\.(current_tenant_id|is_super_admin|current_user_role)\(\)/g) || [];
  chk(bare.length === 0,
      'every helper call is wrapped in (select ...) — one bare call keeps the filter per-row'
      + (bare.length ? ' — found ' + bare.length : ''));
  const wrapped = (exec.match(/\(select public\.(current_tenant_id|is_super_admin|current_user_role)\(\)\)/g) || []).length;
  chk(wrapped >= 7, 'all seven call sites are wrapped (found ' + wrapped + ')');
}

// ---- the verify prints a row --------------------------------------------
chk(/select[\s\S]*pg_policies[\s\S]*commit;/i.test(exec),
    'it verifies itself against pg_policies and returns a row');

// ---- the safety property this migration RELIES ON ------------------------
// Rewriting a policy by hand is only safe when no later migration has
// redefined it. games_select gained `deleted_at is null` in 012 and the
// tenant policies were rewritten in 016 -- retyping either from sql/009
// would put deleted games back in front of customers. players_select and
// players_write exist ONLY in 009 and the baseline, which is what makes this
// one safe. If that ever stops being true, this check fails.
{
  const later = fs.readdirSync(sqlDir)
    .filter(f => /^\d{3}_/.test(f) && !/_DOWN\.sql$/.test(f))
    .filter(f => parseInt(f.slice(0, 3), 10) > 9 && f !== path.basename(file))
    .filter(f => /players_(select|write)/.test(fs.readFileSync(path.join(sqlDir, f), 'utf8')));
  chk(later.length === 0,
      'no migration after 009 redefines the players policies — which is the only reason '
      + 'rewriting them from the file was safe'
      + (later.length ? ' — BUT FOUND: ' + later.join(', ')
                      + ' (043 may have reverted them; check before trusting either)' : ''));
}

// ---- and the trap is still out there -------------------------------------
// 28 policies share the shape. This is a note, not a failure: fixing them
// needs expressions derived from the live catalogue rather than from sql/009.
{
  let remaining = 0;
  fs.readdirSync(sqlDir).filter(f => f.endsWith('.sql') && !/_DOWN\.sql$/.test(f))
    .forEach(f => {
      const s = fs.readFileSync(path.join(sqlDir, f), 'utf8').replace(/--[^\n]*/g, '');
      remaining += (s.match(/(?<!\(\s*select\s)\bpublic\.current_tenant_id\(\)/g) || []).length;
    });
  console.log('\n  note: ' + remaining + ' unwrapped current_tenant_id() call sites remain across sql/. '
              + 'Each one is a per-row function call in a policy.\n  They need expressions read from '
              + 'pg_policies, not retyped from sql/009 — see the comment in 043.\n');
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
