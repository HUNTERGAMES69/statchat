// Picker buttons for an unassigned-but-rostered player showed the team
// name appended to it
// -----------------------------------------------------------------------
// Reported directly, with a screenshot: after tonight's earlier fix made
// position/unit genuinely optional, a player with no assigned unit who
// had already been credited once (making him "discovered" for that
// role) started showing up as a picker BUTTON on the next play -- and
// his button read "SHERMORION DISMUKE (Test Opp)" while every other
// button on the same list was a bare name.
//
// Root cause: offenseEligible, specialTeamsEligible, and returnerEligible
// each build their button list with `roster[num] || nameIn<Unit>(team,
// num)` -- and nameInOffense/nameInSpecialTeams/nameInDefense
// unconditionally append "(TeamName)". That suffix is correct for
// play-TEXT that names players from two different teams in one
// sentence (a tackler credited on the other team's carry, say), but
// wrong here: every button in one of these lists is already this one
// team's own player, so the team name is pure noise. It only ever
// fired for someone with no assigned unit -- rosterOffense[num] (etc.)
// is blank for him, same as it always was -- which the unassigned-
// roster fix made newly reachable, since such a player can now be
// legitimately "discovered" instead of always erroring out.
//
// defenseEligible had a related but different symptom: it had no
// fallback to any nameIn*() helper at all, so an unassigned defender
// discovered this same way showed a completely BLANK button, not a
// wrong name.
//
// Fixed by switching all four to call rosterName() directly -- the
// same shared engine.js function already used for the manual-entry
// resolution -- rather than the team-name-appending wrappers.

const { bootGamePage, defaultRoster } = require('./harness');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  function pushPlay(h, roleKey, num, playType, side) {
    h.evalIn(
      "plays.push({ id: 'p1', text: 'test', effect: {}, roles: { " + roleKey +
      ": { team: '" + side + "', num: '" + num + "'" + (roleKey === 'carrier' ? ', yards: 5' : '') +
      " }, playType: '" + playType + "' }, quarter: 1, sequence_number: 1, team_side: '" + side + "' })"
    );
  }

  // --- 1. offenseEligible: an unassigned, discovered carrier.
  {
    const roster = defaultRoster().concat([
      { team_side: 'teamA', unit: null, jersey_number: '50', player_name: 'Alpha Unassigned', position: null }
    ]);
    const h = await bootGamePage({ roster });
    pushPlay(h, 'carrier', '50', 'rush', 'teamA');
    const list = JSON.parse(h.evalIn('JSON.stringify(offenseEligible("teamA", "carrier"))'));
    const entry = list.find(e => e.num === '50');
    if (!entry || entry.name !== 'Alpha Unassigned') {
      fail('offenseEligible', 'expected a bare "Alpha Unassigned", got: ' + JSON.stringify(entry));
    }
    h.close();
  }

  // --- 2. specialTeamsEligible: an unassigned, discovered kicker.
  {
    const roster = defaultRoster().concat([
      { team_side: 'teamA', unit: null, jersey_number: '90', player_name: 'Unassigned Kicker', position: null }
    ]);
    const h = await bootGamePage({ roster });
    pushPlay(h, 'kicker', '90', 'kickoff', 'teamA');
    const list = JSON.parse(h.evalIn('JSON.stringify(specialTeamsEligible("teamA"))'));
    const entry = list.find(e => e.num === '90');
    if (!entry || entry.name !== 'Unassigned Kicker') {
      fail('specialTeamsEligible', 'expected a bare "Unassigned Kicker", got: ' + JSON.stringify(entry));
    }
    h.close();
  }

  // --- 3. returnerEligible: an unassigned, discovered returner.
  {
    const roster = defaultRoster().concat([
      { team_side: 'teamA', unit: null, jersey_number: '92', player_name: 'Unassigned Returner', position: null }
    ]);
    const h = await bootGamePage({ roster });
    pushPlay(h, 'defense', '92', 'kickoff_return', 'teamA');
    const list = JSON.parse(h.evalIn('JSON.stringify(returnerEligible("teamA"))'));
    const entry = list.find(e => e.num === '92');
    if (!entry || entry.name !== 'Unassigned Returner') {
      fail('returnerEligible', 'expected a bare "Unassigned Returner", got: ' + JSON.stringify(entry));
    }
    h.close();
  }

  // --- 4. defenseEligible: an unassigned, discovered tackler -- the
  // blank-name symptom, not the team-name-suffix one.
  {
    const roster = defaultRoster().concat([
      { team_side: 'teamA', unit: null, jersey_number: '91', player_name: 'Unassigned Tackler', position: null }
    ]);
    const h = await bootGamePage({ roster });
    pushPlay(h, 'defense', '91', 'rush', 'teamA');
    const list = JSON.parse(h.evalIn('JSON.stringify(defenseEligible("teamA"))'));
    const entry = list.find(e => e.num === '91');
    if (!entry || entry.name !== 'Unassigned Tackler') {
      fail('defenseEligible', 'expected a bare "Unassigned Tackler", not blank or suffixed, got: ' + JSON.stringify(entry));
    }
    h.close();
  }

  // --- 5. Regression guard: an ordinary, unit-assigned player must
  // still show with no suffix at all -- this was never broken, but a
  // fix that touched all four functions deserves a check that normal
  // players are untouched.
  {
    const h = await bootGamePage({ roster: defaultRoster() });
    const list = JSON.parse(h.evalIn('JSON.stringify(offenseEligible("teamA", "carrier"))'));
    const entry = list.find(e => e.num === '22');
    if (!entry || entry.name !== 'N Runningback') {
      fail('ordinary-player-unaffected', 'expected an ordinary, assigned player to show his bare name unchanged, got: ' + JSON.stringify(entry));
    }
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Picker buttons: unassigned player shows a clean name ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  a discovered, unassigned player shows his real name with no team suffix and no blank button, in every picker that can offer him, while an ordinary assigned player is unaffected.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
