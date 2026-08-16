// The broadcast setup page lists every field, and must keep listing them
// =====================================================================
// broadcast_setup.html tells a production team which fields each feed
// view carries, so they know what to bind an overlay to. Until 14 Aug
// 2026 it gave a prose summary -- "yards, first downs, third downs,
// turnovers" for a view that actually carries twenty-six fields -- which
// sent people to fetch the URL and read raw XML to find the rest.
//
// WHY THIS FILE EXISTS. A documentation list that nothing checks rots
// silently, and this one rots in the worst possible way: it is read once,
// the day before a game, by somebody with no way to tell it is out of
// date. Adding a field to api/feed.js and forgetting the page is a
// one-line mistake that surfaces as an overlay with a blank box on air.
//
// So the page is compared against the REAL feed, built from a game that
// exercises every stat type. Not a fixed list in two places -- the feed
// is the source of truth and this reads it.
//
// The comparison is deliberately one-directional in one respect: a field
// the page lists but the fixture does not produce is NOT a failure, since
// a bucket only holds keys that were incremented (a receiver with no
// touchdown has no `td` at all) and no single game can exercise
// everything. A field the FEED produces and the page omits always fails.

const fs = require('fs');
const path = require('path');
const { bootGamePage, defaultRoster } = require('./harness');
const { enterPlay, setDrive, click, typeInto } = require('./ui_driver');

const REPO = path.join(__dirname, '..');

// Build the feed's views with the same code the API runs, without the
// HTTP handler or a database.
function buildFeedViews(plays) {
  const engine = require(path.join(REPO, 'api', '_engine.js'));
  const src = fs.readFileSync(path.join(REPO, 'api', 'feed.js'), 'utf8');
  const body = src.slice(src.indexOf('const mmss'), src.indexOf('module.exports'));
  const buildViews = new Function('engine', `
    const { computeState, computeBoxScore, countPossessions, countTurnovers, markerLabel, quarterLabel } = engine;
    ${body}
    return buildViews;
  `)(engine);
  const ctx = engine.buildContext(
    { id: 'g', designator: 'G1', our_team_is_home: true,
      home_team_name: 'Neville', away_team_name: 'Ruston',
      status: 'in_progress', season_year: 2025 },
    defaultRoster().map(r => Object.assign({}, r)), plays, { name: 'Neville' });
  return buildViews(ctx);
}

// The page's list, read out of the source rather than by booting it --
// the point is what a reader SEES, and that is the literal in the file.
function pageFields() {
  const src = fs.readFileSync(path.join(REPO, 'broadcast_setup.html'), 'utf8');
  const block = src.slice(src.indexOf('const FEEDS = ['), src.indexOf('];', src.indexOf('const FEEDS = [')));
  const out = {};
  // Entries are [view, label, shape, 'space separated field names'] and
  // wrap across two lines. Read the view name from one line and the
  // field string from the next, rather than trying to match the pair in
  // a single regex -- a formatter reflowing the file would silently
  // break that and this check would then pass by finding nothing.
  const lines = block.split('\n');
  lines.forEach((line, i) => {
    const head = line.match(/^\s*\['([a-z]+)',/);
    if (!head) return;
    const tail = (lines[i + 1] || '').match(/^\s*'([^']*)'\]/);
    if (!tail){
      out[head[1]] = null;   // recognised the view, could not read its fields
      return;
    }
    out[head[1]] = tail[1].split(/\s+/).filter(Boolean);
  });
  return out;
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // A game that touches every stat category: rush, loss, pass,
  // incompletion, sack, fumble, interception, touchdown, PAT, kick
  // return, punt and field goal.
  const h = await bootGamePage({ roster: defaultRoster() });
  const { window: win, document: doc } = h;
  win.confirm = () => true;
  const drive = (side, yl) => setDrive(h, { down: 1, distance: 10, side, yardline: yl });

  drive('own', 25);
  click(win, doc.getElementById('setClockUtilBtn'));
  typeInto(win, doc.getElementById('setclock_val'), '1200');
  click(win, doc.getElementById('setclock_save'));
  enterPlay(h, { type: 'rush', carrier: '22', yards: '9', credit: '55' });
  enterPlay(h, { type: 'rush', carrier: '22', yards: '3', loss: true, credit: '55' });
  enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '22', credit: '55' });
  enterPlay(h, { type: 'pass', passer: '7', receiver: '80', incomplete: true });
  enterPlay(h, { type: 'sack', passer: '7', yards: '6', credit: '99' });
  enterPlay(h, { type: 'fumble', carrier: '22', fumrec: 'opp', credit: '55', yards: '5' });
  drive('own', 40);
  enterPlay(h, { type: 'int', passer: '12', credit: '44', yards: '8',
                 spot: { side: 'own', yardline: '48' } });
  drive('opp', 6);
  enterPlay(h, { type: 'rush', carrier: '22', yards: '6', td: true });
  enterPlay(h, { type: 'pat', kicker: '3', result: 'g' });
  enterPlay(h, { type: 'kickoff', kicker: '3', credit: '21', retyds: '18',
                 spot: { side: 'own', yardline: '28' } });
  drive('own', 28);
  enterPlay(h, { type: 'punt', punter: '15', yards: '42', spot: { side: 'own', yardline: '30' } });
  drive('opp', 22);
  enterPlay(h, { type: 'fg', kicker: '3', yards: '39', result: 'g' });
  const plays = h.db.plays.map((p, i) =>
    Object.assign({}, p, { sequence_number: p.sequence_number || i + 1 }));
  h.close();

  const views = buildFeedViews(plays);
  const listed = pageFields();

  // Every view the feed serves must appear on the page, and vice versa.
  const feedViews = Object.keys(views).sort();
  const pageViews = Object.keys(listed).sort();
  feedViews.forEach(v => {
    if (!listed[v]) {
      fail('views', 'the feed serves "' + v + '" and the setup page does not mention it — ' +
           'a view nobody knows about might as well not exist');
    }
  });
  pageViews.forEach(v => {
    if (!views[v]) {
      fail('views', 'the setup page lists "' + v + '" and the feed does not serve it — ' +
           'a production team would build against a URL that returns nothing');
    }
  });

  // Every field the feed produces must be listed.
  feedViews.forEach(v => {
    if (listed[v] === null){
      fail('fields', 'the setup page lists "' + v + '" but its field list could not be read — ' +
           'the FEEDS entry format changed and this check is no longer reading anything, ' +
           'which would let every later assertion pass for free');
      return;
    }
    if (!listed[v]) return;
    const produced = new Set();
    (views[v] || []).forEach(row => Object.keys(row).forEach(k => produced.add(k)));
    const missing = [...produced].filter(f => listed[v].indexOf(f) === -1);
    if (missing.length) {
      fail('fields', 'view "' + v + '" produces ' + missing.join(', ') +
           ' and the setup page does not list ' + (missing.length === 1 ? 'it' : 'them') +
           ' — an overlay built from that page would never know to bind ' +
           (missing.length === 1 ? 'it' : 'them'));
    }
  });

  // Sanity: the fixture has to actually exercise things, or "no missing
  // fields" is a statement about an empty feed.
  const counts = feedViews.map(v => (views[v] || []).length);
  if (counts.some(n => n === 0)) {
    const empty = feedViews.filter(v => !(views[v] || []).length);
    fail('fixture', 'these views came back empty: ' + empty.join(', ') +
         ' — the game in this file no longer exercises them, so it is not checking ' +
         'their fields at all');
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Broadcast setup field lists ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) {
      console.log('  every field the feed serves is documented on the setup page.');
    }
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
