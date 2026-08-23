// Coverage probe
// --------------
// Drives EVERY play type and sub-flow the UI offers, each from a clean
// drive, and reports what actually happened: did it save, what did the
// log line say, what stats moved, and what did it do to game state.
//
// The scripted game covers a realistic sequence; this covers the
// surface area. Several of these paths -- fumble-during-rush/pass/sack,
// blocked kicks, 2-point conversions, safeties -- have never been
// exercised by any automated test, so "does this path even work" is a
// genuinely open question rather than a regression check.

const { bootGamePage } = require('./harness');
const { enterPlay, setDrive, UnreachableByUI } = require('./ui_driver');

// Every case starts from Neville (teamA) 1st & 10 at own 40, so results
// are comparable and nothing is near a goal line by accident.
const START = { down: 1, distance: 10, side: 'own', yardline: 40 };

const CASES = [
  // --- Rush ---------------------------------------------------------
  ['rush plain',              { type: 'rush', carrier: '22', yards: '9' }],
  ['rush touchdown',          { type: 'rush', carrier: '22', yards: '60', td: true }],
  ['rush loss',               { type: 'rush', carrier: '22', yards: '-4' }],
  ['rush safety',             { type: 'rush', carrier: '22', yards: '-5', safety: true }],
  ['rush fumble, own recover',{ type: 'rush', carrier: '22', yards: '5', fumbled: true, fumrec: 'own' }],
  ['rush fumble, opp recover',{ type: 'rush', carrier: '22', yards: '5', fumbled: true, fumrec: 'opp', credit: '55' }],
  ['rush fumble, opp ret TD', { type: 'rush', carrier: '22', yards: '5', fumbled: true, fumrec: 'opp', credit: '55', retyds: '40', fumTd: true }],

  // --- Pass ---------------------------------------------------------
  ['pass complete',           { type: 'pass', passer: '7', receiver: '80', yards: '14' }],
  ['pass touchdown',          { type: 'pass', passer: '7', receiver: '80', yards: '60', td: true }],
  ['pass incomplete',         { type: 'pass', passer: '7', receiver: '80', incomplete: true }],
  ['pass safety',             { type: 'pass', passer: '7', receiver: '80', yards: '-6', safety: true }],
  ['pass fumble, own recover',{ type: 'pass', passer: '7', receiver: '80', yards: '8', fumbled: true, fumrec: 'own' }],
  ['pass fumble, opp recover',{ type: 'pass', passer: '7', receiver: '80', yards: '8', fumbled: true, fumrec: 'opp', credit: '55' }],

  // --- Sack ---------------------------------------------------------
  ['sack plain',              { type: 'sack', passer: '7', yards: '7', credit: '55' }],
  ['sack safety',             { type: 'sack', passer: '7', yards: '8', safety: true }],
  ['sack fumble, own recover',{ type: 'sack', passer: '7', yards: '6', fumbled: true, fumrec: 'own' }],
  ['sack fumble, opp recover',{ type: 'sack', passer: '7', yards: '6', fumbled: true, fumrec: 'opp', credit: '55' }],

  // --- Turnovers ----------------------------------------------------
  ['interception',            { type: 'int', passer: '7', credit: '21', yards: '12' }],
  ['interception ret TD',     { type: 'int', passer: '7', credit: '21', yards: '60', td: true }],
  ['fumble, opp recover',     { type: 'fumble', carrier: '22', credit: '99', yards: '3' }],
  ['fumble, own recover',     { type: 'fumble', carrier: '22', fumrec: 'own' }],
  ['fumble ret TD',           { type: 'fumble', carrier: '22', credit: '99', yards: '60', td: true }],

  // --- Kickoff ------------------------------------------------------
  // The five entries carrying a `spot` do so because the takeover spot
  // became MANDATORY on kickoffs and punts on 13 Aug 2026. Without it
  // Review refuses the play and the path reads as unreachable, which is
  // a stale fixture rather than a hole in the UI. The touchback and
  // return-touchdown variants need no spot -- one is prefilled, the
  // other has no ensuing drive -- which is why only these five broke.
  ['kickoff returned',        { type: 'kickoff', kicker: '3', yards: '55', credit: '25', retyds: '18',
                               spot: { side: 'own', yardline: '25' } }],
  ['kickoff touchback',       { type: 'kickoff', kicker: '3', yards: '65', touchback: true }],
  ['kickoff return TD',       { type: 'kickoff', kicker: '3', yards: '50', credit: '25', retyds: '50', td: true }],

  // --- Punt ---------------------------------------------------------
  ['punt returned',           { type: 'punt', punter: '15', yards: '38', credit: '25', retyds: '9',
                               spot: { side: 'own', yardline: '31' } }],
  ['punt return TD',          { type: 'punt', punter: '15', yards: '38', credit: '25', retyds: '55', td: true }],
  ['punt blocked, opp rec',   { type: 'punt', punter: '15', blocked: true, blockrec: 'opp', credit: '55', retyds: '10',
                               spot: { side: 'own', yardline: '40' } }],
  ['punt blocked, opp rec TD',{ type: 'punt', punter: '15', blocked: true, blockrec: 'opp', credit: '55', retyds: '35', td: true }],
  ['punt blocked, own rec',   { type: 'punt', punter: '15', blocked: true, blockrec: 'own',
                               spot: { side: 'own', yardline: '40' } }],
  // Added 14 Aug 2026 with the interception touchback: caught in the end
  // zone and downed, the defence takes over at their own 20 with no
  // return to record.
  ['int touchback',           { type: 'int', passer: '7', credit: '55', intTouchback: true }],
  // A muffed/bad snap recovered by the KICKING team in their own end
  // zone -- two points, the mirror of the blocked-punt safety beside it.
  ['punt muffed, safety',     { type: 'punt', punter: '15', yards: '0', muffed: true,
                               muffrec: 'k', muffrecoverer: '15', safety: true }],
  // NO SPOT, deliberately. A safety ends the play in the end zone and a
  // FREE KICK follows, so there is no takeover spot to give. This entry
  // was given one on 14 Aug 2026 while repairing fixtures that the new
  // mandatory-spot rule had broken -- and that quietly papered over a
  // real bug: the rule was demanding a spot here, making the blocked-punt
  // safety unenterable. Supplying one made an unreachable path look
  // reachable. If this ever needs a spot again to pass, the rule has
  // regressed; do not add one.
  // The MUFF safety, added to the probe 14 Aug 2026. Its blocked sibling
  // was already here; this one was correct, wired, and covered by nothing
  // -- which is a large part of why nobody could find it on the panel.
  ['punt muffed, own rec, safety', { type:'punt', punter:'15', muffed:true, muffrec:'k', safety:true }],
  ['punt blocked, safety',    { type: 'punt', punter: '15', blocked: true, blockrec: 'own', safety: true }],

  // --- Kicking ------------------------------------------------------
  ['field goal good',         { type: 'fg', kicker: '3', yards: '38', result: 'g' }],
  ['field goal missed',       { type: 'fg', kicker: '3', yards: '48', result: 'x' }],
  ['field goal blocked',      { type: 'fg', kicker: '3', yards: '44', blocked: true, credit: '55' }],
  ['field goal blocked ret TD',{ type: 'fg', kicker: '3', yards: '44', blocked: true, credit: '55', retyds: '60', td: true }],
  ['PAT good',                { type: 'pat', kicker: '3', result: 'g' }],
  ['PAT missed',              { type: 'pat', kicker: '3', result: 'x' }],
  ['PAT blocked',             { type: 'pat', kicker: '3', blocked: true, credit: '55' }],

  // --- Two-point conversions ----------------------------------------
  // The two 2PT turnover paths were removed from the tree on 23 Aug --
  // NFHS ends a try when the defence gains possession, so there is
  // no return and no score to describe. Nothing reaches them now.
  ['2pt rush good',           { type: 'twopt', sub: 'rush', carrier: '22', result: 'g' }],
  ['2pt rush failed',         { type: 'twopt', sub: 'rush', carrier: '22', result: 'x' }],
  // NFHS: a try ends when the defense gains possession, so there is no
  // defensive score to reach. The turnover itself is still recorded.
  ['2pt pass good',           { type: 'twopt', sub: 'pass', passer: '7', receiver: '80', result: 'g' }],
  ['2pt pass failed',         { type: 'twopt', sub: 'pass', passer: '7', receiver: '80', result: 'x' }],

  // --- Utilities ----------------------------------------------------
  ['safety (standalone)',     { type: 'safety', credit: '55' }],
  ['penalty on offense',      { type: 'penalty', on: 'offense', yards: '10' }],
  ['penalty on defense',      { type: 'penalty', on: 'defense', yards: '5' }]
];

function summariseStats(box) {
  const out = [];
  for (const team of ['teamA', 'teamB']) {
    for (const cat of ['rushing', 'passing', 'receiving', 'defense', 'specialTeams']) {
      const b = box[team][cat] || {};
      for (const num of Object.keys(b)) {
        const kv = Object.entries(b[num])
          .filter(([k]) => k !== 'long' && k !== 'puntsWithYards')
          .map(([k, v]) => k + '=' + v).join(' ');
        if (kv) out.push(team.slice(4) + '/' + cat.slice(0, 4) + '#' + num + ' ' + kv);
      }
    }
  }
  return out;
}

async function run() {
  const rows = [];
  for (const [name, spec] of CASES) {
    const h = await bootGamePage();
    let rec = { name, spec };
    try {
      setDrive(h, START);
      const before = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
      const res = enterPlay(h, spec);
      const after = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
      // computeBoxScore lives in the report pages, not game.html, so
      // recompute here from the same persisted rows those pages read.
      const plays = JSON.parse(h.evalIn('JSON.stringify(plays)'));
      rec.saved = res.saved;
      rec.reason = res.reason;
      rec.text = res.parsedText;
      rec.warning = res.warning;
      rec.before = before;
      rec.after = after;
      rec.plays = plays;
      // THE BOX SCORE ITSELF, not just its inputs. engine.js is loaded by
      // the page, so this is the same computeBoxScore the report pages
      // run. Without it a bug INSIDE computeBoxScore stays invisible --
      // the roles feeding it look right and the printed number is still
      // wrong, which is the harder half of the problem to find.
      rec.box = JSON.parse(h.evalIn('JSON.stringify(computeBoxScore(plays))'));
      rec.alerts = h.alerts.slice();
    } catch (e) {
      rec.error = (e instanceof UnreachableByUI ? 'UNREACHABLE: ' : 'THREW: ') + e.message;
    }
    h.close();
    rows.push(rec);
  }
  return rows;
}

if (require.main === module) {
  run().then(rows => {
    const bad = [];
    console.log('=== UI path coverage probe ===\n');
    for (const r of rows) {
      if (r.error) {
        console.log('  XX  ' + r.name.padEnd(28) + r.error);
        bad.push(r);
        continue;
      }
      if (!r.saved) {
        console.log('  XX  ' + r.name.padEnd(28) + 'NOT SAVED -- ' + (r.reason || 'unknown'));
        bad.push(r);
        continue;
      }
      const a = r.after;
      const dd = a.down ? a.down + '&' + a.distance + '@' + a.fieldPos : 'no drive';
      console.log('  ok  ' + r.name.padEnd(28) + dd.padEnd(14) +
                  'poss=' + a.possession.slice(4) +
                  ' score=' + a.scores.teamA + '-' + a.scores.teamB);
      console.log('      ' + (r.text || '').slice(0, 120));
      if (r.warning) console.log('      WARN: ' + r.warning.slice(0, 110));
      if (r.alerts && r.alerts.length) console.log('      ALERT: ' + r.alerts.join(' / ').slice(0, 110));
    }
    console.log('\n=== ' + (CASES.length - bad.length) + '/' + CASES.length + ' paths reached and saved ===');
    if (bad.length) bad.forEach(b => console.log('  unreached: ' + b.name));
    process.exitCode = bad.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run, CASES, START, summariseStats };
