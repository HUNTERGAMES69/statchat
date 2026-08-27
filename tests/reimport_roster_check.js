// Re-import the our-team roster into an existing game
// ===================================================
// A game's roster is a SNAPSHOT taken when it was set up. That is right --
// a finished game must not change because somebody edited a roster
// afterwards -- but there was no way to pull a correction INTO a game, and
// no way to see that the two had drifted.
//
// The roster page derives its unit badge from primary_position on every
// load, so it keeps showing the corrected answer while the game holds the
// old one. A kicker uploaded as K showed "Special" on the roster page and
// was absent from the kickoff picker, with nothing to explain the gap.
//
//   node tests/reimport_roster_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(path.join(__dirname, '..', 'create_game.html'), 'utf8');
const doc = new JSDOM(src).window.document;

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Re-import roster ===\n');

// ---- present, and only where it makes sense ------------------------------
chk(!!doc.getElementById('reimportBtn'), 'the button exists');
chk(/display:none/.test(doc.getElementById('reimportWrap').getAttribute('style') || ''),
    'hidden by default — there is nothing to re-import into a game that does ' +
    'not exist yet');
chk(/if \(editGameId\)\{\s*\n\s*document\.getElementById\('reimportWrap'\)\.style\.display = '';/.test(src),
    'and revealed only in edit mode');

// OUR TEAM ONLY. There is no master table for an opponent roster -- it
// exists solely as a per-game upload -- so there is nothing to re-import
// from, and re-uploading is already how you change it.
chk(!/reimport[\s\S]{0,600}?teamB|opponentResolved = [\s\S]{0,80}Fresh/i.test(
      /function runReimport[\s\S]*?\n  \}/.exec(src)[0]),
    'it never touches the opponent side');
chk(/ourResolved = JSON\.parse\(JSON\.stringify\(ourFreshResolved\)\)/.test(src),
    'and swaps only the our-team roster');

// ---- refused once a play exists ------------------------------------------
// A saved play credits a jersey number to a unit; moving that player would
// leave a statistic attached to a roster entry that no longer agrees.
{
  const fn = /async function runReimport\(\)\{[\s\S]*?\n  \}/.exec(src);
  chk(!!fn, 'runReimport is defined');
  if (fn) {
    chk(/from\('plays'\)\.select\('id', \{ count: 'exact', head: true \}\)\.eq\('game_id', editGameId\)/.test(fn[0]),
        'it counts this game\'s plays before doing anything');
    chk(/if \(count > 0\)\{[\s\S]{0,400}?return;/.test(fn[0]),
        'and refuses when there are any');
    const countAt = fn[0].indexOf("from('plays')");
    const applyAt = fn[0].indexOf('reimportApply');
    chk(countAt > -1 && applyAt > countAt,
        'the check happens BEFORE anything is offered, not after');
    chk(/count, error: cErr/.test(fn[0]) && /if \(cErr\)\{/.test(fn[0]),
        'and a failed count refuses too rather than assuming zero');
  }
}

// ---- nothing is written here ---------------------------------------------
// The existing Save changes button does the writing, through the same path
// every other edit uses. One place that writes a roster, not two.
{
  const fn = /async function runReimport\(\)\{[\s\S]*?\n  \}/.exec(src)[0];
  chk(!/\.insert\(|\.upsert\(|\.delete\(|\.update\(/.test(fn),
      'it writes nothing to the database — Save changes still does that, so ' +
      'there is one roster-writing path rather than two that can diverge');
  chk(/Press <strong>Save changes<\/strong>/.test(src),
      'and says so after applying');
}

// ---- the preview is the point --------------------------------------------
// A silent re-snapshot is the same trap in reverse. The diff is what turns
// this into something you can check without changing anything.
chk(/function reimportDiffHtml/.test(src), 'a diff is rendered');
{
  const uf = /function unitsFromResolved\(res\)\{[\s\S]*?\n  \}/.exec(src);
  chk(!!uf, 'and built from a real comparison, not a message');
  if (uf) {
    const unitsFromResolved = new Function(uf[0] + '; return unitsFromResolved;')();
    // the exact case that started this: three players sharing #1
    const before = { '1': { offense: [{ name: 'Bryce Ross' }, { name: 'Jason Nguyen' },
                                      { name: 'Christian Carter' }], defense: [], special: [] } };
    const after = { '1': { offense: [{ name: 'Christian Carter' }],
                           defense: [{ name: 'Jason Nguyen' }],
                           special: [{ name: 'Bryce Ross' }] } };
    const b = unitsFromResolved(before), a = unitsFromResolved(after);
    chk(b['1|Bryce Ross'].join() === 'offense' && a['1|Bryce Ross'].join() === 'special',
        'a kicker filed as offense is shown moving to special');
    chk(b['1|Jason Nguyen'].join() === 'offense' && a['1|Jason Nguyen'].join() === 'defense',
        'and a defensive tackle back to defense');
    chk(b['1|Christian Carter'].join() === a['1|Christian Carter'].join(),
        'while a player who was already right is not listed — three players ' +
        'share this number, and only the two that actually change should show');
  }
}
chk(/Nothing to ' \+\s*\n\s*'change/.test(src) || /Nothing to change/.test(src),
    'and it says so plainly when the game already matches');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
