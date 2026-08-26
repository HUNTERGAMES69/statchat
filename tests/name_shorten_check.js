// Long names shorten — but never into a different player
// ======================================================
// Opponent rosters are uploaded per game and carry names long enough to
// push the numeric columns off a view tile. Shortening to an initial fixes
// that and introduces a far worse risk: "Jarivs Blackston" and "James
// Blackston" both become "J. Blackston".
//
// In a STATISTICS table that is not a cosmetic problem. It attributes one
// player's numbers to another and gives the reader no way to tell. **A
// clipped name is a display problem; a wrong name is a data problem**, so
// the short form is used only where it is unique among the names shown
// beside it.
//
//   node tests/name_shorten_check.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'view.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

// lift the real functions out of the page so the test cannot drift from it
const grab = name => {
  const re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n      \\}');
  const m = re.exec(src);
  if (!m) throw new Error('could not find ' + name + ' in view.html');
  return m[0];
};
// NAME_LIMIT and NICKNAME both. shortenName gained a dependency on the
// nickname pattern when tier 2 was added, and lifting the function without
// it threw ReferenceError -- the extraction has to follow the code.
const consts = /const NAME_LIMIT = \d+;/.exec(src)[0] + '\n' +
               /const NICKNAME = [^\n]+/.exec(src)[0];
const { shortenName, shortenAll, NAME_LIMIT } = new Function(
  consts + '\n' + grab('shortenName') + '\n' + grab('shortenAll') +
  '\nreturn { shortenName, shortenAll, NAME_LIMIT };')();

console.log('=== Name shortening (limit ' + NAME_LIMIT + ') ===\n');

// ---- the threshold leaves real names alone -------------------------------
['Parker Robinson', "Kionte' Mims II", 'Jarivs Blackston', 'Connor Ajlani',
 'Tahj Sanders', 'Rivers Sorrell'].forEach(n => {
  chk(shortenName(n) === n,
      'untouched: "' + n + '" (' + n.length + ' chars, under the limit)');
});

// ---- long names shorten --------------------------------------------------
chk(shortenName('Christopher Vandergriff') === 'C. Vandergriff',
    'long name shortens to an initial');
chk(shortenName('Bartholomew Fetterman Jr.') === 'B. Fetterman Jr.',
    'a SUFFIX is kept — dropping it loses information and invites a collision ' +
    'against a plain Fetterman');
// The case above passes whether or not the suffix branch runs, because "Jr."
// survives inside the surname join either way -- an assertion that cannot
// fail. This one separates them: with the branch off, the surname becomes
// "Vandergriffington III" and the III is no longer treated as a suffix, so
// a roster holding both a Vandergriffington and a Vandergriffington III
// would collide.
chk(shortenName('Maximilian Vandergriffington III') === 'M. Vandergriffington III',
    'and the suffix is recognized as a suffix, not swallowed into the surname');
const suffixPair = [
  { name: 'Maximilian Vandergriffington' },
  { name: 'Maximilian Vandergriffington III' },
];
const sp = shortenAll(suffixPair);
chk(sp[0] !== sp[1],
    'a player and the same-named player with a suffix never collapse together');
chk(shortenName('Maximilian Van Der Berg') === 'M. Van Der Berg',
    'a compound surname stays whole');
chk(shortenName('Bartholomewwwwwwwwwwww') === 'Bartholomewwwwwwwwwwww',
    'a single long word is left alone — there is no initial to take');

// ---- TIER 2: THE NICKNAME GOES, NOT THE FIRST NAME ----------------------
// Tier 1 alone was not enough. `Antuan "AJ" Robinson Jr.` is 24 characters
// and comes out of tier 1 at 20 -- still long enough to push the XP Made
// column off the special-teams tile, which is what Andy saw.
//
// The obvious second tier is last-name-only. It is the wrong one: it saves
// 3 characters and collapses `Parker Robinson` and `Jaylen Robinson` --
// brothers on one roster is ordinary -- into two identical rows. The
// collision guard then hands BOTH their full names back, so on exactly the
// roster where it is needed it switches itself off.
chk(shortenName('Antuan "AJ" Robinson Jr.') === 'A. Robinson Jr.',
    'the name from the screenshot drops to 15 characters, keeping the initial ' +
    'AND the surname (got "' + shortenName('Antuan "AJ" Robinson Jr.') + '")');
chk(shortenName('Bartholomew "Bart" Fetterman Jr.') === 'B. Fetterman Jr.',
    'and the suffix still rides along after the nickname is removed');
chk(shortenName('DeAndre "Pop" Houston-Carson') === 'D. Houston-Carson',
    'a hyphenated surname survives intact');

// TIER 2 ONLY FIRES WHEN TIER 1 IS NOT ENOUGH. A nickname on a name that
// already fits is the player's own, and there is no reason to take it.
chk(shortenName('"Tank" Williams') === '"Tank" Williams',
    'a SHORT name keeps its nickname — tier 2 is a last resort, not a policy ' +
    'on nicknames');
chk(shortenName('Parker Robinson') === 'Parker Robinson',
    'and a name under the limit is untouched at either tier');

// THE COLLISION RISK IS UNCHANGED by tier 2, which is the whole argument
// for it over last-name-only.
{
  const brothers = [{ name: 'Antuan "AJ" Robinson Jr.' }, { name: 'Jaylen "JR" Robinson' }];
  const out2 = shortenAll(brothers);
  chk(out2[0] !== out2[1],
      'two brothers with nicknames still resolve to DIFFERENT names — ' +
      'last-name-only would have made both "Robinson" and forced the guard ' +
      'to give up (got "' + out2[0] + '" / "' + out2[1] + '")');
}

// ---- THE COLLISION GUARD -------------------------------------------------
const clash = [
  { name: 'Jarivs Blackstonnnnn' },   // over the limit
  { name: 'James Blackstonnnnn' },    // over the limit, same initial + surname
];
const out = shortenAll(clash);
chk(out[0] === 'Jarivs Blackstonnnnn' && out[1] === 'James Blackstonnnnn',
    'TWO players who would shorten to the same thing BOTH keep their full ' +
    'names — a table must never show one player under another player\'s name');

const mixed = [
  { name: 'Christopher Vandergriff' },  // shortens
  { name: 'Sam Goode' },                // short already
  { name: 'Devonte Williamsonnnn' },    // shortens
];
const m = shortenAll(mixed);
chk(m[0] === 'C. Vandergriff' && m[1] === 'Sam Goode' && m[2] === 'D. Williamsonnnn',
    'no collision means every long name shortens and short ones are untouched');

// a short form that would equal someone's ACTUAL full name
const shadow = [
  { name: 'Jonathan Priceeeeeeee' },
  { name: 'J. Priceeeeeeee' },
];
const sh = shortenAll(shadow);
chk(sh[0] === 'Jonathan Priceeeeeeee',
    'a short form is refused when it would duplicate another row\'s REAL name');

// ---- the page uses it, once per table ------------------------------------
chk(/const displayNames = shortenAll\(rows\);/.test(src),
    'view.html computes the names once per table, so uniqueness is judged ' +
    'against the names actually shown together');
chk(/displayNames\[ri\]/.test(src),
    'and renders from that rather than from r.name');
chk(!/shortenName\(/.test(src.replace(/function shortenName[\s\S]*?\n      \}/, '')
                            .replace(/function shortenAll[\s\S]*?\n      \}/, '')),
    'shortenName is never called directly on a single name — that would skip ' +
    'the collision check entirely');

// ---- THE WIDTH CAP, checked for SHAPE only ------------------------------
// jsdom does no layout: clientWidth, offsetWidth and scrollWidth all report
// 0, so this loop cannot be exercised here. That blindness is exactly what
// let the original problem through -- the tables are table-layout:auto with
// white-space:nowrap, so a long row does not wrap, it makes the table wider
// than the tile and the right-hand columns are simply clipped.
//
// What CAN be asserted is that the cap exists, runs after the height pass,
// and fails safe.
chk(/WIDTH MATTERS TOO/.test(src),
    'the scaler considers width, not only height');
{
  const heightLoop = src.indexOf('Re-measure and back off until it genuinely fits');
  const widthLoop  = src.indexOf('WIDTH MATTERS TOO');
  chk(heightLoop > -1 && widthLoop > heightLoop,
      'and does so AFTER height has had its say — the height pass is allowed ' +
      'to GROW to 1.5x, which would otherwise spend the characters the ' +
      'shortener just saved and push the numbers off again');
}
chk(/if \(wA <= 0 && wB <= 0\) break;/.test(src),
    'it stops as soon as nothing overflows');
chk(/if \(!avail\) return 0;/.test(src),
    'and FAILS SAFE: a browser that reports no width breaks the loop and ' +
    'leaves the height-chosen scale, which is exactly current behaviour — ' +
    'this can only improve on today, never regress');
chk(/Math\.max\(t\.scrollWidth, t\.offsetWidth\)/.test(src),
    'overflow is measured three ways and the largest wins, because browsers ' +
    'disagree about which property grows when a nowrap table exceeds its box');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
