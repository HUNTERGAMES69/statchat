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

  // --- THE CLOCK IS ASKED AT THE TOUCHDOWN, NOT AT THE TRY ---------------
  // Andy's call, 14 Aug 2026, and the reason is a real one: a touchdown
  // does not set endsDrive, so the prompt landed on the PAT and the
  // scoring drive's time of possession swallowed the try with it. The
  // number a coach wants is how long the DRIVE took.
  //
  // Three things are pinned. The touchdown asks. The try does not. And a
  // SAFETY still does -- it also ends the drive for one-or-two points,
  // which is why the test cannot simply be "small score ends the drive";
  // what separates them is whether a touchdown came immediately before.
  {
    const asks = (h) => h.document.getElementById('confirmClockRow').style.display === 'block';
    const review = (h, open) => {
      open(h.window, h.document);
      click(h.window, h.document.getElementById('pp_review'));
      return asks(h);
    };

    const h = await bootGamePage();
    h.window.confirm = () => true;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    click(h.window, h.document.getElementById('setClockUtilBtn'));
    typeInto(h.window, h.document.getElementById('setclock_val'), '1200');
    click(h.window, h.document.getElementById('setclock_save'));
    setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 6 });

    if (!review(h, (w, d) => {
      click(w, d.querySelector('.ptypeBtn[data-type="rush"]'));
      typeInto(w, d.getElementById('pp_carrier_manual'), '22');
      typeInto(w, d.getElementById('pp_yards'), '6');
      click(w, d.getElementById('pp_td_toggle'));
    })) {
      fail('touchdown clock', 'a touchdown does not ask for the clock — the scoring drive ' +
           'then has no end, and its time of possession runs on into the try');
    }
    typeInto(h.window, h.document.getElementById('confirmClockInput'), '512');
    click(h.window, h.document.getElementById('saveBtn'));

    // The touchdown must actually CLOSE the possession, not merely ask.
    const top = JSON.parse(h.evalIn('JSON.stringify(computeState().possessionTime)'));
    if (top.teamA !== 408) {
      fail('touchdown clock', 'took over at 12:00 and scored at 5:12, so the drive is 6:48 ' +
           '(408s) — got ' + top.teamA + 's. A clock entered on a touchdown must write an ' +
           'end-of-possession event; without one the clock is asked for and thrown away');
    }

    if (review(h, (w, d) => {
      click(w, d.querySelector('.ptypeBtn[data-type="pat"]'));
      typeInto(w, d.getElementById('pp_kicker_manual'), '3');
      const r = d.querySelector('input[name=pp_patres][value="g"]');
      if (r) click(w, r);
    })) {
      fail('touchdown clock', 'the PAT still asks for the clock — asking twice invites a ' +
           'second reading that would reopen and re-close the drive');
    }
    h.close();

    // A safety is one-or-two points and ends the drive, and MUST still ask.
    const g = await bootGamePage();
    g.window.confirm = () => true;
    setDrive(g, { down: 2, distance: 8, side: 'own', yardline: 2 });
    if (!review(g, (w, d) => {
      click(w, d.querySelector('.ptypeBtn[data-type="safety"]'));
      typeInto(w, d.getElementById('pp_credit_manual'), '55');
    })) {
      fail('touchdown clock', 'a safety no longer asks for the clock — it is a real end of ' +
           'possession, and only a try following a touchdown should be skipped');
    }
    g.close();
  }

  // --- TIME OF POSSESSION STOPS AT THE END OF REGULATION ----------------
  // Andy's call, 14 Aug 2026. Overtime is played in series, not against a
  // running clock -- each side simply gets the ball from the opponent's
  // 10 -- so any elapsed time recorded there is an artefact of the entry,
  // not of the football. Adding it produced a total that could not be
  // reconciled against the length of the game.
  //
  // The second half of this is the case that would have leaked: a
  // possession OPENED in Q4 and closed by an event carrying an overtime
  // quarter. Freezing accrual alone would still have paid that one out,
  // because the pending start was already sitting there from regulation.
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    win.confirm = () => true; win.alert = () => {};
    h.evalIn("pushAndPersist({id:nextId++, text:'Q4', effect:{setQuarter:4}, quarter:4}); renderAll();");
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    click(win, doc.getElementById('setClockUtilBtn'));
    typeInto(win, doc.getElementById('setclock_val'), '1200');
    click(win, doc.getElementById('setclock_save'));
    enterPlay(h, { type: 'rush', carrier: '22', yards: '9' });
    enterPlay(h, { type: 'punt', punter: '15', yards: '40',
                   spot: { side: 'own', yardline: '25' }, clock: '9:30' });
    const atHorn = JSON.parse(h.evalIn('JSON.stringify(computeState().possessionTime)'));
    if (atHorn.teamA !== 150){
      fail('overtime possession time', 'the regulation figure is wrong before overtime even ' +
           'starts (expected 150s, got ' + atHorn.teamA + 's) — this fixture is not measuring ' +
           'what it thinks');
    }

    // OVERTIME NOW ASKS WHICH BOOK FIRST, 2 Sep 2026. NFHS is chosen
    // because it starts a series at the opponent's 10 -- the value this
    // panel hardcoded before the question existed -- so everything below
    // this line is testing exactly what it was testing before.
    click(win, doc.getElementById('otUtilBtn'));
    click(win, doc.getElementById('ot_fmt_nfhs'));
    click(win, doc.getElementById('ot_pickA'));
    await new Promise(r => setTimeout(r, 60));
    click(win, doc.getElementById('ot_review'));
    await new Promise(r => setTimeout(r, 80));

    // A full start/end pair inside overtime must add nothing.
    h.evalIn("pushAndPersist({id:nextId++, text:'Clock — start', effect:{clockEvent:{type:'start',team:'teamA',absSec:2100}}, quarter:5});");
    h.evalIn("pushAndPersist({id:nextId++, text:'Clock — end', effect:{clockEvent:{type:'end',team:'teamA',absSec:2280}}, quarter:5}); renderAll();");
    const afterOt = JSON.parse(h.evalIn('JSON.stringify(computeState().possessionTime)'));
    if (afterOt.teamA !== atHorn.teamA || afterOt.teamB !== atHorn.teamB){
      fail('overtime possession time', 'overtime clock events changed the totals: ' +
           JSON.stringify(atHorn) + ' -> ' + JSON.stringify(afterOt) +
           '. There is no game clock in overtime, so there is no time to credit');
    }
    h.close();

    // ...and the app must stop ASKING once overtime starts. A clock
    // entered there is recorded and then ignored by the rule above, and
    // asking for a number that does nothing is worse than not asking:
    // it looks like it matters, and a scorer under pressure will stop to
    // find one.
    {
      const k = await bootGamePage();
      const { window: w, document: d } = k;
      w.confirm = () => true; w.alert = () => {};
      k.evalIn("pushAndPersist({id:nextId++, text:'Q4', effect:{setQuarter:4}, quarter:4}); renderAll();");
      setDrive(k, { down: 4, distance: 8, side: 'own', yardline: 30 });
      click(w, d.querySelector('.ptypeBtn[data-type="punt"]'));
      typeInto(w, d.getElementById('pp_punter_manual'), '15');
      typeInto(w, d.getElementById('pp_yards'), '40');
      click(w, d.querySelector('.pp_spot_side[data-side="own"]'));
      typeInto(w, d.getElementById('pp_spot_yardline'), '25');
      click(w, d.getElementById('pp_review'));
      if (d.getElementById('confirmClockRow').style.display !== 'block'){
        fail('overtime possession time', 'a punt in Q4 stopped asking for the clock — the ' +
             'overtime suppression has caught regulation too');
      }
      click(w, d.getElementById('saveBtn'));

      // OVERTIME NOW ASKS WHICH BOOK FIRST, 2 Sep 2026. NFHS is chosen
      // because it starts a series at the opponent's 10 -- the value this
      // panel hardcoded before the question existed -- so everything below
      // this line is testing exactly what it was testing before.
      click(w, d.getElementById('otUtilBtn'));
      click(w, d.getElementById('ot_fmt_nfhs'));
      click(w, d.getElementById('ot_pickA'));
      await new Promise(r => setTimeout(r, 60));
      click(w, d.getElementById('ot_review'));
      await new Promise(r => setTimeout(r, 80));
      click(w, d.querySelector('.ptypeBtn[data-type="rush"]'));
      typeInto(w, d.getElementById('pp_carrier_manual'), '22');
      typeInto(w, d.getElementById('pp_yards'), '10');
      click(w, d.getElementById('pp_td_toggle'));
      click(w, d.getElementById('pp_review'));
      if (d.getElementById('confirmClockRow').style.display === 'block'){
        fail('overtime possession time', 'an overtime touchdown still asks for the clock — ' +
             'there is no game clock in overtime and the value would be discarded');
      }
      k.close();
    }

    // A possession opened in Q4 and closed in overtime pays out nothing.
    const g = await bootGamePage();
    g.window.confirm = () => true; g.window.alert = () => {};
    g.evalIn("pushAndPersist({id:nextId++, text:'Q4', effect:{setQuarter:4}, quarter:4}); renderAll();");
    setDrive(g, { down: 1, distance: 10, side: 'own', yardline: 25 });
    g.evalIn("pushAndPersist({id:nextId++, text:'Clock — start', effect:{clockEvent:{type:'start',team:'teamA',absSec:2400}}, quarter:4}); renderAll();");
    // OVERTIME NOW ASKS WHICH BOOK FIRST, 2 Sep 2026. NFHS starts a
    // series at the opponent's 10 -- the value this panel hardcoded
    // before the question existed -- so what follows is unchanged.
    click(g.window, g.document.getElementById('otUtilBtn'));
    click(g.window, g.document.getElementById('ot_fmt_nfhs'));
    click(g.window, g.document.getElementById('ot_pickA'));
    await new Promise(r => setTimeout(r, 60));
    click(g.window, g.document.getElementById('ot_review'));
    await new Promise(r => setTimeout(r, 80));
    g.evalIn("pushAndPersist({id:nextId++, text:'Clock — end', effect:{clockEvent:{type:'end',team:'teamA',absSec:2880}}, quarter:5}); renderAll();");
    const straddle = JSON.parse(g.evalIn('JSON.stringify(computeState().possessionTime)'));
    if (straddle.teamA !== 0){
      fail('overtime possession time', 'a possession opened in Q4 was paid out by an END event ' +
           'in overtime: ' + straddle.teamA + 's. The pending start has to be dropped when ' +
           'overtime begins, not merely left unclosed');
    }
    g.close();
  }

  // A TIME EXACTLY ON A QUARTER BOUNDARY ENDS THAT QUARTER, it does not
  // begin the next one. 0:00 at the end of Q4 is stored as 4 x the
  // quarter length, and plain arithmetic reads that as the first tick of
  // Q5 -- so a finalized game reported its last clock entry as
  // "12:00 (Q5)", inventing an overtime period that never happened.
  // Reported from a real game. The same slip applied at every quarter
  // end; it was only obvious at the last one, where there is no next
  // quarter for it to be plausibly mistaken for.
  {
    const h = await bootGamePage();
    const L = h.evalIn('quarterLengthSec');
    const at = v => JSON.parse(h.evalIn('JSON.stringify(absSecToClockStr(' + v + '))'));
    const expect = (v, text, q, why) => {
      const r = at(v);
      if (!r || r.text !== text || r.q !== q) {
        fail('clock-boundary', why + ': expected ' + text + ' (Q' + q + '), got ' +
          (r ? r.text + ' (Q' + r.q + ')' : 'null'));
      }
    };
    expect(0, '12:00', 1, 'absSec 0 really is the start of Q1');
    expect(L, '0:00', 1, 'the 0:00 that closes Q1');
    expect(L - 1, '0:01', 1, 'one second left in Q1 is untouched');
    expect(2 * L, '0:00', 2, 'the 0:00 that closes the first half');
    expect(4 * L, '0:00', 4, 'the 0:00 that ends regulation must not read as Q5');
    // Genuine overtime still reports Q5 -- the fix must not hide a real one.
    expect(4 * L + 60, '11:00', 5, 'a real overtime period');
    h.close();
  }

  // A KICKOFF TOUCHBACK CARRIES THE CLOCK FORWARD. The ball is dead the
  // moment it reaches the end zone, so the receiving team's possession
  // starts on the same clock the scoring play ended on -- a number the
  // scorer typed one play ago.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 5 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '5', td: true, clock: '7:42' });
    enterPlay(h, { type: 'pat', kicker: '3', result: 'g' });
    const cc = () => doc.getElementById('confirmClockInput');

    click(win, doc.querySelector('.ptypeBtn[data-type="kickoff"]'));
    click(win, doc.querySelector('.pp_kicker_pick'));
    click(win, doc.getElementById('pp_ko_touchback_toggle'));
    click(win, doc.getElementById('pp_review'));
    await new Promise(r => setTimeout(r, 300));
    if (cc().value !== '7:42') {
      fail('touchback:clock', 'a touchback should carry the last clock forward, got ' + JSON.stringify(cc().value));
    }
    click(win, doc.getElementById('saveBtn'));
    await new Promise(r => setTimeout(r, 250));

    // A RETURNED kickoff must NOT be prefilled -- time came off the clock,
    // and a wrong number that fills itself in looks more trustworthy than
    // one the scorer typed.
    click(win, doc.getElementById('phaseClearBtn'));
    await new Promise(r => setTimeout(r, 80));
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    click(win, doc.querySelector('.ptypeBtn[data-type="kickoff"]'));
    click(win, doc.querySelector('.pp_kicker_pick'));
    typeInto(win, doc.getElementById('pp_retyds'), '22');
    click(win, doc.querySelector('.pp_spot_side[data-side="own"]'));
    typeInto(win, doc.getElementById('pp_spot_yardline'), '32');
    click(win, doc.getElementById('pp_review'));
    await new Promise(r => setTimeout(r, 300));
    // REVERSED 30 Aug 2026. This asserted that only a TOUCHBACK prefills.
    // Andy's call, from LIVE_GAME_FEEDBACK item 4: every kickoff
    // prefills, because the clock is stopped before all of them -- it
    // stops on the score, does not run during the try, and restarts only
    // when the receiving team touches the ball. So the clock at the catch
    // IS the clock at the previous stoppage, touchback or not.
    //
    // The check now runs the other way: a returned kickoff MUST arrive
    // prefilled, and the value must be a real clock rather than an empty
    // box or a zero.
    if (!/^\d+:[0-5]\d$/.test(cc().value || '')) {
      fail('kickoff:prefill', 'a returned kickoff should arrive prefilled, got ' + JSON.stringify(cc().value));
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
