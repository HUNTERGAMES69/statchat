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

  // REVIEW MUST NEVER REFUSE SILENTLY.
  // ---------------------------------------------------------------------
  // Every tree guarded its required player with a bare `return` -- eleven
  // of them. Pressing Review with no ball carrier, passer, punter or
  // kicker did nothing at all: no message, no confirm box, no clue which
  // field was wanted. Reported as "it fails silently", and it is the most
  // common way to meet it, since the player is the first thing skipped
  // when moving fast.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    const probe = async (type, prep) => {
      setDrive(h, { down: 4, distance: 8, side: 'own', yardline: 30 });
      click(win, doc.querySelector('.ptypeBtn[data-type="' + type + '"]'));
      if (prep) prep();
      click(win, doc.getElementById('pp_review'));
      await new Promise(r => setTimeout(r, 150));
      const top = ((doc.getElementById('gameMsg') || {}).textContent || '').trim();
      const row = doc.querySelector('#playPanel .row-gap-msg');
      // NOT AT THE TOP OF THE PAGE. A copy up there was kept as a
      // backstop and caused the very problem it was meant to cover:
      // writing into gameMsg grows the top of the document, which moves
      // the panel under the scorer's thumb at the moment they are reading
      // a refusal. Reported directly.
      if (top) {
        fail('silent:' + type + ':top', 'the refusal should not be written at the top of the page: ' + JSON.stringify(top));
      }
      if (!row) fail('silent:' + type + ':row', 'nothing marked the row that is missing a player');
      // AND BESIDE REVIEW. On a tall tree the top of the page is
      // off-screen at the moment Review is pressed, so a message only up
      // there reads as the button not working.
      const rv = doc.getElementById('pp_review_msg');
      if (!rv || win.getComputedStyle(rv).display === 'none' || !/still needed/i.test(rv.textContent)) {
        fail('silent:' + type + ':review', 'nothing said beside the Review button');
      }
      // Directly under the button, not somewhere else on the panel.
      const btnRow = doc.getElementById('pp_review').closest('.row');
      if (!btnRow || btnRow.nextElementSibling !== rv) {
        fail('silent:' + type + ':place', 'the message should sit under the Review row');
      }
      // And it must not have opened the confirm box on an incomplete play.
      if (doc.getElementById('confirmCard').style.display !== 'none') {
        fail('silent:' + type + ':confirm', 'the confirm box opened on an incomplete play');
      }
      click(win, doc.getElementById('phaseClearBtn'));
      await new Promise(r => setTimeout(r, 80));
    };
    await probe('punt', () => typeInto(win, doc.getElementById('pp_yards'), '38'));
    await probe('rush', () => typeInto(win, doc.getElementById('pp_yards'), '5'));
    await probe('pass');

    // The warning clears as soon as the field is answered -- one that
    // outlives the problem teaches people to ignore warnings.
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    click(win, doc.querySelector('.ptypeBtn[data-type="rush"]'));
    click(win, doc.getElementById('pp_review'));
    await new Promise(r => setTimeout(r, 120));
    if (!doc.querySelector('#playPanel .row-gap-msg')) fail('silent:setup', 'expected a warning to clear');
    click(win, doc.querySelector('.pp_carrier_pick'));
    await new Promise(r => setTimeout(r, 60));
    if (doc.querySelector('#playPanel .row-gap-msg')) {
      fail('silent:persists', 'the warning should clear once the player is picked');
    }

    // CLEAR TAKES THE ERROR WITH THE TREE. "Still needed: the punter" is
    // a statement about a panel that no longer exists. The commonest way
    // to meet it is opening the WRONG tree, noticing because a field is
    // missing, and clearing -- and the complaint then follows you onto
    // the right tree, where it is false. Reported directly.
    setDrive(h, { down: 4, distance: 8, side: 'own', yardline: 30 });
    click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
    typeInto(win, doc.getElementById('pp_yards'), '38');
    click(win, doc.getElementById('pp_review'));
    await new Promise(r => setTimeout(r, 150));
    const gm = () => ((doc.getElementById('gameMsg') || {}).textContent || '').trim();
    const rvNow = () => {
      const e = doc.getElementById('pp_review_msg');
      return e && win.getComputedStyle(e).display !== 'none' ? e.textContent.trim() : '';
    };
    if (!/still needed/i.test(rvNow())) fail('clear:setup', 'expected an entry error to clear');
    click(win, doc.getElementById('phaseClearBtn'));
    await new Promise(r => setTimeout(r, 150));
    if (rvNow()) fail('clear:stale', 'Clear left the entry error up: ' + JSON.stringify(rvNow()));
    if (doc.querySelector('.row-gap-msg') || doc.querySelector('.row-gap')) {
      fail('clear:rowmark', 'Clear left a row still marked as missing something');
    }
    if (doc.getElementById('fieldPosWarning').style.display !== 'none') {
      fail('clear:fieldwarn', 'Clear left the panel warning up');
    }
    const rvAfter = doc.getElementById('pp_review_msg');
    if (rvAfter && win.getComputedStyle(rvAfter).display !== 'none') {
      fail('clear:reviewmsg', 'Clear left the message beside Review up');
    }

    // But a GAME notice must survive it. gameMsg also carries things that
    // outlive a panel -- halftime, connectivity, save failures -- and
    // those are about the game, not the tree that was open.
    h.evalIn("showMsg('gameMsg','Back to halftime. Use Start 2nd half.','info');");
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    click(win, doc.getElementById('phaseClearBtn'));
    await new Promise(r => setTimeout(r, 150));
    if (!/halftime/i.test(gm())) {
      fail('clear:overreach', 'Clear removed a game notice it should have left: ' + JSON.stringify(gm()));
    }
    h.close();
  }

  // A QB KNEEL DEFAULTS TO NO LOSS. The kneel is nearly always taken at
  // the spot, so the common case should need no typing. The field used to
  // be empty with a placeholder of 1, which asked for a number every time
  // and suggested the wrong one -- and an emptied box charged a yard
  // nobody had entered.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 40 });
    click(win, doc.getElementById('kneelUtilBtn'));
    if (doc.getElementById('kneel_yds').value !== '0') {
      fail('kneel:prefill', 'the yards field should start at 0, got ' +
        JSON.stringify(doc.getElementById('kneel_yds').value));
    }
    const kneel = async (prep) => {
      click(win, doc.getElementById('kneelUtilBtn'));
      if (prep) prep();
      click(win, doc.getElementById('kneel_review'));
      await new Promise(r => setTimeout(r, 150));
      click(win, doc.getElementById('saveBtn'));
      await new Promise(r => setTimeout(r, 180));
      return h.evalIn('plays[plays.length-1].text');
    };
    click(win, doc.getElementById('kneel_clear'));
    const asGiven = await kneel();
    if (!/no gain/.test(asGiven)) fail('kneel:default', 'an untouched kneel should lose nothing: ' + asGiven);
    // An EMPTIED box means the same as the 0 it replaced. This is the
    // case that used to charge a yard silently.
    const emptied = await kneel(() => typeInto(win, doc.getElementById('kneel_yds'), ''));
    if (!/no gain/.test(emptied)) fail('kneel:emptied', 'an emptied box should still mean no loss: ' + emptied);
    // And a real loss still records -- a default of 0 must not swallow one.
    const typed = await kneel(() => typeInto(win, doc.getElementById('kneel_yds'), '2'));
    if (!/loss of 2/.test(typed)) fail('kneel:typed', 'a typed loss should survive: ' + typed);
    // Three kneels, one loss: the team bucket must reconcile.
    const rush = JSON.parse(h.evalIn('JSON.stringify(computeBoxScore(plays).teamA.rushing)'));
    if (!rush.TEAM || rush.TEAM.att !== 3 || rush.TEAM.yds !== -2) {
      fail('kneel:box', 'expected 3 team rushes for -2, got ' + JSON.stringify(rush.TEAM));
    }
    h.close();
  }

  // OFFSIDE, on all three sides at 5 yards. Added 22 Aug on Andy's call:
  // officials and crews say "offside", and a scorer who hears it should be
  // able to enter it without first translating it into encroachment. The
  // NFHS book uses false start and encroachment for scrimmage, which is
  // true and beside the point in a press box.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });

    const optionsFor = async (side) => {
      click(win, doc.getElementById('penUtilBtn'));
      click(win, doc.querySelector('.penTeamBtn[data-team="' + side + '"]'));
      await new Promise(r => setTimeout(r, 80));
      const sel = doc.getElementById('pen_type');
      const opts = sel ? [...sel.options].map(o => o.textContent.trim()) : [];
      return { sel, opts };
    };

    for (const side of ['off', 'def']) {
      const { sel, opts } = await optionsFor(side);
      const offsides = opts.filter(o => /offside/i.test(o));
      if (!offsides.includes('Offside')) {
        fail('offside:' + side, 'no scrimmage Offside offered to the ' + side + ': ' + offsides.join(' | '));
      }
      if (!offsides.includes('Offside (free kick)')) {
        fail('offside:' + side + ':kick', 'no free-kick Offside offered: ' + offsides.join(' | '));
      }
      // Exactly two, and DISTINCTLY NAMED. Three entries -- one per team
      // plus kicking -- put two identically-labelled "Offside" options in
      // front of the scorer, which is a choice with no right answer.
      if (offsides.length !== 2 || offsides[0] === offsides[1]) {
        fail('offside:' + side + ':dupe', 'offside entries must be two and distinct: ' + offsides.join(' | '));
      }
      // Picking it fills 5 yards and logs as Offside.
      // GUARDED: without this the suite THREW when the foul was missing
      // rather than failing, which stops every later check and reports
      // nothing useful. A test that crashes is worse than one that fails.
      const opt = [...sel.options].find(o => o.textContent.trim() === 'Offside');
      if (!opt) { click(win, doc.getElementById('phaseClearBtn')); continue; }
      sel.value = opt.value;
      sel.dispatchEvent(new win.Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 80));
      if (doc.getElementById('pen_yds').value !== '5') {
        fail('offside:' + side + ':yards', 'offside should auto-fill 5 yards, got ' +
          JSON.stringify(doc.getElementById('pen_yds').value));
      }
      click(win, doc.getElementById('pen_review'));
      await new Promise(r => setTimeout(r, 120));
      click(win, doc.getElementById('saveBtn'));
      await new Promise(r => setTimeout(r, 180));
      const text = h.evalIn('plays[plays.length-1].text');
      if (!/Offside/.test(text)) fail('offside:' + side + ':log', 'the log should name the foul: ' + text);
    }

    // The dead-ball toggle is a short wrapped label on a narrow box, not a
    // sentence running the width of the panel.
    click(win, doc.getElementById('penUtilBtn'));
    click(win, doc.querySelector('.penTeamBtn[data-team="off"]'));
    await new Promise(r => setTimeout(r, 80));
    const db = doc.getElementById('pen_no_down_toggle');
    if (!db) fail('deadball:missing', 'no dead-ball toggle');
    else {
      // ONE SHORT LINE. Two earlier versions were both too long: first a
      // whole sentence, then a shortened label that still wrapped onto a
      // second line and made the button taller than the two beneath it.
      const c = win.getComputedStyle(db);
      const label = db.textContent.trim();
      if (label !== 'Dead Ball / After Play') {
        fail('deadball:label', 'unexpected label: ' + JSON.stringify(label));
      }
      if (c.whiteSpace !== 'nowrap') {
        fail('deadball:wrap', 'the label should be short enough not to wrap');
      }
      // What it DOES belongs in the title, readable on demand.
      if (!/down and distance/i.test(db.getAttribute('title') || '')) {
        fail('deadball:title', 'the explanation should survive in the tooltip');
      }
    }
    h.close();
  }

  // A TIMEOUT IS REVIEWED BEFORE IT IS WRITTEN. It used to go straight to
  // the log, on the reasoning that there was nothing to get wrong. The
  // thing to get wrong is WHICH TEAM: the two buttons sit side by side,
  // and a mis-tap spends a timeout that team still has while hiding one
  // it does not -- visible immediately on the banner, the live totals and
  // the broadcast feed.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    const before = h.evalIn('plays.length');

    click(win, doc.getElementById('timeoutUtilBtn'));
    await new Promise(r => setTimeout(r, 80));
    click(win, doc.querySelector('.toTeamBtn[data-team="teamA"]'));
    await new Promise(r => setTimeout(r, 80));
    if (h.evalIn('plays.length') !== before) {
      fail('timeout:written', 'picking a team should not write the timeout yet');
    }
    const toSave = doc.getElementById('to_save'), toBack = doc.getElementById('to_back');
    if (!toSave || !toBack) {
      // Guarded, not clicked blind: the driver THROWS on a missing
      // element, which stops the suite and reports nothing.
      fail('timeout:review', 'the review step needs Save and Back');
      h.close();
      return failures;
    }
    if (!/Neville/.test(doc.getElementById('playPanel').textContent)) {
      fail('timeout:names', 'the review should name the team being charged');
    }

    // BACK REOPENS THE PICKER rather than closing -- the likeliest reason
    // to press it is the wrong team, and closing would make correcting it
    // two taps instead of one.
    click(win, doc.getElementById('to_back'));
    await new Promise(r => setTimeout(r, 80));
    if (!doc.querySelector('.toTeamBtn')) fail('timeout:back', 'Back should return to the team picker');
    if (h.evalIn('plays.length') !== before) fail('timeout:back-wrote', 'Back must not write anything');

    // And the corrected team is the one charged.
    click(win, doc.querySelector('.toTeamBtn[data-team="teamB"]'));
    await new Promise(r => setTimeout(r, 80));
    click(win, doc.getElementById('to_save'));
    await new Promise(r => setTimeout(r, 200));
    const to = JSON.parse(h.evalIn('JSON.stringify(computeState().timeouts)'));
    if (to.teamA !== 3 || to.teamB !== 2) {
      fail('timeout:charged', 'the corrected team should be charged, got ' + JSON.stringify(to));
    }
    h.close();
  }

  // THE SACK TREE HAS THE 0-9 PAD. It was missing only because that
  // branch calls yardsBlock directly, and the pad is added by the call
  // site rather than by yardsBlock -- so every panel that wants it has to
  // ask. A sack is a yardage entry like any other.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    const sackBtn = [...doc.querySelectorAll('#playPanel button')]
      .find(b => /^Sacked$/.test(b.textContent.trim()));
    if (!sackBtn) { fail('sack:toggle', 'no Sacked toggle'); h.close(); return failures; }
    click(win, sackBtn);
    await new Promise(r => setTimeout(r, 100));
    const digits = [...doc.querySelectorAll('#playPanel .quickYardsBtn')];
    if (digits.length !== 10) {
      fail('sack:pad', 'expected a 0-9 pad on the sack tree, got ' + digits.length + ' buttons');
    } else {
      if (digits[0].dataset.for !== 'pp_yards') {
        fail('sack:pad-target', 'the pad should fill the yards-lost box, got ' + digits[0].dataset.for);
      }
      click(win, digits[7]);
      if (doc.getElementById('pp_yards').value !== '7') {
        fail('sack:pad-click', 'tapping 7 should enter 7, got ' + JSON.stringify(doc.getElementById('pp_yards').value));
      }
    }
    h.close();
  }

  // THE LADDER IS ONE CHOICE, AND PRESSING IT AGAIN PUTS IT BACK.
  // ---------------------------------------------------------------------
  // Two faults reported together on 23 Aug: Manual entry could be opened
  // ON TOP of an open tree -- two panels claiming the screen, with the
  // code buffer written by whichever was touched last -- and an open tree
  // could not be shut by pressing its own button, so the only way out was
  // Clear, which is not where a scorer looks.
  //
  // Collapsing DISCARDS, exactly as Clear does (Andy's call).
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    const panelUp = () => doc.getElementById('playPanel').style.display !== 'none';
    const manualUp = () => doc.getElementById('manualPanel').style.display !== 'none';
    // A leading dot means a selector, anything else is an id. The first
    // version treated every string as an id and threw on the selectors.
    const tap = sel => click(win, sel[0] === '.'
      ? doc.querySelector(sel) : doc.getElementById(sel));

    tap('.ptypeBtn[data-type="rush"]');
    await new Promise(r => setTimeout(r, 70));
    if (!panelUp()) fail('ladder:open', 'Rush should open a tree');

    // Manual entry shuts the tree rather than stacking on it.
    tap('manualBtn');
    await new Promise(r => setTimeout(r, 70));
    if (panelUp()) fail('ladder:stack', 'opening Manual entry should close the open tree');
    if (!manualUp()) fail('ladder:manual', 'Manual entry should open');
    tap('manualBtn');
    await new Promise(r => setTimeout(r, 70));
    if (manualUp()) fail('ladder:manual-toggle', 'pressing Manual entry again should close it');

    // Press-again collapses, and press once more reopens.
    tap('.ptypeBtn[data-type="punt"]');
    await new Promise(r => setTimeout(r, 70));
    typeInto(win, doc.getElementById('pp_yards'), '17');
    tap('.ptypeBtn[data-type="punt"]');
    await new Promise(r => setTimeout(r, 70));
    if (panelUp()) fail('ladder:collapse', 'pressing the open tree again should collapse it');
    tap('.ptypeBtn[data-type="punt"]');
    await new Promise(r => setTimeout(r, 70));
    if (!panelUp()) fail('ladder:reopen', 'pressing it a third time should reopen it');
    // DISCARDED, like Clear -- not preserved.
    const yards = (doc.getElementById('pp_yards') || {}).value;
    if (yards) fail('ladder:discard', 'collapsing should discard entered values, found ' + JSON.stringify(yards));

    // The utility buttons are on the ladder too and answer to the same
    // rule. They are wired in the capture phase, which is easy to get
    // subtly wrong, so both directions are checked.
    tap('penUtilBtn');
    await new Promise(r => setTimeout(r, 70));
    if (!/which team|on offense/i.test(doc.getElementById('playPanel').textContent)) {
      fail('ladder:util-open', 'Penalty should replace the open tree');
    }
    tap('penUtilBtn');
    await new Promise(r => setTimeout(r, 70));
    if (panelUp()) fail('ladder:util-collapse', 'pressing Penalty again should collapse it');

    // AND A SAVED PLAY LEAVES THE LADDER READY. Saving closes the panel by
    // its own route, and without clearing the ladder state the next press
    // of the SAME button collapsed nothing instead of opening it -- two
    // rushes in a row, which is most of a game, entered only the first.
    enterPlay(h, { type: 'rush', carrier: '22', yards: '5' });
    tap('.ptypeBtn[data-type="rush"]');
    await new Promise(r => setTimeout(r, 70));
    if (!panelUp()) fail('ladder:after-save', 'the same tree should open again after a save');
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
