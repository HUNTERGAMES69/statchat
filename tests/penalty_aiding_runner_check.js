// Aiding the runner — name, slug and yardage
// -----------------------------------------
// Requested 5 September 2026 as "add an aiding the runner penalty". It was
// already in the catalog, under the NFHS book term "Helping the runner" —
// which is the problem, not the answer. The dropdown is one flat
// alphabetical select and a native select jumps on first letter, so the
// book term filed it under H while the scorer reaching for it looks under
// A. Present, correct, and unfindable: the same failure pass interference
// had when it sorted under D.
//
// THREE THINGS THIS PINS, and each of them is a way the change could be
// undone by someone doing the obvious thing:
//
//   1. The SLUG stays `helping_runner`. Renaming it to match the label is
//      the tidy-looking edit that silently orphans every play already
//      logged with it.
//   2. There is exactly ONE entry for the foul. "Add an aiding the runner
//      penalty" read literally produces a second one, and a duplicate in a
//      41-option list is worse than the wrong sort position it fixes.
//   3. The yardage is 5. It was 15 — the pre-reduction number, from when
//      the penalty went 15 -> 10 -> 5. It matches nothing current: NFHS is
//      5 and even the NFL's is 10. A wrong number here does not sit in a
//      table, it auto-fills the yards box on a live entry path.
//
//   node tests/penalty_aiding_runner_check.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Aiding the runner ===\n');

const cat = /const PENALTIES = \{[\s\S]*?\n\};/.exec(src)[0];

// Read the entry out of the catalog rather than matching the whole line,
// so reformatting the table does not fail a test about its contents.
const entry = /\bhelping_runner:\s*\{([^}]*)\}/.exec(cat);
chk(!!entry, 'the slug `helping_runner` still exists — every play already ' +
             'logged with it resolves through this key, and renaming the ' +
             'slug to match the label would orphan all of them');

if (entry) {
  const body = entry[1];
  chk(/name:\s*'Aiding the runner'/.test(body),
      "named 'Aiding the runner' — said the way a scorer says it, so it " +
      'sorts under A where they look for it');
  chk(/yards:\s*5\b/.test(body),
      'yards: 5 — NFHS 9-1. 15 was the pre-reduction number and auto-filled ' +
      'a wrong suggestion into the yards box');
  chk(!/yards:\s*15\b/.test(body), 'the old 15 is gone, not merely joined');
  chk(/side:\s*'off'/.test(body), "still an offensive foul");
  chk(/group:\s*'During the play'/.test(body),
      'still carries its group — nothing reads it today, but penalty_list_check ' +
      'requires every entry to have one');
}

// ONE ENTRY, NOT TWO. The literal reading of the request adds a second.
{
  const named = (cat.match(/name:\s*'(?:Aiding|Helping|Assisting) the runner'/g) || []);
  chk(named.length === 1,
      'exactly one entry for this foul, found ' + named.length +
      ' — a second would put a duplicate in front of the scorer and split ' +
      'the logged data across two slugs');
  chk(!/Helping the runner/.test(src),
      'no stray "Helping the runner" left anywhere in the file');
}

// WHERE IT LANDS IN THE LIST. The whole point of the rename is the sort
// position, so assert the position rather than trusting the label.
{
  const PEN = {};
  const re = /^\s*([a-z_0-9]+):\s*\{([^}]*)\}/gm;
  let m;
  while ((m = re.exec(cat))) {
    const nm = /name:\s*'([^']*)'/.exec(m[2]);
    const sd = /side:\s*'([^']*)'/.exec(m[2]);
    if (nm && sd) PEN[m[1]] = { name: nm[1], side: sd[1] };
  }
  const off = Object.keys(PEN)
    .filter(k => PEN[k].side === 'both' || PEN[k].side === 'off')
    .map(k => PEN[k].name)
    .sort((a, b) => a.localeCompare(b));
  const idx = off.indexOf('Aiding the runner');
  chk(idx !== -1, 'it appears in the offensive list');
  chk(idx === 0 || /^[Aa]/.test(off[idx - 1] || ''),
      'it sorts among the A entries (position ' + idx + ' of ' + off.length +
      ', after "' + (off[idx - 1] || '—') + '") — a scorer typing "a" ' +
      'reaches it');
}

console.log('\nFailures: ' + fails);
if (!fails) {
  console.log('\n  the foul a crew calls "aiding the runner" is one entry, ' +
              'named the way\n  they say it, sorted where they look for it, ' +
              'carrying the NFHS yardage,\n  and still keyed by the slug ' +
              'every logged play was written with.\n');
}
process.exit(fails ? 1 : 0);
