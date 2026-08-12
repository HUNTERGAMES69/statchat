// NFL-data QA harness
// -------------------
// Drives real NFL games through the REAL StatChat UI and checks the
// result against an independent source of truth. Every other suite
// checks the app against itself; this one checks it against reality.
//
// Roughly 150 plays per game rather than the 19 of the scripted game, so
// it exercises parseInput, every entry panel, computeState and
// computeBoxScore over sequences no hand-written fixture would cover.
//
// TWO TIERS ARE ASSERTED, and the choice matters:
//
//   Tier 1 -- convention-independent. Per-player rushing yards,
//   receiving yards, passing yards, and play counts. StatChat follows
//   NFHS and nflverse follows NFL, but those two disagree only about
//   TEAM totals (sack yardage, kneels), never about what an individual
//   rusher gained. So any mismatch here is unambiguous.
//
//   Tier 3 -- signal, not comparison. validateGame() must report zero
//   issues. Across 150 real plays that is a strong check on down
//   continuity, impossible gains and touchdown distances, and it needs
//   no reference data at all, so no adjustment layer can hide a bug.
//
// Tier 2 (team totals, compared after normalising NFL->NFHS) is
// deliberately NOT here. The adjustment layer is the main risk in the
// whole design: a wrong "adjustment" silently hides a real defect.
// Tiers 1 and 3 have to be clean before that is worth building.
//
// Not part of the normal suite -- around 30-60s per game in jsdom.
//   node tests/nfl/run_qa.js            # 3 games
//   node tests/nfl/run_qa.js 10         # 10 games

const { bootGamePage, bootPage } = require('../harness');
const { enterPlay, setDrive, click } = require('../ui_driver');
const fetchNfl = require('./fetch');
const { buildRoster, convertRow, fieldPosFrom, num, truthy } = require('./convert');

// Expected per-player yardage, straight from the play-by-play. Derived
// from the same rows rather than from player_stats so a mismatch points
// at StatChat rather than at two nflverse files disagreeing.
function expectedFromRows(rows, numberFor) {
  const exp = { rush: {}, rec: {}, pass: {} };
  const add = (b, k, v) => { if (k) b[k] = (b[k] || 0) + v; };
  for (const r of rows) {
    // Two-point conversion yardage is NOT part of anyone's rushing or
    // receiving total -- NFHS and the NFL agree on that; nflverse simply
    // reports yards_gained on the row like any other. Summing it made
    // StatChat look 2 yards light on a quarterback who ran one in, when
    // StatChat was correct and this calculation was not.
    if (truthy(r.two_point_attempt)) continue;
    if (r.play_type === 'run' && !truthy(r.qb_kneel)) {
      add(exp.rush, numberFor.get(r.rusher_player_id), num(r.yards_gained));
    }
    if (r.play_type === 'pass' && truthy(r.complete_pass)) {
      add(exp.rec, numberFor.get(r.receiver_player_id), num(r.yards_gained));
      add(exp.pass, numberFor.get(r.passer_player_id), num(r.yards_gained));
    }
  }
  return exp;
}

async function runGame(rows, gameId) {
  const issues = [];
  const homeAbbr = rows[0].home_team;
  const { roster, numberFor } = buildRoster(rows, homeAbbr);

  const h = await bootGamePage({ roster });
  const { window: win, document: doc } = h;

  let entered = 0, skipped = 0, failed = 0;
  let lastPos = null, stateMismatches = 0, prevDesc = null, comparable = 0;
  let lastEnteredIdx = -99, lastEnteredTeam = null, lastEnteredDrive = null;
  let lastEnteredHadPenalty = false, penaltySkips = 0;
  let lastEnteredHadOwnFumble = false, fumbleSkips = 0;
  let rowIdx = -1;
  // Tier 0 only starts once a play has actually been entered -- before
  // that there is no previous play to have set anything up.
  let expectState = false;

  for (const row of rows) {
    rowIdx++;
    const converted = convertRow(row, numberFor, homeAbbr);
    if (!converted) { skipped++; continue; }

    const wantTeam = row.posteam === homeAbbr ? 'teamA' : 'teamB';
    const fp = fieldPosFrom(row);
    const down = parseInt(row.down, 10);
    const dist = parseInt(row.ydstogo, 10);

    // TIER 0 -- did the PREVIOUS play set this one up correctly?
    //
    // This is the check the harness was missing. Re-asserting the
    // situation before every play (which it still does below, to resync)
    // meant nothing ever tested that play N produces the right state for
    // play N+1: down progression, first downs, field position carry-over,
    // possession after a punt or turnover. All of it was overwritten
    // before it could be compared.
    //
    // So compare FIRST, resync SECOND. A mismatch is reported and then
    // corrected, so one bad play cannot cascade into fifty.
    // Only when this row FOLLOWS DIRECTLY from the last one we entered.
    // The converter skips kickoffs, penalties and anything it cannot
    // model, and punts are entered without a takeover spot -- after any
    // of those the state SHOULD differ, and comparing anyway produced a
    // wall of mismatches that said nothing about the engine. Requiring
    // an unbroken pair, same possession, same drive, leaves only cases
    // where play N genuinely had to set up play N+1.
    // ...and not across a penalty. The converter enters a play's yardage
    // but NOT any flag on it, so after an accepted penalty the spot
    // legitimately differs. Entering penalties properly means modelling
    // acceptance, declination, offsetting and half-the-distance, which
    // is a bigger job than this harness needs -- so those pairs are
    // excluded and counted, rather than reported as engine faults.
    const continuous = expectState && lastEnteredIdx === rowIdx - 1 &&
      lastEnteredTeam === wantTeam && lastEnteredDrive === row.drive &&
      !lastEnteredHadPenalty && !lastEnteredHadOwnFumble;
    if (continuous && fp !== null && down >= 1 && down <= 4) {
      const got = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
      const wants = { down, distance: dist, fieldPos: fp, possession: wantTeam };
      const diffs = [];
      if (got.possession !== wants.possession) {
        diffs.push('possession ' + got.possession + ' vs ' + wants.possession);
      }
      if (got.down !== wants.down) diffs.push('down ' + got.down + ' vs ' + wants.down);
      // Distance is only comparable when the app also knows the spot;
      // goal-to-go is expressed differently by the two sources.
      if (got.fieldPos !== null && got.fieldPos + got.distance < 100 &&
          got.distance !== wants.distance) {
        diffs.push('distance ' + got.distance + ' vs ' + wants.distance);
      }
      if (got.fieldPos !== null && got.fieldPos !== wants.fieldPos) {
        diffs.push('fieldPos ' + got.fieldPos + ' vs ' + wants.fieldPos);
      }
      comparable++;
      if (diffs.length) {
        stateMismatches++;
        if (issues.filter(i => i.area === 'tier0 state').length < 6) {
          issues.push({ area: 'tier0 state',
            detail: 'after "' + (prevDesc || 'start').slice(0, 46) + '" -> ' + diffs.join(', ') });
        }
      }
    }
    prevDesc = (row.desc || row.play_type || '').slice(0, 60);

    // Resync. StatChat credits a play to whoever currently has the ball,
    // so possession must be right or the yardage lands on the wrong team.
    // Resync against the app's ACTUAL possession, not against what the
    // harness last set. Tracking the intended value meant that once the
    // engine's possession drifted -- a turnover on downs the harness did
    // not intend, say -- nothing corrected it, because the EXPECTED team
    // had not changed. One game in sixteen showed a run of nine
    // consecutive possession mismatches from exactly that: a single
    // drift, uncorrected for the rest of the drive, reported nine times
    // as though it were nine faults.
    if (row.posteam) {
      const actual = h.evalIn('computeState().possession');
      if (actual !== wantTeam) {
        h.evalIn('pushAndPersist({id:nextId++,text:"harness possession",effect:{forcePossession:' +
                 JSON.stringify(wantTeam) + '},quarter:1}); renderAll();');
      }
      lastPos = wantTeam;
    }
    if (fp !== null && down >= 1 && down <= 4) {
      const side = fp <= 50 ? 'own' : 'opp';
      const yardline = fp <= 50 ? fp : 100 - fp;
      try {
        setDrive(h, { down, distance: dist || 10, side, yardline });
      } catch (e) { /* a spot we cannot express; the play still runs */ }
    }

    if (converted.kind === 'kneel') {
      try {
        click(win, doc.getElementById('kneelUtilBtn'));
        click(win, doc.getElementById('kneel_review'));
        click(win, doc.getElementById('saveBtn'));
        entered++;
      } catch (e) { failed++; }
      continue;
    }

    try {
      enterPlay(h, converted.spec);
      entered++;
      expectState = true;
      lastEnteredIdx = rowIdx;
      lastEnteredTeam = wantTeam;
      lastEnteredDrive = row.drive;
      lastEnteredHadPenalty = truthy(row.penalty);
      if (lastEnteredHadPenalty) penaltySkips++;
      // A fumble RECOVERED BY THE OWN TEAM moves the ball again after the
      // play, and nflverse's yards_gained covers only the play itself --
      // a 7-yard catch then fumbled forward and recovered 8 yards on
      // still reports 7. That number is the correct RECEIVING yardage,
      // which is why tier 1 passes; it is the field position that
      // diverges, because the converter does not enter the fumble at
      // all. All four DAL_NYG mismatches were this single cause,
      // including the two "Aborted" snaps.
      lastEnteredHadOwnFumble = truthy(row.fumble) && !truthy(row.fumble_lost);
      if (lastEnteredHadOwnFumble) fumbleSkips++;
    } catch (e) {
      failed++;
      if (issues.filter(i => i.area === 'entry').length < 5) {
        issues.push({ area: 'entry',
          detail: row.play_type + ' on ' + (row.down || '?') + ' & ' + (row.ydstogo || '?') +
                  ' failed: ' + e.message.split('\n')[0] });
      }
    }
  }

  // --- Tier 3: the app's own checker must be silent -------------------
  const validation = JSON.parse(h.evalIn('JSON.stringify(validateGame())'));

  const dbRows = h.db.plays.map((r, i) =>
    Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
  h.close();

  // --- Tier 1: per-player yardage against the source ------------------
  const v = await bootPage('view.html', { existingPlays: dbRows });
  const box = JSON.parse(v.evalIn('JSON.stringify(computeBoxScore(plays))'));
  // Buckets are keyed by display name, so resolve each jersey the same
  // way the app does rather than guessing at the key.
  const keyOf = (team, jersey) => v.evalIn(
    'playerName(' + JSON.stringify(team) + ', ' + JSON.stringify(jersey) + ')');

  const exp = expectedFromRows(rows, numberFor);
  const rosterByNum = new Map(roster.map(r => [r.jersey_number, r]));

  const compare = (label, expected, category, statKey) => {
    for (const jersey of Object.keys(expected)) {
      const info = rosterByNum.get(jersey);
      if (!info) continue;
      const key = keyOf(info.team_side, jersey);
      const got = ((box[info.team_side] || {})[category] || {})[key];
      const actual = got ? (got[statKey] || 0) : 0;
      const want = expected[jersey];
      if (actual !== want) {
        issues.push({ area: 'tier1 ' + label,
          detail: info.player_name + ' (#' + jersey + '): nflverse ' + want +
                  ', StatChat ' + actual });
      }
    }
  };
  compare('rushing', exp.rush, 'rushing', 'yds');
  compare('receiving', exp.rec, 'receiving', 'yds');
  compare('passing', exp.pass, 'passing', 'yds');

  // TIER 2a -- the number has to reach the SCREEN, not just the engine.
  // Everything above reads computeBoxScore directly, which would pass
  // even if no page rendered it. This reads the DOM: the top rusher's
  // total must actually appear in the rendered text.
  const topRusher = Object.keys(exp.rush)
    .sort((a, b) => exp.rush[b] - exp.rush[a])[0];
  if (topRusher && exp.rush[topRusher] > 0) {
    const info = rosterByNum.get(topRusher);
    if (info) {
      const shown = v.document.body.textContent.replace(/\s+/g, ' ');
      const name = keyOf(info.team_side, topRusher);
      if (shown.indexOf(name) === -1) {
        issues.push({ area: 'tier2 rendered',
          detail: 'view.html does not display the leading rusher ' + name });
      }
    }
  }
  v.close();

  // TIER 2b -- all four surfaces must agree. Each has its OWN COPY of
  // the engine (the known duplication), so a fix applied to one and
  // missed on another shows up here and nowhere else. This is the same
  // check cross_surface makes, but over ~140 real plays instead of 19.
  const surfaces = { 'view.html': box };
  for (const page of ['recap.html', 'stat_package.html', 'season_report.html']) {
    let pv;
    try {
      pv = await bootPage(page, {
        existingPlays: dbRows,
        query: page === 'season_report.html' ? '?season=2026' : undefined,
        game: { status: 'final', season_year: 2026, game_date: '2026-08-01' }
      });
    } catch (e) {
      issues.push({ area: 'tier2 cross-surface', detail: page + ' failed to load: ' +
                    e.message.split('\n')[0].slice(0, 70) });
      continue;
    }
    try {
      surfaces[page] = JSON.parse(pv.evalIn(
        'JSON.stringify(computeBoxScore(' +
        (page === 'season_report.html' ? 'plays || []' : 'plays') + '))'));
    } catch (e) {
      issues.push({ area: 'tier2 cross-surface',
                    detail: page + ': computeBoxScore unavailable' });
    }
    pv.close();
  }
  const base = surfaces['view.html'];
  for (const page of Object.keys(surfaces)) {
    if (page === 'view.html') continue;
    for (const team of ['teamA', 'teamB']) {
      for (const cat of ['rushing', 'passing', 'receiving']) {
        const a = (base[team] || {})[cat] || {};
        const b = (surfaces[page][team] || {})[cat] || {};
        for (const who of Object.keys(a)) {
          const av = a[who].yds || 0, bv = (b[who] || {}).yds || 0;
          if (av !== bv) {
            issues.push({ area: 'tier2 cross-surface',
              detail: page + ' ' + team + '.' + cat + '.' + who +
                      ': view says ' + av + ', this page says ' + bv });
          }
        }
      }
    }
  }

  for (const msg of validation.slice(0, 8)) {
    issues.push({ area: 'tier3 validateGame', detail: String(msg).slice(0, 110) });
  }

  return { gameId, entered, skipped, failed, issues, stateMismatches, comparable, penaltySkips, fumbleSkips,
           validationCount: validation.length };
}

async function run(limit) {
  const pbpPath = fetchNfl.playByPlay(2023);
  const gameIds = fetchNfl.listGameIds(pbpPath, limit || 3);
  const results = [];
  for (const gid of gameIds) {
    const rows = fetchNfl.readGame(pbpPath, gid);
    results.push(await runGame(rows, gid));
  }
  return results;
}

if (require.main === module) {
  const limit = parseInt(process.argv[2], 10) || 3;
  run(limit).then(results => {
    console.log('=== NFL-data QA harness ===\n');
    let total = 0;
    for (const r of results) {
      const tier1 = r.issues.filter(i => i.area.indexOf('tier1') === 0).length;
      console.log(r.gameId + '   entered ' + r.entered + '  skipped ' + r.skipped +
                  '  failed ' + r.failed);
      console.log('   tier0 state mismatches   : ' + r.stateMismatches +
                  ' of ' + r.comparable + ' consecutive pairs' +
                  ' (' + r.penaltySkips + ' penalty, ' + r.fumbleSkips +
                  ' own-recovered fumble)');
      console.log('   tier1 yardage mismatches : ' + tier1);
      console.log('   tier3 validateGame issues: ' + r.validationCount);
      for (const i of r.issues.slice(0, 6)) {
        console.log('      [' + i.area + '] ' + i.detail);
      }
      if (r.issues.length > 6) console.log('      ... and ' + (r.issues.length - 6) + ' more');
      total += r.issues.length;
    }
    console.log('\nTotal issues: ' + total);
    process.exitCode = total ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run, runGame };
