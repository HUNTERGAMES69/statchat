// The platform user list: aligned, and disabled accounts out of the way
// =====================================================================
// Every tenant used to render its OWN <table>, so each sized its columns to
// its own content and nothing lined up down the page -- a tenant with one
// short name gave a narrow Name column, the next gave a wide one.
//
// Disabled accounts were always shown. They are the minority and the least
// likely to need action, and grouped by tenant they push the live accounts
// down: three test tenants existed solely to hold one disabled user each.
//
//   node tests/platform_users_table_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(path.join(__dirname, '..', 'platform.html'), 'utf8');
const doc = new JSDOM(src).window.document;

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Platform user list ===\n');

// ---- one table, so the columns can line up -------------------------------
{
  const render = /body\.innerHTML = '<table>'[\s\S]*?\}\)\.join\(''\) \+ '<\/table>';/.exec(src);
  chk(!!render, 'the list renders as ONE table');
  if (render) {
    const t = render[0];
    chk((t.match(/<table/g) || []).length === 1 && (t.match(/<\/table>/g) || []).length === 1,
        'opened and closed exactly once — a table per group is what made the ' +
        'columns disagree');
    chk(/groupRow\(k, rows\.length\)/.test(t),
        'and a tenant heading is a full-width ROW inside it, not an <h2> ' +
        'between separate tables');
  }
  chk(/colspan="6"/.test(src), 'the group row spans every column');

  // WIDTHS ARE LEFT TO THE CONTENT. A first version added table-layout:fixed
  // with declared percentages on top of the single table, and that pushed the
  // whole thing off the card: a fixed column cannot grow past its share, and
  // the actions cell holds three buttons at roughly 340px against a 16%
  // allowance. The single table is already what makes the rows line up.
  chk(!/table-layout:fixed;">/.test(src),
      'the layout is NOT fixed — declared widths cannot hold three buttons ' +
      'and the table overflowed the card');
  chk(!/<colgroup>/.test(src),
      'and no colgroup: the single table is what aligns the columns, not ' +
      'percentages layered on top of it');
}

// ---- the toggle ----------------------------------------------------------
chk(!!doc.getElementById('showDisabledUsers'), 'a show-disabled toggle exists');
chk(!doc.getElementById('showDisabledUsers').checked,
    'and is OFF by default — disabled accounts are the exception, not the view');
chk(/showDisabled \? scoped : scoped\.filter\(u => !u\.disabled\)/.test(src),
    'it filters the list rather than styling rows out, and within the chosen ' +
    'tenant rather than across everything');

// HIDDEN, BUT COUNTED. Hiding something without saying how much is hidden is
// how a list starts lying.
chk(/disabledCount/.test(src) && /Show disabled accounts \(' \+ disabledCount/.test(src),
    'the label carries the count, so you can tell disabled accounts exist ' +
    'without turning it on');

chk(/t\.addEventListener\('change', \(\) => loadUsers\(accessToken\)\)/.test(src),
    'and it re-renders through the same loader — filtering in the DOM would ' +
    'be a second path that drifts from this one');

// ---- nothing until a tenant is chosen ------------------------------------
// Every account across every customer at once is a list nobody reads: the
// platform admin is almost always here about ONE tenant, and scrolling past
// five others to reach it is how the wrong Disable button gets pressed.
chk(!!doc.getElementById('userTenantPick'), 'a tenant selector exists');
chk(doc.getElementById('userTenantPick').options[0].value === '',
    'and opens on a blank choice');
chk(/Choose a tenant above to see its accounts/.test(src),
    'showing nothing until one is picked, and saying why');
// AND THE GATE ACTUALLY RETURNS. The message existing is not the message
// being reached: replacing `if (!chosen)` with `if (false)` left every
// assertion above green.
chk(/if \(!chosen\)\{[\s\S]{0,220}?return;\s*\n\s*\}/.test(src),
    'and the blank choice RETURNS, so no list is built behind the prompt');
chk(/const scoped = chosen === '\\u0001all'\s*\n\s*\? allUsers\s*\n\s*: allUsers\.filter\(u => groupKeyFor\(u\) === chosen\);/.test(src),
    'and a chosen tenant narrows the list to it — anything else means every ' +
    'account is still on screen under a heading that says otherwise');
chk(/<option value="\\u0001all">All tenants/.test(src),
    'with an All tenants option for when the whole list is wanted');

// BUILT FROM THE ACCOUNTS, not the tenants table: a user whose tenant row was
// deleted still needs somewhere to appear, and that is exactly the account
// most worth finding.
chk(/\[\.\.\.new Set\(allUsers\.map\(u =>/.test(src),
    'the options come from the accounts themselves');
chk(/pick\.value = \[\.\.\.pick\.options\]\.some\(o => o\.value === current\) \? current : ''/.test(src),
    'and a tenant that disappears between refreshes does not leave the ' +
    'control showing a name that is no longer in the list');

// ONE DEFINITION of what group an account belongs to -- the selector and the
// grouping both need it, and two copies would disagree about where a
// tenantless super admin goes.
chk((src.match(/function groupKeyFor/g) || []).length === 1,
    'group membership is decided in one place');
{
  const gk = /function groupKeyFor\(u\)\{[\s\S]*?\n    \}/.exec(src);
  chk(!!gk, 'and it is a real function');
  if (gk) {
    const f = new Function(gk[0] + '; return groupKeyFor;')();
    chk(f({ isSuperAdmin: true, tenantId: null }) === '\u0000platform',
        'the platform account sorts to the top');
    chk(f({ tenantId: null }) === '\uffffunassigned',
        'and a tenantless user to the bottom, without a special case in the sort');
    chk(f({ tenantId: 't1', tenantName: 'Neville' }) === 'Neville',
        'and a normal account under its tenant');
  }
}

// The count has to describe what is on screen. A label saying 3 while you are
// looking at a tenant with none of them is worse than no label at all.
chk(/const inScope = chosen === '\\u0001all'/.test(src),
    'the disabled count is scoped to the chosen tenant, not the whole system');

// ---- the empty case ------------------------------------------------------
chk(/Every account here is disabled/.test(src),
    'a tenant whose accounts are all disabled says so rather than looking empty');
chk(/: 'No accounts\.'/.test(src),
    'and a genuinely empty tenant says something different — "turn on show ' +
    'disabled" is misleading when there are none to show');

// ---- behaviour, on the real shape of the data ----------------------------
{
  const users = [
    { displayName: 'Andy Martin', tenantName: 'Neville', id: 'n1' },
    { displayName: 'Demo Admin User', tenantName: 'Red Stick', id: 'r1' },
    { displayName: 'Andy Martin', tenantName: 'Test High', id: 't1', disabled: true },
    { displayName: 'Test Admin 2', tenantName: 'Test Tenant 2', id: 't2', disabled: true },
    { displayName: 'Info User', tenantName: 'Test tenant', id: 't3', disabled: true }
  ];
  const shown = (show) => show ? users : users.filter(u => !u.disabled);
  const groups = (list) => new Set(list.map(u => u.tenantName)).size;

  chk(shown(false).length === 2 && groups(shown(false)) === 2,
      'with the toggle off, three tenants that exist only to hold a disabled ' +
      'account drop out of the list entirely');
  chk(shown(true).length === 5 && groups(shown(true)) === 5,
      'and with it on, everything is back');
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
