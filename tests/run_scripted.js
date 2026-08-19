// Drives the scripted game through game.html's real UI and compares the
// resulting state, play-by-play, against hand-written expectations.

const { bootGamePage } = require('./harness');
const { enterPlay, setDrive } = require('./ui_driver');
const script = require('./scripted_game');

function stateOf(h) {
  return JSON.parse(h.evalIn('JSON.stringify(computeState())'));
}

// A SEPARATE, INDEPENDENT CHECK, not a step in the scripted narrative
// above -- added 19 Aug 2026, found by mutation testing rather than a
// live-game report. A dead-ball penalty (or one assessed after a kick
// or change of possession) moves the ball but keeps the down and
// distance-to-go as they were, EXCEPT when the new spot is close
// enough to the goal line that the original distance would overshoot
// it -- "1st & 10" at the opponent's 5 makes no sense; it has to read
// "1st & Goal" (5 to go). The clamp that makes this true had no test
// of its own: removing it (Math.max(1, state.distance) instead of
// Math.max(1, Math.min(state.distance, 100 - state.fieldPos))) passed
// every existing suite silently. This is a real, reachable situation
// -- unlike offsetting penalties, which will not be entered -- so it
// gets its own fresh game instance rather than being folded into the
// narrative script above, to avoid disturbing that script's own
// carefully-built sequence.
async function checkPenaltyDistanceClamp() {
  const failures = [];
  const h = await bootGamePage();
  setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 15 });
  enterPlay(h, { type: 'penalty', on: 'defense', yards: '10', deadBall: true });
  const st = stateOf(h);
  if (st.distance !== 5) {
    failures.push({ step: 'penalty-distance-clamp', kind: 'distance',
      detail: 'expected 5 (1st & Goal from the 5), got ' + st.distance });
  }
  if (st.fieldPos !== 95) {
    failures.push({ step: 'penalty-distance-clamp', kind: 'fieldPos',
      detail: 'expected 95, got ' + st.fieldPos });
  }
  h.close();
  return failures;
}

async function runScript(opts = {}) {
  const h = await bootGamePage(opts.boot || {});
  const trace = [];
  const failures = [];

  for (let i = 0; i < script.length; i++) {
    const step = script[i];
    const label = '#' + i + ' ' + (step.note || (step.setDrive ? 'setDrive' : 'step'));
    let result;
    try {
      result = step.setDrive ? setDrive(h, step.setDrive) : enterPlay(h, step.spec);
    } catch (e) {
      failures.push({ step: label, kind: 'threw', detail: e.message });
      trace.push({ label, error: e.message });
      continue;
    }

    const st = stateOf(h);
    const lastText = h.evalIn('plays.length ? plays[plays.length-1].text : ""');
    trace.push({ label, saved: result.saved, parsedText: result.parsedText,
                 lastText, warning: result.warning, state: st });

    if (!step.setDrive && !result.saved) {
      failures.push({ step: label, kind: 'not-saved', detail: result.reason || 'save produced no play' });
      continue;
    }

    const e = step.expect || {};
    const check = (name, actual, expected) => {
      if (expected === undefined) return;
      if (actual !== expected) {
        failures.push({ step: label, kind: name, detail: 'expected ' + expected + ', got ' + actual });
      }
    };
    check('down', st.down, e.down);
    check('distance', st.distance, e.distance);
    check('fieldPos', st.fieldPos, e.fieldPos);
    check('possession', st.possession, e.possession);
    if (e.scores) {
      check('score.teamA', st.scores.teamA, e.scores.teamA);
      check('score.teamB', st.scores.teamB, e.scores.teamB);
    }
    (e.textHas || []).forEach(sub => {
      const hay = (result.parsedText || '') + ' | ' + lastText;
      if (!hay.toLowerCase().includes(sub.toLowerCase())) {
        failures.push({ step: label, kind: 'text', detail: 'log line missing "' + sub + '" -- got: ' + lastText });
      }
    });
  }

  return { h, trace, failures };
}

if (require.main === module) {
  Promise.all([runScript(), checkPenaltyDistanceClamp()]).then(([{ h, trace, failures }, extraFailures]) => {
    console.log('=== Scripted game trace (driven through the real UI) ===\n');
    trace.forEach(t => {
      if (t.error) { console.log(t.label + '\n    THREW: ' + t.error); return; }
      const s = t.state;
      const dd = s.down ? s.down + '&' + s.distance : 'no drive';
      console.log(t.label);
      console.log('    log  : ' + t.lastText);
      console.log('    state: ' + dd + ' fp=' + s.fieldPos + ' poss=' + s.possession +
                  ' score=' + s.scores.teamA + '-' + s.scores.teamB + (t.warning ? '  WARN: ' + t.warning : ''));
    });
    failures.push(...extraFailures);
    console.log('\n=== Failures: ' + failures.length + ' ===');
    failures.forEach(f => console.log('  [' + f.kind + '] ' + f.step + '\n      ' + f.detail));
    h.close();
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { runScript, stateOf };
