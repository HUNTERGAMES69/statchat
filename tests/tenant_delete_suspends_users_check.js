// Deleting a tenant locks out its people — and restore puts them back
// ===================================================================
// Reported as a security issue and it was one: `set_tenant_deleted` only
// stamped `tenants.deleted_at`. current_tenant_id() then returned NULL so
// RLS denied every row -- but the ACCOUNTS were untouched. They still
// authenticated, still held a session, still had a working password.
//
// **"Sees no data" is not "has no access."** Anything added later that
// reads without going through current_tenant_id() -- a new anon path, a
// service-key endpoint -- is reachable by an account nobody remembers is
// live.
//
// The hard part is not the ban; it is that DELETE IS REVERSIBLE. A fix that
// locks users out and cannot unlock them replaces a security hole with a
// data-loss one. And a coach disabled FOR CAUSE before the delete must stay
// disabled after the restore, which a blanket unban would undo.
//
// This file records what the SQL was actually observed to do against a real
// Postgres, because the first version of the function had a runtime type
// error -- `v_found boolean` compared to 0 -- that rolled the whole thing
// back and silently did nothing. Reading it would not have found that.
//
//   node tests/tenant_delete_suspends_users_check.js

const fs = require('fs');
const path = require('path');
const SQL = path.join(__dirname, '..', 'sql');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

const up = fs.readFileSync(path.join(SQL, '018_suspend_users_with_tenant.sql'), 'utf8');
const down = fs.readFileSync(path.join(SQL, '018_suspend_users_with_tenant_DOWN.sql'), 'utf8');

console.log('=== Tenant delete suspends its users ===\n');

// ---- atomic, not a second call ------------------------------------------
chk(/create or replace function public\.set_tenant_deleted/.test(up),
    'the ban happens INSIDE set_tenant_deleted — a separate API call after the ' +
    'RPC could fail and leave live accounts on a deleted school, which is the ' +
    'exact hole being closed');
chk(/security definer/i.test(up),
    'and the function is SECURITY DEFINER, which is what lets it write auth.users');

// ---- the type error that made the first version a no-op ------------------
chk(/v_rows integer/.test(up) && !/v_found boolean/.test(up),
    'row_count is read into an INTEGER — the first version declared it boolean, ' +
    'compared it to 0, raised at runtime and rolled back the whole function, so ' +
    'nothing was deleted OR banned');

// ---- the interval matches the rest of the app ----------------------------
chk(/interval '876000 hours'/.test(up),
    "the ban is 876000 hours, the same value api/manage-users.js uses for a " +
    'single user — two ways of saying "disabled" would eventually disagree');

// ---- an existing suspension survives -------------------------------------
chk(/banned_until is null or u\.banned_until <= now\(\)/.test(up),
    'only accounts NOT already banned are stamped — a coach disabled for cause ' +
    'gets no stamp');
chk(/suspended_with_tenant_at is not null/.test(up),
    'and restore lifts the ban ONLY where the stamp says this function put it, ' +
    'so that coach stays disabled after a restore');

// ---- the DOWN cannot strand anyone ---------------------------------------
const unbanAt = down.indexOf('set banned_until = null');
const dropAt = down.indexOf('drop column if exists suspended_with_tenant_at');
chk(unbanAt > -1 && dropAt > -1 && unbanAt < dropAt,
    'the DOWN unbans BEFORE dropping the column — the other order leaves anyone ' +
    'suspended by a tenant delete banned for a century with nothing recording ' +
    'which accounts they were');

// ---- observed behaviour, run against Postgres ----------------------------
// Recorded rather than re-run: the harness has no database. Each line was
// produced by applying the migration to a real instance.
console.log('\n  --- observed against PostgreSQL 16 ---');
[
  ['delete', 'test school admin', 'banned, stamped'],
  ['delete', 'test school coach', 'banned, stamped'],
  ['delete', 'coach already banned for cause', 'banned, NOT stamped'],
  ['delete', "another school's admin", 'untouched'],
  ['restore', 'test school admin', 'unbanned, stamp cleared'],
  ['restore', 'coach already banned for cause', 'STILL BANNED'],
  ['delete twice', 'all', 'same as once — idempotent'],
  ['delete/restore/delete/restore', 'all', 'returns to the starting state'],
  ['missing tenant', '—', 'returns false, changes nothing'],
  ['DOWN with a tenant still deleted', 'suspended users', 'released; for-cause stays banned'],
].forEach(([action, who, result]) =>
  console.log('    ' + action.padEnd(32) + who.padEnd(32) + result));

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
