// Entry integrity checks (Aug 6, 2026 session)
// --------------------------------------------
// Five separate live-entry behaviours, grouped because they all concern
// what actually gets WRITTEN when the coach commits a play.
//
// The most important is the stale-confirm-text bug, which is the only
// one here that silently corrupted saved data: the confirm card is built
// on Review but nothing is written until Save, so any state change in
// between (Undo being the easy one) left the stored text describing a
// down & distance that no longer existed, while the effect was applied
// to the current state. The result was a log with an impossible jump
// (2nd & 10 straight to 4th & 11) and a third-down attempt that no
// longer counted -- invisible until someone read the log back.

const { bootGamePage } = require('./harness');
const { enterPlay, setDrive, click, typeInto } = require('./ui_driver');

const wait = ms => new Promise(r => setTimeout(r, ms));

function statedDownDistance(text) {
  const m = text.match(/— (\d)(?:st|nd|rd|th) & (\d+)/);
  if (m) return m[1] + ' & ' + m[2];
  return /1st down/.test(text) ? '1 & 10' : null;
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1. Stale confirm text ----------------------------------------
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 34 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '4' });   // -> 2nd & 6
    // Review a play...
    click(win, doc.querySelector('.ptypeBtn[data-type="rush"]'));
    typeInto(win, doc.getElementById('pp_carrier_manual'), '28');
    typeInto(win, doc.getElementById('pp_yards'), '-5');
    click(win, doc.getElementById('pp_review'));
    // ...then change the state before committing it.
    click(win, doc.getElementById('undoBtn'));
    await wait(20);
    click(win, doc.getElementById('saveBtn'));
    await wait(20);

    const text = h.evalIn('plays[plays.length-1].text');
    const st = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
    const stated = statedDownDistance(text);
    const actual = st.down + ' & ' + st.distance;
    if (stated !== actual) {
      fail('stale text', 'saved log says "' + stated + '" but the engine is at "' + actual +
           '" -- the play was not re-parsed at save time. Text: ' + text);
    }
    h.close();
  }

  // --- 2. Every saved line agrees with the recomputed engine state ---
  //     A general version of the above: no drive should ever contain a
  //     line whose stated down & distance disagrees with replay.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 34 });
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', incomplete: true });
    enterPlay(h, { type: 'pass', passer: '7', receiver: '84', yards: '10' });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '1' });
    enterPlay(h, { type: 'penalty', on: 'defense', yards: '5' });
    enterPlay(h, { type: 'pass', passer: '7', receiver: '88', yards: '6' });
    enterPlay(h, { type: 'rush', carrier: '28', yards: '-1' });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '26' });
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', incomplete: true });
    enterPlay(h, { type: 'rush', carrier: '28', yards: '-5' });
    const n = h.evalIn('plays.length');
    for (let i = 0; i < n; i++) {
      const text = h.evalIn('plays[' + i + '].text');
      const st = JSON.parse(h.evalIn('JSON.stringify(computeState(plays.slice(0,' + (i + 1) + ')))'));
      const stated = statedDownDistance(text);
      if (!stated || st.down === null) continue;
      const actual = st.down + ' & ' + st.distance;
      if (stated !== actual) {
        fail('text/engine mismatch', 'play ' + i + ' says "' + stated + '", engine says "' +
             actual + '": ' + text);
      }
    }
    h.close();
  }

  // --- 3. Redo restores the play at its original sequence number -----
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '15' });
    const beforeDown = doc.getElementById('downText').textContent;

    click(win, doc.getElementById('undoBtn')); await wait(20);
    if (doc.getElementById('redoBtn').disabled) fail('redo', 'Redo stayed disabled after an undo');
    click(win, doc.getElementById('redoBtn')); await wait(20);

    if (doc.getElementById('downText').textContent !== beforeDown) {
      fail('redo', 'undo+redo did not restore the state: ' + doc.getElementById('downText').textContent);
    }
    if (!doc.getElementById('redoBtn').disabled) fail('redo', 'Redo stayed enabled with an empty stack');
    const seqs = h.db.inserted.filter(r => r.table === 'plays').map(r => r.row.sequence_number);
    if (seqs[seqs.length - 1] !== seqs[seqs.length - 2]) {
      fail('redo', 'redo appended a new sequence number instead of reusing the original: ' + seqs.join(','));
    }
    // A new play must invalidate the redo stack.
    click(win, doc.getElementById('undoBtn')); await wait(20);
    enterPlay(h, { type: 'rush', carrier: '22', yards: '3' });
    if (!doc.getElementById('redoBtn').disabled) {
      fail('redo', 'entering a new play must clear the redo stack');
    }
    h.close();
  }

  // --- 4. Passer picker pre-selects the last quarterback -------------
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    h.evalIn('renderPlayPanel("pass")');
    if (doc.getElementById('pp_passer_manual').value !== '') {
      fail('QB prefill', 'nothing should be pre-selected before the team has thrown');
    }
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '12' });
    // Enter a pass WITHOUT touching the passer field.
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    typeInto(win, doc.getElementById('pp_receiver_manual'), '84');
    typeInto(win, doc.getElementById('pp_yards'), '9');
    click(win, doc.getElementById('pp_review'));
    const text = doc.getElementById('parsedText').textContent;
    if (!text.includes('N Quarterback')) {
      fail('QB prefill', 'the pre-selected passer was not used: ' + text);
    }
    h.close();
  }

  // --- 5. Penalty "no down change" -----------------------------------
  {
    const cases = [
      ['off', '10', true,  '1st & 10', 'own 15'],
      ['off', '10', false, '1st & 20', 'own 15'],
      ['def', '15', true,  '1st & 10', 'own 40']
    ];
    for (const [side, yds, noDown, wantDD, wantSpot] of cases) {
      const h = await bootGamePage();
      const { window: win, document: doc } = h;
      setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
      click(win, doc.getElementById('penUtilBtn'));
      const panel = doc.getElementById('playPanel');
      click(win, panel.querySelector('.penTeamBtn[data-team="' + side + '"]'));
      typeInto(win, doc.getElementById('pen_yds'), yds);
      if (noDown) click(win, doc.getElementById('pen_no_down'));
      click(win, doc.getElementById('pen_review'));
      click(win, doc.getElementById('saveBtn'));
      const after = doc.getElementById('downText').textContent;
      if (!after.includes(wantDD) || !after.includes(wantSpot)) {
        fail('penalty no-down-change', side + ' ' + yds + ' checked=' + noDown +
             ' should give "' + wantDD + ' at ' + wantSpot + '", got: ' + after);
      }
      h.close();
    }
  }

  // --- 6. Safety credits the clock to the team that HAD the ball -----
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    h.evalIn('showClockPrompt({mode:"start", team:"teamA"}, function(){})');
    typeInto(win, doc.getElementById('clockPromptInput'), '9:00');
    h.evalIn('resolveClockPrompt(false)');
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 40 });
    click(win, doc.querySelector('.ptypeBtn[data-type="safety"]'));
    click(win, doc.getElementById('pp_review'));
    typeInto(win, doc.getElementById('confirmClockInput'), '7:30');
    click(win, doc.getElementById('saveBtn'));

    const clockLine = h.evalIn(
      'JSON.stringify(plays.filter(p=>p.effect&&p.effect.clockEvent&&p.effect.clockEvent.type==="end").map(p=>p.text))');
    if (!/Neville/.test(clockLine)) {
      fail('safety clock', 'the end-of-possession clock must name the team that had the ball, got ' + clockLine);
    }
    const st = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
    if (st.possessionTime.teamA !== 90) {
      fail('safety clock', 'Neville should be credited 90s of possession, got ' +
           JSON.stringify(st.possessionTime));
    }
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Entry integrity checks ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) console.log('  saved text always matches the engine; redo, QB prefill, penalties and safety clocks correct.');
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
