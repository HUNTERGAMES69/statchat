// Loss of down survives being written down
// ========================================
// The 'ld' toggle was added on 18 August 2026 alongside 'nd' and 'fd'. The
// parser read the token, advanced the down, and put the answer in the play's
// SENTENCE -- and then the Object.assign that builds the effect wrote
// noDownChange and autoFirstDown and not this one.
//
// So the down a loss-of-down penalty consumed existed only in the stored
// prose. Neither engine had anything to read; both left the down where it
// was. The log said "2nd & 15" and the header said "1st & 15" about the same
// play, and validateGame reported the mismatch afterwards as though the
// scorer had done something wrong.
//
// WHAT THIS FILE CHECKS, and why each part is separate:
//
//   1. THE MUTATION APPLIED. The saved effect carries lossOfDown. Without
//      this, everything below could pass against a fixture that was hand-fed
//      the flag the app never writes.
//   2. THE THING REPORTED. Not "the flag is written" but "the sentence and
//      the recomputed state agree about the down" -- which is the symptom,
//      and which stayed broken through the whole time the flag existed.
//   3. BOTH ENGINES. engine.js serves all seventeen pages; api/engine.js
//      serves the feed and the season endpoints. They are separate
//      implementations of computeState, and a fix in one is a divergence,
//      not a fix: the overlays would report a different down from the app.
//   4. IT IS NOT VACUOUS. The same penalty without the toggle must leave the
//      down alone. A check that only ever asserts "the down advanced" passes
//      just as well against an engine that advances it on every penalty.
//
//   node tests/penalty_loss_of_down_check.js

const path = require('path');
const { bootGamePage } = require('./harness');
const { click, typeInto, setDrive } = require('./ui_driver');

const ENGINE     = path.join(__dirname, '..', 'engine.js');
const API_ENGINE = path.join(__dirname, '..', 'api', 'engine.js');

// 1st & 10 on their own 25, then an illegal forward pass: 5 yards back to the
// 20, and the down is consumed. 2nd & 15.
const RESET = { id: 1, sequence_number: 1, text: 'reset', team_side: 'teamA', quarter: 1,
                effect: { isReset: true, down: 1, distance: 10, fieldPos: 25 } };
const PEN = ld => ({ id: 2, sequence_number: 2, text: 'PENALTY', team_side: 'teamA', quarter: 1,
                     effect: Object.assign({ penaltyTeam: 'teamA', penaltyYds: 5, fieldDelta: -5 },
                                           ld ? { lossOfDown: true } : {}) });

function stateFrom(modulePath, plays){
  delete require.cache[require.resolve(modulePath)];
  const engine = require(modulePath);
  globalThis.plays = plays;
  globalThis.startingPossession = 'teamA';
  globalThis.TEAMS = { teamA: { name: 'Neville' }, teamB: { name: 'Ruston' } };
  return engine.computeState(plays);
}

async function run(){
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1. the app writes it -------------------------------------------
  // Driven through the real Penalty panel, not by handing parseInput a
  // string: the flag has to survive the panel, the code line, the parser
  // and the save handler, and it was the last of those four that dropped it.
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    click(win, doc.getElementById('penUtilBtn'));
    const panel = doc.getElementById('playPanel');
    click(win, panel.querySelector('.penTeamBtn[data-team="off"]'));
    typeInto(win, doc.getElementById('pen_yds'), '5');
    click(win, doc.getElementById('pen_lod_toggle'));
    click(win, doc.getElementById('pen_review'));
    click(win, doc.getElementById('saveBtn'));

    const saved = h.evalIn('JSON.stringify(plays[plays.length - 1] || null)');
    const play = saved ? JSON.parse(saved) : null;

    if (!play || !play.effect){
      fail('write', 'no play was saved at all');
    } else {
      if (play.effect.lossOfDown !== true){
        fail('write', 'the saved effect does not carry lossOfDown — this is the ' +
                      'defect: the parser computed it, wrote it into the sentence, ' +
                      'and left it out of the object. Got: ' +
                      JSON.stringify(play.effect));
      }
      // 2. THE THING REPORTED. The sentence states a down; the log,
      //    recomputed, has to reach the same one.
      const stated = /—\s*(\d)(?:st|nd|rd|th)\s*&/.exec(play.text || '');
      const recomputed = h.evalIn('String(computeState().down)');
      if (!stated){
        fail('sentence', 'the play text states no down at all: ' + play.text);
      } else if (stated[1] !== recomputed){
        fail('sentence', 'the log says ' + stated[1] + ' down and the recomputed ' +
                         'state says ' + recomputed + ' — the two disagree about ' +
                         'the same play, which is what validateGame reports');
      }
      if (!/loss of down/i.test(play.text || '')){
        fail('sentence', 'the sentence does not say loss of down, while its two ' +
                         'siblings both announce themselves — a loss-of-down foul ' +
                         'and an ordinary one read identically and resolve to ' +
                         'different downs. Got: ' + play.text);
      }
    }
    h.close();
  }

  // --- 3. and both engines read it ------------------------------------
  {
    const withLd    = [RESET, PEN(true)];
    const withoutLd = [RESET, PEN(false)];

    const a = stateFrom(ENGINE,     withLd);
    const b = stateFrom(API_ENGINE, withLd);

    if (a.down !== 2){
      fail('engine.js', 'expected 2nd down after a loss-of-down penalty, got ' + a.down);
    }
    if (b.down !== 2){
      fail('api/engine.js', 'expected 2nd down after a loss-of-down penalty, got ' + b.down +
                            ' — the feed and the overlays would report a different down ' +
                            'from the app');
    }
    if (a.down !== b.down || a.distance !== b.distance){
      fail('engines', 'the two engines disagree: engine.js says ' + a.down + ' & ' +
                      a.distance + ', api/engine.js says ' + b.down + ' & ' + b.distance);
    }

    // --- 4. NOT VACUOUS -------------------------------------------------
    const c = stateFrom(ENGINE,     withoutLd);
    const d = stateFrom(API_ENGINE, withoutLd);
    if (c.down !== 1){
      fail('engine.js', 'an ordinary penalty must NOT consume the down — the ' +
                        'replay is the default and this branch would be advancing ' +
                        'it for every foul. Got ' + c.down);
    }
    if (d.down !== 1){
      fail('api/engine.js', 'an ordinary penalty must NOT consume the down, got ' + d.down);
    }
    // Distance moves by the yardage either way; only the down number differs.
    if (a.distance !== c.distance){
      fail('engines', 'loss of down changed the DISTANCE as well (' + a.distance +
                      ' vs ' + c.distance + ') — it consumes the down and nothing else');
    }
  }

  console.log('=== Loss of down ===\n');
  if (!failures.length){
    console.log('  the app writes lossOfDown onto the effect, the sentence says so,\n' +
                '  the recomputed state reaches the same down the sentence states,\n' +
                '  both engines consume the down, and neither consumes it on a\n' +
                '  penalty that does not carry the flag.\n');
  } else {
    failures.forEach(f => console.log('  FAIL [' + f.area + '] ' + f.detail));
    console.log('\nFailures: ' + failures.length);
  }
  process.exit(failures.length ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
