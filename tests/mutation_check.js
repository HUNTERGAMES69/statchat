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
    name: "shorthand-hex: stop expanding #abc, so luminance goes NaN again",
    file: "engine.js",
    from: "  if (/^#[0-9a-fA-F]{3}$/.test(h)) return ('#' + h[1]+h[1] + h[2]+h[2] + h[3]+h[3]).toLowerCase();",
    to: "",
    expectCaughtBy: ["color_check.js"]
  },
  {
    name: "position-lists: drop ATHLETE from game.html only, so five copies drift",
    file: "game.html",
    from: "'OG','G','T','C','ATHLETE'",
    to: "'OG','G','T','C'",
    expectCaughtBy: ["color_check.js"]
  },
  {
    name: "fumble-tackle: count a fumble RECOVERY as a tackle again",
    file: "engine.js",
    from: "    const TACKLE_TYPES = ['rush', 'pass', 'sack'];",
    to: "    const TACKLE_TYPES = ['rush', 'pass', 'sack', 'fumble'];",
    expectCaughtBy: ["tackles_check.js"]
  },
  {
    name: "kickoff-repaint: clear an outcome without repainting its button",
    file: "game.html",
    from: "            btn.textContent = btn.dataset.label || 'Blocked';",
    to: "            void 0;",
    expectCaughtBy: ["whitelist_check.js"]
  },
  {
    name: "sack-sign: stop negating sack yardage (the Aug 3 bug)",
    file: "game.html",
    from: "      netYards = -sackLossYards;",
    to: "      netYards = sackLossYards;",
    expectCaughtBy: ["run_scripted.js"]
  },
  {
    name: "penalty-distance: stop adjusting distance-to-go on a penalty",
    file: "engine.js",
    from: "        state.distance -= e.fieldDelta;",
    to: "        state.distance -= 0;",
    expectCaughtBy: ["run_scripted.js"]
  },
  {
    name: "returner-overload: credit any roles.defense as a defensive stat",
    file: "engine.js",
    from: "    if (r.defense && (type === 'int' || type === 'sack' || type === 'fumble')){",
    to: "    if (r.defense){",
    expectCaughtBy: ["cross_surface.js"]
  },
  {
    name: "shared-number: stop recording which player, keep only the number",
    file: "game.html",
    from: "        (num, name) => { if (sel[role] === num) sel[role + 'Name'] = name; });",
    to: "        undefined);",
    expectCaughtBy: ["shared_number_check.js"]
  },
  {
    name: "returner-name: drop the cross-roster fallback (the Aug 5 bug)",
    file: "engine.js",
    from: "  const n = rosterName(teamKey, num, ['defense','special','offense']);",
    to: "  const n = TEAMS[teamKey].rosterDefense[num];",
    expectCaughtBy: ["run_scripted.js"]
  },
  {
    name: "returner-picker: fall back to the defence-only eligible list",
    file: "game.html",
    from: "      const list = returnerEligible(def);",
    to: "      const list = defenseEligible(def);",
    expectCaughtBy: ["picker_check.js"]
  },
  {
    name: "returner-rank: stop demoting kickers below real returners",
    file: "game.html",
    from: "  ['K','PK','P','LS','H','KO'].forEach(p => rank[p] = 3);",
    to: "  ['K','PK','P','LS','H','KO'].forEach(p => rank[p] = 0);",
    expectCaughtBy: ["picker_check.js"]
  },
  {
    name: "clock-display: store the raw colon-less clock text again",
    file: "game.html",
    from: "text: 'Clock — ' + normalizeClockStr(q, clockVal) + ' at change of possession",
    to: "text: 'Clock — ' + clockVal + ' at change of possession",
    expectCaughtBy: ["clock_display_check.js"]
  },
  {
    name: "drive-boundary: let a drive start on an administrative marker (the Aug 6 bug)",
    file: "engine.js",
    from: "    if (possAfter !== priorPoss) pushStart(firstRealPlayFrom(i + 1));",
    to: "    if (possAfter !== priorPoss) pushStart(i + 1);",
    expectCaughtBy: ["drive_boundary_check.js"]
  },
  {
    name: "drive-summary: let a trailing clock marker be the drive summary line",
    file: "view.html",
    from: "        if (segment[i].text && !isAdminMarker(segment[i])){ lastPlayText = segment[i].text; break; }",
    to: "        if (segment[i].text && !segment[i].isDivider){ lastPlayText = segment[i].text; break; }",
    expectCaughtBy: ["drive_boundary_check.js"]
  },
  {
    name: "admin-marker: stop treating clock events as administrative",
    file: "view.html",
    from: "  return !!(e.clockEvent || e.setQuarter || e.forcePossession || p.isDivider);",
    to: "  return !!(e.setQuarter || e.forcePossession || p.isDivider);",
    expectCaughtBy: ["drive_boundary_check.js"]
  },
  {
    name: "possession-count: reimplement drive boundaries instead of deriving them",
    file: "engine.js",
    from: "  findDriveStarts(playsList).forEach(idx => {",
    to: "  [].forEach(idx => {",
    expectCaughtBy: ["possession_and_drive_check.js"]
  },
  {
    name: "adjust-button: let a reset marker always open a new drive",
    file: "engine.js",
    from: "      if (!starts.length || playsList[i].effect.newPossession) pushStart(i);",
    to: "      pushStart(i);",
    expectCaughtBy: ["drive_boundary_check.js"]
  },
  {
    name: "down-conversions: drop incomplete passes from the play-type list again",
    file: "engine.js",
    from: "      if (!['rush','pass','incomplete','sack','int','fumble'].includes(type)) continue;",
    to: "      if (!['rush','pass','sack','int','fumble'].includes(type)) continue;",
    expectCaughtBy: ["possession_and_drive_check.js"]
  },
  {
    name: "unnamed fumble: stop honouring roles.lost as a turnover",
    file: "engine.js",
    from: "    if (r.playType === 'fumble' && r.carrier && (r.lost || r.defense)) counts[r.carrier.team] = (counts[r.carrier.team] || 0) + 1;",
    to: "    if (r.playType === 'fumble' && r.carrier && r.defense) counts[r.carrier.team] = (counts[r.carrier.team] || 0) + 1;",
    expectCaughtBy: ["possession_and_drive_check.js"]
  },
  {
    name: "stale text: stop re-parsing the play at save time (the Aug 6 bug)",
    file: "game.html",
    from: "      if (fresh) pending = Object.assign(fresh, {",
    to: "      if (false) pending = Object.assign(fresh, {",
    expectCaughtBy: ["entry_integrity_check.js"]
  },
  {
    name: "safety clock: credit the end-of-possession clock to the scorer again",
    file: "game.html",
    from: "        const endingTeam = preState.possession;",
    to: "        const endingTeam = effect.score ? effect.score.team : preState.possession;",
    expectCaughtBy: ["entry_integrity_check.js"]
  },
  {
    name: "penalty no-down-change: adjust distance anyway",
    file: "engine.js",
    from: "            state.distance = Math.max(1, Math.min(state.distance, 100 - state.fieldPos));",
    to: "            state.distance = Math.max(1, state.distance);",
    expectCaughtBy: ["run_scripted.js"]
  },
  {
    name: "stat-drop: stop counting rushing attempts",
    file: "engine.js",
    from: "        s.att = (s.att||0) + 1;\n        s.yds = (s.yds||0) + (r.carrier.yards||0);",
    to: "        s.yds = (s.yds||0) + (r.carrier.yards||0);",
    expectCaughtBy: ["cross_surface.js"]
  }
];

// Behavioural suites first, on purpose. engine_parity fires on ANY
// single-file edit to a duplicated function, so if it ran first it would
// short-circuit almost every mutant and hide whether the behavioural
// tests can actually detect the broken behaviour. It stays last as a
// backstop.
// Tried in order, stopping at the first suite that catches the mutant.
// The cheap broad ones come first so most mutants are settled in one run;
// the three at the end were added 14 Aug 2026 because the mutants aimed
// at them would otherwise have been reported as SURVIVORS -- a mutant is
// only a blind spot if a suite that could see it was actually run.
const SUITES = ['run_scripted.js', 'picker_check.js', 'clock_display_check.js',
                'drive_boundary_check.js', 'possession_and_drive_check.js',
                'optional_players_check.js', 'entry_integrity_check.js',
                'cross_surface.js', 'color_check.js', 'tackles_check.js',
                'whitelist_check.js', 'shared_number_check.js'];

const FLIGHT = path.join(__dirname, '.mutation-in-flight.json');
const BACKUP = path.join(__dirname, '.mutation-in-flight.bak');

// Put a previous run's mutation back before doing anything else. Running
// the suite against a file that still carries someone else's deliberate
// bug produces results that look real and are not.
function recoverInterrupted(){
  if (!fs.existsSync(FLIGHT) || !fs.existsSync(BACKUP)) return;
  let info;
  try { info = JSON.parse(fs.readFileSync(FLIGHT, 'utf8')); }
  catch (e) { return; }
  const target = path.join(REPO, info.file);
  fs.writeFileSync(target, fs.readFileSync(BACKUP, 'utf8'));
  fs.unlinkSync(FLIGHT);
  fs.unlinkSync(BACKUP);
  console.log('RECOVERED: a previous run was interrupted while ' + info.file +
              ' carried the mutant "' + info.name + '". The file has been restored.\n');
}

// Ctrl-C and kill. These are BEST EFFORT ONLY and usually will not fire:
// runSuite uses execFileSync, which blocks the event loop, so a signal
// arriving mid-suite is queued until the sync call returns -- which for a
// hung suite means the timeout, and for SIGKILL means never. Verified on
// 14 Aug 2026: a SIGINT during a run left the mutation on disk and the
// BREADCRUMB is what recovered it. The handler is kept for the case where
// the signal lands between suites; the file on disk is the real mechanism.
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => process.on(sig, () => {
  try {
    if (fs.existsSync(FLIGHT) && fs.existsSync(BACKUP)) {
      const info = JSON.parse(fs.readFileSync(FLIGHT, 'utf8'));
      fs.writeFileSync(path.join(REPO, info.file), fs.readFileSync(BACKUP, 'utf8'));
      fs.unlinkSync(FLIGHT); fs.unlinkSync(BACKUP);
      console.log('\nInterrupted — ' + info.file + ' restored.');
    }
  } catch (e) {}
  process.exit(130);
}));

// A mutant can make a suite HANG rather than fail -- an infinite loop in
// drive detection will do it -- and execFileSync with no timeout waits
// for ever, taking the whole run with it and leaving the mutation on
// disk. 45s is about three times the slowest honest suite; two minutes
// was tried first and made a single surviving mutant cost 24 minutes.
//
// A timeout counts as CAUGHT, deliberately: a suite that never returns
// has certainly noticed something, and the alternative is reporting a
// hang as a clean pass.
const SUITE_TIMEOUT_MS = 45000;

function runSuite(file) {
  try {
    execFileSync('node', [path.join(__dirname, file)], {
      cwd: REPO, stdio: 'pipe', timeout: SUITE_TIMEOUT_MS, killSignal: 'SIGKILL'
    });
    return true; // passed
  } catch (e) {
    if (e && (e.code === 'ETIMEDOUT' || e.signal === 'SIGKILL')) {
      console.log('        (' + file + ' hit the ' + (SUITE_TIMEOUT_MS / 1000) +
                  's timeout under this mutant -- counted as caught)');
    }
    return false; // failed, or hung
  }
}

function main() {
  console.log('=== Mutation check: can the suite detect broken behaviour? ===\n');
  recoverInterrupted();

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
    // A KILLED PROCESS DOES NOT RUN `finally`.
    // ------------------------------------------------------------------
    // This script edits real source files and restores them afterwards.
    // The try/finally below covers an exception; it does NOT cover the
    // process being killed, running out of memory, or the machine going
    // away -- and when that happens the repo is left with a deliberate
    // bug written into it. That happened twice on 14 Aug 2026, and the
    // second time the corrupted file was mistaken for the real one and
    // reasoned from, which produced a page of wrong conclusions.
    //
    // The breadcrumb is written BEFORE the mutation, so a later run (or a
    // human) can always tell what was in flight and put it back. Signal
    // handlers cover Ctrl-C and kill; nothing covers SIGKILL, which is
    // why the file on disk is the real safety net.
    fs.writeFileSync(FLIGHT, JSON.stringify({ file: m.file, name: m.name }, null, 2));
    fs.writeFileSync(BACKUP, original);
    fs.writeFileSync(target, original.replace(m.from, m.to));
    let caughtBy = [];
    try {
      // Stop at the first suite that catches it. Running all nine
      // against all nineteen mutants takes long enough to hit tool
      // timeouts, and one catch is all that's needed to prove the
      // mutant is not a blind spot.
      // Try the suites this mutant is EXPECTED to be caught by first,
      // then the rest. Without this the runner walks the whole list in a
      // fixed order for every mutant, and a genuine survivor costs
      // twelve full suite runs -- with the per-suite timeout that is
      // twenty-four minutes for ONE mutant, which is how a 23-mutant run
      // stopped being something anyone would sit through.
      //
      // The expectation is a hint about where to look, not a
      // restriction: every other suite is still tried before declaring a
      // survivor, so a mutant caught somewhere unexpected is still
      // caught, and still reported by the suite that actually caught it.
      const expected = (m.expectCaughtBy || []).filter(x => SUITES.includes(x));
      const order = expected.concat(SUITES.filter(x => !expected.includes(x)));
      for (const s of order){
        if (!runSuite(s)){ caughtBy.push(s); break; }
      }
    } finally {
      fs.writeFileSync(target, original); // always restore
      try { fs.unlinkSync(FLIGHT); } catch (e) {}
      try { fs.unlinkSync(BACKUP); } catch (e) {}
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
