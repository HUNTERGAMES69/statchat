// Tenant scoping on the two identity endpoints — HAZARD 7
// ========================================================
// api/manage-users.js and api/invite-user.js hold the service key, so
// RLS does not apply to them. Until 24 Aug 2026 they asked "is the
// caller an admin?" and never "an admin of WHAT" — so any school's
// admin could list every user on the platform and set any of their
// passwords. Harmless with one tenant, total cross-tenant account
// takeover the moment there are two.
//
// This drives both endpoints with two schools and four callers against a
// stubbed Supabase. Two fixture faults were found while writing it, and
// both are the reason the fixtures look the way they do:
//
//   * the "no tenant" caller originally had role 'view', so the ADMIN
//     check refused it before the tenant guard was reached — and a
//     mutation deleting that guard passed. It is now an ADMIN with no
//     school, which is the real case: invited, not yet assigned.
//   * the list action was only checked for its status code, so a
//     mutation that stopped filtering passed. It now asserts WHICH users
//     come back.
//
// Both are the same mistake: asserting that a call was refused without
// asserting WHY, and asserting that a call succeeded without asserting
// what it returned.
//
// ONE MUTATION HERE IS UNCATCHABLE, and that is not a gap. Removing the
// `!target.tenant_id` half of refuseIfOtherTenant changes no behaviour:
// the comparison after it still refuses, because null !== the caller's
// tenant, and the caller can never have a null tenant at that point. It
// is defensive redundancy, kept for what it says rather than what it
// does. An uncatchable mutation and a weak test look identical in a
// report and are not the same thing.
//
//   node tests/tenant_scoping_check.js
//
// NOTE: requires the tenant columns from sql/006_tenants.sql to exist in
// the endpoints' expectations — it stubs the database, so it does not
// need a live one.

const Module = require('module'), path = require('path');
const ROOT = path.join(__dirname, '..', 'api');
const T_A='tenant-aaaa', T_B='tenant-bbbb';
const PROFILES = {
  'admin-a':  { tenant_id:T_A, role:'admin', is_super_admin:false },
  'scorer-a': { tenant_id:T_A, role:'game_entry', is_super_admin:false },
  'admin-b':  { tenant_id:T_B, role:'admin', is_super_admin:false },
  'super':    { tenant_id:null, role:'view',  is_super_admin:true },
  // AN ADMIN WITH NO SCHOOL. The earlier fixture gave this user role
  // 'view', so the admin check refused it first and the tenant guard was
  // never reached — a mutation removing that guard passed. This is the
  // real case: an admin invited but not yet assigned a tenant.
  'orphan-admin': { tenant_id:null, role:'admin', is_super_admin:false },
};
const EMAILS = Object.fromEntries(Object.keys(PROFILES).map(k => [k, k + '@x.edu']));
let acted = [];
function load(callerId){
  acted = [];
  const real = Module._resolveFilename;
  Module._resolveFilename = function(r,...a){
    if (r === '@supabase/supabase-js') return '@supabase/supabase-js';
    return real.call(this,r,...a); };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: callerId } } }),
      resetPasswordForEmail: async e => { acted.push(['reset',e]); return {}; },
      admin: {
        listUsers: async () => ({ data: { users: Object.keys(PROFILES).map(id =>
          ({ id, email:EMAILS[id], created_at:'', last_sign_in_at:'', email_confirmed_at:'', banned_until:null })) } }),
        updateUserById: async (id,p) => { acted.push([p.password?'setPassword':'ban',id]); return {}; },
        deleteUser: async id => { acted.push(['delete',id]); return {}; },
        inviteUserByEmail: async (e,o) => { acted.push(['invite',e,o&&o.data]); return { data:{user:{id:'new'}} }; },
      }
    },
    from: () => ({
      select: () => ({
        eq: (col,val) => ({ limit: async () => ({ data: [PROFILES[val] || null] }) }),
        in: async () => ({ data: Object.entries(PROFILES).map(([id,p]) =>
          ({ id, display_name:id, role:p.role, tenant_id:p.tenant_id })) })
      }),
      update: () => ({ eq: async () => { acted.push(['update']); return {}; } })
    })
  };
  require.cache['@supabase/supabase-js'] = { id:'@supabase/supabase-js', loaded:true,
    exports:{ createClient: () => client } };
  for (const f of ['manage-users.js','invite-user.js']) delete require.cache[require.resolve(path.join(ROOT,f))];
  const mu = require(path.join(ROOT,'manage-users.js')), iu = require(path.join(ROOT,'invite-user.js'));
  Module._resolveFilename = real;
  return { mu, iu };
}
function res(){ const r={code:null,body:null}; r.setHeader=()=>{};
  r.status=c=>{r.code=c;return r;}; r.json=b=>{r.body=b;return r;}; r.end=()=>r; return r; }
const H = c => ({ authorization:'Bearer '+c });
let fails=0; const chk=(o,m)=>{console.log((o?'  ok   ':'  FAIL ')+m); if(!o)fails++;};

(async()=>{
  process.env.SUPABASE_URL='https://x'; process.env.SUPABASE_SECRET_KEY='k';

  let {mu} = load('admin-a');
  for (const [action, body, label] of [
    ['setPassword',{userId:'admin-b',newPassword:'longenough1'},"set another school's admin password"],
    ['delete',     {userId:'admin-b'},                "delete another school's admin"],
    ['setRole',    {userId:'admin-b',role:'view'},    "demote another school's admin"],
    ['setDisabled',{userId:'admin-b',disabled:true},  "disable another school's admin"],
    ['sendReset',  {email:'admin-b@x.edu'},           "reset another school's admin by email"],
    ['resendInvite',{email:'admin-b@x.edu'},          "re-invite another school's admin"],
  ]) { const r=res(); await mu({method:'POST',headers:H('admin-a'),body:Object.assign({action},body)},r);
       chk(r.code===403 && acted.length===0, 'CANNOT '+label+' ('+r.code+')'); }

  ({mu}=load('admin-a')); let r=res();
  await mu({method:'POST',headers:H('admin-a'),body:{action:'setPassword',userId:'scorer-a',newPassword:'longenough1'}},r);
  chk(r.code===200,'CAN act on their own scorer ('+r.code+')');

  // THE LIST MUST BE FILTERED — asserted on its contents, not just its
  // status. A mutation that stopped filtering passed a version of this
  // file that never looked at what came back.
  ({mu}=load('admin-a')); r=res();
  await mu({method:'POST',headers:H('admin-a'),body:{action:'list'}},r);
  const ids=(r.body&&r.body.users||[]).map(u=>u.id).sort();
  chk(r.code===200 && ids.join(',')==='admin-a,scorer-a',
      'list returns ONLY this school ('+ids.join(',')+')');

  ({mu}=load('super')); r=res();
  await mu({method:'POST',headers:H('super'),body:{action:'list'}},r);
  chk((r.body&&r.body.users||[]).length===Object.keys(PROFILES).length,
      'the platform sees every school in list');

  ({mu}=load('super')); r=res();
  await mu({method:'POST',headers:H('super'),body:{action:'setPassword',userId:'admin-b',newPassword:'longenough1'}},r);
  chk(r.code===200,'the platform CAN reset any password ('+r.code+')');

  // AN ADMIN WITH NO SCHOOL is refused — the case the old fixture missed.
  ({mu}=load('orphan-admin')); r=res();
  await mu({method:'POST',headers:H('orphan-admin'),body:{action:'list'}},r);
  chk(r.code===403,'an ADMIN with no tenant is refused ('+r.code+')');
  ({mu}=load('orphan-admin')); r=res();
  await mu({method:'POST',headers:H('orphan-admin'),body:{action:'setPassword',userId:'admin-b',newPassword:'longenough1'}},r);
  chk(r.code===403 && acted.length===0,'and cannot act on anybody ('+r.code+')');

  // A TARGET WITH NO TENANT is refused too, not just a caller with none.
  // Somebody invited but not yet assigned to a school is nobody's to act
  // on, and "unassigned" must not read as "unprotected". A mutation that
  // dropped the `!target.tenant_id` half of the check passed until this
  // case existed.
  ({mu}=load('admin-a')); r=res();
  await mu({method:'POST',headers:H('admin-a'),body:{action:'delete',userId:'orphan-admin'}},r);
  chk(r.code===403 && !acted.some(a=>a[0]==='delete'),
      'a school admin cannot act on an UNASSIGNED user ('+r.code+')');

  ({mu}=load('super')); r=res();
  await mu({method:'POST',headers:H('super'),body:{action:'delete',userId:'super'}},r);
  chk(r.code===400,'even the platform cannot delete itself ('+r.code+')');

  let {iu}=load('admin-a'); r=res();
  await iu({method:'POST',headers:H('admin-a'),body:{email:'new@a.edu',fullName:'Dana Whitfield',tenantId:T_B}},r);
  const inv=acted.find(a=>a[0]==='invite');
  chk(inv&&inv[2]&&inv[2].tenant_id===T_A,"invite carries the CALLER's tenant, body ignored ("+(inv&&inv[2]&&inv[2].tenant_id)+')');
  chk(inv&&inv[2]&&inv[2].display_name==='Dana Whitfield','and the name');

  ({iu}=load('orphan-admin')); r=res();
  await iu({method:'POST',headers:H('orphan-admin'),body:{email:'x@y.edu'}},r);
  chk(r.code===400 && !acted.some(a=>a[0]==='invite'),'an admin with no school cannot invite ('+r.code+')');

  console.log(fails?'\n'+fails+' FAILURES':'\nALL PASS'); process.exit(fails?1:0);
})();

