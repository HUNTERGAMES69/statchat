// The platform console — platform.html
// ====================================
// The super-admin account has no tenant, so every other page in the app
// shows it a MERGED VIEW of every school with nothing saying whose data
// is on screen. This page names the school before it shows anything
// belonging to one, and it is the only place the platform account
// currently makes sense.
//
// WHAT THIS CHECKS, and why each one:
//
//   * A NON-PLATFORM ACCOUNT SEES NOTHING. The gate is rendered first and
//     the console revealed afterwards, never the other way round --
//     rendering first and hiding on failure flashes real data at the
//     wrong person.
//   * RESTORE GOES THROUGH restore_game(). Not an UPDATE. A SELECT policy
//     that hides deleted rows makes the equivalent update impossible
//     (see sql/012), so a well-meaning "simplification" back to an update
//     would silently stop working.
//   * THE DELETED LIST NAMES THE SCHOOL. Since migration 010 a designator
//     is only unique WITHIN a tenant, so "2026-W1" alone is ambiguous the
//     moment there are two customers.
//   * NO "ACT AS". MULTI_TENANT_PLAN.md defers impersonation until there
//     is an audit trail, and this page is exactly where it would quietly
//     appear.
//
//   node tests/platform_console_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const FILE = path.join(__dirname, '..', 'platform.html');
const raw = fs.readFileSync(FILE, 'utf8');
// Comments stripped before matching: four checks earlier in this project
// matched their own explanatory prose and failed correct files.
const code = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/<!--[\s\S]*?-->/g, '');

function boot(profileRow, opts) {
  opts = opts || {};
  const dom = new JSDOM(raw.replace(/<script src="https:\/\/cdn[^"]*"><\/script>/, ''), {
    runScripts: 'outside-only', url: 'https://www.statchat.co/platform.html'
  });
  const w = dom.window;
  const calls = { rpc: [], from: [], fetch: [] };
  let authCb = null;
  // THE STUB HAS TO ACTUALLY FILTER. A first version ignored .not() and
  // returned every game for the deleted-games query, so the list rendered
  // the LIVE game first and the restore click sent its id. The check
  // failed and the page was correct. A stub that does not do what the
  // query does cannot test a page that depends on the query doing it.
  // THE STUB PROJECTS COLUMNS, like PostgREST does. Without this a
  // mutation that stopped selecting logo_url still saw it in the fixture
  // and passed — the stub was handing back columns the page never asked
  // for. Embedded resources ("tenants(name)") are kept whole.
  const project = (rows, cols) => {
    if (!cols) return rows;
    const want = cols.split(',').map(c => c.trim()).filter(Boolean);
    const plain = want.filter(c => !c.includes('('));
    const embeds = want.filter(c => c.includes('(')).map(c => c.split('(')[0]);
    return rows.map(r => {
      const o = {};
      plain.forEach(c => { if (c in r) o[c] = r[c]; });
      embeds.forEach(c => { if (c in r) o[c] = r[c]; });
      return o;
    });
  };
  const q = (rows) => {
    let out = rows, cols = null;
    const api = {
      select(c){ cols = c; return api; },
      eq(col, val){ out = out.filter(r => r[col] === val); return api; },
      not(col, op, val){
        if (op === 'is' && val === null) out = out.filter(r => r[col] != null);
        return api;
      },
      order(){ return Promise.resolve({ data: project(out, cols), error: null }); },
      limit(){ return Promise.resolve({ data: project(out, cols), error: null }); },
      then(res){ return Promise.resolve({ data: project(out, cols), error: null }).then(res); }
    };
    return api;
  };
  w.supabase = { createClient: () => ({
    auth: { onAuthStateChange: cb => { authCb = cb; } },
    rpc: async (name, args) => { calls.rpc.push({ name, args });
      return { data: opts.rpcData === undefined ? true : opts.rpcData, error: opts.rpcError || null }; },
    from: (t) => { calls.from.push(t);
      if (t === 'profiles') return q([profileRow]);
      if (t === 'tenants')  return q(opts.tenants || []);
      if (t === 'games')    return q(opts.games || []);
      return q([]); }
  }) };
  // The users tab goes through api/manage-users.js, not a table query --
  // auth.users is not readable from the browser at all.
  w.fetch = async (url, init) => {
    calls.fetch.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return { ok: !opts.usersError, status: opts.usersError ? 500 : 200,
             json: async () => opts.usersError
               ? { error: opts.usersError }
               : { users: opts.users || [] } };
  };
  w.eval([...w.document.querySelectorAll('script')].map(s => s.textContent).join('\n;\n'));
  return { w, d: w.document, calls,
           fire: (s) => authCb && authCb('INITIAL_SESSION', s) };
}
const wait = () => new Promise(r => setTimeout(r, 40));
const session = { access_token: 'tok-abc', user: { id: 'u1', email: 'statchatadmin@statchat.co' } };

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

(async () => {
  // ---- a tenant admin is refused, and never sees the console ----------
  let b = boot({ id: 'u2', is_super_admin: false, tenant_id: 't1' });
  b.fire({ user: { id: 'u2', email: 'coach@school.edu' } });
  await wait();
  chk(b.d.getElementById('console').classList.contains('hidden'),
      'a NON-platform account never sees the console');
  chk(!b.d.getElementById('gate').classList.contains('hidden'),
      'and is left on the gate, which was rendered first rather than hidden after');
  chk(/platform account/i.test(b.d.getElementById('gateText').textContent),
      'with an explanation rather than an empty page');

  // ---- the platform gets in ------------------------------------------
  b = boot({ id: 'u1', is_super_admin: true, tenant_id: null }, {
    // THE CREST LIVES ON `teams`, embedded through the foreign key -- it
    // is NOT a column on tenants. 006 put a copy there, the app was never
    // repointed at it, and that copy went stale the first time a tenant
    // uploaded a logo. 017 dropped it.
    tenants: [{ id:'t1', name:'Neville', full_name:'Neville High School',
                teams:[{ logo_url:'https://cdn/neville.png' }],
                subscription:'active', renews_on:'2027-08-01', disabled_at:null, disabled_reason:null },
              { id:'t2', name:'Riverside', full_name:null, teams:[{ logo_url:null }],
                subscription:'trial', renews_on:null, disabled_at:'2026-08-24T22:00:00Z', disabled_reason:'Non-payment' }],
    users: [
      { id:'u1', email:'statchatadmin@statchat.co', displayName:'Platform',
        role:'admin', lastSignInAt:'2026-08-24T23:00:00Z', emailConfirmedAt:'x',
        disabled:false, tenantId:null, tenantName:null, isSuperAdmin:true },
      { id:'u2', email:'andy@neville.edu', displayName:'Andy Martin',
        role:'admin', lastSignInAt:'2026-08-24T20:00:00Z', emailConfirmedAt:'x',
        disabled:false, tenantId:'t1', tenantName:'Neville', isSuperAdmin:false },
      { id:'u3', email:'coach@riverside.edu', displayName:'Dana Whitfield',
        role:'game_entry', lastSignInAt:null, emailConfirmedAt:null,
        disabled:false, tenantId:'t2', tenantName:'Riverside', isSuperAdmin:false },
      { id:'u4', email:'orphan@nowhere.edu', displayName:null,
        role:'view', lastSignInAt:null, emailConfirmedAt:'x',
        disabled:true, tenantId:null, tenantName:null, isSuperAdmin:false }
    ],
    games: [{ id:'g1', tenant_id:'t1', deleted_at:null },
            { id:'g2', tenant_id:'t1', deleted_at:'2026-08-24T20:00:00Z',
              designator:'2026-W2', home_team_name:'Neville', away_team_name:'Oak Grove',
              game_date:'2026-09-11', tenants:{ name:'Neville' } }]
  });
  b.fire(session);
  await wait();
  chk(!b.d.getElementById('console').classList.contains('hidden'), 'the platform sees the console');
  chk(/statchatadmin@statchat\.co/.test(b.d.getElementById('whoami').textContent),
      'and the account it is signed in as is named on screen');

  // THE CREST. A school with a logo shows it; one without shows a
  // monogram rather than a gap or a broken image — and "no logo yet" is
  // the ordinary state for a new customer, which is exactly the one the
  // platform is most likely to be looking up.
  // TAB ORDER AND LABELS, asserted because selectTab DERIVES element ids
  // from the TABS array -- 'tenants' becomes tabTenants and panelTenants.
  // A renamed panel with a stale array entry throws on click rather than
  // failing visibly, and only on the tab nobody opened during testing.
  const tabLabels = [...b.d.querySelectorAll('.tabs button')].map(x => x.textContent.trim());
  chk(tabLabels.join(' | ') === 'Tenants | Users | Recovery tools',
      'tabs read Tenants, Users, Recovery tools in that order (got: ' + tabLabels.join(' | ') + ')');
  const tabsArr = (code.match(/const TABS = \[([^\]]*)\]/) || [])[1] || '';
  ['tenants','users','recovery'].forEach(t => {
    chk(tabsArr.includes("'" + t + "'"), 'TABS includes ' + t);
    const cap = t.charAt(0).toUpperCase() + t.slice(1);
    chk(!!b.d.getElementById('tab' + cap) && !!b.d.getElementById('panel' + cap),
        'and tab' + cap + '/panel' + cap + ' both exist, so selectTab can find them');
  });

  const tenantsHtml = b.d.getElementById('tenantsBody').innerHTML;
  chk(/<img src="https:\/\/cdn\/neville\.png"/.test(tenantsHtml),
      'a tenant WITH a logo shows it');
  chk(/class="crest">R</.test(tenantsHtml),
      'a tenant WITHOUT one shows a monogram, not a gap or a broken image');
  // NO PREFILLED-LOOKING PLACEHOLDERS on the add form. "Neville" as a
  // placeholder reads as a value, and it is a REAL tenant: somebody
  // glances at a filled-looking form, presses Create, and is told a tenant
  // of that name already exists -- about a name they never typed.
  chk(!/id="add(?:Name|FullName|Email|AdminName)"[^>]*placeholder=/.test(raw),
      'the add-tenant fields carry no placeholders that read as prefilled values');

  // AND IT MUST COME FROM teams, not a column on tenants. The stale copy
  // is what made a freshly uploaded logo invisible in this console.
  chk(/teams\(logo_url\)/.test(code),
      'the crest is read from teams through the foreign key, not from a tenants column');
  // Checking the COLUMN LIST, not the whole select string: `teams(logo_url)`
  // legitimately contains "logo_url", and a first version of this matched
  // it and failed correct code.
  const tenantCols = (code.match(/tenants'\)\.select\('([^']*)'/) || [])[1] || '';
  chk(!/(^|,\s*)logo_url/.test(tenantCols.replace(/teams\([^)]*\)/g, '')),
      'and tenants is not asked for a logo_url column it no longer has');

  chk(/onerror=/.test(tenantsHtml),
      'and a logo that fails to load falls back rather than showing a broken icon');

  // SUSPENSION. Reads keep working on purpose: an overlay is a read, and
  // a crew that loses its scoreboard mid-broadcast loses it in front of
  // an audience -- over a decision reversible in seconds.
  // ACTIONS LIVE IN A PER-ROW MENU. Suspend and Delete side by side as
  // buttons on a list is a misclick waiting to happen, and one of them is
  // destructive.
  // REFRESH. The list goes stale while you look at it -- a tenant uploads
  // a logo or finishes a game in another window and nothing here knows.
  // Asserted explicitly rather than left to be caught incidentally by the
  // page throwing on a missing element, which is not the same as testing
  // that the control exists.
  chk(/id="refreshTenantsBtn"/.test(raw), 'the Tenants tab has a Refresh control');

  chk(/data-menu=/.test(tenantsHtml), 'each tenant row has an actions menu');
  chk(/>Suspend</.test(tenantsHtml), 'the menu offers Suspend for an active tenant');
  chk(/>Restore access</.test(tenantsHtml), 'and Restore access for a suspended one');
  chk(/data-del=/.test(tenantsHtml), 'and Delete tenant');
  chk(/class="menu hidden"/.test(tenantsHtml), 'the menu starts closed');
  chk(/Suspended/.test(tenantsHtml),
      'and its status reads Suspended, NOT its subscription -- a tenant can be paid up ' +
      'and still suspended, and the status line must not say Active next to an account ' +
      'that cannot write');
  chk(/Non-payment/.test(tenantsHtml), 'the reason is shown, so the support call starts informed');

  // the control calls the function, with the right sense
  b.w.confirm = () => true;
  b.w.prompt  = () => 'Testing';
  const suspendBtn = [...b.d.querySelectorAll('[data-toggle]')].find(x => x.textContent === 'Suspend');
  suspendBtn.dispatchEvent(new b.w.Event('click', { bubbles: true }));
  await wait();
  const sc = b.calls.rpc.find(c => c.name === 'set_tenant_disabled');
  chk(!!sc, 'suspending calls set_tenant_disabled()');
  chk(sc && sc.args.p_disabled === true, 'with p_disabled true for an active tenant');
  chk(sc && sc.args.p_reason === 'Testing', 'and passes the reason through');

  // DELETING A TENANT is a typed confirmation, not a yes/no. The row is
  // chosen from a list, and typing the name means READING it -- the only
  // thing that reliably catches the wrong row.
  b.w.prompt = () => 'Neville';
  const delBtn = [...b.d.querySelectorAll('[data-del]')][0];
  delBtn.dispatchEvent(new b.w.Event('click', { bubbles: true }));
  await wait();
  const dc = b.calls.rpc.find(c => c.name === 'set_tenant_deleted');
  chk(!!dc, 'deleting calls set_tenant_deleted()');
  chk(dc && dc.args.p_deleted === true, 'with p_deleted true');

  // AND A MISTYPED NAME CHANGES NOTHING.
  b.calls.rpc.length = 0;
  b.w.prompt = () => 'not the name';
  b.d.querySelectorAll('[data-del]')[0].dispatchEvent(new b.w.Event('click', { bubbles: true }));
  await wait();
  chk(!b.calls.rpc.some(c => c.name === 'set_tenant_deleted'),
      'a mistyped name deletes nothing');

  // The delete path must NOT be a hard delete: tenants cascades to five
  // tables, so a DELETE would destroy every game, play and roster row.
  chk(!/\.from\('tenants'\)[^;]*\.delete\(/.test(code),
      'nothing hard-deletes a tenant — the row cascades to five tables');

  const tenants = b.d.getElementById('tenantsBody').textContent;
  chk(/Neville/.test(tenants) && /Riverside/.test(tenants), 'both schools are listed');
  chk(/Lapsed|Trial|Active/.test(tenants), 'subscription state is shown');

  const deleted = b.d.getElementById('recoveryBody').innerHTML;
  chk(/2026-W2/.test(deleted), 'the deleted game is listed');
  chk(/Neville/.test(deleted),
      'and NAMED WITH ITS SCHOOL — a designator alone is ambiguous since migration 010');
  chk(/data-restore="g2"/.test(deleted), 'with a restore control carrying the game id');

  // ---- restore goes through the function ------------------------------
  b.d.querySelector('[data-restore]').dispatchEvent(new b.w.Event('click', { bubbles: true }));
  await wait();
  const rpc = b.calls.rpc.find(c => c.name === 'restore_game');
  chk(!!rpc, 'restoring calls restore_game(), not a bare UPDATE');
  chk(rpc && rpc.args && rpc.args.p_game_id === 'g2', 'with the right game id');
  chk(/restored/i.test(b.d.getElementById('msg').textContent), 'and reports success');

  // ---- source-level guarantees ---------------------------------------
  chk(!/update\s*\(\s*\{\s*deleted_at/.test(code),
      'nothing tries to clear deleted_at with an UPDATE — a SELECT policy hiding deleted ' +
      'rows makes that impossible (sql/012)');
  chk(!/act[ _-]?as/i.test(code),
      'no "Act As" — impersonation is deferred until there is an audit trail, and this ' +
      'page is exactly where it would quietly appear');
  chk(/is_super_admin/.test(code), 'the gate reads is_super_admin from the profile');

  // A LANDING PAGE MUST BE LEAVABLE. The platform account lands here
  // rather than on the dashboard, so this is the only page it sees. It
  // shipped with no sign-out and no route to change its own password.
  // ---- the users tab ---------------------------------------------------
  // It reads through api/manage-users.js because auth.users is not visible
  // to the browser: email, last sign-in and the disabled flag only exist
  // there, behind the service key.
  const uf = b.calls.fetch.find(f => /manage-users/.test(f.url));
  chk(!!uf, 'the users tab calls api/manage-users');
  chk(uf && uf.body && uf.body.action === 'list', 'with the list action');
  chk(uf && /^Bearer /.test(uf.auth || ''), 'and the session token, which the endpoint requires');

  const usersHtml = b.d.getElementById('usersBody').innerHTML;
  chk(/Neville/.test(usersHtml) && /Riverside/.test(usersHtml),
      'users are GROUPED BY TENANT — a flat roll of every account is the merged view this ' +
      'console exists to avoid');
  chk(/StatChat platform/.test(usersHtml),
      'the platform account is its own group, not filed under a customer');
  chk(/No tenant assigned/.test(usersHtml),
      'and a user with NO tenant is surfaced — invisible on every other screen, and ' +
      'usually somebody invited and never assigned');
  chk(/never/.test(usersHtml), 'a user who has never signed in says so');
  chk(/Invited/.test(usersHtml), 'an unconfirmed invite is marked');

  // READ-ONLY, DELIBERATELY. Acting on a customer's staff from here would
  // be the platform changing a school's people with nothing recording it.
  chk(!/data-action=/.test(usersHtml) && !/setRole|setPassword|Delete/.test(usersHtml),
      'the users tab offers no actions — that waits for the audit trail');

  // ---- and the OTHER half of this: account.html --------------------------
  // The platform saw every school's users on its own account page, under a
  // heading about its own account. Not a leak -- the platform is entitled
  // to that data -- but the wrong place, with nothing saying whose staff it
  // was. Asserted here rather than in its own file because it is the same
  // decision as the Users tab: this data belongs on the console, grouped.
  const acct = fs.readFileSync(path.join(__dirname, '..', 'account.html'), 'utf8')

  // EVERY 'Dashboard' LINK IN THE APP POINTS AT dashboard.html -- sixteen
  // of them across twelve files. Rather than patch sixteen, dashboard.html
  // bounces the platform to the console, which repairs all of them at once.
  // Asserted here because the symptom is invisible in normal use: it only
  // shows for the one account that has no tenant.
  const dash = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8')
    .replace(/\/\/[^\n]*/g, '');
  chk(/is_super_admin[\s\S]{0,80}location\.replace\('platform\.html'\)/.test(dash),
      'dashboard.html bounces the platform to the console');
  // AND IT MUST RUN BEFORE FIRST PAINT. The bounce used to sit in
  // loadIsAdmin(), which runs after showView() -- so the platform saw a
  // full frame of the dashboard, loading splash and TENANT LOGO included,
  // before being redirected. Reported as 'a black flash with the Neville
  // N in it'. A redirect after the wrong thing is painted has not
  // prevented it, only shortened it.
  const bounceAt = dash.indexOf("location.replace('platform.html')");
  const paintAt  = dash.indexOf("showView('dashboardView')");
  chk(bounceAt !== -1 && paintAt !== -1 && bounceAt < paintAt,
      'and it runs BEFORE showView, so no frame of a tenant dashboard is painted first');
  chk((dash.match(/location\.replace\('platform\.html'\)/g) || []).length === 1,
      'and there is exactly one bounce, not a live one plus a dead one left behind');
  // THE BYPASS IS PART OF THE DESIGN, not a hole. Support and the Open
  // button both need to see a school's dashboard AS THE PLATFORM, and a
  // bounce with no way past it would be the thing that has to be unpicked
  // when that ships. Asserted so it is not 'tidied away' as dead code.
  // CHECKING THAT viewingAs IS *USED*, not merely declared. A mutation
  // replacing `if (!viewingAs)` with `if (true)` left the declaration
  // standing and passed an assertion that only looked for the name.
  // Both shapes this has taken are accepted -- an && clause and a
  // wrapping if -- because the behaviour is what matters, not which one.
  chk(/get\('as'\)/.test(dash) && /(if\s*\(\s*!viewingAs|&&\s*!viewingAs)/.test(dash),
      'and has a named bypass (?as=) so viewing a school is not blocked later');
  chk(!/id="platformLink"/.test(dash),
      'and the menu link it replaced is gone, not left as dead markup the platform ' +
      'can never reach');
  chk(/id="backLink"/.test(acct) && /back\.href = 'platform\.html'/.test(acct),
      "account.html's back link goes to the console for the platform, so it does not " +
      'flash a dashboard under a label naming one it does not have');
  chk(/role === 'admin' && !profile\.is_super_admin/.test(acct),
      'account.html hides user management from the platform account');
  chk(/select\('display_name, avatar_url, role, is_super_admin'\)/.test(acct),
      'and actually fetches the column it gates on');

  chk(/id="signOutBtn"/.test(raw), 'there is a sign-out control');
  chk(/href="account\.html"/.test(raw), 'and a route to account settings');
  // Wired OUTSIDE the gate: an account that fails the is_super_admin
  // check still has to be able to leave.
  const gateAt = code.indexOf('is_super_admin){');
  const signOutAt = code.indexOf("getElementById('signOutBtn').addEventListener");
  chk(signOutAt !== -1 && signOutAt > gateAt,
      'sign-out is wired unconditionally, so a refused account can still leave');

  console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
