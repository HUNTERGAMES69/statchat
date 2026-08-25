// A column you filter on must be a column you selected
// ====================================================
// This has now caused two production bugs in one day, both silent:
//
//   dashboard.html  `deleted_at` was missing from the tenants select, so
//                   every tenant read as undefined, `!t.deleted_at` was
//                   true for all of them, and a deleted tenant stayed in
//                   the live list.
//   recap.html      `tenant_id` was missing from the games select, so
//                   `.eq('tenant_id', undefined)` matched nothing and the
//                   home team lost its colours entirely. The OPPONENT kept
//                   its own, because those live on the game row and were
//                   already selected -- that asymmetry was the only clue.
//
// **An unselected column is `undefined`, not an error.** Nothing throws,
// nothing logs, and the page renders a plausible-looking fallback. The
// only reliable defence is to check the column list against what the code
// goes on to read.
//
// Pages using select('*') are exempt: they get every column by definition.
//
//   node tests/selected_columns_check.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

const files = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.html') && !f.includes('_mock'))
  .sort();

console.log('=== Filtered and read columns are actually selected ===\n');

for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '');

  // WHERE THE ROW CAME FROM, not the nearest select.
  // A first version looked at whatever select preceded the filter, which
  // on most pages is the TEAMS query -- so it reported `game.tenant_id`
  // against a select that was never going to contain it, twelve times. A
  // check that fires on correct code teaches people to ignore it.
  //
  // The row variable is bound by `const game = gameRows[0]` (or similar),
  // and gameRows comes from a specific .from('games').select(...). Follow
  // that chain instead of guessing by proximity.
  const filters = [...src.matchAll(/\.eq\('(\w+)',\s*(\w+)\.(\w+)\)/g)];

  for (const fm of filters) {
    const rowVar = fm[2], prop = fm[3];
    // find `const <rowVar> = <src>[0]` above this point
    const decl = new RegExp('const\\s+' + rowVar + '\\s*=\\s*(\\w+)\\s*\\[0\\]');
    const dm = decl.exec(src.slice(0, fm.index));
    if (!dm) continue;
    const arrVar = dm[1];
    // find the select that produced that array
    const q = new RegExp('data:\\s*' + arrVar + '[^=]*=[\\s\\S]{0,200}?\\.from\\(\'(\\w+)\'\\)\\s*\\.select\\(\\s*((?:\'[^\']*\'\\s*\\+?\\s*)+)\\)');
    const qm = q.exec(src);
    if (!qm) continue;
    const cols = qm[2].replace(/[\'+]/g, ' ');
    if (/\*/.test(cols)) continue;
    const listed = cols.split(',').map(c => c.trim().split(/[\s(]/)[0]).filter(Boolean);
    if (listed.includes(prop)) continue;
    chk(false, f + ': `' + rowVar + '.' + prop + '` filters a query, but `' + prop +
        '` is not in the ' + qm[1] + ' select that produced ' + arrVar +
        ' — it will be undefined, and nothing will throw');
  }
}

if (!fails) console.log('  every column read from an explicit select is in that select.');
console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
