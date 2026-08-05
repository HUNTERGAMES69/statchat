// Drives the scripted game through game.html's real UI and compares the
// resulting state, play-by-play, against hand-written expectations.

const { bootGamePage } = require('./harness');
const { enterPlay, setDrive } = require('./ui_driver');
const script = require('./scripted_game');

function stateOf(h) {
  return JSON.parse(h.evalIn('JSON.stringify(computeState())'));
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
  runScript().then(({ h, trace, failures }) => {
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
    console.log('\n=== Failures: ' + failures.length + ' ===');
    failures.forEach(f => console.log('  [' + f.kind + '] ' + f.step + '\n      ' + f.detail));
    h.close();
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { runScript, stateOf };
