// The penalty list is one alphabetical run
// ========================================
// It was four optgroups -- Before the snap, During the play, Kicking plays,
// Personal foul / conduct -- each sorted alphabetically inside itself. So
// finding a penalty meant deciding which group it belonged to FIRST and then
// looking. Under time pressure that is two decisions where there should be
// one, and the first is a judgement call: is a chop block a foul during the
// play, or a personal foul?
//
// Flat, the answer is always in the same place, and a native select jumps to
// the first letter as you type.
//
//   node tests/penalty_list_check.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Penalty list: flat and alphabetical ===\n');

chk(!/<optgroup/.test(src),
    'no optgroups anywhere — the grouping was the thing being removed');
chk(/penaltyOptionsFor\(penTeam\)\s*\n?\s*\.map\(i => '<option value="' \+ i\.slug/.test(src),
    'the select is built from a flat list of items, not a list of groups');

// `group` STAYS IN THE DATA. Nothing reads it now, but it describes when a
// foul happens and is worth keeping for anything that wants it later.
{
  const cat = /const PENALTIES = \{[\s\S]*?\n\};/.exec(src)[0];
  const total = (cat.match(/^\s*[a-z_0-9]+:\s*\{/gm) || []).length;
  const grouped = (cat.match(/group: '[^']+'/g) || []).length;
  chk(total > 40 && grouped === total,
      'every penalty still carries its group (' + grouped + ' of ' + total +
      ') — removing the UI grouping is not a reason to throw away what the ' +
      'data knows, and one blanked entry would be invisible in the dropdown');
}

// ---- run it --------------------------------------------------------------
{
  const pen = /const PENALTIES = \{[\s\S]*?\n\};/.exec(src);
  const fn = /function penaltyOptionsFor\(side\)\{[\s\S]*?\n\}/.exec(src);
  chk(!!pen && !!fn, 'both the catalogue and the builder are present');
  if (pen && fn) {
    const f = new Function(pen[0] + '\n' + fn[0] + '; return penaltyOptionsFor;')();

    // THE SIDE VALUES ARE 'off' AND 'def', not 'offense'/'defense'. Calling
    // it with the long form returns a shorter list that looks plausible and
    // is missing False start, which is how this nearly got misdiagnosed as
    // a data fault.
    ['off', 'def'].forEach(side => {
      const list = f(side);
      chk(list.length > 30,
          side + ': ' + list.length + ' options — a short list here means the ' +
          'side filter is matching the wrong value');

      const names = list.map(i => i.name);
      const sorted = names.slice().sort((a, b) => a.localeCompare(b));
      chk(JSON.stringify(names) === JSON.stringify(sorted),
          side + ': in alphabetical order, top to bottom');

      const dup = names.filter((n, i) => names.indexOf(n) !== i);
      chk(dup.length === 0,
          side + ': no duplicate names — grouping used to separate two ' +
          'entries sharing one name, and a flat list would show them twice' +
          (dup.length ? ' (' + [...new Set(dup)].join(', ') + ')' : ''));

      chk(list.every(i => i.slug && i.name),
          side + ': every item has a slug and a name');
    });

    chk(f('off').some(i => i.name === 'False start'),
        'False start is offered to the offense — the most common one there is');
    chk(!f('def').some(i => i.name === 'False start'),
        'and not to the defense');
    chk(f('def').some(i => i.name === 'Pass interference') &&
        f('off').some(i => i.name === 'Pass interference'),
        'while pass interference is offered to both, as two separate entries');
  }
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
