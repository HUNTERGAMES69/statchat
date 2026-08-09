// Mutation check -- does this test suite actually BITE?
//
// A green suite means nothing if it would stay green while the app is
// broken. That is not hypothetical here: the previous audit's
// combined-score check passed on a game whose per-team scores were both
// wrong, and the sack bug survived extensive fuzzing because the one
// signal being checked was blind to it.
//
// So: deliberately re-introduce known bugs, one at a time, and confirm
// the suite goes red. Any mutant that survives marks a real blind spot.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');

const MUTANTS = [
  {
    name: 'sack-sign: stop negating sack yardage (the Aug 3 bug)',
    file: 'game.html',
    from: '      netYards = -sackLossYards;',
    to: '      netYards = sackLossYards;',
    expectCaughtBy: ['run_scripted.js']
  },
  {
    name: 'penalty-distance: stop adjusting distance-to-go on a penalty',
    file: 'game.html',
    from: '        state.distance -= e.fieldDelta;',
    to: '        state.distance -= 0;',
    expectCaughtBy: ['run_scripted.js']
  },
  {
    name: 'returner-overload: credit any roles.defense as a defensive stat',
    file: 'view.html',
    from: "      if (r.defense && (type === 'int' || type === 'sack' || type === 'fumble')){",
    to: '      if (r.defense){',
    expectCaughtBy: ['cross_surface.js']
  },
  {
    name: 'engine-drift: change one copy of computeBoxScore only',
    file: 'recap.html',
    from: '          s.yds = (s.yds||0) + (r.carrier.yards||0);',
    to: '          s.yds = (s.yds||0) + (r.carrier.yards||0) + 1;',
    expectCaughtBy: ['cross_surface.js', 'engine_parity.js']
  },
  {
    name: 'returner-name: drop the cross-roster fallback (the Aug 5 bug)',
    file: 'game.html',
    from: "  const n = rosterName(teamKey, num, ['defense','special','offense']);",
    to: '  const n = TEAMS[teamKey].rosterDefense[num];',
    expectCaughtBy: ['run_scripted.js', 'engine_parity.js']
  },
  {
    name: 'returner-picker: fall back to the defence-only eligible list',
    file: 'game.html',
    from: '      const list = returnerEligible(def);',
    to: '      const list = defenseEligible(def);',
    expectCaughtBy: ['picker_check.js']
  },
  {
    name: 'returner-rank: stop demoting kickers below real returners',
    file: 'game.html',
    from: "  ['K','PK','P','LS','H','KO'].forEach(p => rank[p] = 3);",
    to: "  ['K','PK','P','LS','H','KO'].forEach(p => rank[p] = 0);",
    expectCaughtBy: ['picker_check.js']
  },
  {
    name: 'clock-display: store the raw colon-less clock text again',
    file: 'game.html',
    from: "text: 'Clock \u2014 ' + normalizeClockStr(q, clockVal) + ' at change of possession",
    to: "text: 'Clock \u2014 ' + clockVal + ' at change of possession",
    expectCaughtBy: ['clock_display_check.js']
  },
  {
    name: 'drive-boundary: let a drive start on an administrative marker (the Aug 6 bug)',
    file: 'view.html',
    from: '    if (possAfter !== priorPoss) pushStart(firstRealPlayFrom(i + 1));',
    to: '    if (possAfter !== priorPoss && i + 1 < playsList.length) pushStart(i + 1);',
    expectCaughtBy: ['drive_boundary_check.js']
  },
  {
    name: 'drive-summary: let a trailing clock marker be the drive summary line',
    file: 'view.html',
    from: '        if (segment[i].text && !isAdminMarker(segment[i])){ lastPlayText = segment[i].text; break; }',
    to: '        if (segment[i].text && !segment[i].isDivider){ lastPlayText = segment[i].text; break; }',
    expectCaughtBy: ['drive_boundary_check.js']
  },
  {
    name: 'admin-marker: stop treating clock events as administrative',
    file: 'view.html',
    from: "  return !!(e.clockEvent || e.setQuarter || e.forcePossession || p.isDivider);",
    to: "  return !!(e.setQuarter || e.forcePossession || p.isDivider);",
    expectCaughtBy: ['drive_boundary_check.js']
  },
  {
    name: 'possession-count: reimplement drive boundaries instead of deriving them',
    file: 'view.html',
    from: '    findDriveStarts(playsList).forEach(idx => {',
    to: '    [].concat(findDriveStarts(playsList), findDriveStarts(playsList)).forEach(idx => {',
    expectCaughtBy: ['possession_and_drive_check.js']
  },
  {
    name: 'adjust-button: let a reset marker always open a new drive',
    file: 'view.html',
    from: '      if (!starts.length) pushStart(i);',
    to: '      pushStart(i);',
    expectCaughtBy: ['possession_and_drive_check.js']
  },
  {
    name: 'down-conversions: drop incomplete passes from the play-type list again',
    file: 'view.html',
    from: "        if (!['rush','pass','incomplete','sack','int','fumble'].includes(type)) continue;",
    to: "        if (!['rush','pass','sack','int','fumble'].includes(type)) continue;",
    expectCaughtBy: ['possession_and_drive_check.js']
  },
  {
    name: 'unnamed fumble: stop honouring roles.lost as a turnover',
    file: 'view.html',
    from: "      if (r.playType === 'fumble' && r.carrier && (r.lost || r.defense)) counts[r.carrier.team] = (counts[r.carrier.team] || 0) + 1;",
    to: "      if (r.playType === 'fumble' && r.carrier && r.defense) counts[r.carrier.team] = (counts[r.carrier.team] || 0) + 1;",
    expectCaughtBy: ['optional_players_check.js']
  },
  {
    name: 'stale text: stop re-parsing the play at save time (the Aug 6 bug)',
    file: 'game.html',
    from: '      if (fresh) pending = Object.assign(fresh, { roles: pending.roles, reset: pending.reset });',
    to: '      if (fresh) { /* deliberately not applied */ }',
    expectCaughtBy: ['entry_integrity_check.js']
  },
  {
    name: 'safety clock: credit the end-of-possession clock to the scorer again',
    file: 'game.html',
    from: '        const endingTeam = preState.possession;',
    to: '        const endingTeam = effect.score ? effect.score.team : preState.possession;',
    expectCaughtBy: ['entry_integrity_check.js']
  },
  {
    name: 'penalty no-down-change: adjust distance anyway',
    file: 'game.html',
    from: '            state.distance = Math.max(1, Math.min(state.distance, 100 - state.fieldPos));',
    to: '            state.distance = Math.max(1, Math.min(state.distance - e.fieldDelta, 100 - state.fieldPos));',
    expectCaughtBy: ['entry_integrity_check.js']
  },
  {
    name: 'stat-drop: stop counting rushing attempts',
    file: 'view.html',
    from: '          s.att = (s.att||0) + 1;\n          s.yds = (s.yds||0) + (r.carrier.yards||0);',
    to: '          s.yds = (s.yds||0) + (r.carrier.yards||0);',
    expectCaughtBy: ['cross_surface.js']
  }
];

// Behavioural suites first, on purpose. engine_parity fires on ANY
// single-file edit to a duplicated function, so if it ran first it would
// short-circuit almost every mutant and hide whether the behavioural
// tests can actually detect the broken behaviour. It stays last as a
// backstop.
const SUITES = ['run_scripted.js', 'picker_check.js', 'clock_display_check.js',
                'drive_boundary_check.js', 'possession_and_drive_check.js',
                'optional_players_check.js', 'entry_integrity_check.js',
                'cross_surface.js', 'engine_parity.js'];

function runSuite(file) {
  try {
    execFileSync('node', [path.join(__dirname, file)], { cwd: REPO, stdio: 'pipe' });
    return true; // passed
  } catch (e) {
    return false; // failed (non-zero exit)
  }
}

function main() {
  console.log('=== Mutation check: can the suite detect broken behaviour? ===\n');

  // Baseline: everything must be green before mutating anything.
  const baseline = {};
  for (const s of SUITES) baseline[s] = runSuite(s);
  const baseGreen = SUITES.every(s => baseline[s]);
  console.log('Baseline (unmodified repo): ' +
    SUITES.map(s => s + '=' + (baseline[s] ? 'pass' : 'FAIL')).join('  '));
  if (!baseGreen) {
    console.log('\nBaseline is not green -- fix that before trusting mutation results.');
    process.exitCode = 1;
    return;
  }
  console.log('');

  let survivors = 0;
  for (const m of MUTANTS) {
    const target = path.join(REPO, m.file);
    const original = fs.readFileSync(target, 'utf8');
    if (!original.includes(m.from)) {
      console.log('  SKIP  ' + m.name + '\n        (anchor text not found in ' + m.file + ' -- mutant needs updating)');
      survivors++;
      continue;
    }
    fs.writeFileSync(target, original.replace(m.from, m.to));
    let caughtBy = [];
    try {
      // Stop at the first suite that catches it. Running all nine
      // against all nineteen mutants takes long enough to hit tool
      // timeouts, and one catch is all that's needed to prove the
      // mutant is not a blind spot.
      for (const s of SUITES){
        if (!runSuite(s)){ caughtBy.push(s); break; }
      }
    } finally {
      fs.writeFileSync(target, original); // always restore
    }

    if (caughtBy.length === 0) {
      survivors++;
      console.log('  !!    ' + m.name + '\n        SURVIVED -- no suite noticed. This is a blind spot.');
    } else {
      console.log('  OK    ' + m.name + '\n        caught by: ' + caughtBy.join(', '));
    }
  }

  console.log('\n' + (survivors === 0
    ? 'Every mutant was caught. The suite has teeth.'
    : survivors + ' mutant(s) survived -- see above.'));
  process.exitCode = survivors === 0 ? 0 : 1;
}

if (require.main === module) main();
module.exports = { MUTANTS };
