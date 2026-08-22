// Picker behaviour checks
// -----------------------
// Three rules, asserted across all four picker families:
//
//   1. Every player named on the likely-starters screen appears in the
//      pickers for the roles that slot plays -- and NOT in ones it
//      doesn't. This must hold before a single play is entered, and
//      regardless of which roster unit the player was filed under or
//      what position string they carry.
//   2. Any player entered by hand on a play joins that picker from then
//      on, so a number never has to be typed twice.
//   3. Lists are ordered by most recent use.
//
// The negative assertions matter as much as the positive ones. Earlier
// attempts at rule 1 were too broad and put wide receivers in the
// quarterback picker, which is worse than the original bug.

const { bootGamePage, defaultRoster } = require('./harness');
const { enterPlay, setDrive, click, typeInto } = require('./ui_driver');

// A picker button shows the SURNAME only; the full name lives in its
// title. These checks are about WHICH PLAYER a button is, not about how
// his name is abbreviated, so they read the title and fall back to the
// visible text. Written after promoting the rail layout, where the
// shortened labels made every full-name matcher here fail at once --
// the labels were doing their job and the matchers were reading the
// wrong half of the button.
// BOTH halves, joined -- not title-or-text. The title is the full name on
// most buttons, but on a seeded starter it is a tooltip instead ("Last
// quarterback to throw -- tap to confirm..."), so preferring it hid the
// player's name behind the hint. Matching the pair is right for what
// these checks ask, which is only ever whether a given player is present.
const pickLabel = b => b ? ((b.getAttribute('title') || '') + ' ' + (b.textContent || '')) : '';

const OPP_ROSTER = [
  // Deliberately awkward, mirroring a real opponent upload:
  //  - #6 is seeded RB1 but filed under DEFENSE
  //  - #5 carries a two-way position string
  //  - #24 has a position the allow-lists do not know
  //  - #8 has no position at all
  //  - #77 is a lineman: rostered, never seeded, must stay out
  { team_side: 'teamB', unit: 'offense', jersey_number: '1',  player_name: 'Opp QB',     position: 'QB' },
  { team_side: 'teamB', unit: 'defense', jersey_number: '6',  player_name: 'Opp RB1',    position: 'RB/LB' },
  { team_side: 'teamB', unit: 'offense', jersey_number: '5',  player_name: 'Opp WR1',    position: 'WR, DB' },
  { team_side: 'teamB', unit: 'offense', jersey_number: '24', player_name: 'Opp WR2',    position: 'ATH' },
  { team_side: 'teamB', unit: 'offense', jersey_number: '8',  player_name: 'Opp WR3',    position: '' },
  { team_side: 'teamB', unit: 'offense', jersey_number: '77', player_name: 'Opp Line',   position: 'OL' }
];
const SEEDS = { teamB: { QB: '1', RB1: '6', WR1: '5', WR2: '24', WR3: '8' } };

async function oppWithBall(){
  const roster = defaultRoster().filter(r => r.team_side === 'teamA').concat(OPP_ROSTER);
  const h = await bootGamePage({ roster, game: { seed_starters: SEEDS } });
  h.evalIn('pushAndPersist({id:nextId++,text:"flip",effect:{forcePossession:"teamB"},quarter:1}); renderAll();');
  return h;
}
const nums = (h, type, cls) => {
  h.evalIn('renderPlayPanel("' + type + '")');
  // data-num, not a regex on the label. The button used to read
  // "#8 Name" and the number was scraped out of it; treatment A dropped
  // the '#' and split the number into its own element, and this returned
  // a list of undefineds while reporting it as "seeded #8 missing" --
  // a test failing for a rendering change and blaming the app.
  //
  // data-num is the attribute every click handler already reads, so it is
  // both the stable handle and the one that matters.
  return [...h.document.querySelectorAll(cls)].map(b => b.dataset.num);
};

async function run(){
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });
  const has = (list, n) => list.indexOf(n) !== -1;

  // --- 1. seeded starters, before any play ---------------------------
  {
    const h = await oppWithBall();
    const carrier  = nums(h, 'rush', '.pp_carrier_pick');
    const passer   = nums(h, 'pass', '.pp_passer_pick');
    const receiver = nums(h, 'pass', '.pp_receiver_pick');

    ['1', '6', '5', '24', '8'].forEach(n => {
      if (!has(carrier, n)) fail('rule 1', 'seeded #' + n + ' missing from the carrier picker: ' + carrier.join(','));
    });
    if (!has(passer, '1')) fail('rule 1', 'the seeded QB is missing from the passer picker: ' + passer.join(','));
    ['6', '5', '24', '8'].forEach(n => {
      if (!has(receiver, n)) fail('rule 1', 'seeded #' + n + ' missing from the receiver picker: ' + receiver.join(','));
    });

    // Negative: the seed must not be a blanket bypass.
    ['6', '5', '24', '8'].forEach(n => {
      if (has(passer, n)) fail('rule 1 (negative)', 'seeded non-QB #' + n + ' should not be in the passer picker');
    });
    if (has(carrier, '77') || has(passer, '77') || has(receiver, '77')){
      fail('rule 1 (negative)', 'a rostered OL who was never seeded should not appear in any of them');
    }
    h.close();
  }

  // --- 2. a hand-typed player joins the list -------------------------
  {
    const h = await oppWithBall();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    if (has(nums(h, 'rush', '.pp_carrier_pick'), '44')){
      fail('rule 2', '#44 should not be there before he carries');
    }
    enterPlay(h, { type: 'rush', carrier: '44', yards: '6' });
    if (!has(nums(h, 'rush', '.pp_carrier_pick'), '44')){
      fail('rule 2', 'a hand-typed carrier did not join the picker');
    }
    h.close();
  }

  // --- 2b. same for defence, special teams and returners -------------
  {
    const h = await bootGamePage();
    const mk = roles => h.evalIn('pushAndPersist({id:nextId++,text:"x",effect:{},quarter:1,roles:' + JSON.stringify(roles) + '});');
    const numsOf = expr => JSON.parse(h.evalIn('JSON.stringify(' + expr + '.map(x => x.num))'));

    if (has(numsOf('defenseEligible("teamB")'), '63')) fail('rule 2', '#63 present before any credit');
    mk({ defense: { team: 'teamB', num: '63' }, playType: 'sack' });
    if (!has(numsOf('defenseEligible("teamB")'), '63')) fail('rule 2', 'a hand-typed tackler did not join the picker');

    mk({ punter: { team: 'teamA', num: '61' }, playType: 'punt' });
    if (!has(numsOf('specialTeamsEligible("teamA")'), '61')) fail('rule 2', 'a hand-typed punter did not join the picker');

    mk({ defense: { team: 'teamB', num: '82' }, playType: 'kickoff_return' });
    if (!has(numsOf('returnerEligible("teamB")'), '82')) fail('rule 2', 'a hand-typed returner did not join the picker');
    h.close();
  }

  // --- 3. recency ordering -------------------------------------------
  {
    const h = await oppWithBall();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '6',  yards: '4' });
    enterPlay(h, { type: 'rush', carrier: '24', yards: '3' });
    enterPlay(h, { type: 'rush', carrier: '6',  yards: '2' });
    const carrier = nums(h, 'rush', '.pp_carrier_pick');
    if (carrier[0] !== '6' || carrier[1] !== '24'){
      fail('rule 3', 'carriers should be 6 then 24 by recency, got ' + carrier.join(','));
    }
    h.close();
  }
  {
    const h = await bootGamePage();
    const mk = roles => h.evalIn('pushAndPersist({id:nextId++,text:"x",effect:{},quarter:1,roles:' + JSON.stringify(roles) + '});');
    const numsOf = expr => JSON.parse(h.evalIn('JSON.stringify(' + expr + '.map(x => x.num))'));

    ['55', '99', '55', '21'].forEach(n => mk({ defense: { team: 'teamB', num: n }, playType: 'sack' }));
    const def = numsOf('defenseEligible("teamB")');
    if (def[0] !== '21' || def[1] !== '55' || def[2] !== '99'){
      fail('rule 3', 'tacklers should be 21,55,99 by recency, got ' + def.join(','));
    }

    mk({ punter: { team: 'teamA', num: '15' }, playType: 'punt' });
    mk({ kicker: { team: 'teamA', num: '3'  }, playType: 'kickoff' });
    const st = numsOf('specialTeamsEligible("teamA")');
    if (st[0] !== '3' || st[1] !== '15'){
      fail('rule 3', 'special teams should be 3 then 15 by recency, got ' + st.join(','));
    }

    mk({ defense: { team: 'teamB', num: '82' }, playType: 'kickoff_return' });
    const ret = numsOf('returnerEligible("teamB")');
    if (ret[0] !== '82') fail('rule 3', 'the most recent returner should lead, got ' + ret.join(','));
    h.close();
  }

  // --- 4. our own fully-positioned roster stays tightly filtered -----
  {
    const h = await bootGamePage();
    const passer = nums(h, 'pass', '.pp_passer_pick');
    if (passer.length !== 1 || passer[0] !== '7'){
      fail('rule 1 (negative)', 'a complete roster should still filter the passer picker to the QB, got ' + passer.join(','));
    }
    h.close();
  }

  // --- SEEDING A SHARED NUMBER ------------------------------------------
  // Added 13 Aug 2026. Two separate things, both about a starters list
  // that names a jersey number two people wear.
  //
  // 1. THE SEED MUST REACH A NARROW ROLE. Passer, kicker and punter
  //    refuse unpositioned players on purpose -- otherwise every nameless
  //    entry in an opponent roster lands in the quarterback picker. The
  //    seed is the coach's explicit override of that, and for UNSHARED
  //    numbers it always worked. For a shared number it did not: an
  //    ambiguous number is dropped from the resolved list before the seed
  //    check is reached, and the ambiguous branch never consulted the
  //    seed. Seeding QB to a shared number therefore did nothing at all
  //    and the passer picker came up EMPTY -- which reads as broken.
  //
  //    Opponent rosters typed from a programme have no positions, so this
  //    is the ordinary case, not a corner.
  //
  // 2. RECENCY OUTRANKS THE SEED ONCE SOMEONE HAS PLAYED. A starters list
  //    is a guess made before kickoff; a carry is a fact. If the backup
  //    has taken over, he belongs at the front of the picker even though
  //    the coach named someone else in August.
  {
    const roster = defaultRoster().filter(r => r.team_side === 'teamB').concat([
      { team_side: 'teamA', unit: 'offense', jersey_number: '7',  player_name: 'Alpha Ates',  position: '' },
      { team_side: 'teamA', unit: 'offense', jersey_number: '7',  player_name: 'Bravo Boone', position: '' },
      { team_side: 'teamA', unit: 'offense', jersey_number: '40', player_name: 'Cody Carr',   position: 'RB' },
      { team_side: 'teamA', unit: 'offense', jersey_number: '40', player_name: 'Dell Doss',   position: 'RB' },
      // Shared and NOT seeded -- the control for the ordering assertion.
      { team_side: 'teamA', unit: 'offense', jersey_number: '55', player_name: 'Earl Eames',  position: 'RB' },
      { team_side: 'teamA', unit: 'offense', jersey_number: '55', player_name: 'Fred Frank',  position: 'RB' }
    ]);
    const h = await bootGamePage({ roster,
      game: { seed_starters: { teamA: { QB: '7', RB1: '40' } } } });
    const { window: win, document: doc } = h;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });

    // (1) a seeded shared number reaches the passer picker
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    const passers = [...doc.querySelectorAll('.pp_passer_pick')].map(pickLabel);
    if (!passers.length) {
      fail('seeded shared number', 'seeding QB to a shared number left the passer picker ' +
           'EMPTY — the seed never reached the ambiguous branch');
    } else if (!passers.some(t => /Alpha/.test(t)) || !passers.some(t => /Bravo/.test(t))) {
      fail('seeded shared number', 'both players wearing the seeded number must be offered — ' +
           'the seed is keyed by NUMBER and cannot say which one. Got: ' + passers.join(' , '));
    }

    // (2) before anyone plays, SEEDED numbers lead un-seeded ones.
    // Asserted that way round rather than naming one number: seedOrder is
    // role-ordered (QB, RB1, RB2, WR1...), so the seeded QB sorts ahead of
    // the seeded RB1 even in the carrier picker. That is not new and not
    // this change -- the resolved list has always sorted by
    // seed.indexOf() -- so pinning "#40 first" would be pinning an
    // accident of which slot was filled in.
    click(win, doc.querySelector('.ptypeBtn[data-type="rush"]'));
    const before = [...doc.querySelectorAll('.pp_carrier_pick')].map(b => b.dataset.num);
    const lastSeeded = Math.max(before.lastIndexOf('7'), before.lastIndexOf('40'));
    const firstUnseeded = before.indexOf('55');
    if (firstUnseeded !== -1 && lastSeeded > firstUnseeded) {
      fail('seeded shared number', 'before any carry, every seeded number should sort ahead of ' +
           'the un-seeded #55. Order: ' + before.join(','));
    }

    // ...and once the OTHER number carries, recency takes over
    click(win, [...doc.querySelectorAll('.pp_carrier_pick')].find(b => /Bravo/.test(pickLabel(b))));
    typeInto(win, doc.getElementById('pp_yards'), '8');
    click(win, doc.getElementById('pp_review'));
    click(win, doc.getElementById('saveBtn'));
    click(win, doc.querySelector('.ptypeBtn[data-type="rush"]'));
    const after = [...doc.querySelectorAll('.pp_carrier_pick')];
    if (!after.length || !/Bravo/.test(pickLabel(after[0]))) {
      fail('seeded shared number', 'after Bravo Boone carried he should lead the carrier picker — ' +
           'a carry is a fact and outranks the starters list. Got: ' +
           after.map(b => pickLabel(b).trim()).join(' , '));
    }
    h.close();
  }

  // --- A SHARED NUMBER WHO PLAYS OUT OF POSITION ------------------------
  // The halfback pass. A running back throws, and from then on he is a
  // player who throws -- the resolved list has always worked that way
  // ("a tight end who has carried is a ball carrier"). Ambiguous numbers
  // never reached that rule, so a shared-number back could throw a
  // perfectly recorded pass and still not appear in the passer picker on
  // the next snap. The number had to be typed every single time.
  //
  // Identity-keyed: throwing promotes the man who threw, NOT both players
  // wearing his jersey. Both halves are asserted, because admitting both
  // would look like a pass and is the easier thing to write by accident.
  {
    const roster = defaultRoster().filter(r => r.team_side === 'teamB').concat([
      { team_side: 'teamA', unit: 'offense', jersey_number: '7',  player_name: 'Alpha Ates',  position: 'RB' },
      { team_side: 'teamA', unit: 'offense', jersey_number: '7',  player_name: 'Bravo Boone', position: 'RB' },
      { team_side: 'teamA', unit: 'offense', jersey_number: '12', player_name: 'Real Quarterback', position: 'QB' },
      { team_side: 'teamA', unit: 'offense', jersey_number: '80', player_name: 'Wide Out',    position: 'WR' }
    ]);
    const h = await bootGamePage({ roster });
    const { window: win, document: doc } = h;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });

    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    const pre = [...doc.querySelectorAll('.pp_passer_pick')].map(pickLabel);
    if (pre.some(t => /Alpha|Bravo/.test(t))) {
      fail('halfback pass', 'a recorded RB should not be pre-offered in the passer picker ' +
           'before he has thrown — that is what keeps the grid short. Got: ' + pre.join(' , '));
    }

    // Type the back's number and pick him -- the manual path never
    // filters on position, which is what makes the play enterable at all.
    typeInto(win, doc.getElementById('pp_passer_manual'), '7');
    const alts = [...doc.querySelectorAll('.nameConfirmAlt')];
    const alpha = alts.find(b => /Alpha/.test(pickLabel(b)));
    if (alpha) click(win, alpha);
    typeInto(win, doc.getElementById('pp_receiver_manual'), '80');
    typeInto(win, doc.getElementById('pp_yards'), '18');
    click(win, doc.getElementById('pp_review'));
    click(win, doc.getElementById('saveBtn'));

    const thrown = h.db.plays[h.db.plays.length - 1];
    const who = thrown && thrown.roles && thrown.roles.passer && thrown.roles.passer.name;
    if (who !== 'Alpha Ates') {
      fail('halfback pass', 'the pass should be recorded to Alpha Ates, got ' + JSON.stringify(who));
    }

    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    const post = [...doc.querySelectorAll('.pp_passer_pick')].map(pickLabel);
    // SURNAME, not first name. A seeded starter's title is a tooltip
    // rather than his full name, so "Alpha" is nowhere in that button --
    // only "Ates" is. The check is unchanged in substance: Ates and Boone
    // share #7, so the surname still identifies exactly one of them, and
    // it is what the scorer actually sees.
    if (!post.some(t => /Ates/.test(t))) {
      fail('halfback pass', 'after throwing, the back should JOIN the passer picker — ' +
           'otherwise his number has to be typed on every halfback pass. Got: ' + post.join(' , '));
    }
    if (post.some(t => /Boone/.test(t))) {
      fail('halfback pass', 'only the man who actually threw should be promoted. Bravo Boone ' +
           'shares the number but has thrown nothing, and appears anyway: ' + post.join(' , '));
    }
    h.close();
  }

  // --- A NAMED SEED PICKS WHICH #7 --------------------------------------
  // The structural fix, 13 Aug 2026. seed_starters was slot -> jersey
  // NUMBER, so with two players wearing 7 it could not say which one was
  // the starter — the last place in the app that could not express a
  // shared number. It is now { num, name }, and BOTH shapes must be read
  // forever: no game row is migrated, so every game saved before that
  // date is still a bare number and must behave exactly as it used to.
  //
  // The seed decides who is offered FIRST, and nothing else. Both players
  // stay in the list — a starters list says who is expected to start, not
  // who is allowed to play, and narrowing to the named one would hide the
  // backup the moment he came on. That is asserted explicitly because it
  // is the tempting "improvement" that would break a real game.
  {
    const roster = defaultRoster().filter(r => r.team_side === 'teamB').concat([
      { team_side: 'teamA', unit: 'offense', jersey_number: '7',  player_name: 'Alpha Ates',  position: 'RB' },
      { team_side: 'teamA', unit: 'offense', jersey_number: '7',  player_name: 'Bravo Boone', position: 'RB' }
    ]);
    const firstCarrier = async (seeds) => {
      const h = await bootGamePage({ roster, game: { seed_starters: { teamA: seeds } } });
      setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
      click(h.window, h.document.querySelector('.ptypeBtn[data-type="rush"]'));
      const names = [...h.document.querySelectorAll('.pp_carrier_pick')].map(pickLabel);
      h.close();
      return names;
    };

    const named = await firstCarrier({ RB1: { num: '7', name: 'Bravo Boone' } });
    if (!named.length || !/Bravo/.test(named[0])){
      fail('named seed', 'seeding RB1 to Bravo Boone specifically should put him first, got: ' +
           named.map(t => t.trim()).join(' , '));
    }
    // REVISED 13 Aug 2026, same evening. This first asserted that BOTH
    // players stay in the picker, on the reasoning that a seed says who
    // is expected to start rather than who may play. Seeing it in a real
    // game showed that was wrong: the coach had already answered "which
    // #5" in the starters list, and the picker showed two question marks
    // against the number they had just settled. Answering a question and
    // then being asked it again reads as the app ignoring you.
    //
    // The backup was never actually unreachable, which is what made the
    // original reasoning hollow -- typing the number offers the same
    // choice, and one play promotes him permanently. Both are asserted
    // below, because they are what make the narrowing safe.
    if (named.some(t => /Alpha/.test(t))){
      fail('named seed', 'the un-named #7 is still offered — naming Bravo in the starters ' +
           'list answered "which one", and showing both again ignores that answer');
    }
    if (named.some(t => /\?/.test(t))){
      fail('named seed', 'the seeded player is still marked "?" — the number was resolved ' +
           'at setup, so there is no open question left to flag');
    }
    // ...and naming the other one reverses it, so the assertion above is
    // not just observing roster order.
    const other = await firstCarrier({ RB1: { num: '7', name: 'Alpha Ates' } });
    if (!other.length || !/Alpha/.test(other[0])){
      fail('named seed', 'naming Alpha Ates should offer HIM, got: ' +
           other.map(t => t.trim()).join(' , '));
    }
    if (other.some(t => /Bravo/.test(t))){
      fail('named seed', 'naming Alpha still offered Bravo');
    }

    // THE BACKUP MUST STAY REACHABLE. Narrowing the picker is only
    // defensible because these two paths exist; without them a coach
    // would have no way to record the other man at all.
    {
      const h2 = await bootGamePage({ roster,
        game: { seed_starters: { teamA: { RB1: { num: '7', name: 'Bravo Boone' } } } } });
      setDrive(h2, { down: 1, distance: 10, side: 'own', yardline: 25 });
      click(h2.window, h2.document.querySelector('.ptypeBtn[data-type="rush"]'));
      typeInto(h2.window, h2.document.getElementById('pp_carrier_manual'), '7');
      const box = h2.document.querySelector('#pp_carrier_manual + div');
      const boxText = box ? box.textContent : '';
      const alts = [...h2.document.querySelectorAll('.nameConfirmAlt')].map(b => b.textContent).join(' ');
      // The DEFAULT must be the seeded starter, not whoever the roster
      // map happens to hold. Otherwise the picker offers one player and
      // typing the same number quietly offers the other.
      if (!/Bravo/.test(boxText)){
        fail('named seed', 'typing the shared number defaults to somebody other than the ' +
             'seeded starter — the picker and the typed entry must agree about who #7 is. ' +
             'Got: ' + JSON.stringify(boxText.slice(0, 100)));
      }
      if (!/Alpha/.test(alts)){
        fail('named seed', 'typing the shared number does not offer the un-named player — ' +
             'that path is the whole reason narrowing the picker is safe. Offered: ' +
             JSON.stringify(alts.slice(0, 120)));
      }
      h2.close();
    }

    // BACKWARD COMPATIBILITY: a bare number, as every older game has.
    const legacy = await firstCarrier({ RB1: '7' });
    if (legacy.length < 2){
      fail('named seed', 'a legacy bare-number seed broke the picker — old game rows are ' +
           'never migrated and must keep working: ' + legacy.map(t => t.trim()).join(' , '));
    }

    // Recency still outranks a named seed once someone has played.
    const h = await bootGamePage({ roster,
      game: { seed_starters: { teamA: { RB1: { num: '7', name: 'Alpha Ates' } } } } });
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    click(h.window, h.document.querySelector('.ptypeBtn[data-type="rush"]'));
    // Bravo is not a button here -- Alpha is the named starter -- so he
    // goes in the way the backup always does: type the number, pick him.
    typeInto(h.window, h.document.getElementById('pp_carrier_manual'), '7');
    const bravoAlt = [...h.document.querySelectorAll('.nameConfirmAlt')]
      .find(b => /Bravo/.test(pickLabel(b)));
    if (!bravoAlt){
      fail('named seed', 'Alpha is the seeded starter, so typing #7 should default to him ' +
           'and offer Bravo as the alternative — Bravo was not offered');
    } else {
      click(h.window, bravoAlt);
    }
    typeInto(h.window, h.document.getElementById('pp_yards'), '9');
    click(h.window, h.document.getElementById('pp_review'));
    click(h.window, h.document.getElementById('saveBtn'));
    click(h.window, h.document.querySelector('.ptypeBtn[data-type="rush"]'));
    const after = [...h.document.querySelectorAll('.pp_carrier_pick')].map(pickLabel);
    if (!after.length || !/Bravo/.test(after[0])){
      fail('named seed', 'Bravo Boone carried, so he must lead the picker even though Alpha ' +
           'was the named starter — a carry is a fact and a seed is a guess. Got: ' +
           after.map(t => t.trim()).join(' , '));
    }
    h.close();
  }

  // THE SUGGESTED QUARTERBACK DOES NOT PREFILL THE MANUAL BOX. Every
  // other box on the page reads "or type #", so one already carrying 7
  // looked like somebody had typed it -- and it is the SUGGESTION, which
  // is what the highlighted button beside it already says.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '12' });
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    const manual = doc.getElementById('pp_passer_manual');
    if (manual.value) fail('suggest:prefill', 'the manual box should be empty, got ' + JSON.stringify(manual.value));
    if (!/type #/.test(manual.placeholder)) fail('suggest:placeholder', 'expected the shared placeholder, got ' + manual.placeholder);
    // The suggestion itself must survive -- the point is the box, not the
    // carried-forward quarterback.
    const sug = doc.querySelector('#pp_passer_grid button.suggested');
    if (!sug) fail('suggest:lost', 'the last quarterback should still be suggested');
    // And confirming him with one tap still records him.
    click(win, sug);
    typeInto(win, doc.getElementById('pp_receiver_manual'), '84');
    typeInto(win, doc.getElementById('pp_yards'), '17');
    click(win, doc.getElementById('pp_review'));
    await new Promise(r => setTimeout(r, 120));
    click(win, doc.getElementById('saveBtn'));
    await new Promise(r => setTimeout(r, 150));
    if (!/Quarterback/.test(h.evalIn('plays[plays.length-1].text'))) {
      fail('suggest:record', 'confirming the suggestion should record him: ' + h.evalIn('plays[plays.length-1].text'));
    }
    h.close();
  }

  // A CLEAR ON THE PHASE ROW. The tree's own Clear sits at the bottom,
  // below however tall the open tree happens to be -- on a long one that
  // is a scroll away from where the mistake was noticed.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    const btn = doc.getElementById('phaseClearBtn');
    if (!btn) { fail('phaseclear:missing', 'no Clear on the phase row'); h.close(); return failures; }
    if (!btn.parentElement.contains(doc.getElementById('quarterUtilBtn'))) {
      fail('phaseclear:row', 'it should share the row with the quarter/half buttons');
    }
    if (win.getComputedStyle(btn).marginLeft !== 'auto') {
      fail('phaseclear:right', 'it should hold the right edge, got ' + win.getComputedStyle(btn).marginLeft);
    }
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    click(win, doc.querySelector('.pp_passer_pick'));
    typeInto(win, doc.getElementById('pp_yards'), '14');
    const before = h.evalIn('plays.length');
    click(win, btn);
    await new Promise(r => setTimeout(r, 120));
    if (doc.getElementById('playPanel').innerHTML.trim()) fail('phaseclear:panel', 'the tree should be emptied');
    if (h.evalIn('plays.length') !== before) fail('phaseclear:wrote', 'Clear must not write a play');
    if (doc.getElementById('typeRail').querySelectorAll('.rail-active').length) {
      fail('phaseclear:rail', 'the ladder should be unlit after Clear');
    }
    h.close();
  }

  // THE KICKER AND PUNTER BOXES DO NOT PREFILL EITHER. The quarterback's
  // was fixed first and left these behind: a box already carrying 39
  // looks like somebody typed it, when it is the suggestion -- which the
  // highlighted button beside it already says.
  {
    const roster = defaultRoster().concat([
      { team_side: 'teamA', unit: 'special', jersey_number: '39', player_name: 'Rivers Sorrell', position: 'P' }
    ]);
    const h = await bootGamePage({ roster });
    const doc = h.window.document, win = h.window;
    h.evalIn('window.confirm = () => true;');
    setDrive(h, { down: 4, distance: 8, side: 'own', yardline: 30 });
    enterPlay(h, { type: 'punt', punter: '39', puntyds: '42', spot: { side: 'own', yardline: 38 } });
    // Give the ball back, or the "last punter for the team now on
    // offence" is the other side and nothing is suggested at all.
    click(win, doc.getElementById('flipBtn'));
    await new Promise(r => setTimeout(r, 200));
    setDrive(h, { down: 4, distance: 9, side: 'own', yardline: 28 });
    const n0 = h.evalIn('plays.length');

    click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
    const manual = doc.getElementById('pp_punter_manual');
    if (manual.value) fail('kick-suggest:prefill', 'the punter box should be empty, got ' + JSON.stringify(manual.value));
    if (!/type #/.test(manual.placeholder)) fail('kick-suggest:placeholder', 'expected the shared placeholder, got ' + manual.placeholder);
    const sug = doc.querySelector('#pp_punter_grid button.suggested');
    if (!sug) fail('kick-suggest:lost', 'the last punter should still be suggested');

    // THE POINT: entering the play WITHOUT touching the picker still
    // credits him. Removing a prefill must not remove the carry.
    typeInto(win, doc.getElementById('pp_yards'), '38');
    click(win, doc.querySelector('.pp_spot_side[data-side="opp"]'));
    typeInto(win, doc.getElementById('pp_spot_yardline'), '34');
    click(win, doc.getElementById('pp_review'));
    await new Promise(r => setTimeout(r, 150));
    click(win, doc.getElementById('saveBtn'));
    await new Promise(r => setTimeout(r, 200));
    if (h.evalIn('plays.length') <= n0) fail('kick-suggest:save', 'the punt did not save');
    const roles = JSON.parse(h.evalIn('JSON.stringify((plays.filter(p=>p.roles&&p.roles.playType==="punt").pop()||{}).roles||null)'));
    if (!roles || !roles.punter || roles.punter.num !== '39') {
      fail('kick-suggest:credit', 'the suggested punter should be credited untouched, got ' +
        (roles && roles.punter ? roles.punter.num : 'none'));
    }
    h.close();
  }

  return failures;
}

if (require.main === module){
  run().then(f => {
    console.log('=== Picker behaviour checks ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) console.log('  starters appear, hand-typed players stick, lists order by recency.');
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
