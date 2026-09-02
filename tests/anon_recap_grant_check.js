// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// The anon column grant on `games` must cover what recap.html asks for
// ====================================================================
// On 2 September 2026 every public recap link died with
//
//     permission denied for table games
//
// The cause is a Postgres behaviour worth stating plainly, because it is
// the opposite of the one everybody has internalised from RLS:
//
//   RLS that excludes a row returns FEWER ROWS.
//   A COLUMN-LEVEL GRANT that excludes a column returns AN ERROR.
//
// `anon` does not hold a blanket select on public.games. It holds a
// column-level grant naming a fixed list (sql/000_baseline.sql, widened by
// sql/038_anon_recap_tenant_id.sql). Ask for one column outside that list
// and the whole query fails -- not the column, the query -- and recap.html
// shows its error view to every visitor.
//
// recap.html has carried a comment saying "this list must stay a subset of
// the grant" since the sharing feature shipped. A later fix added
// `tenant_id` to the select, correctly, and nobody widened the grant. A
// comment cannot fail a build. This can:
//
// AND THE SELECT LIST IS ONLY HALF OF IT. Granting tenant_id fixed the
// games query and the link still failed, because the anon SELECT policies
// on plays, game_rosters, teams and tenants all reach into games by
// subquery. A policy expression runs as the invoking role, and when it
// touches a DIFFERENT table the invoker's column privileges on that table
// are checked normally -- so reading one row of `plays` needs SELECT on
// games.deleted_at, and failing it reports "permission denied for table
// games" on a query that never mentioned games. Section 4 covers that,
// and it is the check that would have found the whole bug at once.
//
//   node tests/anon_recap_grant_check.js
//
// WHY ONLY recap.html. It is the only page an anonymous visitor ever
// reaches -- /g/<token> rewrites to api/share.js (vercel.json), which uses
// the service key for its own lookup and then serves recap.html, where the
// browser queries Supabase with the anon key. Every other page that touches
// `games` is behind a login and runs as `authenticated`, which has a
// blanket select and cannot hit this.

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Anon grant vs recap.html select list ===\n');

// --------------------------------------------------------------------------
// 1. WHAT anon MAY READ
//
// Read it out of the migrations rather than hard-coding it here. A test that
// carries its own copy of the list agrees with itself forever and tells you
// nothing about the database.
//
// Comments are stripped first: sql/038 discusses the grant in prose, and a
// parser that reads its own explanation would find grants that do not exist.
// --------------------------------------------------------------------------
const sqlDir = path.join(root, 'sql');
const sqlFiles = fs.readdirSync(sqlDir).filter(f => f.endsWith('.sql')).sort();

const granted = new Set();
const grantSource = {};
let revoked = false;

sqlFiles.forEach(f => {
  // A _DOWN file describes an undo that is only true if somebody ran it.
  // Reading one would let a rollback nobody performed fail this check.
  if (/_DOWN\.sql$/.test(f)) return;
  const raw = fs.readFileSync(path.join(sqlDir, f), 'utf8');
  const sql = raw.replace(/--[^\n]*/g, '');

  const re = /grant\s+select\s*\(([^)]*)\)\s+on\s+(?:table\s+)?public\.games\s+to\s+([^;]+);/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    if (!/\banon\b/i.test(m[2])) continue;
    m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(c => {
      granted.add(c);
      if (!grantSource[c]) grantSource[c] = f;
    });
  }

  if (/revoke\s+[^;]*\bselect\b[^;]*on\s+(?:table\s+)?public\.games\s+from\s+[^;]*\banon\b/i.test(sql)) {
    revoked = true;
  }
});

chk(granted.size > 0, 'found the column-level grant on public.games for anon');
chk(!revoked, 'no migration revokes select on games from anon');
chk(granted.has('tenant_id'),
    'tenant_id is granted — this is the one that broke the share links'
    + (granted.has('tenant_id') ? ' (from ' + grantSource['tenant_id'] + ')' : ''));

console.log('\n  anon may read ' + granted.size + ' columns of games: '
            + Array.from(granted).sort().join(', ') + '\n');

// --------------------------------------------------------------------------
// 2. WHAT recap.html ASKS FOR
//
// Every `.from('games').select(...)` in the page, with the select list read
// out of the concatenated string literals -- the real one is split across
// four lines, and a regex that only reads the first line would pass while
// missing the column that actually broke.
// --------------------------------------------------------------------------
const recap = fs.readFileSync(path.join(root, 'recap.html'), 'utf8');

// A select that runs only for a signed-in admin is exempt: an admin is
// `authenticated`, which holds a blanket select. Being on this list is not
// a free pass -- section 3 makes each one prove it is guarded.
const ADMIN_ONLY = ['setupShare'];

const selects = [];
const marker = ".from('games').select(";
for (let i = recap.indexOf(marker); i !== -1; i = recap.indexOf(marker, i + 1)) {
  // Balance the parens so a select spanning several lines is read whole.
  let depth = 0, j = i + marker.length - 1, end = -1;
  for (; j < recap.length; j++) {
    if (recap[j] === '(') depth++;
    else if (recap[j] === ')') { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end === -1) continue;
  const args = recap.slice(i + marker.length, end);
  const cols = (args.match(/'([^']*)'/g) || []).join('')
    .replace(/'/g, '').split(',').map(s => s.trim()).filter(Boolean);

  // Walk backwards to the enclosing function so the check can tell the
  // anonymous path from the admin one by name rather than by line number.
  const before = recap.slice(0, i);
  const fnMatches = before.match(/function\s+([A-Za-z0-9_$]+)\s*\(/g) || [];
  const last = fnMatches[fnMatches.length - 1] || 'function (unknown)(';
  const fn = /function\s+([A-Za-z0-9_$]+)/.exec(last)[1];

  selects.push({ fn: fn, cols: cols, line: before.split('\n').length });
}

chk(selects.length > 0, 'found the games queries in recap.html');

selects.forEach(s => {
  if (ADMIN_ONLY.indexOf(s.fn) !== -1) {
    console.log('  --   ' + s.fn + '() line ' + s.line
                + ': admin only, skipped — ' + s.cols.join(', '));
    return;
  }
  const missing = s.cols.filter(c => !granted.has(c));
  chk(missing.length === 0,
      s.fn + '() line ' + s.line + ': every column is granted to anon'
      + (missing.length ? ' — NOT GRANTED: ' + missing.join(', ') : '')); 
});

// --------------------------------------------------------------------------
// 3. THE EXEMPTION HAS TO BE EARNED
//
// setupShare reads share_token, which is deliberately NOT granted to anon --
// the token is the share link, and handing it to an anonymous reader would
// let anybody mint the URL for a game that was never shared. The query is
// safe only because the function returns before reaching it for anyone who
// is not an admin. If that guard is ever removed, the exemption above turns
// into the same outage this file exists to prevent.
// --------------------------------------------------------------------------
ADMIN_ONLY.forEach(name => {
  const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{([\\s\\S]{0,400})');
  const body = re.exec(recap);
  chk(!!body, name + '(): found in recap.html');
  if (!body) return;
  chk(/if\s*\(\s*!\s*isAdmin\s*\)\s*return/.test(body[1]),
      name + '(): returns immediately unless isAdmin — this is what makes the exemption safe');
});

// share_token must stay out of the grant. Checked positively, because the
// cheap way to make section 2 pass is to grant everything.
chk(!granted.has('share_token'),
    'share_token is NOT granted to anon — the share link cannot be read by a stranger');
chk(!granted.has('created_by') && !granted.has('guided_state'),
    'account ids and app working state stay out of the anon grant');


// --------------------------------------------------------------------------
// 4. WHAT THE ANON POLICIES THEMSELVES NEED
//
// The generalisation of this bug, and the part a reader of recap.html could
// never have spotted. Every anon SELECT policy on a table OTHER than games
// that reaches into games by subquery requires the anon role to hold column
// privileges on every games column it names -- id, status, is_public,
// tenant_id, deleted_at as of sql/016. Miss one and the dependent table is
// unreadable, with an error naming games.
//
// Policies ON games are exempt: a policy is not column-privilege checked
// against its own table, which is the only reason column grants and RLS can
// be combined at all. That asymmetry is exactly what made 038 look like a
// complete fix when it was half of one.
// --------------------------------------------------------------------------
const policyNeeds = {};   // column -> [policies that need it]

sqlFiles.forEach(f => {
  if (/_DOWN\.sql$/.test(f)) return;
  const sql = fs.readFileSync(path.join(sqlDir, f), 'utf8').replace(/--[^\n]*/g, '');
  const re = /create\s+policy\s+("[^"]+"|\S+)\s+on\s+public\.(\w+)\s+for\s+(\w+)\s+to\s+([^\s]+(?:\s*,\s*\w+)*)\s+([\s\S]*?);/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const name = m[1], table = m[2], roles = m[4], body = m[5];
    if (!/\banon\b/i.test(roles)) continue;
    if (!/\bselect\b/i.test(m[3])) continue;
    if (table === 'games') continue;            // exempt, see above
    // Alias games is given inside the subquery, e.g. "from public.games g".
    const aliases = [];
    let a, ar = /public\.games\s+(?:as\s+)?(\w+)/gi;
    while ((a = ar.exec(body)) !== null) aliases.push(a[1]);
    if (!aliases.length && /\bfrom\s+public\.games\b/i.test(body)) aliases.push('games');
    aliases.forEach(al => {
      let c, cr = new RegExp('\\b' + al + '\\.(\\w+)', 'g');
      while ((c = cr.exec(body)) !== null) {
        (policyNeeds[c[1]] = policyNeeds[c[1]] || []);
        if (policyNeeds[c[1]].indexOf(table) === -1) policyNeeds[c[1]].push(table);
      }
    });
  }
});

const needed = Object.keys(policyNeeds).sort();
chk(needed.length > 0, 'found the anon policies that reach into games by subquery');
console.log('\n  anon policies need ' + needed.length + ' columns of games: '
            + needed.join(', ') + '\n');

needed.forEach(col => {
  chk(granted.has(col),
      'games.' + col + ' is granted to anon — needed by the anon policy on '
      + policyNeeds[col].join(', ')
      + (granted.has(col) ? '' : ' — WITHOUT IT THOSE TABLES RETURN "permission denied for table games"'));
});

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
