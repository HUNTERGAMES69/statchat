// The help file's roster-import section is true of the code
// =============================================================================
// Written 4 September 2026, with the section it guards. Andy asked for more in
// the help file about how rosters are imported: what is read, what is ignored,
// how conflicts and shared numbers are handled, two-way players.
//
// Every claim in that section was derived by RUNNING the importer and the
// classifier, not by reading them. This file exists because documentation goes
// stale in a way code does not: nothing breaks, no test fails, and the page
// keeps confidently describing behaviour that changed underneath it. The lesson
// this project already paid for once -- a code comment asserting a rule is a
// claim to verify, never a citation -- applies with more force to a page a
// customer reads.
//
// So the checks below do not compare the help text against a copy of the rules
// kept here. They derive the rules FROM THE SOURCE and assert the help file
// agrees. A list held in two places agrees with itself forever and tells you
// nothing.
//
// The three facts most likely to drift, and most costly when they do:
//
//   THE POSITION VOCABULARY. Add a position to OFFENSE_POS and the help file's
//   table is quietly wrong, and a coach who reads it will file a player under
//   nothing. Derived from create_game.html and compared set to set.
//
//   THE ROW CAP AND THE FILE CAP. Both are stated as numbers in the prose.
//
//   THE COLUMN RULE. "Digits only" in column A is the single commonest reason
//   an import comes up short, because a "#" prefix is skipped as silently as a
//   header row. If that regex ever loosens, the warning becomes a lie that
//   costs somebody a squad on a Friday night.
//
//   node tests/roster_help_accuracy_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const HELP = read('help.html');
const ROSTER = read('roster.html');
const CREATE = read('create_game.html');

// The help section only, so a stray "QB" elsewhere on an 88,000-character page
// cannot make a missing abbreviation look present.
//
// It starts at "Uploading a roster from a spreadsheet" and not at the first
// heading added on 4 September: the row cap and the file cap are stated in the
// paragraph above those, and a narrower window silently excluded them -- which
// showed up as the cap check failing AND its own mutation check passing for the
// wrong reason, on a string the window never contained.
const doc = new JSDOM(HELP).window.document;
const heads = [...doc.querySelectorAll('h3')];
const start = heads.find(h => /Uploading a roster from a spreadsheet/i.test(h.textContent));
const end   = heads.find(h => /Your team.s look/i.test(h.textContent));
let SECTION = '';
if (start){
  let n = start, out = [];
  while (n && n !== end){ out.push(n.textContent); n = n.nextElementSibling; }
  SECTION = out.join('\n');
}

let pass = 0, fail = 0;
const chk = (ok, m, detail) => {
  if (ok) { pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (detail ? '\n         ' + detail : '')); }
};

console.log('=== The help file describes the importer the code actually is ===\n');

chk(SECTION.length > 1000,
    'the roster-import section was found in help.html', SECTION.length + ' characters');

// ---------------------------------------------------------------------------
console.log('\n-- the position vocabulary, derived from create_game.html --');

function listFrom(name){
  const m = new RegExp('const ' + name + ' = \\[([^\\]]*)\\]').exec(CREATE);
  if (!m) return null;
  return m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}
const UNITS = { Offense: listFrom('OFFENSE_POS'),
                Defense: listFrom('DEFENSE_POS'),
                'Special teams': listFrom('SPECIAL_POS') };

Object.keys(UNITS).forEach(unit => {
  const list = UNITS[unit];
  if (!list){ chk(false, unit + ': could not read the list out of create_game.html'); return; }
  // The row of the help table for this unit, so DB appearing under Offense
  // somewhere else on the page cannot satisfy Defense.
  const row = [...doc.querySelectorAll('table tr')]
    .find(tr => tr.cells.length === 2 &&
                new RegExp('^' + unit + '$', 'i').test(tr.cells[0].textContent.trim()));
  if (!row){ chk(false, unit + ': no row in the help table'); return; }
  const shown = row.cells[1].textContent.trim().split(/\s+/);
  const missing = list.filter(p => shown.indexOf(p) < 0);
  const extra   = shown.filter(p => list.indexOf(p) < 0);
  chk(missing.length === 0 && extra.length === 0,
      unit + ': the help table lists exactly the ' + list.length + ' abbreviations the code knows',
      (missing.length ? 'missing from help: ' + missing.join(' ') + '. ' : '') +
      (extra.length ? 'in help but not in the code: ' + extra.join(' ') : ''));
});

// ---------------------------------------------------------------------------
console.log('\n-- the numbers --');

{
  const cap = /const MAX_ROSTER_ROWS\s*=\s*(\d+)/.exec(ROSTER);
  chk(!!cap && SECTION.indexOf(cap[1]) >= 0,
      'the row cap in the prose is the row cap in the code',
      cap ? 'code says ' + cap[1] : 'could not read MAX_ROSTER_ROWS');
}
{
  const b = /const MAX_ROSTER_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(ROSTER);
  chk(!!b && new RegExp(b[1] + '\\s*MB').test(HELP),
      'the file-size limit in the prose is the one in the code',
      b ? 'code says ' + b[1] + 'MB' : 'could not read MAX_ROSTER_BYTES');
}

// ---------------------------------------------------------------------------
console.log('\n-- the behaviour the section promises --');

// COLUMN A IS DIGITS ONLY. Asserted against the real regex rather than a
// paraphrase of it: this is what makes "#4 is skipped" true.
{
  const re = /if \(!\/\^\\d\+\$\/\.test\(String\(num\)\.trim\(\)\)\) return;/.test(ROSTER);
  chk(re, 'roster.html still skips any column A that is not digits end to end');
  chk(/#4/.test(SECTION) && /12A/.test(SECTION),
      'and the help names the two shapes that actually bite, "#4" and "12A"');
}

// ONLY THE FIRST SHEET.
{
  chk(/wb\.Sheets\[wb\.SheetNames\[0\]\]/.test(ROSTER),
      'roster.html still reads only the first sheet');
  chk(/first sheet/i.test(SECTION), 'and the help says so');
}

// ONLY THE FIRST POSITION, AND ORDER MATTERS.
{
  const fp = /function firstPosOf\(pos\)\{[\s\S]*?filter\(Boolean\)\[0\]/.test(CREATE);
  chk(fp, 'firstPosOf still takes the first token only');
  chk(/RB\/LB/.test(SECTION) && /LB\/RB/.test(SECTION),
      'and the help shows the same pair reversed, which is the only way to say ' +
      '"order matters" so a reader believes it');
}

// AN EXISTING PLAYER IS SKIPPED, NOT UPDATED. The most surprising behaviour in
// the whole importer and the one a coach is most likely to rely on being the
// other way round.
{
  const skips = /const newRows = parsed\.filter\(p => !existingNames\.has\(p\.name\.toLowerCase\(\)\)\)/.test(ROSTER);
  chk(skips, 'roster.html still filters out existing names rather than updating them');
  chk(/skipped, not\s*\n?\s*updated/i.test(SECTION.replace(/\s+/g, ' ')) ||
      /skipped, not updated/i.test(SECTION.replace(/\s+/g, ' ')),
      'and the help says plainly that an existing player is skipped, not updated');
}

// MATCHED BY NAME, CASE-INSENSITIVE, WITHIN THE SEASON.
{
  chk(/\.eq\('season_year', currentSeasonYear\)/.test(ROSTER),
      'the duplicate check is still scoped to the season');
  chk(/season/i.test(SECTION), 'and the help says the matching is scoped to the season');
}

// THE TWO IMPORTERS DIFFER. The opponent one refuses the whole file.
{
  chk(/That file was not imported\./.test(CREATE),
      'the opponent importer still refuses the whole file on a bad row');
  chk(/refused/i.test(SECTION) && /Opponent/i.test(SECTION),
      'and the help contrasts the two importers rather than describing one');
}

// THE (O)/(D)/(ST) TAG.
{
  const tag = /match\(\/\\\(\\s\*\(O\|D\|ST\)\\s\*\\\)\\s\*\$\/i\)/.test(CREATE);
  chk(tag, 'the name tag is still (O), (D) or (ST) at the end of the name');
  chk(/\(O\)/.test(SECTION) && /\(D\)/.test(SECTION) && /\(ST\)/.test(SECTION),
      'and the help lists all three');
}

// ---------------------------------------------------------------------------
console.log('\n-- and the checks are shown to fail --');

// A documentation test that has never failed is indistinguishable from one
// whose selector stopped matching the section. Each mutation below is a real
// way this page goes stale.
function reSection(src){
  const d = new JSDOM(src).window.document;
  const hs = [...d.querySelectorAll('h3')];
  const s = hs.find(h => /Uploading a roster from a spreadsheet/i.test(h.textContent));
  const e = hs.find(h => /Your team.s look/i.test(h.textContent));
  if (!s) return '';
  let n = s, out = [];
  while (n && n !== e){ out.push(n.textContent); n = n.nextElementSibling; }
  return out.join('\n');
}
{
  // A position added to the code and not to the help file.
  const mutated = CREATE.replace("const OFFENSE_POS = ['QB',", "const OFFENSE_POS = ['QB','WILDCAT',");
  const list = /const OFFENSE_POS = \[([^\]]*)\]/.exec(mutated)[1]
    .split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  const row = [...doc.querySelectorAll('table tr')]
    .find(tr => tr.cells.length === 2 && /^Offense$/i.test(tr.cells[0].textContent.trim()));
  // GUARDED. Run against a help file that has no position table at all -- which
  // is exactly what main looked like before this section was written -- the
  // unguarded version threw here and took the whole run down mid-report,
  // turning nine legible failures into a stack trace.
  const shown = row ? row.cells[1].textContent.trim().split(/\s+/) : [];
  chk(list.some(p => shown.indexOf(p) < 0),
      'a position added to the code but not to the help table is caught',
      row ? '' : '(no table in this help file, so the check is trivially satisfied)');
}
{
  // The row cap changed in the code and not in the prose.
  const mutated = ROSTER.replace(/const MAX_ROSTER_ROWS\s*=\s*\d+/, 'const MAX_ROSTER_ROWS  = 250');
  const cap = /const MAX_ROSTER_ROWS\s*=\s*(\d+)/.exec(mutated)[1];
  chk(SECTION.indexOf(cap) < 0, 'a row cap changed in the code but not in the help is caught');
}
{
  // The section renamed or removed.
  const mutated = HELP.replace('Uploading a roster from a spreadsheet', 'Some other heading');
  chk(reSection(mutated).length === 0,
      'losing the section heading is caught rather than silently passing an empty string');
}

console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
if (fail) process.exit(1);
