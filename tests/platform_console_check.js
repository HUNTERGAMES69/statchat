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
  const calls = { rpc: [], from: [] };
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
  w.eval([...w.document.querySelectorAll('script')].map(s => s.textContent).join('\n;\n'));
  return { w, d: w.document, calls,
           fire: (s) => authCb && authCb('INITIAL_SESSION', s) };
}
const wait = () => new Promise(r => setTimeout(r, 40));
const session = { user: { id: 'u1', email: 'statchatadmin@statchat.co' } };

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
    tenants: [{ id:'t1', name:'Neville', full_name:'Neville High School',
                logo_url:'https://cdn/neville.png',
                subscription:'active', renews_on:'2027-08-01' },
              { id:'t2', name:'Riverside', full_name:null, logo_url:null,
                subscription:'trial', renews_on:null }],
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
  const schoolsHtml = b.d.getElementById('schoolsBody').innerHTML;
  chk(/<img src="https:\/\/cdn\/neville\.png"/.test(schoolsHtml),
      'a school WITH a logo shows it');
  chk(/class="crest">R</.test(schoolsHtml),
      'a school WITHOUT one shows a monogram, not a gap or a broken image');
  chk(/onerror=/.test(schoolsHtml),
      'and a logo that fails to load falls back rather than showing a broken icon');

  const schools = b.d.getElementById('schoolsBody').textContent;
  chk(/Neville/.test(schools) && /Riverside/.test(schools), 'both schools are listed');
  chk(/Lapsed|Trial|Active/.test(schools), 'subscription state is shown');

  const deleted = b.d.getElementById('restoreBody').innerHTML;
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
