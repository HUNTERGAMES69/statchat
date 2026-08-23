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

  // FALLING ON YOUR OWN FUMBLE: the ball, the down, and the stat sheet.
  // ---------------------------------------------------------------------
  // Two faults, found together on 23 Aug.
  //
  // 1. There was no way to say WHERE the ball was recovered. A runner's
  //    yardage is measured to the spot of the FUMBLE, not to where his
  //    team fell on it, so gain 8, fumble, recover 3 back and the rusher
  //    is still credited 8 while the ball sits 5 ahead of the snap. Two
  //    numbers, and the entry layer had one.
  //
  // 2. The effect never set `converts`, so the engine advanced the down
  //    but could not award a first down. 2nd & 7 at own 30, rush for 8,
  //    own recovery came out 3rd & 1 instead of 1st & 10 -- verified
  //    against the live build, so it long predated the spot work.
  {
    const run = async (down, dist, yl, yards, spot) => {
      const h = await bootGamePage();
      const doc = h.window.document, win = h.window;
      setDrive(h, { down: down, distance: dist, side: 'own', yardline: yl });
      click(win, doc.querySelector('.ptypeBtn[data-type="rush"]'));
      click(win, doc.querySelector('.pp_carrier_pick'));
      typeInto(win, doc.getElementById('pp_yards'), String(yards));
      click(win, doc.getElementById('pp_rush_fumbled_toggle'));
      await new Promise(r => setTimeout(r, 80));
      const own = doc.querySelector('input[name=pp_rush_fumrec][value=own]');
      own.checked = true;
      own.dispatchEvent(new win.Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 80));
      if (spot) {
        // VISIBLE, not merely present. The first version of this test
        // clicked the control without checking it was on screen, and
        // passed while the whole block sat inside the OPPONENT-recovery
        // div -- hidden on every own recovery, which is the only time it
        // applies. Andy found it in the browser; the test could not.
        const wrap = doc.getElementById('pp_rushfum_ownspot_wrap');
        let vis = !!wrap, node = wrap;
        while (vis && node && node !== doc.body) {
          if (win.getComputedStyle(node).display === 'none') vis = false;
          node = node.parentElement;
        }
        if (!vis) { fail('ownfum:hidden', 'the recovery spot is not on screen for an own recovery'); h.close(); return null; }
        const side = doc.querySelector('.pp_rushfum_ownspot_side[data-side="own"]');
        if (!side) { h.close(); return null; }
        click(win, side);
        typeInto(win, doc.getElementById('pp_rushfum_ownspot_yardline'), String(spot));
      }
      click(win, doc.getElementById('pp_review'));
      await new Promise(r => setTimeout(r, 150));
      click(win, doc.getElementById('saveBtn'));
      await new Promise(r => setTimeout(r, 200));
      const out = {
        st: JSON.parse(h.evalIn('JSON.stringify((({down,distance,fieldPos,possession})=>({down,distance,fieldPos,possession}))(computeState()))')),
        rush: JSON.parse(h.evalIn('JSON.stringify(computeBoxScore(plays).teamA.rushing)')),
        text: h.evalIn('plays[plays.length-1].text')
      };
      h.close();
      return out;
    };
    const eq = (got, want, area, detail) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        fail(area, detail + ' -- got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
      }
    };

    // Reaching the line to gain awards the first down.
    let r = await run(2, 7, 30, 8, null);
    eq([r.st.down, r.st.distance, r.st.fieldPos], [1, 10, 38],
       'ownfum:converts', '2nd & 7 at own 30, rush 8 recovered on the spot');

    // Recovered BEHIND the fumble: the ball goes back, the rusher does not.
    r = await run(2, 7, 30, 8, 35);
    if (r === null) fail('ownfum:spot', 'no own-recovery spot control on the rush tree');
    else {
      eq([r.st.down, r.st.distance, r.st.fieldPos], [3, 2, 35],
         'ownfum:spot-ball', 'recovered at own 35 should leave 3rd & 2 there');
      // THE WHOLE POINT: yardage to the fumble, ball to the recovery.
      const yds = (r.rush['N Quarterback'] || r.rush['N Runningback'] || {}).yds;
      if (yds !== 8) {
        fail('ownfum:credit', 'the runner is credited to the spot of the fumble, expected 8, got ' + yds);
      }
    }

    // Short of the marker on fourth down is a turnover on downs, and the
    // other team takes over at the recovery spot (mirrored).
    r = await run(4, 3, 40, 5, 38);
    if (r && !/turnover on downs/.test(r.text)) {
      fail('ownfum:downs', 'fourth down short should turn the ball over: ' + r.text);
    }
    if (r && r.st.possession !== 'teamB') {
      fail('ownfum:possession', 'possession should change, got ' + r.st.possession);
    }
  }

  // THE CONTROL MUST BE VISIBLE ON ALL THREE TREES, and hidden when the
  // OPPONENT recovers. Three separate div-nesting faults put it in the
  // wrong branch on rush, pass and sack in turn.
  {
    const check = async (tree, pfx, ptype) => {
      const h = await bootGamePage();
      const doc = h.window.document, win = h.window;
      setDrive(h, { down: 2, distance: 7, side: 'own', yardline: 30 });
      click(win, doc.querySelector('.ptypeBtn[data-type="' + ptype + '"]'));
      if (tree === 'sack') {
        const sb = [...doc.querySelectorAll('#playPanel button')]
          .find(b => /^Sacked$/.test(b.textContent.trim()));
        if (sb) click(win, sb);
        await new Promise(r => setTimeout(r, 60));
      }
      const tog = doc.getElementById('pp_' + tree + '_fumbled_toggle');
      if (!tog) { fail('ownfum:' + tree + ':toggle', 'no fumble toggle'); h.close(); return; }
      click(win, tog);
      await new Promise(r => setTimeout(r, 80));
      const onScreen = () => {
        let e = doc.getElementById('pp_' + pfx + '_ownspot_wrap');
        if (!e) return false;
        while (e && e !== doc.body) {
          if (win.getComputedStyle(e).display === 'none') return false;
          e = e.parentElement;
        }
        return true;
      };
      const pick = v => {
        const r = doc.querySelector('input[name=pp_' + tree + '_fumrec][value=' + v + ']');
        r.checked = true;
        r.dispatchEvent(new win.Event('change', { bubbles: true }));
      };
      pick('own');
      await new Promise(r => setTimeout(r, 80));
      if (!onScreen()) fail('ownfum:' + tree + ':own', 'the recovery spot should show when your own team recovers');
      pick('opp');
      await new Promise(r => setTimeout(r, 80));
      if (onScreen()) fail('ownfum:' + tree + ':opp', 'the OWN recovery spot should hide when the opponent recovers');
      h.close();
    };
    await check('rush', 'rushfum', 'rush');
    await check('pass', 'passfum', 'pass');
    await check('sack', 'sackfum', 'pass');
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
