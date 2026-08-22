// The team stats + leaders broadcast overlay
// -----------------------------------------------------------------------
// A graphic for holding between drives: the team-versus-team comparison on
// top, each side's leaders underneath. Modelled on the recap page's Team
// Stats list MINUS four rows cut for the overlay -- Total Plays, Yards Per
// Play, Yards Per Pass and 20yd+ Plays. On a report those add depth; on a
// graphic held for a few seconds they are four more rows to skip past to
// reach the ones a commentator reads out.
//
// Unlike the season leader panels, this one is LIVE: it reads the game on
// air through /api/gamedata and repolls, so it is current whenever the
// director cuts to it.

const { bootGamePage, bootPage, defaultRoster, DEFAULT_GAME, DEFAULT_BRANDING } = require('./harness');
const { enterPlay, setDrive, click, typeInto } = require('./ui_driver');

// The overlay has no #mainView, so the shared readiness probe never fires.
const bootOverlay = () => bootPage('broadcast_stats.html',
  { readyWhen: win => !!win.document.getElementById('panel') });

async function paint(w, rows) {
  w.window.__payload = { game: DEFAULT_GAME, roster: defaultRoster(),
    ourBranding: DEFAULT_BRANDING, plays: rows };
  w.evalIn('window.fetch = () => Promise.resolve({ ok:true, json: () => Promise.resolve(window.__payload) });');
  await w.evalIn('fetchAndRender()');
  await new Promise(r => setTimeout(r, 250));
}

const rowMap = doc => {
  const out = {};
  doc.querySelectorAll('#rows .srow').forEach(r => {
    const c = [...r.children].map(x => x.textContent.trim());
    out[c[1]] = { visitor: c[0], home: c[2] };
  });
  return out;
};

async function buildGame() {
  const g = await bootGamePage();
  const doc = g.window.document, win = g.window;
  setDrive(g, { down: 1, distance: 10, side: 'own', yardline: 25 });
  enterPlay(g, { type: 'pass', passer: '7', receiver: '80', yards: '34' });
  enterPlay(g, { type: 'rush', carrier: '22', yards: '12' });
  enterPlay(g, { type: 'sack', passer: '7', yards: '6', credit: '52' });
  setDrive(g, { down: 1, distance: 10, side: 'opp', yardline: 15 });
  enterPlay(g, { type: 'rush', carrier: '22', yards: '15', td: true });
  enterPlay(g, { type: 'pat', kicker: '3', result: 'g' });
  click(win, doc.getElementById('penUtilBtn'));
  click(win, doc.querySelector('.penTeamBtn[data-team="off"]'));
  typeInto(win, doc.getElementById('pen_yds'), '5');
  click(win, doc.getElementById('pen_review'));
  await new Promise(r => setTimeout(r, 120));
  click(win, doc.getElementById('saveBtn'));
  await new Promise(r => setTimeout(r, 150));
  const rows = g.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
  g.close();
  return rows;
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });
  const rows = await buildGame();

  // --- 1. The comparison carries the rows that were kept, and none of
  //     the four that were cut.
  {
    const w = await bootOverlay();
    await paint(w, rows);
    const doc = w.document;
    if (doc.getElementById('panel').style.display !== 'block') fail('panel', 'the overlay did not show');
    const map = rowMap(doc);
    ['Total Yards', 'Pass Yards', 'Pass TD', 'Rush Yards', 'Yards Per Rush', 'Rush TD',
     'Possessions', 'Time of Possession', 'Turnovers', 'Sacks Allowed',
     'Penalties', 'Penalty Yards', '3rd Down', '4th Down'].forEach(k => {
      if (!(k in map)) fail('rows:missing', k + ' is missing from the comparison');
    });
    ['Total Plays', 'Yards Per Play', 'Yards Per Pass', '20yd+ Plays'].forEach(k => {
      if (k in map) fail('rows:cut', k + ' was cut for the overlay and should not appear');
    });
    // Real figures, not placeholders: the sack is charged to team rushing
    // by NFHS, so it shows as a LOSS there and as one Sack Allowed.
    if (map['Sacks Allowed'] && map['Sacks Allowed'].visitor !== '1') {
      fail('rows:sack', 'expected one sack allowed, got ' + map['Sacks Allowed'].visitor);
    }
    if (map['Penalties'] && map['Penalties'].visitor !== '1') {
      fail('rows:penalty', 'expected one penalty, got ' + map['Penalties'].visitor);
    }
    if (map['Penalty Yards'] && map['Penalty Yards'].visitor !== '5') {
      fail('rows:penyds', 'expected five penalty yards, got ' + map['Penalty Yards'].visitor);
    }
    // No clock was entered, so an em dash rather than 0:00 -- a zero reads
    // as "they never had the ball" instead of "nobody recorded it".
    if (map['Time of Possession'] && !/\u2014/.test(map['Time of Possession'].visitor)) {
      fail('rows:top', 'expected an em dash for unrecorded TOP, got ' + map['Time of Possession'].visitor);
    }
    w.close();
  }

  // --- 2. Leaders: one side per team, three categories each.
  {
    const w = await bootOverlay();
    await paint(w, rows);
    const doc = w.document;
    const sides = doc.querySelectorAll('#leaders .lside');
    if (sides.length !== 2) fail('leaders:sides', 'expected a panel per team, got ' + sides.length);
    const cats = [...doc.querySelectorAll('#leaders .lcat')].map(e => e.textContent);
    ['Passing leader', 'Rushing leader', 'Receiving leader'].forEach(c => {
      if (!cats.includes(c)) fail('leaders:cat', c + ' is missing');
    });
    const txt = doc.getElementById('leaders').textContent;
    if (!/N Quarterback/.test(txt)) fail('leaders:passer', 'the passing leader is missing: ' + txt.slice(0, 120));
    if (!/N Runningback/.test(txt)) fail('leaders:rusher', 'the rushing leader is missing');
    // A category with nobody in it shows a dash, not a name -- and never
    // TEAM or Unknown, which are bookkeeping buckets rather than players.
    if (/TEAM|Unknown/.test(txt)) fail('leaders:bucket', 'a bookkeeping bucket is being shown as a leader: ' + txt.slice(0, 160));
    w.close();
  }

  // --- 3. SILENT ON AIR. An overlay that prints an error puts that error
  //     on the broadcast, so a failed fetch hides the panel and says
  //     nothing -- unless ?debug=1, which vMix never sends.
  {
    const w = await bootOverlay();
    w.evalIn('window.fetch = () => Promise.reject(new Error("boom"));');
    await w.evalIn('fetchAndRender().catch(()=>{})');
    await new Promise(r => setTimeout(r, 150));
    w.evalIn('try { showFatal("boom"); } catch(e){}');
    const body = w.document.body.textContent;
    if (/boom/.test(body)) fail('silent', 'an error is being painted onto the broadcast without ?debug=1');
    w.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Broadcast overlay: team stats + leaders ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  the comparison carries the kept rows and none of the cut ones, both teams get a leaders panel, and a failed fetch stays silent on air.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
