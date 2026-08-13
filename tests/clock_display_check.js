// Clock display normalization
// ----------------------------
// Coaches may type a clock without the colon ("1156" for "11:56") --
// that's the whole point of clockToAbsSeconds accepting it. But the
// STORED text used to embed the coach's raw input verbatim, so a
// colon-less entry showed up colon-less forever, on every surface that
// displays that play: the on-screen log, view.html, recap.html, and
// every report. There is no reformatting step downstream -- every page
// just renders the stored string -- so the fix has to happen once, at
// the point the text is assembled in game.html, via normalizeClockStr().
//
// This checks all three reachable call sites that embed a clock value
// into stored text: a possession-changing play with the clock row
// filled in colon-less (covers both the "at change of possession" and
// "start of possession" wording), and a drive-ending score (the "end of
// possession" wording).

const { bootGamePage } = require('./harness');
const { enterPlay, setDrive, click, typeInto } = require('./ui_driver');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- Case 1: change of possession (punt), clock typed without a colon
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 40 });
    click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
    const panel = doc.getElementById('playPanel');
    click(win, panel.querySelector('.pp_punter_pick[data-num="15"]'));
    typeInto(win, doc.getElementById('pp_yards'), '40');
    // The ensuing spot is REQUIRED on a punt as of 13 Aug 2026. This suite
    // is about the CLOCK, so the spot is incidental -- but without it
    // Review is refused, no confirm card appears, and the failure reads as
    // "the confirm card did not ask for a clock", which is the wrong
    // diagnosis.
    click(win, panel.querySelector('.pp_spot_side[data-side="own"]'));
    typeInto(win, doc.getElementById('pp_spot_yardline'), '25');
    click(win, doc.getElementById('pp_review'));

    const clockRow = doc.getElementById('confirmClockRow');
    if (!clockRow || clockRow.style.display === 'none') {
      fail('change-of-possession', 'confirm card did not ask for a clock value on a punt');
    } else {
      typeInto(win, doc.getElementById('confirmClockInput'), '1156');
      click(win, doc.getElementById('saveBtn'));
      const texts = JSON.parse(h.evalIn('JSON.stringify(plays.map(p => p.text))'));
      const clockLine = texts.find(t => t.startsWith('Clock —'));
      if (!clockLine) {
        fail('change-of-possession', 'no Clock line was saved at all');
      } else if (!clockLine.includes('11:56')) {
        fail('change-of-possession', 'colon-less input "1156" was not normalized: ' + clockLine);
      } else if (clockLine.includes('1156')) {
        fail('change-of-possession', 'raw colon-less input leaked into the stored text: ' + clockLine);
      }
    }
    h.close();
  }

  // --- Case 2: drive-ending score (field goal), clock typed without a colon
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 40 });
    enterPlay(h, { type: 'fg', kicker: '3', yards: '38', result: 'g', clock: '749' });
    const texts = JSON.parse(h.evalIn('JSON.stringify(plays.map(p => p.text))'));
    const clockLine = texts.find(t => t.startsWith('Clock —'));
    if (!clockLine) {
      fail('end-of-possession', 'no Clock line was saved after a field goal');
    } else if (!clockLine.includes('7:49')) {
      fail('end-of-possession', 'colon-less input "749" was not normalized: ' + clockLine);
    } else if (clockLine.includes('749 ')) {
      fail('end-of-possession', 'raw colon-less input leaked into the stored text: ' + clockLine);
    }
    h.close();
  }

  // --- Case 3: a clock typed WITH a colon must be preserved exactly,
  //     not mangled by the normalize step.
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 40 });
    click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
    const panel = doc.getElementById('playPanel');
    click(win, panel.querySelector('.pp_punter_pick[data-num="15"]'));
    typeInto(win, doc.getElementById('pp_yards'), '40');
    // The ensuing spot is REQUIRED on a punt as of 13 Aug 2026. This suite
    // is about the CLOCK, so the spot is incidental -- but without it
    // Review is refused, no confirm card appears, and the failure reads as
    // "the confirm card did not ask for a clock", which is the wrong
    // diagnosis.
    click(win, panel.querySelector('.pp_spot_side[data-side="own"]'));
    typeInto(win, doc.getElementById('pp_spot_yardline'), '25');
    click(win, doc.getElementById('pp_review'));
    typeInto(win, doc.getElementById('confirmClockInput'), '3:07');
    click(win, doc.getElementById('saveBtn'));
    const texts = JSON.parse(h.evalIn('JSON.stringify(plays.map(p => p.text))'));
    const clockLine = texts.find(t => t.startsWith('Clock —'));
    if (!clockLine || !clockLine.includes('3:07')) {
      fail('already-colon', 'a clock typed as "3:07" was altered: ' + clockLine);
    }
    h.close();
  }

  // --- Case 4: the separate showClockPrompt flow (a standalone card,
  //     not the play-confirm card) has its own three embed sites and
  //     must be fixed independently.
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    h.evalIn('showClockPrompt({mode:"transition", outgoingTeam:"teamA", incomingTeam:"teamB"}, function(){})');
    if (doc.getElementById('clockPromptCard').style.display === 'none') {
      fail('clockPrompt-flow', 'showClockPrompt did not open its card');
    } else {
      typeInto(win, doc.getElementById('clockPromptInput'), '845');
      h.evalIn('resolveClockPrompt(false)');
      const texts = JSON.parse(h.evalIn('JSON.stringify(plays.map(p => p.text))'));
      const clockLine = texts.find(t => t.startsWith('Clock —'));
      if (!clockLine) {
        fail('clockPrompt-flow', 'no Clock line was saved by resolveClockPrompt');
      } else if (!clockLine.includes('8:45')) {
        fail('clockPrompt-flow', 'colon-less input "845" was not normalized: ' + clockLine);
      } else if (clockLine.includes('845 ')) {
        fail('clockPrompt-flow', 'raw colon-less input leaked into the stored text: ' + clockLine);
      }
    }
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Clock display normalization ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) console.log('  colon-less input is normalized before storage on every reachable path.');
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
