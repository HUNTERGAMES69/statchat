// Turnover touchdown yardage -- direction check
// ------------------------------------------------
// Reported directly, with a screenshot, 20 Aug 2026: ball at Neville's
// own 41, intercepted, returned for a touchdown, logged as a 58/59-yard
// return. The correct number is 41.
//
// The reasoning: fieldPos already means "yards from the goal line the
// offense was driving toward." A rush or pass touchdown covers exactly
// that many MORE yards to reach it -- 100 - fieldPos -- because the same
// team keeps driving the same direction. An interception or a fumble
// recovered by the defense reverses which goal line matters: the team
// now carrying the ball needs to reach the goal line BEHIND where they
// took it away, which is exactly fieldPos yards, not 100 minus it.
//
// refreshSpotCalcContext's own touchdown auto-fill (rush/pass/sack) was
// already correct, because it never had to reverse direction. It simply
// never ran for a turnover at all -- interceptions use a separate
// calculator for a different question (the takeover spot for the NEXT
// drive), so the yards field was left fully manual with no auto-fill and
// no safety net. A coach was left to work out a direction-reversed
// number by hand, under time pressure, in the exact play where the
// mental picture of who is going which way is least settled.
//
// The dedicated Fumble type got the identical fix at the same time, for
// the identical reason -- found while confirming this one. Its own
// Touchdown toggle exists ONLY inside the "recovered by opponent" branch;
// "recovered by own team" has no Touchdown option of its own, so
// whenever the toggle is even reachable there, the scoring team is
// unconditionally the defense.

const { bootGamePage } = require('./harness');
const { click, setDrive, typeInto } = require('./ui_driver');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1. The exact reported case: own 41, intercepted, touchdown.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 41 });
    h.evalIn("renderPlayPanel('int')");
    typeInto(h.window, h.document.getElementById('pp_passer_manual'), '7');
    click(h.window, h.document.getElementById('pp_td_toggle'));
    const ye = h.document.getElementById('pp_yards');
    if (ye.value !== '41') {
      fail('int-own41-value', 'expected pp_yards to read 41 (fieldPos), got ' + JSON.stringify(ye.value));
    }
    if (!ye.disabled) fail('int-own41-locked', 'expected pp_yards to be locked once Touchdown is checked');
    click(h.window, h.document.getElementById('pp_review'));
    const pending = JSON.parse(h.evalIn('JSON.stringify(pending)'));
    if (!/returned 41/.test(pending.text)) {
      fail('int-own41-text', 'expected the saved play text to read "returned 41", got: ' + pending.text);
    }
    if (!pending.effect.score || pending.effect.score.team !== 'teamB' || pending.effect.score.points !== 6) {
      fail('int-own41-score', 'expected a 6-point score for the intercepting team, got: ' + JSON.stringify(pending.effect.score));
    }
    h.close();
  }

  // --- 2. The formula holds across the field, not just at 41 -- the
  // value must always equal fieldPos itself, never 100 - fieldPos.
  for (const yl of [5, 25, 50, 75, 95]) {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: yl });
    h.evalIn("renderPlayPanel('int')");
    click(h.window, h.document.getElementById('pp_td_toggle'));
    const ye = h.document.getElementById('pp_yards');
    if (ye.value !== String(yl)) {
      fail('int-formula-' + yl, 'at fieldPos ' + yl + ', expected pp_yards to read ' + yl + ', got ' + JSON.stringify(ye.value));
    }
    h.close();
  }

  // --- 3. Unchecking Touchdown releases the field for manual entry
  // again (does not leave it permanently locked, and does not wipe a
  // value the coach might want to adjust).
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 41 });
    h.evalIn("renderPlayPanel('int')");
    click(h.window, h.document.getElementById('pp_td_toggle'));
    click(h.window, h.document.getElementById('pp_td_toggle'));
    const ye = h.document.getElementById('pp_yards');
    if (ye.disabled) fail('int-unlock', 'pp_yards stayed locked after Touchdown was unchecked');
    h.close();
  }

  // --- 4. Non-touchdown interception returns are unaffected -- manual
  // entry still works exactly as before.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 41 });
    h.evalIn("renderPlayPanel('int')");
    typeInto(h.window, h.document.getElementById('pp_passer_manual'), '7');
    typeInto(h.window, h.document.getElementById('pp_yards'), '8');
    click(h.window, h.document.getElementById('pp_review'));
    const pending = JSON.parse(h.evalIn('JSON.stringify(pending)'));
    if (!/returned 8\b/.test(pending.text)) {
      fail('int-nontd-manual', 'a manually entered non-touchdown return no longer works: ' + pending.text);
    }
    h.close();
  }

  // --- 5. The fumble panel, opponent recovers, returned for a
  // touchdown -- the identical fix, the identical direction.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 41 });
    h.evalIn("renderPlayPanel('fumble')");
    typeInto(h.window, h.document.getElementById('pp_carrier_manual'), '22');
    click(h.window, h.document.getElementById('pp_td_toggle'));
    const ye = h.document.getElementById('pp_yards');
    if (ye.value !== '41') {
      fail('fumble-opp-td-value', 'expected pp_yards to read 41 on the fumble panel, got ' + JSON.stringify(ye.value));
    }
    typeInto(h.window, h.document.getElementById('pp_credit_manual'), '99');
    click(h.window, h.document.getElementById('pp_review'));
    const pending = JSON.parse(h.evalIn('JSON.stringify(pending)'));
    if (!/returned 41/.test(pending.text)) {
      fail('fumble-opp-td-text', 'expected the saved play text to read "returned 41", got: ' + pending.text);
    }
    h.close();
  }

  // --- 6. Sanity check: rush and pass touchdowns must still use the
  // ORIGINAL direction (100 - fieldPos), since the offense keeps
  // driving the same way it always was. A fix aimed at turnovers must
  // not accidentally touch the case that was already correct.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 41 });
    h.evalIn("renderPlayPanel('rush')");
    typeInto(h.window, h.document.getElementById('pp_carrier_manual'), '22');
    click(h.window, h.document.getElementById('pp_td_toggle'));
    const ye = h.document.getElementById('pp_yards');
    if (ye.value !== '59') {
      fail('rush-td-unaffected', 'a rush touchdown from own 41 should still read 59 (100 - fieldPos), got ' + JSON.stringify(ye.value));
    }
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Turnover touchdown yardage (direction) ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  a turnover returned for a touchdown always reads fieldPos, never 100 minus it, and rush/pass touchdowns are untouched.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
