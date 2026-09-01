// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// The Users tab tenant picker
// ===========================
// Andy, 1 Sep 2026: "users dropdown shows all tenants (21). That 21 count
// includes deleted tenants."
//
// TWO SEPARATE FAULTS behind one sentence, which is why this file asserts
// both:
//
//   1. THE FIGURE WAS AN ACCOUNT COUNT UNDER A TENANT LABEL. The option read
//      "All tenants (21)" and 21 was visible.length -- users, not schools.
//      A label naming one thing over a figure counting another gets read as
//      the label says, and was.
//
//   2. DELETED SCHOOLS SAT AMONG THE LIVE ONES. The group list is built from
//      the accounts rather than the tenants table, deliberately, so an
//      orphaned login stays findable. But the console only ever saw a name,
//      so a deleted school was indistinguishable from a live one.
//
// THE REAL FIX IS NOT IN THIS FILE. Migration 018 locks out a tenant's
// accounts when it is deleted, and 034 backfills the schools deleted before
// 018 existed. Once those accounts are disabled they fall out of the default
// list on their own, through the disabled filter that was already there.
// This file asserts the OUTCOME either way, so it still fails if the display
// silently starts depending on something else.
//
// Drives platform.html's real renderer through the same jsdom mock
// platformui.js uses.
//
//   node tests/tenant_picker_check.js

const fs = require('fs');
const { JSDOM } = require('jsdom');
const SRC = fs.readFileSync(require('path').join(__dirname, '..', 'platform.html'), 'utf8');

let pass = 0, fail = 0;
const chk = (label, ok, detail) => { if (ok) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (detail ? '\n       ' + detail : '')); } };

const U = (o) => Object.assign({
  id:'u'+Math.random(), email:'x@y.z', displayName:'X', role:'admin',
  tenantName:'Bayou High', tenantId:'t1',
  emailConfirmedAt:'2026-08-02T10:00:00Z', lastSignInAt:'2026-08-20T10:00:00Z',
  disabled:false, mfaVerified:false, mustChangePassword:false,
  tenantDeleted:false }, o);

const USERS = [
  // two live schools
  U({ id:'r1', displayName:'Riverside AD',   tenantName:'Riverside High', tenantId:'t1' }),
  U({ id:'r2', displayName:'Riverside Coach',tenantName:'Riverside High', tenantId:'t1', role:'game_entry' }),
  U({ id:'n1', displayName:'Northgate AD',   tenantName:'Northgate High', tenantId:'t2' }),
  // A DELETED SCHOOL. 018/034 lock these accounts out, so they arrive
  // disabled -- which is exactly why the default view must not show them
  // and the "show disabled" view must say what they are.
  U({ id:'g1', displayName:'Gone AD',    tenantName:'Old Gone High', tenantId:'t3',
      tenantDeleted:true, disabled:true }),
  U({ id:'g2', displayName:'Gone Coach', tenantName:'Old Gone High', tenantId:'t3',
      tenantDeleted:true, disabled:true, role:'game_entry' }),
  // A LIVE SCHOOL WITH THE SAME NAME as a deleted one: deleting and
  // recreating is how a school changes plan, and the two must not merge.
  U({ id:'x1', displayName:'New Gone AD', tenantName:'Old Gone High', tenantId:'t4' }),
  U({ id:'u1', displayName:'No School',  tenantName:null, tenantId:null }),
  U({ id:'u-me', displayName:'Andy', role:'admin', tenantName:null, tenantId:null }),
];
let PAYLOAD_EXTRA = {};

(async () => {
  const dom = new JSDOM(SRC, { runScripts:'dangerously', url:'https://statchat.co/platform.html',
    beforeParse(w) {
      w.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        if (body.action === 'list') return { ok:true, json: async () =>
          Object.assign({ users:USERS, signedInUserId:'u-me' }, PAYLOAD_EXTRA) };
        return { ok:true, json: async () => ({ success:true }) };
      };
      const session = { user:{ id:'u-me' }, access_token:'tok' };
      w.supabase = { createClient: () => ({
        auth: { getSession: async () => ({ data:{ session } }),
          onAuthStateChange: (cb) => { setTimeout(() => cb('SIGNED_IN', session), 0);
            return { data:{ subscription:{ unsubscribe(){} } } }; },
          signOut: async () => ({ error:null }) },
        from: () => ({ select: () => ({ eq: () => ({ limit: async () =>
          ({ data:[{ is_super_admin:true, tenant_id:null }], error:null }) }),
          order: () => ({ then: undefined }) }) }),
        rpc: async () => ({ data:null, error:null }),
      }) };
      w.alert = () => {}; w.confirm = () => true;
    } });
  const w = dom.window, d = w.document;
  await new Promise(r => setTimeout(r, 400));
  // Same route platformui.js uses: the value is 'grp:all', and loadUsers is
  // called directly rather than trusting a synthesized change event.
  if (!d.querySelector('#usersBody table')) {
    try { await w.loadUsers('tok'); } catch (e) {}
    const pick = d.getElementById('userTenantPick');
    if (pick && [...pick.options].some(o => o.value === 'grp:all')) {
      pick.value = 'grp:all';
      try { await w.loadUsers('tok'); } catch (e) {}
    }
  }
  await new Promise(r => setTimeout(r, 200));

  // The name cell now carries the address on a second line, so the cell's
  // whole textContent is "Andy Martinandy@x.z". Match the name's own span.
  const rowFor = (name) => [...d.querySelectorAll('#usersBody tr')]
    .find(tr => (tr.querySelector('td.name .uname') || {}).textContent === name);
  // Throws rather than returning null, so a negative assertion cannot pass
  // simply because the row was never rendered -- which is exactly how the
  // first run of this file reported 3 green checks against an empty table.
  const pills = (name) => {
    const r = rowFor(name);
    if (!r) throw new Error('no row for "' + name + '" -- the list did not render, ' +
                            'so nothing below was actually tested');
    return [...r.querySelectorAll('.pill')].map(p => p.textContent.trim());
  };

  const pick = d.getElementById('userTenantPick');
  const opts = () => [...pick.options].map(o => o.textContent);
  const allOpt = () => opts().find(t => t.indexOf('All tenants') === 0) || '';

  chk('the picker rendered', !!pick && pick.options.length > 1, JSON.stringify(opts()));

  // ---- THE COUNT ----------------------------------------------------
  // 6 accounts are enabled (2 deleted-school ones are disabled and hidden),
  // across 3 live groups: Riverside, Northgate, and the recreated Old Gone.
  chk('the All-tenants line names BOTH numbers, not one figure under the other label',
      /schools/.test(allOpt()) && /accounts?/.test(allOpt()), allOpt());
  chk('...the account figure counts accounts', /6 accounts/.test(allOpt()), allOpt());
  chk('...the school figure counts schools, and excludes the deleted one',
      /\b3 schools/.test(allOpt()), allOpt());
  chk('...and excludes the platform and unassigned pseudo-groups from the school count',
      !/[45] schools/.test(allOpt()), allOpt());

  // ---- DELETED SCHOOLS ARE NOT IN THE DEFAULT LIST -------------------
  // Not because the picker filters them, but because 018/034 disable their
  // accounts and the disabled filter already runs. Asserted anyway: it is
  // the behaviour Andy reported, whichever layer delivers it.
  chk('a deleted school is absent while disabled accounts are hidden',
      !opts().some(t => /deleted school/.test(t)), JSON.stringify(opts()));

  // ---- AND WHEN YOU DO GO LOOKING FOR THEM ---------------------------
  const toggle = d.getElementById('showDisabledUsers');
  chk('there is a show-disabled toggle to find them with', !!toggle);
  if (toggle){
    toggle.checked = true;
    toggle.dispatchEvent(new w.Event('change', { bubbles:true }));
    await new Promise(r => setTimeout(r, 150));
    chk('with disabled shown, the deleted school appears AND says it is deleted',
        opts().some(t => /Old Gone High \u2014 deleted school/.test(t)),
        JSON.stringify(opts()));
    // THE COLLISION. A live school and a deleted one share the name; they
    // must be two entries, not one merged group hiding live staff among
    // locked-out ones.
    const gone = opts().filter(t => t.indexOf('Old Gone High') === 0);
    chk('...and the live school of the same name stays a separate entry',
        gone.length === 2, JSON.stringify(gone));
    chk('...with the deleted one sorted below the live schools',
        opts().findIndex(t => /deleted school/.test(t)) >
        opts().findIndex(t => /^Riverside High/.test(t)), JSON.stringify(opts()));
  }

  console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
  process.exitCode = fail ? 1 : 0;
})();
