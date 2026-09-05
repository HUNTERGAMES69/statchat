// This game's roster — the read-only view
// ---------------------------------------
// Built 5 September 2026, the morning after a game where #7 was two
// players (a linebacker and a wide receiver) and NOBODY held #10 on
// offense. Both facts were true, both mattered, and neither was visible
// from any screen. A pass credited to #10 resolved offense -> special ->
// defense, found the defensive back, and put a catch on him. Six rounds of
// hand-written SQL to unpick, and four of those rounds were wrong because
// the SQL kept assuming a jersey number identifies a player.
//
// THAT ASSUMPTION IS WHAT THESE TESTS EXIST TO BREAK. The fixture below
// deliberately carries a shared number across two units, a defence-only
// number that has been credited an offensive stat, a kicker and an
// ordinary lineman. The kicker and the lineman are not decoration: they
// are there to fail the test if the warning is ever widened back to
// "no offense entry", which fires on most of a roster and is therefore
// a warning nobody reads.

const { bootGamePage } = require('./harness');
const { click, typeInto } = require('./ui_driver');

const ROSTER = [
  { team_side:'teamA', jersey_number:'7',  player_name:'Dillon Robb',     unit:'offense', position:'WR' },
  { team_side:'teamA', jersey_number:'7',  player_name:'Jakobe Collins',  unit:'defense', position:'LB' },
  { team_side:'teamA', jersey_number:'10', player_name:'Tim Smith',       unit:'defense', position:'DB' },
  { team_side:'teamA', jersey_number:'12', player_name:'Parker Robinson', unit:'offense', position:'QB' },
  { team_side:'teamA', jersey_number:'70', player_name:'Marcus Webb',     unit:'offense', position:'OT' },
  { team_side:'teamA', jersey_number:'31', player_name:'Hunter Quinn',    unit:'special', position:'K'  },
];

async function run(){
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  const h = await bootGamePage({ roster: ROSTER });
  const doc = h.document, win = h.window;

  // The fault from 4 Sep: a catch credited to a number nobody holds on offense.
  h.evalIn("pushAndPersist({id:nextId++,text:'pass to Tim Smith for 9',effect:{isStat:true}," +
    "quarter:2,roles:{passer:{team:'teamA',num:'12',yards:9}," +
    "receiver:{team:'teamA',num:'10',yards:9},playType:'pass'}});");

  const btn = doc.getElementById('rosterViewBtn');
  const card = doc.getElementById('rosterCard');
  if (!btn)  fail('button', 'no Roster button in the utility rail');
  if (!card) fail('card', 'no #rosterCard on the page');
  if (!btn || !card){ h.close(); return failures; }

  // It took the slot Manual entry left. If a spacer comes back the rail
  // grows a row and every button above it moves -- which is the whole
  // reason that gap was kept in the first place.
  if (doc.querySelector('.manualGap')){
    fail('rail', 'the .manualGap spacer is back alongside the button, so the rail is a row taller');
  }
  if (!card.classList.contains('hidden')) fail('card', 'the card should start closed');

  click(win, btn);
  if (card.classList.contains('hidden')) fail('toggle', 'clicking Roster did not open the card');
  if (btn.getAttribute('aria-expanded') !== 'true') fail('a11y', 'aria-expanded did not flip to true');

  const rowsOf = () => [...doc.querySelectorAll('.rosterTable tr')].slice(1).map(tr => ({
    num: tr.children[0].textContent, name: tr.children[1].textContent,
    unit: tr.children[2].textContent, flag: tr.children[4].textContent.trim(),
    hot: tr.className.indexOf('rosterHot') !== -1,
    shared: tr.className.indexOf('rosterShared') !== -1 }));

  let rows = rowsOf();
  if (rows.length !== 6) fail('render', 'expected 6 rows, one per player per unit, got ' + rows.length);
  if (!(rows[0] && rows[0].num === '7' && rows[1] && rows[1].num === '7')){
    fail('sort', 'the two #7 rows should sort adjacent at the top, got ' +
      rows.map(r => r.num).join(','));
  }

  // A NUMBER IS NOT A PLAYER. Both #7s must be listed; showing one is the
  // exact bug this view exists to make visible.
  const sevens = rows.filter(r => r.num === '7');
  if (sevens.length !== 2){
    fail('shared', '#7 is two players and only ' + sevens.length + ' row(s) rendered');
  }
  if (!sevens.every(r => r.shared)) fail('shared', 'not every #7 row carries the shared flag');
  if (!sevens.some(r => r.name === 'Jakobe Collins') || !sevens.some(r => r.name === 'Dillon Robb')){
    fail('shared', 'both #7 players must appear: ' + sevens.map(r => r.name).join(' / '));
  }

  const ten = rows.find(r => r.num === '10');
  if (!ten || !ten.hot){
    fail('flag', '#10 has a catch credited to it and nobody on offense — it must be flagged');
  } else if (!/offensive stat/.test(ten.flag)){
    fail('flag', 'the flag must say WHY, got ' + JSON.stringify(ten.flag));
  }

  // THE NARROWNESS OF THE FLAG. A kicker and a lineman have no offensive
  // credit against them, so neither may be marked. An earlier version
  // flagged on "no offense entry" alone and lit up both.
  const kicker = rows.find(r => r.num === '31');
  if (kicker && kicker.flag){
    fail('flag:noise', 'the kicker is flagged — the warning has been widened and is now noise');
  }
  const lineman = rows.find(r => r.num === '70');
  if (lineman && lineman.flag){
    fail('flag:noise', 'an ordinary offensive lineman is flagged');
  }

  // --- search --------------------------------------------------------
  const search = doc.getElementById('rosterSearch');
  if (!search){ fail('search', 'no search box'); }
  else {
    // EXACT BEFORE PREFIX. On a ninety-man roster, typing 7 must put #7 at
    // the top rather than burying it under #70 and #71.
    typeInto(win, search, '7');
    rows = rowsOf();
    if (!(rows.length === 3 && rows[0].num === '7' && rows[1].num === '7' && rows[2].num === '70')){
      fail('search:number', 'search "7" should be #7, #7, #70 in that order, got ' +
        rows.map(r => r.num).join(','));
    }
    typeInto(win, search, 'robb');
    rows = rowsOf();
    if (!(rows.length === 1 && rows[0].name === 'Dillon Robb')){
      fail('search:name', 'search "robb" should find Dillon Robb alone, got ' +
        rows.map(r => r.name).join(' / '));
    }
    // A DIGITS-ONLY QUERY IS A NUMBER. Typing 7 must never match a name.
    typeInto(win, search, '12');
    rows = rowsOf();
    if (rows.some(r => r.num !== '12')){
      fail('search:number', 'a numeric search matched something other than the number: ' +
        rows.map(r => r.num + ' ' + r.name).join(' / '));
    }
    typeInto(win, search, 'ZZZ');
    if (doc.querySelector('.rosterTable')){
      fail('search:empty', 'a search with no hits rendered a table instead of saying so');
    }
    typeInto(win, search, '');
    if (rowsOf().length !== 6) fail('search', 'clearing the box did not restore every row');
  }

  // --- flagged-only --------------------------------------------------
  const flagBtn = doc.getElementById('rosterFlagBtn');
  if (!flagBtn){ fail('filter', 'no Flagged-only button'); }
  else {
    click(win, flagBtn);
    rows = rowsOf();
    if (!rows.length || !rows.every(r => r.flag)){
      fail('filter', 'Flagged only should show flagged rows and nothing else, got ' +
        rows.length + ' row(s)');
    }
    click(win, flagBtn);
    if (rowsOf().length !== 6) fail('filter', 'toggling Flagged only off did not restore every row');
  }

  click(win, btn);
  if (!card.classList.contains('hidden')) fail('toggle', 'clicking Roster again did not close it');

  h.close();
  return failures;
}

if (require.main === module){
  run().then(failures => {
    console.log('=== This game\'s roster ===\n');
    if (!failures.length){
      console.log('  the roster view lists every player on every unit, flags a shared number,');
      console.log('  flags a number credited an offensive stat with nobody on offense, and');
      console.log('  leaves the kicker and the linemen alone.');
      process.exit(0);
    }
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    process.exit(1);
  }).catch(e => { console.error(e); process.exit(1); });
}
module.exports = { run };
