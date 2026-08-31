// Game phase is DERIVED, not remembered
// -------------------------------------
// `game_phase` used to be authoritative and stored on the game row,
// which meant it could disagree with the plays. That produced THREE
// separate lockups in one session:
//
//   * undoing across the interval left it at 'secondHalf' with no
//     second-half plays;
//   * undoing past the divider left it at 'halftime' with no divider —
//     both half buttons hidden, every control disabled;
//   * a stale guided_state kept a kickoff "active" after its plays were
//     undone.
//
// Each was patched with a self-heal, and each patch was a symptom of the
// same fault. On 12 August 2026 the phase became a function of the log:
// `derivePhase()`. The log cannot disagree with itself.
//
// WHAT A LOCKUP LOOKS LIKE, and why these assertions are shaped as they
// are: the page renders fine. Nothing errors. There is simply no button
// that moves the game forward and no way to enter a play. So the check
// is not "did it throw" — it is "from this state, can a scorer still do
// something?" Every scenario below ends by asserting a way forward.

const { bootGamePage } = require('./harness');
const { enterPlay, setDrive, click, typeInto } = require('./ui_driver');

function phase(h) { return h.evalIn('derivePhase()'); }

function wayForward(h) {
  const d = h.document;
  const visible = id => {
    const el = d.getElementById(id);
    return !!(el && el.style.display !== 'none' && !el.disabled);
  };
  const canEnterPlay = [...d.querySelectorAll('.ptypeBtn')].some(b => !b.disabled);
  const routes = [];
  if (visible('startGameBtn')) routes.push('Start game');
  if (visible('endFirstHalfBtn')) routes.push('End 1st half');
  if (visible('startHalfBtn')) routes.push('Start 2nd half');
  if (visible('endGameBtn')) routes.push('End game');
  if (canEnterPlay) routes.push('enter a play');
  return routes;
}

async function playThroughToSecondHalf(h) {
  const { window: win, document: doc } = h;
  click(win, doc.getElementById('startGameBtn'));
  click(win, doc.getElementById('pickA'));
  typeInto(win, doc.getElementById('gk_kicker_manual'), '3');
  // A DIRECTION IS REQUIRED NOW. The guided kickoff panel gained
  // "which way is <team> kicking" and refuses to save without it,
  // so every helper that clicked straight through to Save has been
  // stuck on the opening kickoff ever since -- which is why this
  // walkthrough reported "0 plays in the log" rather than a failure
  // anyone could act on. One click, before Save.
  const _dir1 = doc.querySelector('.gk_dir_btn'); if (_dir1) click(win, _dir1);
  click(win, doc.getElementById('guidedKickoffSave'));
  typeInto(win, doc.getElementById('gr_yards'), '20');
  const sb = doc.querySelector('.gr_spot_side[data-side="own"]');
  if (sb) click(win, sb);
  typeInto(win, doc.getElementById('gr_spot_yardline'), '25');
  typeInto(win, doc.getElementById('guidedReturnClock'), '11:50');
  click(win, doc.getElementById('guidedReturnSave'));
  await new Promise(r => setTimeout(r, 80));

  enterPlay(h, { type: 'rush', carrier: '22', yards: '5' });

  click(win, doc.getElementById('quarterUtilBtn'));
  click(win, doc.getElementById('endFirstHalfBtn'));
  const clockIn = doc.getElementById('confirmClockInput');
  if (clockIn && doc.getElementById('confirmClockRow').style.display !== 'none') {
    typeInto(win, clockIn, '0:00');
    click(win, doc.getElementById('saveBtn'));
  }
  await new Promise(r => setTimeout(r, 80));
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- the phase matches the log at every stage -----------------------
  {
    const h = await bootGamePage({ game: { game_phase: 'notStarted' } });
    if (phase(h) !== 'notStarted') {
      fail('derivation', 'an empty game should be notStarted, got ' + phase(h));
    }
    await playThroughToSecondHalf(h);
    if (phase(h) !== 'halftime') {
      fail('derivation', 'after the half-end divider with no play after it, ' +
           'expected halftime, got ' + phase(h));
    }
    if (!wayForward(h).includes('Start 2nd half')) {
      fail('lockup', 'at halftime with no route forward. Offered: ' +
           JSON.stringify(wayForward(h)));
    }
    h.close();
  }

  // --- THE STORED-PHASE LOCKUPS, reproduced directly ------------------
  // Each of these is a game row whose stored phase is a LIE about the
  // log. Before the change these locked the page; now the stored value
  // is ignored entirely.
  const liars = [
    ['secondHalf with no plays at all',      'secondHalf'],
    ['halftime with no divider in the log',  'halftime'],
    ['ended on a game that is not final',    'ended']
  ];
  for (const [label, stored] of liars) {
    const h = await bootGamePage({ game: { game_phase: stored } });
    const got = phase(h);
    if (got !== 'notStarted') {
      fail('stale phase', label + ': the log has no plays, so the phase ' +
           'should be notStarted; got ' + got);
    }
    const routes = wayForward(h);
    if (!routes.length) {
      fail('lockup', label + ': NO way forward — this is the lockup');
    }
    h.close();
  }

  // --- undoing across the interval ------------------------------------
  // The first of the three lockups. Play into the second half, then undo
  // back past the interval.
  {
    const h = await bootGamePage({ game: { game_phase: 'notStarted' } });
    const { window: win, document: doc } = h;
    await playThroughToSecondHalf(h);

    // Start the second half and run a play, so we are genuinely in it.
    click(win, doc.getElementById('startHalfBtn'));
    click(win, doc.getElementById('pickB'));
    typeInto(win, doc.getElementById('gk_kicker_manual'), '3');
    // A DIRECTION IS REQUIRED NOW. The guided kickoff panel gained
    // "which way is <team> kicking" and refuses to save without it,
    // so every helper that clicked straight through to Save has been
    // stuck on the opening kickoff ever since -- which is why this
    // walkthrough reported "0 plays in the log" rather than a failure
    // anyone could act on. One click, before Save.
    const _dir2 = doc.querySelector('.gk_dir_btn'); if (_dir2) click(win, _dir2);
    click(win, doc.getElementById('guidedKickoffSave'));
    typeInto(win, doc.getElementById('gr_yards'), '18');
    const sb = doc.querySelector('.gr_spot_side[data-side="own"]');
    if (sb) click(win, sb);
    typeInto(win, doc.getElementById('gr_spot_yardline'), '30');
    typeInto(win, doc.getElementById('guidedReturnClock'), '11:45');
    click(win, doc.getElementById('guidedReturnSave'));
    await new Promise(r => setTimeout(r, 80));

    if (phase(h) !== 'secondHalf') {
      fail('derivation', 'after a second-half kickoff, expected secondHalf, ' +
           'got ' + phase(h));
    }

    // Now undo everything back past the divider.
    for (let i = 0; i < 12; i++) {
      const undo = doc.getElementById('undoBtn');
      if (!undo || undo.disabled) break;
      click(win, undo);
      await new Promise(r => setTimeout(r, 40));
    }

    const after = phase(h);
    const routes = wayForward(h);
    if (!routes.length) {
      fail('lockup', 'after undoing back across the interval there is NO ' +
           'way forward. Phase says ' + after + '. This is the exact ' +
           'lockup the derivation exists to prevent');
    }
    // Whatever it landed on must be consistent with the log.
    const hasDivider = JSON.parse(h.evalIn(
      'JSON.stringify(plays.some(p => p.isDivider && /end of (1st|first) half/i.test(p.text||"")))'));
    if (!hasDivider && (after === 'halftime' || after === 'secondHalf')) {
      fail('derivation', 'no half divider in the log but the phase says ' +
           after + ' — stored state has leaked back in');
    }
    h.close();
  }

  // --- a stale guided flow must not disable the page ------------------
  // The third lockup: guided_state is still STORED (it is not derivable
  // from the log — "kickoff in progress" and "kickoff never started"
  // look identical), so this one still needs a repair. Check it works.
  {
    const h = await bootGamePage({
      game: {
        game_phase: 'halftime',
        guided_state: { active: true, quarter: 3, kickingTeam: 'teamA',
                        receivingTeam: 'teamB', step: 'kickoff',
                        targetPhase: 'secondHalf' }
      }
    });
    await new Promise(r => setTimeout(r, 100));
    const routes = wayForward(h);
    if (!routes.length) {
      fail('lockup', 'a stale guided kickoff with no half divider left the ' +
           'page with no way forward');
    }
    h.close();
  }

  // --- ENDING THE GAME BETWEEN OVERTIME SERIES --------------------------
  // Reported 14 Aug 2026. The guided series panel comes up automatically
  // when a series ends and disables the rest of the page while it is
  // there -- including End game. So after the deciding series the only
  // way forward was to set up a series nobody was going to play.
  //
  // The option lives in the panel itself now, and is offered only when
  // the score is not level: a tie means another round, and finalizing
  // would refuse it anyway. Hiding it beats refusing after the fact.
  {
    const { enterPlay, setDrive, click, typeInto } = require('./ui_driver');
    const intoOt = async () => {
      const h = await bootGamePage();
      const { window: win, document: doc } = h;
      win.confirm = () => true; win.alert = () => {};
      h.evalIn("pushAndPersist({id:nextId++, text:'Q4', effect:{setQuarter:4}, quarter:4}); renderAll();");
      setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 30 });
      click(win, doc.getElementById('otUtilBtn'));
      click(win, doc.getElementById('ot_pickA'));
      await new Promise(r => setTimeout(r, 60));
      click(win, doc.getElementById('ot_review'));
      await new Promise(r => setTimeout(r, 80));
      return h;
    };

    // One team ahead: the option is there and it finalizes.
    {
      const h = await intoOt();
      const { window: win, document: doc } = h;
      enterPlay(h, { type: 'rush', carrier: '22', yards: '10', td: true });
      enterPlay(h, { type: 'pat', kicker: '3', result: 'g' });
      await new Promise(r => setTimeout(r, 90));
      click(win, doc.getElementById('ot_review'));
      await new Promise(r => setTimeout(r, 90));
      for (const y of ['1','2','1','1']) enterPlay(h, { type: 'rush', carrier: '30', yards: y });
      await new Promise(r => setTimeout(r, 90));
      const btn = doc.getElementById('ot_endgame');
      if (!btn){
        fail('overtime end game', 'no way to end the game from the between-series panel — it ' +
             'disables the rest of the page, so the only way on was to start a series nobody ' +
             'was going to play');
      } else {
        click(win, btn);
        await new Promise(r => setTimeout(r, 150));
        if (h.evalIn('gamePhase') !== 'ended'){
          fail('overtime end game', 'ending from the panel did not finalize the game');
        }
        const dividers = JSON.parse(h.evalIn('JSON.stringify(plays.filter(p=>p.isDivider).map(p=>p.text))'));
        if (dividers.indexOf('Final') === -1){
          fail('overtime end game', 'no Final divider was written: ' + dividers.join(', '));
        }
        if (h.document.getElementById('guidedPanel').style.display !== 'none'){
          fail('overtime end game', 'the guided panel is still up over a finished game — it ' +
               'must be closed BEFORE finalizing, or the re-render puts it straight back');
        }
      }
      h.close();
    }

    // Scores level: no option, and a line saying why.
    {
      const h = await intoOt();
      for (const y of ['1','2','1','1']) enterPlay(h, { type: 'rush', carrier: '22', yards: y });
      await new Promise(r => setTimeout(r, 90));
      if (h.document.getElementById('ot_endgame')){
        fail('overtime end game', 'the end-game option is offered with the scores level — the ' +
             'game cannot end on a tie, so this refuses after the click instead of before');
      }
      if (!/Scores level/.test(h.document.getElementById('guidedContent').textContent)){
        fail('overtime end game', 'nothing explains why the game cannot be ended yet');
      }
      h.close();
    }
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Game phase derived from the log ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) {
      console.log('  the phase always matches the plays; no state to go stale.');
    }
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
