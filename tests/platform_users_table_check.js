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
  const render = /body\.innerHTML = '<table style="table-layout:fixed;">'[\s\S]*?\}\)\.join\(''\) \+ '<\/table>';/.exec(src);
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
  const cols = /const COLS =[\s\S]*?'<\/colgroup>';/.exec(src);
  chk(!!cols, 'column widths are declared rather than left to the content');
  if (cols) {
    const w = [...cols[0].matchAll(/width:(\d+)%/g)].map(m => +m[1]);
    chk(w.length === 6, 'one per column');
    chk(w.reduce((a, b) => a + b, 0) === 100, 'and they total 100%');
  }
  chk(/colspan="6"/.test(src), 'the group row spans every column');
  chk(/table-layout:fixed/.test(src),
      'and the layout is fixed, so the two button columns cannot win space ' +
      'from the text ones');
}

// ---- the toggle ----------------------------------------------------------
chk(!!doc.getElementById('showDisabledUsers'), 'a show-disabled toggle exists');
chk(!doc.getElementById('showDisabledUsers').checked,
    'and is OFF by default — disabled accounts are the exception, not the view');
chk(/showDisabled \? allUsers : allUsers\.filter\(u => !u\.disabled\)/.test(src),
    'it filters the list rather than styling rows out');

// HIDDEN, BUT COUNTED. Hiding something without saying how much is hidden is
// how a list starts lying.
chk(/disabledCount/.test(src) && /Show disabled accounts \(' \+ disabledCount/.test(src),
    'the label carries the count, so you can tell disabled accounts exist ' +
    'without turning it on');

chk(/t\.addEventListener\('change', \(\) => loadUsers\(accessToken\)\)/.test(src),
    'and it re-renders through the same loader — filtering in the DOM would ' +
    'be a second path that drifts from this one');

// ---- the empty case ------------------------------------------------------
chk(/Every account is disabled/.test(src),
    'a tenant list that is entirely disabled says so rather than looking empty');

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
