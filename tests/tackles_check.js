// Per-player tackles
// ------------------
// Added 12 August 2026 (production plan, Phase 4b). The app had ALWAYS
// captured "tackled by" — stored in `roles.defense`, used to rank the
// tackler picker — and then thrown it away. Only interceptions, sacks
// and fumble recoveries were counted, so an ordinary tackle produced no
// stat anywhere.
//
// TWO DESIGN DECISIONS, both deliberate and both easy to "fix" wrongly:
//
// 1. A SINGLE NUMBER, no solo/assisted split. The entry panel takes one
//    tackler, so every tackle is implicitly solo today. Splitting would
//    need a second field on the fastest-moving screen in the app, which
//    is a real cost during a live game for a distinction nobody has
//    asked for yet.
//
// 2. PER-PLAYER TFL DOES NOT MATCH TEAM TFL, and must not be made to.
//    Team TFL counts every scrimmage play that lost yardage, whether or
//    not anyone was credited — a CEILING. Per-player TFL needs a named
//    tackler, and naming is optional — a FLOOR. Both are correct. They
//    answer different questions, and the reports show them in separate
//    tables with a note, rather than one number that is wrong for
//    somebody.
//
// The under-count is REAL and worth restating: at speed the tackler
// often goes unnamed, so these numbers are a lower bound on what
// happened. That is exactly why team TFL was built to count from the
// play log instead.
//
// ---------------------------------------------------------------------
// REWRITTEN 13 August 2026 — THE SCENARIO IS NOW DRIVEN THROUGH THE UI.
//
// This suite used to hand-author its play rows as object literals, and
// it got one of them WRONG in a way that hid a real bug for a day.
//
// The fixture wrote a seven-yard sack as `passer.yards: -7`. The app
// writes `7` — a POSITIVE loss magnitude, which is what the yards field
// on the sack panel produces, what the play code "#7s 7" carries, and
// what the team-rushing charge in computeBoxScore SUBTRACTS. Six writers
// and readers across engine.js, view.html, recap.html, stat_package.html
// and season_report.html agree on positive.
//
// Because the fixture disagreed, the TFL assertion below passed against
// an engine that never credited a TFL on any sack in production. The bug
// was real, shipped, and invisible: the test asserted the right thing
// about the wrong data. Mutation testing would not have caught it either
// — reverting the fix still leaves this suite green, which is exactly
// what happened when it was checked.
//
// So the plays are no longer written by hand. They are entered through
// game.html's real panels and read back out of what the app persisted.
// A fixture cannot invent a sign convention the app does not use if the
// app is the thing that produced it. This is the same rule the rest of
// tests/ already follows, and the README's "one rule" section says why:
// the original sack-yardage bug (Aug 3) also lived in the input path and
// also survived testing that fed the engine pre-built values.
//
// The cost is runtime — booting game.html and clicking through nine
// plays is slower than declaring an array. Worth it.
// ---------------------------------------------------------------------

const { bootGamePage, bootPage } = require('./harness');
const D = require('./ui_driver');

const ROSTER = [
  { team_side: 'teamA', unit: 'offense', jersey_number: '22', player_name: 'Roberson', position: 'RB' },
  { team_side: 'teamA', unit: 'offense', jersey_number: '7',  player_name: 'Robinson', position: 'QB' },
  { team_side: 'teamA', unit: 'offense', jersey_number: '80', player_name: 'Young',    position: 'WR' },
  { team_side: 'teamB', unit: 'defense', jersey_number: '99', player_name: 'Frank',    position: 'DL' },
  { team_side: 'teamB', unit: 'defense', jersey_number: '55', player_name: 'Carter',   position: 'LB' },
  // OUR defenders, and OUR opponent's ball carrier. stat_package and
  // season_report report Neville only, so a fixture whose tacklers are
  // all on the opposing side proves nothing about them -- the pages
  // correctly showed an empty section and the test blamed the pages.
  { team_side: 'teamA', unit: 'defense', jersey_number: '44', player_name: 'Sledge',   position: 'LB' },
  { team_side: 'teamB', unit: 'offense', jersey_number: '30', player_name: 'Doyle',    position: 'RB' }
];

/**
 * Enter the scenario through game.html and hand back what the app SAVED.
 *
 * Every play is preceded by a drive reset to 1st & 10. That is not
 * tidiness: without it the series reaches 4th down, a gain short of the
 * sticks becomes a turnover on downs, possession flips silently, and the
 * plays after it are credited to the wrong side. The first draft of this
 * rewrite did exactly that and put two of Neville's rushes on Ruston.
 */
async function buildScenario() {
  const h = await bootGamePage({ roster: ROSTER });
  const problems = [];

  const fresh = (yardline) => D.setDrive(h, { down: 1, distance: 10, side: 'own', yardline });
  const play = (label, spec) => {
    const r = D.enterPlay(h, spec);
    // A play the UI refused to save would otherwise show up further down
    // as a puzzling count mismatch. Name it where it happened.
    if (!r.saved) problems.push('the UI did not save "' + label + '": ' + (r.reason || 'unknown'));
    return r;
  };

  // --- Neville has the ball; Ruston's defence records ------------------
  fresh(25); play('rush 6, tackled by Frank',  { type: 'rush', carrier: '22', yards: 6, credit: '99' });
  fresh(25); play('rush -3, tackled by Carter', { type: 'rush', carrier: '22', yards: 3, loss: true, credit: '55' });
  fresh(25); play('sack 7, credited to Frank',  { type: 'sack', passer: '7',  yards: 7, credit: '99' });
  fresh(25); play('pass 12, tackled by Carter', { type: 'pass', passer: '7', receiver: '80', yards: 12, credit: '55' });
  // NOBODY named -- must credit nobody, and must not throw.
  fresh(25); play('rush 4, no tackler named',   { type: 'rush', carrier: '22', yards: 4 });
  // A LOSS with nobody named -- team TFL counts it, per-player does not.
  fresh(25); play('rush -2, no tackler named',  { type: 'rush', carrier: '22', yards: 2, loss: true });

  // --- Ruston with the ball, so OUR defence records something ----------
  // The real "Flip possession" button, not a write into page state.
  const flip = h.document.getElementById('flipBtn');
  if (!flip) problems.push('no Flip possession button on game.html — cannot change sides through the UI');
  else D.click(h.window, flip);
  if (h.evalIn('computeState().possession') !== 'teamB') {
    problems.push('possession did not change hands; the second series would be credited to the wrong team');
  }

  fresh(30); play('Doyle rush 5, tackled by Sledge',  { type: 'rush', carrier: '30', yards: 5, credit: '44' });
  fresh(30); play('Doyle rush -4, tackled by Sledge', { type: 'rush', carrier: '30', yards: 4, loss: true, credit: '44' });

  const plays = h.db.plays.map((r, i) => Object.assign({}, r, {
    sequence_number: r.sequence_number || i + 1
  }));
  h.close();
  return { plays, problems };
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  const { plays, problems } = await buildScenario();
  problems.forEach(p => fail('entry', p));

  const scrimmage = plays.filter(p => p.roles && p.roles.playType);
  if (scrimmage.length !== 8) {
    fail('entry', 'expected 8 scrimmage plays from the UI, got ' + scrimmage.length +
         ' — the rest of this suite counts on that shape');
  }

  // --- THE SIGN CONVENTION, pinned ---------------------------------------
  // This is the assertion whose absence let the bug ship. It does not
  // check a stat; it checks that the app still records sack yardage the
  // way every reader of it expects. If this fails, do not "fix" the
  // readers -- find out why the writer changed.
  {
    const sack = scrimmage.find(p => p.roles.playType === 'sack');
    if (!sack) {
      fail('convention', 'no sack play was persisted at all');
    } else {
      if (!(sack.roles.passer && sack.roles.passer.yards === 7)) {
        fail('convention', 'a 7-yard sack must persist roles.passer.yards as +7, a POSITIVE ' +
             'loss magnitude. Got ' + JSON.stringify(sack.roles.passer) + '. The team-rushing ' +
             'charge subtracts this value, and the sack-yards tiles on four report pages sum it');
      }
      if (!(sack.effect && sack.effect.statYds === -7)) {
        fail('convention', 'a 7-yard sack must persist effect.statYds as -7, SIGNED net yardage. ' +
             'Got ' + JSON.stringify(sack.effect && sack.effect.statYds) + '. This is the field ' +
             'both per-player and team TFL are counted from');
      }
    }
  }

  const v = await bootPage('view.html', { existingPlays: plays, roster: ROSTER });
  const box = JSON.parse(v.evalIn('JSON.stringify(computeBoxScore(plays))'));
  const def = (box.teamB || {}).defense || {};

  // --- the counts ------------------------------------------------------
  const frank = def.Frank || {};
  const carter = def.Carter || {};

  if ((frank.tackles || 0) !== 2) {
    fail('tackles', 'Frank should have 2 tackles (a rush stop and a sack), got ' +
         (frank.tackles || 0) + '. Full row: ' + JSON.stringify(frank));
  }
  if ((carter.tackles || 0) !== 2) {
    fail('tackles', 'Carter should have 2 tackles (a rush for loss and a pass), ' +
         'got ' + (carter.tackles || 0));
  }

  // --- a sack is a tackle too ------------------------------------------
  // How stat sheets treat it, and easy to get wrong by excluding sacks
  // from the tackle count.
  if ((frank.sacks || 0) !== 1) {
    fail('tackles', 'Frank lost his sack: ' + JSON.stringify(frank));
  }
  if ((frank.tackles || 0) <= (frank.sacks || 0)) {
    fail('tackles', 'a sack must count as a tackle as well as a sack');
  }

  // --- TFL ---------------------------------------------------------------
  if ((carter.tfl || 0) !== 1) {
    fail('tfl', 'Carter should have 1 TFL (the 3-yard loss), got ' + (carter.tfl || 0));
  }
  // THE REGRESSION GUARD. With the plays entered through the UI, a sack
  // arrives carrying passer.yards = +7. Any TFL check that reads the role
  // yardage instead of effect.statYds reads that as a seven-yard GAIN and
  // credits nothing -- which is precisely the bug fixed on 13 Aug 2026.
  if ((frank.tfl || 0) !== 1) {
    fail('tfl', 'Frank should have 1 TFL (the sack), got ' + (frank.tfl || 0) +
         '. A sack loses yardage by definition. If this is 0, something is deriving ' +
         'the loss from roles.passer.yards (+7, a positive magnitude) rather than ' +
         'effect.statYds (-7, signed)');
  }

  // --- a gain is never a TFL --------------------------------------------
  const totalTfl = Object.keys(def).reduce((t, k) => t + (def[k].tfl || 0), 0);
  if (totalTfl !== 2) {
    fail('tfl', 'expected 2 per-player TFL, got ' + totalTfl +
         ' — a positive gain must never count');
  }

  // --- an unnamed tackler credits NOBODY --------------------------------
  const totalTackles = Object.keys(def)
    .filter(k => k !== 'TEAM')
    .reduce((t, k) => t + (def[k].tackles || 0), 0);
  if (totalTackles !== 4) {
    fail('unnamed', 'expected 4 credited tackles across 6 scrimmage plays — ' +
         'two had no tackler named and must credit nobody. Got ' + totalTackles);
  }
  if ((def.TEAM || {}).tackles) {
    fail('unnamed', 'an unnamed tackle was credited to a TEAM bucket. Unlike ' +
         'sacks, an uncredited tackle should count for nobody — a team ' +
         '"tackle" total is meaningless, every play ends in one');
  }

  // --- our own defence, from the second series --------------------------
  const ourDef = (box.teamA || {}).defense || {};
  const sledge = ourDef.Sledge || {};
  if ((sledge.tackles || 0) !== 2 || (sledge.tfl || 0) !== 1) {
    fail('tackles', 'Sledge should have 2 tackles and 1 TFL from Ruston\'s series, got ' +
         JSON.stringify(sledge));
  }

  // --- the sack still lands on team rushing ------------------------------
  // The other half of the sign convention, and the reason it must stay
  // positive. NFHS charges sack yardage to the team as a rushing loss;
  // if the stored sign flipped, this would silently read +7.
  {
    const teamRush = ((box.teamA || {}).rushing || {}).TEAM || {};
    if (teamRush.yds !== -7 || teamRush.att !== 1) {
      fail('convention', 'the sack should charge team rushing 1 attempt for -7 yards, got ' +
           JSON.stringify(teamRush));
    }
  }

  // --- the deliberate disagreement with team TFL ------------------------
  // The whole reason these live in separate tables.
  {
    // view.html computes team TFL inline rather than through a named
    // helper, so derive it here the same way: every scrimmage play that
    // lost yardage, tackler or not.
    const TFL_TYPES = ['rush', 'pass', 'sack', 'fumble'];
    const teamTfl = plays.filter(p =>
      p.roles && TFL_TYPES.includes(p.roles.playType) &&
      p.roles.playType && p.effect && typeof p.effect.statYds === 'number' &&
      p.effect.statYds < 0 &&
      // Ruston's defence only -- Neville's losses.
      ((p.roles.carrier && p.roles.carrier.team === 'teamA') ||
       (p.roles.passer && p.roles.passer.team === 'teamA'))).length;
    if (teamTfl <= totalTfl) {
      fail('ceiling vs floor', 'team TFL (' + teamTfl + ') should EXCEED ' +
           'per-player TFL (' + totalTfl + ') in this scenario — there is a ' +
           'loss with no tackler named. If they are equal the team count ' +
           'has probably been changed to require a tackler, which loses ' +
           'the ceiling');
    }
  }

  // --- the view page shows TEAM defence only ----------------------------
  // The per-player tackles tile was removed from view.html on 13 Aug 2026
  // at Andy's request. It is the live spectator and broadcast screen,
  // where the useful defensive figure is the team one; a per-player list
  // is a post-game reading, and it is the one table on that page that is
  // knowingly a floor rather than a total.
  //
  // Asserted as an ABSENCE, so a well-meaning re-add is caught. The
  // numbers themselves are checked above and their display is checked on
  // the three report pages below -- this is about the surface, not the
  // data, and the two must not be conflated.
  {
    const text = v.document.body.textContent.replace(/\s+/g, ' ');
    if (/Frank|Carter/.test(text)) {
      fail('display', 'view.html names an individual tackler — the per-player ' +
           'tackles tile is deliberately not on the live view page. Team ' +
           'defensive totals belong there; per-player belongs on the reports');
    }
    // The TEAM defence tile must still be there -- removing the wrong one
    // would also make the assertion above pass.
    if (!/Fum Rec/i.test(text) && !/Sacks/i.test(text)) {
      fail('display', 'view.html shows no team defensive tile at all — the ' +
           'per-player tile was meant to go, not the team one');
    }
  }
  v.close();

  // --- every post-game surface -------------------------------------------
  // All four, because the numbers existing in the engine says nothing
  // about whether anyone can see them. season_report additionally has to
  // AGGREGATE by name across games, which is a different code path from
  // simply displaying one game's box score.
  for (const [page, opts] of [
    ['recap.html', {}],
    ['stat_package.html', {}],
    ['season_report.html', { query: '?season=2026' }]
  ]) {
    let r;
    try {
      r = await bootPage(page, Object.assign({
        existingPlays: plays, roster: ROSTER,
        game: { status: 'final', season_year: 2026, game_date: '2026-08-24' }
      }, opts));
    } catch (e) {
      fail('display', page + ' failed to load: ' + e.message.split('\n')[0]);
      continue;
    }
    await new Promise(res => setTimeout(res, 300));
    const text = r.document.body.textContent.replace(/\s+/g, ' ');
    if (!/Tackles/i.test(text)) {
      fail('display', page + ' shows no Tackles section');
    }
    // Sledge is OURS; Frank plays for the opposition and correctly does
    // not appear on a Neville-only report.
    const wanted = page === 'recap.html' ? 'Frank' : 'Sledge';
    if (!new RegExp(wanted).test(text)) {
      fail('display', page + ' does not name the leading tackler (' +
           wanted + ')');
    }
    if (!/tackler was named/i.test(text)) {
      fail('display', page + ' has no note that only named tackles are ' +
           'counted. Without it an under-count reads as a complete figure');
    }
    r.close();
  }

  // --- A FUMBLE RECOVERY IS NOT A TACKLE --------------------------------
  // Decided 13 Aug 2026. On a fumble play `roles.defense` is the
  // RECOVERER: he picked the ball up, which is a different act from
  // bringing the carrier down, and it is already credited as fumRec.
  // Counting it as a tackle too inflated every recovering defender by
  // one and made the column disagree with what anyone watching saw.
  //
  // Nothing asserted this in either direction before, which is why it
  // survived — the whole suite stayed green when the behaviour was
  // reversed. Pinned now, both halves: the tackle must NOT appear and
  // the recovery MUST.
  {
    const h = await bootGamePage({ roster: ROSTER });
    D.setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 30 });
    const r = D.enterPlay(h, { type: 'rush', carrier: '22', yards: 3, fumbled: true,
      fumbleRec: 'opp', credit: '99', spot: { side: 'own', yardline: '33' } });
    if (!r.saved) fail('fumble recovery', 'the fumble play did not save: ' + r.reason);
    const box = JSON.parse(h.evalIn('JSON.stringify(computeBoxScore(plays))'));
    const rec = ((box.teamB || {}).defense || {})['Frank'] || {};
    if (rec.tackles) {
      fail('fumble recovery', 'recovering a fumble credited ' + rec.tackles + ' tackle(s) — ' +
           'picking the ball up is not bringing the carrier down, and it is already ' +
           'counted as a fumble recovery');
    }
    if (!rec.fumRec) {
      fail('fumble recovery', 'the recovery itself was lost: ' + JSON.stringify(rec) +
           ' — removing the tackle must not remove the fumRec, they are separate credits');
    }
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Per-player tackles ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) {
      console.log('  tackles counted, TFL derived, unnamed plays credit nobody.');
      console.log('  Plays entered through the real UI; sack sign convention pinned.');
    }
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
