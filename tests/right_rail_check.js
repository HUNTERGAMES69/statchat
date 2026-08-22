// The right-margin rail: live totals and live validation
// -----------------------------------------------------------------------
// Two things a scorer would otherwise leave the entry screen to see, put
// in the viewport space outside the 760px card that .floating-actions has
// always used -- the mirror of the drive dock on the left.
//
// The validation half is the one that earns its place: validateGame() has
// only ever run at finalize time, and an error found in the second
// quarter is a ten-second fix where the same error found after the
// whistle is an unlock and a re-entry.

const { bootGamePage } = require('./harness');
const { enterPlay, setDrive } = require('./ui_driver');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1. Live totals carry both teams and reconcile with the engine.
  {
    const h = await bootGamePage();
    const doc = h.window.document;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '12' });
    await new Promise(r => setTimeout(r, 700));
    const t = doc.getElementById('liveBoxBody').textContent.replace(/\s+/g, '');
    if (!/8rushyds/.test(t)) fail('totals:rush', 'expected 8 rushing yards, got: ' + t);
    if (!/12passyds/.test(t)) fail('totals:pass', 'expected 12 passing yards, got: ' + t);
    if (!/20totalyds/.test(t)) fail('totals:total', 'expected 20 total yards, got: ' + t);
    if (!/timeouts/.test(t)) fail('totals:timeouts', 'expected timeouts, got: ' + t);
    h.close();
  }

  // --- 2. A clean game reads clear, and says so rather than sitting empty.
  {
    const h = await bootGamePage();
    const doc = h.window.document;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    await new Promise(r => setTimeout(r, 700));
    if (doc.getElementById('validationCount').textContent !== 'clear') {
      fail('checks:clean', 'a clean game should read clear, got: ' + doc.getElementById('validationCount').textContent);
    }
    if (!doc.getElementById('validationBody').textContent.trim()) {
      fail('checks:clean-body', 'the panel should say nothing is wrong rather than render empty');
    }
    h.close();
  }

  // --- 3. A real fault is surfaced, counted, and flagged red.
  {
    const h = await bootGamePage();
    const doc = h.window.document;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    // A gain past the goal line -- one of the checks validateGame makes.
    h.evalIn("pushAndPersist({ id: nextId++, text: 'N Runningback (Neville) rush for 90 — 2nd & 2', effect: { isStat:true, statYds:90, fieldDelta:90 }, roles:{ carrier:{team:'teamA',num:'22',yards:90}, playType:'rush' }, quarter:1 }); renderAll();");
    await new Promise(r => setTimeout(r, 700));
    const count = doc.getElementById('validationCount');
    if (count.className !== 'vc-bad') fail('checks:flag', 'a game with faults should flag red, got class: ' + count.className);
    const issues = doc.querySelectorAll('#validationBody .v-issue');
    if (!issues.length) fail('checks:issues', 'the impossible gain was not surfaced');
    const txt = doc.getElementById('validationBody').textContent;
    if (!/goal line/.test(txt)) fail('checks:text', 'expected the goal-line check, got: ' + txt.slice(0, 120));
    h.close();
  }

  // --- 4. THROTTLED. validateGame() calls computeState() once per play
  //     over a slice of the log, so it is quadratic; running it inside
  //     renderAll would put a growing pause into play entry, which is the
  //     one thing this page cannot afford.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    h.evalIn('window.__vg = 0; const _v = validateGame; validateGame = function(){ window.__vg++; return _v.apply(this, arguments); };');
    for (let i = 0; i < 3; i++) enterPlay(h, { type: 'rush', carrier: '22', yards: '3' });
    if (h.evalIn('window.__vg') !== 0) {
      fail('checks:throttle', 'validation ran during entry -- it must wait until the page is quiet, calls: ' + h.evalIn('window.__vg'));
    }
    await new Promise(r => setTimeout(r, 700));
    if (h.evalIn('window.__vg') !== 1) {
      fail('checks:throttle-once', 'three plays should collapse into one validation run, got: ' + h.evalIn('window.__vg'));
    }
    h.close();
  }

  // --- 5. Broadcast health inside the ON AIR tile. What matters for a
  //     feed is not that the game is flagged for broadcast -- the red
  //     block says that -- but whether what the overlay reads is CURRENT.
  {
    const h = await bootGamePage();
    const doc = h.window.document;
    h.evalIn("document.getElementById('onAirBanner').style.display='flex'; renderAirHealth();");
    if (!/feed current/.test(doc.getElementById('onAirBanner').textContent)) {
      fail('air:current', 'expected a healthy feed line, got: ' + doc.getElementById('onAirBanner').textContent);
    }
    h.evalIn("pendingQueue.push({sequence_number:99}); renderAirHealth();");
    const t = doc.getElementById('onAirBanner').textContent;
    if (!/1 play unsent/.test(t)) fail('air:unsent', 'unsent plays mean the feed is behind the field and should say so, got: ' + t);
    if (!/ON AIR/.test(t)) fail('air:label', 'the ON AIR label must survive, got: ' + t);
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Right rail: live totals and validation ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  both teams\' totals reconcile with the engine, validation runs live but only once the page is quiet, and the ON AIR tile reports whether the feed is current.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
