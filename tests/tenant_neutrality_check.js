// Nothing is hardcoded to one tenant
// ==================================
// Every page in this app was written for Neville, so Neville's name got
// into places that only look like decoration until a second tenant
// exists. Reported on 25 Aug 2026, all three by a customer-facing symptom
// rather than by anybody looking:
//
//   customize.html    placeholder="Neville High School" — read as a
//                     PREFILLED VALUE on a new tenant's first visit
//   roster.html       placeholder="Neville"
//   season_report     every tenant's export downloaded as
//                     "Neville_2026_season_stats.xlsx" — somebody else's
//                     school, in a file a coach sends to local media
//
// And the reason the placeholder was visible at all: `create_tenant()`
// wrote full_name to `tenants` but not to `teams`, and customize.html
// reads it from `teams`. **Data written to one table and read from
// another, behind a placeholder that looked like a value.**
//
// SECONDARY COLOUR. Andy's call, 25 Aug: white on every logo upload, no
// exceptions. Previously derived from the logo, so two tenants uploading
// crests got two different answers, neither chosen by anyone.
//
//   node tests/tenant_neutrality_check.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// scoring_summary.html is a worked EXAMPLE of scoring-order rules, not a
// tenant-facing screen; its sample game is meant to name real teams.
const NOT_TENANT_FACING = new Set(['scoring_summary.html', 'index.html']);

function run() {
  const fails = [];
  const bad = (f, why) => fails.push({ f, why });

  for (const f of fs.readdirSync(ROOT).filter(x => x.endsWith('.html'))) {
    if (NOT_TENANT_FACING.has(f)) continue;
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    // Comments may discuss Neville as an example; markup and code may not.
    // BLOCK COMMENTS TOO. A first version stripped only `//` lines, so the
    // string regex below ran straight through /* */ blocks and reported
    // three files that merely DISCUSS Neville in commentary about scoring
    // order. Matching is also line-bounded now: a quote regex spanning
    // newlines swallows whole script tags and reports nonsense.
    const code = src
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    if (/placeholder="[^"]*Neville/i.test(code)) {
      bad(f, 'a placeholder names Neville — it reads as a prefilled value to every ' +
             'other tenant, and on a new one the field is genuinely empty');
    }
    const strings = code.match(/'[^'\n]*Neville[^'\n]*'|"[^"\n]*Neville[^"\n]*"/g) || [];
    strings.forEach(s => bad(f, 'a literal names Neville: ' + s.slice(0, 50)));
  }

  // The secondary colour is white on every logo upload, everywhere.
  for (const [f, input] of [['create_game.html', 'oppSecondaryColorInput'],
                            ['customize.html',   'secondaryColorInput']]) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\/[^\n]*/g, '');
    const m = new RegExp("getElementById\\('" + input + "'\\)\\.value = ([^;]+);", 'g');
    let hit, seen = 0;
    while ((hit = m.exec(src)) !== null) {
      const rhs = hit[1].trim();
      // Loading a SAVED game restores whatever that game stored; only the
      // logo-upload path is being constrained here.
      // Only the LOGO UPLOAD path is constrained. Restoring a saved game
      // or a saved team must return whatever was stored, or changing the
      // colour by hand would not survive a reload.
      if (/opponent_secondary_color|eg\.|team\./.test(rhs)) continue;
      seen++;
      if (rhs !== "'#ffffff'") {
        bad(f, 'the secondary colour on logo upload is ' + rhs + ', not white');
      }
    }
    if (!seen) bad(f, 'no logo-upload assignment to ' + input + ' found — has it moved?');
  }

  // create_tenant must write full_name to BOTH tables.
  const sql = fs.readFileSync(path.join(ROOT, 'sql', '013_create_tenant.sql'), 'utf8')
    .replace(/--[^\n]*/g, '');
  const teamsInsert = /insert into public\.teams\s*\(([^)]*)\)/.exec(sql);
  if (!teamsInsert || !/\bfull_name\b/.test(teamsInsert[1])) {
    bad('sql/013_create_tenant.sql',
        'does not write full_name to `teams` — customize.html reads it from there, so a ' +
        'new tenant finds the field empty and sees the placeholder instead');
  }
  return fails;
}

if (require.main === module) {
  const f = run();
  console.log('=== Nothing is hardcoded to one tenant ===\n');
  console.log('Failures: ' + f.length);
  f.forEach(x => console.log('  [' + x.f + '] ' + x.why));
  if (!f.length) console.log('  no tenant-facing page names a tenant, and the secondary colour is always white.');
  process.exitCode = f.length ? 1 : 0;
}

module.exports = { run };
