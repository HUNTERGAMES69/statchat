// A foul during the play, entered in the tree
// ===========================================
// The two-play workaround -- enter the run, then enter the penalty -- gets
// the statistics wrong every time, and always in the same direction: the
// runner keeps the whole run. NFHS credits him to the POINT OF LEGAL
// ADVANCE:
//
//   "When yardage gained by rushing, passing or runbacks is involved with
//    penalty yardage to be assessed, the point at which the official
//    declares the run ends determines the point of legal advance."
//                                    -- NFHS Statisticians' Manual
//
// which is the LESSER of the end of the run and the spot of the foul.
//
// THE FIXTURES BELOW ARE THE MANUAL'S OWN TWO EXAMPLES, verbatim, because
// a rule this easy to state is also easy to implement backwards:
//
//   CD 1  ball B40, rush 15 to B25, clipping at B30  ->  10 rushing
//   CD 2  ball B30, rush 10 to B20, clipping at B15  ->  10 rushing
//
// CD 2 is the one that pins it down. The foul is BEYOND where the run
// ended, and the runner keeps all of it -- so an implementation that reads
// "credit up to the foul" and stops there passes CD 1 and fails here.
//
// The nullification rule is real and is a DIFFERENT rule: "On a foul by
// Team A, such as illegal motion, illegal shift, etc., the play is
// nullified and is not recorded." Pre-snap fouls. Those are not offered
// inside a play tree at all, which is the last check in this file.
//
//   node tests/penalty_in_tree_check.js

const { bootGamePage } = require('./harness');
const { click, typeInto, setDrive, pickPlayer } = require('./ui_driver');

// Drives the tree once. `spot` is {side, yardline} or null.
async function enterRushWithFoul(opts){
  const h = await bootGamePage();
  const { window: win, document: doc } = h;
  setDrive(h, { down: opts.down || 1, distance: opts.distance || 10,
                side: opts.losSide, yardline: opts.losYardline });
  click(win, doc.querySelector('.ptypeBtn[data-type="rush"]'));
  const panel = doc.getElementById('playPanel');
  pickPlayer(win, doc, 'carrier', '22');
  typeInto(win, doc.getElementById('pp_yards'), String(opts.runYards));
  if (opts.foul){
    click(win, panel.querySelector('#pp_pen_group .opt-toggle'));
    click(win, panel.querySelector('.penTreeTeam[data-team="' + opts.foul.on + '"]'));
    const sel = panel.querySelector('#pp_pen_type');
    sel.value = opts.foul.slug;
    sel.dispatchEvent(new win.Event('change'));
    click(win, panel.querySelector('.penTreeCall[data-call="' +
      (opts.foul.accepted ? 'accept' : 'decline') + '"]'));
    if (opts.foul.accepted && opts.foul.spot){
      click(win, panel.querySelector('.penTreeSpotSide[data-side="' + opts.foul.spot.side + '"]'));
      typeInto(win, panel.querySelector('#pp_pen_spot_yardline'), String(opts.foul.spot.yardline));
    }
  }
  const credited = opts.foul ? panel.querySelector('#pp_pen_credit').value : null;
  const readout  = opts.foul ? panel.querySelector('#pp_pen_readout').textContent : '';
  click(win, doc.getElementById('pp_review'));
  click(win, doc.getElementById('saveBtn'));
  return { h, win, doc, credited, readout };
}

async function run(){
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });
  const st = h => JSON.parse(h.evalIn(
    'JSON.stringify({down:computeState().down, distance:computeState().distance, ' +
    'fieldPos:computeState().fieldPos, pen:computeState().penalties, ' +
    'statYards:computeState().statYards})'));
  const rushing = h => JSON.parse(h.evalIn(
    'JSON.stringify(computeBoxScore(plays).teamA.rushing)'));
  const rows = h => JSON.parse(h.evalIn(
    'JSON.stringify(plays.map(function(p){return {text:p.text, effect:p.effect, roles:p.roles};}))'));

  // ---- CD 1 -----------------------------------------------------------
  // Ball on B's 40 (fieldPos 60). Rush 15 to B's 25. Clipping at B's 30
  // (fieldPos 70) -- behind the end of the run. Fifteen off the 30 puts
  // the ball on B's 45.
  {
    const { h, credited, readout } = await enterRushWithFoul({
      losSide: 'opp', losYardline: 40, runYards: 15,
      foul: { on: 'off', slug: 'clipping', accepted: true,
              spot: { side: 'opp', yardline: 30 } }
    });
    if (credited !== '10') fail('CD1', 'credited box should prefill 10, got ' + credited);
    if (!/credited 10/.test(readout)) fail('CD1', 'the readout does not show its working: ' + readout);
    const r = rushing(h);
    const line = r['N Runningback'];
    if (!line) fail('CD1', 'no rushing line at all: ' + JSON.stringify(r));
    else {
      if (line.att !== 1) fail('CD1', 'expected 1 rushing attempt, got ' + line.att);
      if (line.yds !== 10)
        fail('CD1', 'the manual credits 10 rushing yards, got ' + line.yds +
                    ' — crediting the whole run is the defect this exists to fix');
    }
    const s = st(h);
    if (s.pen.teamA.yds !== 15) fail('CD1', 'Team A should be charged 15 penalty yards, got ' + s.pen.teamA.yds);
    if (s.pen.teamA.count !== 1) fail('CD1', 'one penalty, got ' + s.pen.teamA.count);
    // fieldPos is possession-relative -- 0 is Team A's own goal, 100 is
    // Team B's -- so B's 45 is 100 - 45 = 55. Written out because the
    // first version of this line asserted 45 and the code was right.
    if (s.fieldPos !== 55) fail('CD1', "ball should end on B's 45 (fieldPos 55), got " + s.fieldPos);
    if (s.down !== 1) fail('CD1', 'the down is replayed on an accepted penalty, got down ' + s.down);
    if (s.statYards !== 0)
      fail('CD1', 'the drive gained nothing on this snap, so statYards must stay 0, got ' + s.statYards);
    // Two rows, in the order they happened.
    const rr = rows(h).filter(p => !p.effect || !p.effect.isReset);
    if (rr.length !== 2) fail('CD1', 'expected the snap and the penalty, got ' + rr.length + ' rows');
    else {
      if (!/rush for 10/.test(rr[0].text)) fail('CD1', 'row 1 should say the credited figure: ' + rr[0].text);
      if (!/run of 15/.test(rr[0].text)) fail('CD1', 'row 1 should still say what actually happened: ' + rr[0].text);
      if (rr[0].effect.isStat) fail('CD1', 'row 1 must not carry isStat — the ball-advancing math belongs to the penalty row');
      if (!rr[0].effect.settledByPenalty) fail('CD1', 'row 1 should be marked settledByPenalty');
      if (!/PENALTY, Clipping/.test(rr[1].text)) fail('CD1', 'row 2 should be the penalty: ' + rr[1].text);
      if (!/spot of the foul/.test(rr[1].text)) fail('CD1', 'row 2 should say it was spot-enforced: ' + rr[1].text);
    }
    h.close();
  }

  // ---- CD 2: the foul is BEYOND the end of the run --------------------
  // Ball on B's 30 (fieldPos 70). Rush 10 to B's 20. Clipping at B's 15
  // (fieldPos 85) -- past where the run ended. The runner keeps all ten.
  {
    const { h, credited, readout } = await enterRushWithFoul({
      losSide: 'opp', losYardline: 30, runYards: 10,
      foul: { on: 'off', slug: 'clipping', accepted: true,
              spot: { side: 'opp', yardline: 15 } }
    });
    if (credited !== '10')
      fail('CD2', 'credited should be the whole run, 10, got ' + credited +
                  ' — "credit up to the foul" passes CD 1 and fails here');
    if (!/at or beyond the end of the run/.test(readout))
      fail('CD2', 'the readout should say why all of it counts: ' + readout);
    const line = rushing(h)['N Runningback'];
    if (!line || line.yds !== 10) fail('CD2', 'expected 10 rushing yards, got ' + (line && line.yds));
    const s = st(h);
    if (s.pen.teamA.yds !== 15) fail('CD2', 'Team A charged 15, got ' + s.pen.teamA.yds);
    if (s.down !== 1) fail('CD2', 'down replayed, got ' + s.down);
    h.close();
  }

  // ---- a foul on the DEFENSE: the runner keeps what he gained ---------
  {
    const { h, credited } = await enterRushWithFoul({
      losSide: 'own', losYardline: 30, runYards: 8,
      foul: { on: 'def', slug: 'face_mask', accepted: true }
    });
    if (credited !== '8')
      fail('defensive', 'a defensive foul does not create a point of legal advance — ' +
                        'the runner keeps all 8, got ' + credited);
    const line = rushing(h)['N Runningback'];
    if (!line || line.yds !== 8) fail('defensive', 'expected 8 rushing yards, got ' + (line && line.yds));
    h.close();
  }

  // ---- DECLINED: one row, the play stands in full ----------------------
  {
    const { h } = await enterRushWithFoul({
      losSide: 'own', losYardline: 30, runYards: 15,
      foul: { on: 'off', slug: 'clipping', accepted: false }
    });
    const line = rushing(h)['N Runningback'];
    if (!line || line.yds !== 15)
      fail('declined', 'a declined penalty leaves the play whole — expected 15 rushing yards, got ' +
                       (line && line.yds));
    const s = st(h);
    if (s.pen.teamA.count !== 0)
      fail('declined', 'a declined penalty is not enforced and must not be counted, got ' +
                       s.pen.teamA.count);
    const rr = rows(h).filter(p => !p.effect || !p.effect.isReset);
    if (rr.length !== 1) fail('declined', 'expected one row, got ' + rr.length);
    else if (!/declined/i.test(rr[0].text))
      fail('declined', 'the log should still say a flag was thrown: ' + rr[0].text);
    h.close();
  }

  // ---- a replayed down is not a third-down attempt ---------------------
  {
    const { h } = await enterRushWithFoul({
      losSide: 'own', losYardline: 30, down: 3, distance: 8, runYards: 15,
      foul: { on: 'off', slug: 'clipping', accepted: true,
              spot: { side: 'own', yardline: 36 } }
    });
    const d = JSON.parse(h.evalIn('JSON.stringify(computeBoxScore(plays).teamB.oppDowns)'));
    if (d.d3att !== 0)
      fail('thirddown', 'a snap wiped by an accepted penalty is not a third-down attempt — ' +
                        'got d3att=' + d.d3att + '. Counting it charges a failed third down for ' +
                        'a down the chains never saw, and again when it is actually replayed');
    h.close();
  }

  // ---- NOT VACUOUS: an ordinary third down still counts ----------------
  {
    const { h } = await enterRushWithFoul({
      losSide: 'own', losYardline: 30, down: 3, distance: 8, runYards: 3, foul: null
    });
    const d = JSON.parse(h.evalIn('JSON.stringify(computeBoxScore(plays).teamB.oppDowns)'));
    if (d.d3att !== 1)
      fail('thirddown', 'an ordinary third-down rush must still be counted, got d3att=' + d.d3att +
                        ' — without this the skip above could be swallowing every third down');
    h.close();
  }

  // ---- Undo takes the pair --------------------------------------------
  {
    const { h, win, doc } = await enterRushWithFoul({
      losSide: 'opp', losYardline: 40, runYards: 15,
      foul: { on: 'off', slug: 'clipping', accepted: true,
              spot: { side: 'opp', yardline: 30 } }
    });
    const before = rows(h).length;
    click(win, doc.getElementById('undoBtn'));
    await new Promise(r => setTimeout(r, 30));
    const after = rows(h).length;
    if (before - after !== 2)
      fail('undo', 'one Save wrote two rows, so one Undo must take both — removed ' +
                   (before - after));
    const s = st(h);
    if (s.pen.teamA.count !== 0)
      fail('undo', 'the penalty is still counted after undo');
    if (Object.keys(rushing(h)).length !== 0)
      fail('undo', 'the rushing attempt survived the undo: ' + JSON.stringify(rushing(h)));
    h.close();
  }

  // ---- pre-snap fouls are not offered ---------------------------------
  // "On a foul by Team A, such as illegal motion, illegal shift, etc., the
  // play is nullified and is not recorded." Those have no play to attach
  // to, and offering one here invites the entry the manual forbids.
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 30 });
    click(win, doc.querySelector('.ptypeBtn[data-type="rush"]'));
    const panel = doc.getElementById('playPanel');
    click(win, panel.querySelector('#pp_pen_group .opt-toggle'));
    click(win, panel.querySelector('.penTreeTeam[data-team="off"]'));
    const slugs = [...panel.querySelector('#pp_pen_type').options].map(o => o.value);
    ['false_start', 'illegal_motion', 'illegal_shift', 'delay_of_game'].forEach(bad => {
      if (slugs.includes(bad))
        fail('presnap', bad + ' is offered inside the play tree — a pre-snap foul ' +
                        'nullifies the play and is not recorded, and it has no play to ' +
                        'attach to in the first place');
    });
    ['clipping', 'holding', 'face_mask'].forEach(good => {
      if (!slugs.includes(good))
        fail('presnap', good + ' is missing — the filter has taken out fouls that ' +
                        'happen during the play');
    });
    h.close();
  }

  console.log('=== A foul during the play, in the tree ===\n');
  if (!failures.length){
    console.log("  both of the manual's worked examples reproduce, a defensive foul\n" +
                '  leaves the run whole, a declined penalty leaves the play and the\n' +
                '  team totals alone, the replayed down is not counted as an attempt\n' +
                '  while an ordinary third down still is, Undo takes the pair, and no\n' +
                '  pre-snap foul is offered where it would nullify the play.\n');
  } else {
    failures.forEach(f => console.log('  FAIL [' + f.area + '] ' + f.detail));
    console.log('\nFailures: ' + failures.length);
  }
  process.exit(failures.length ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
