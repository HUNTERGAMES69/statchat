// Creating a school — api/create-tenant.js
// =======================================
// The one endpoint that brings a customer into existence, so it is also
// the one place where a wrong identity check creates a tenant nobody
// asked for.
//
// TWO STEPS THAT CANNOT BE ONE TRANSACTION:
//
//   1. create_tenant() makes the tenants row AND the teams row
//      atomically (migration 013, proven by rollback in scratch). A
//      school with no team is invisibly broken — thirteen pages read the
//      team to find out who "we" are and every one comes back empty.
//   2. inviteUserByEmail() talks to Supabase Auth, which is outside that
//      transaction and cannot be rolled into it.
//
// So a failure at step 2 leaves a real school with no users. That is
// REPORTED as exactly that (HTTP 207) rather than hidden behind a
// generic error or "cleaned up" by deleting the tenant — which would
// turn a typo in an email address into the destruction of a record, and
// the delete could fail too.
//
//   node tests/create_tenant_check.js

const Module = require('module');
const path = require('path');
const API = path.join(__dirname, '..', 'api', 'create-tenant.js');

const PROFILES = {
  'super':   { is_super_admin: true },
  'admin-a': { is_super_admin: false },
};

function load(callerId, opts) {
  opts = opts || {};
  const calls = { rpc: [], invite: [], update: [] };
  const real = Module._resolveFilename;
  Module._resolveFilename = function (r, ...a) {
    if (r === '@supabase/supabase-js') return '@supabase/supabase-js';
    return real.call(this, r, ...a);
  };
  const client = {
    auth: {
      getUser: async () => callerId
        ? ({ data: { user: { id: callerId } }, error: null })
        : ({ data: null, error: { message: 'bad token' } }),
      admin: {
        inviteUserByEmail: async (email, o) => {
          calls.invite.push({ email, data: o && o.data });
          if (opts.inviteError) return { data: null, error: { message: opts.inviteError } };
          return { data: { user: { id: 'new-user' } }, error: null };
        }
      }
    },
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      if (opts.rpcError) return { data: null, error: { message: opts.rpcError } };
      return { data: 'tenant-new', error: null };
    },
    from: () => ({
      select: () => ({ eq: (c, v) => ({ limit: async () => ({
        data: PROFILES[v] ? [PROFILES[v]] : [], error: null }) }) }),
      update: (patch) => ({ eq: async (c, v) => {
        calls.update.push({ patch, id: v });
        return { error: opts.roleError ? { message: opts.roleError } : null };
      } })
    })
  };
  require.cache['@supabase/supabase-js'] = { id: '@supabase/supabase-js', loaded: true,
    exports: { createClient: () => client } };
  delete require.cache[require.resolve(API)];
  const h = require(API);
  Module._resolveFilename = real;
  return { h, calls };
}
function res() { const r = { code: null, body: null };
  r.setHeader = () => {}; r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; return r; }; return r; }
const post = (body, caller) => ({ method: 'POST', body,
  headers: { authorization: caller ? 'Bearer t' : '' } });

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

(async () => {
  process.env.SUPABASE_URL = 'https://x';
  process.env.SUPABASE_SECRET_KEY = 'k';

  // ---- only the platform ---------------------------------------------
  let { h, calls } = load('admin-a');
  let r = res();
  await h(post({ name: 'Sneaky High' }, true), r);
  chk(r.code === 403 && calls.rpc.length === 0,
      'a SCHOOL admin cannot create a school (' + r.code + ')');

  ({ h, calls } = load(null));
  r = res();
  await h(post({ name: 'X' }, true), r);
  chk(r.code === 401 && calls.rpc.length === 0, 'an invalid session is refused (' + r.code + ')');

  // ---- the happy path -------------------------------------------------
  ({ h, calls } = load('super'));
  r = res();
  await h(post({ name: 'Riverside', fullName: 'Riverside High School',
                 adminEmail: 'coach@riverside.edu', adminName: 'Dana Whitfield' }, true), r);
  chk(r.code === 200, 'the platform creates a school (' + r.code + ')');
  chk(calls.rpc[0] && calls.rpc[0].name === 'create_tenant',
      'through create_tenant(), so the tenant and its team are atomic');
  chk(calls.rpc[0] && calls.rpc[0].args.p_name === 'Riverside', 'with the name');
  chk(calls.invite[0] && calls.invite[0].data.tenant_id === 'tenant-new',
      'the invite carries the NEW tenant id, so the profile has a school from the instant it exists');
  chk(calls.invite[0] && calls.invite[0].data.display_name === 'Dana Whitfield',
      'and their name, so they are not displayed as an email address');
  chk(calls.update[0] && calls.update[0].patch.role === 'admin',
      'and they are made an admin AFTER the invite — role is never read from client metadata');

  // ---- a school with nobody in it -------------------------------------
  ({ h, calls } = load('super'));
  r = res();
  await h(post({ name: 'Later High' }, true), r);
  chk(r.code === 200 && calls.invite.length === 0,
      'a school can be created with NO admin — staffing it later is legitimate');
  chk(r.body && r.body.invited === false, 'and the response says nobody was invited');

  // ---- the email is checked BEFORE the school exists -------------------
  ({ h, calls } = load('super'));
  r = res();
  await h(post({ name: 'Typo High', adminEmail: 'not-an-email' }, true), r);
  chk(r.code === 400 && calls.rpc.length === 0,
      'a malformed email is refused BEFORE the school is created, so a typo cannot orphan a tenant');

  // ---- the partial failure, which is the whole point -------------------
  ({ h, calls } = load('super', { inviteError: 'mailbox full' }));
  r = res();
  await h(post({ name: 'Orphan High', adminEmail: 'x@y.edu' }, true), r);
  chk(r.code === 207, 'a failed invite returns 207, not 500 — the school DID get created (' + r.code + ')');
  chk(r.body && /school is in the list/i.test(r.body.error || ''),
      'and says so, so the operator knows to invite again rather than re-create');
  chk(!/delete/i.test(JSON.stringify(calls)),
      'and the tenant is NOT deleted to tidy up — that turns a typo into destroying a record');

  ({ h, calls } = load('super', { roleError: 'permission denied' }));
  r = res();
  await h(post({ name: 'Halfway High', adminEmail: 'x@y.edu' }, true), r);
  chk(r.code === 207 && /admin/i.test(r.body.error || ''),
      'a failed role update is also reported as partial, with what to do about it');

  // ---- create_tenant's own errors reach the operator -------------------
  ({ h, calls } = load('super', { rpcError: 'A school called "Neville" already exists.' }));
  r = res();
  await h(post({ name: 'Neville' }, true), r);
  chk(r.code === 400 && /already exists/.test(r.body.error || ''),
      'a duplicate name is passed through in words, not replaced with something generic');

  ({ h } = load('super'));
  r = res();
  await h(post({ name: '   ' }, true), r);
  chk(r.code === 400, 'a blank name is refused');

  console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
