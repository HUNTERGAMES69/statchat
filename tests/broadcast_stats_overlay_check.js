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
    // SIX ROWS, deliberately. Every extra one is something the eye has to
    // pass over to reach what a commentator actually says out loud.
    ['Total Yards', 'Pass Yards', 'Rush Yards',
     'Time of Possession', 'Turnovers', '3rd Down'].forEach(k => {
      if (!(k in map)) fail('rows:missing', k + ' is missing from the comparison');
    });
    ['Total Plays', 'Yards Per Play', 'Yards Per Pass', '20yd+ Plays',
     'Pass TD', 'Yards Per Rush', 'Rush TD', 'Possessions',
     'Sacks Allowed', 'Penalties', 'Penalty Yards', '4th Down'].forEach(k => {
      if (k in map) fail('rows:cut', k + ' was cut for the overlay and should not appear');
    });
    if (Object.keys(map).length !== 6) {
      fail('rows:count', 'expected six rows, got ' + Object.keys(map).length + ': ' + Object.keys(map).join(', '));
    }
    // Real figures, not placeholders. The sack is charged to team rushing
    // by NFHS, so it shows as a LOSS in Rush Yards -- the row that used to
    // report it directly is gone, but the yardage still has to land.
    if (map['Rush Yards'] && !/^-?\d+$/.test(map['Rush Yards'].visitor)) {
      fail('rows:rush', 'rush yards should be a number, got ' + map['Rush Yards'].visitor);
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

  // --- 4. THE HEADER READS THE SAME WAY ON BOTH SIDES. The first version
  //     stretched the name to fill the bar, pushed the score to the far
  //     edge and mirrored the home half -- so the two sides ran in
  //     opposite directions and each name sat a different distance from
  //     its own number depending on how long the name was.
  {
    const w = await bootOverlay();
    await paint(w, rows);
    const doc = w.document, win = w.window;
    const sides = [...doc.querySelectorAll('#head .hteam')];
    if (sides.length !== 2) fail('head:sides', 'expected two header sides, got ' + sides.length);
    const shapes = sides.map(sd => [...sd.children].map(c => c.className || c.tagName).join('>'));
    if (shapes[0] !== shapes[1]) {
      fail('head:mirrored', 'the two header sides read in different orders: ' + shapes.join('  vs  '));
    }
    sides.forEach((sd, i) => {
      const c = win.getComputedStyle(sd);
      if (c.justifyContent !== 'center') fail('head:centred', 'side ' + i + ' is not centred: ' + c.justifyContent);
      if (c.flexDirection !== 'row') fail('head:direction', 'side ' + i + ' is reversed: ' + c.flexDirection);
    });
    // The score sits a FIXED step from the name, not wherever a long name
    // leaves it.
    const nm = doc.querySelector('.hname'), pts = doc.querySelector('.hpts');
    if (win.getComputedStyle(nm).flexGrow !== '0') {
      fail('head:name-grow', 'the name should not stretch to fill the bar');
    }
    if (win.getComputedStyle(pts).marginLeft === '0px') {
      fail('head:gap', 'the score should sit a fixed step right of the name');
    }
    w.close();
  }

  // --- 5. PORTRAIT: a tall narrow column for a lower-third or side slot,
  //     with the two leaders panels STACKED and our team on top.
  //     Side by side the panels are peers and visitor-then-home is right,
  //     matching the comparison. Stacked, the top one reads as the
  //     subject of the graphic -- on a Neville broadcast that is Neville,
  //     home or away.
  {
    const homeGame = Object.assign({}, DEFAULT_GAME, { our_team_is_home: true,
      home_team_name: 'Neville', away_team_name: 'TEST OPP' });
    const paintWith = async (w, game) => {
      w.window.__payload = { game, roster: defaultRoster(), ourBranding: DEFAULT_BRANDING, plays: rows };
      w.evalIn('window.fetch = () => Promise.resolve({ ok:true, json: () => Promise.resolve(window.__payload) });');
      await w.evalIn('fetchAndRender()');
      await new Promise(r => setTimeout(r, 250));
    };
    const names = d => [...d.querySelectorAll('#leaders .ltname')].map(e => e.textContent);
    // A two-word OPPONENT, because a one-word one fits either way and
    // would not have caught the truncation. In this fixture our team is
    // at home, so home_team_name is Neville's slot -- the away name is
    // the opponent's.
    homeGame.away_team_name = 'West Monroe';

    // NEVILLE AT HOME is the case that separates the two orders. With
    // Neville away both layouts agree, so a test using only that fixture
    // would pass whatever the portrait branch did.
    let w = await bootPage('broadcast_stats.html',
      { query: '?id=test-game-1', readyWhen: win => !!win.document.getElementById('panel') });
    await paintWith(w, homeGame);
    // Tested as the RULE, not a literal name: our team is at home in this
    // fixture, so the visitor is whoever is NOT Neville. Hardcoding the
    // opponent's name meant renaming the fixture broke an assertion that
    // had nothing to do with the rename.
    if (names(w.document)[0] === 'Neville') {
      fail('portrait:landscape-order', 'landscape should stay visitor-first, got ' + names(w.document).join(' then '));
    }
    if (w.window.getComputedStyle(w.document.getElementById('leaders')).flexDirection !== 'row') {
      fail('portrait:landscape-dir', 'landscape leaders should sit side by side');
    }
    w.close();

    w = await bootPage('broadcast_stats.html',
      { query: '?id=test-game-1&layout=portrait', readyWhen: win => !!win.document.getElementById('panel') });
    await paintWith(w, homeGame);
    const d = w.document, win = w.window;
    if (!d.body.classList.contains('layout-portrait')) fail('portrait:class', 'the portrait class was not applied');
    if (names(d)[0] !== 'Neville') {
      fail('portrait:order', 'portrait should stack our team on top, got ' + names(d).join(' then '));
    }
    if (win.getComputedStyle(d.getElementById('leaders')).flexDirection !== 'column') {
      fail('portrait:stack', 'portrait leaders should stack, not sit side by side');
    }
    // Narrower, and the same data -- only the shape changes.
    if (win.getComputedStyle(d.getElementById('panel')).right !== 'auto') {
      fail('portrait:width', 'the portrait panel should be a fixed-width column, not full bleed');
    }
    // WIDE ENOUGH FOR A REAL SCHOOL NAME. The header gives each side half
    // of what the TEAM STATS block leaves, and at 640px that carried
    // eleven characters -- "West Monroe" is exactly eleven and came out
    // as "West Mo...". Asserted as a number rather than by measuring
    // text, which jsdom cannot do: the budget is
    // (width - 120) / 2 - 119 per name.
    const pw = parseInt(win.getComputedStyle(d.getElementById('panel')).width, 10);
    if (!(pw >= 800)) {
      fail('portrait:name-room', 'the portrait panel is too narrow for a two-word school name, got ' + pw + 'px');
    }
    if (d.querySelectorAll('#rows .srow').length !== 6) {
      fail('portrait:rows', 'portrait should carry the same six rows');
    }
    if (d.querySelectorAll('.lcard').length !== 6) {
      fail('portrait:cards', 'portrait should carry the same six leader cards');
    }
    w.close();
  }

  // --- 6. SPONSOR BAR: one black bar at the top, white artwork, with the
  //     web address left and the phone number right. No caption -- at
  //     this size the mark reads as a sponsor's without one.
  {
    const w = await bootPage('broadcast_stats.html',
      { query: '?id=test-game-1', readyWhen: win => !!win.document.getElementById('panel') });
    await paint(w, rows);
    const d = w.document, win = w.window;

    if (d.getElementById('sponsorBottom')) fail('sponsor:bottom-gone', 'the bottom banner was a comparison aid and should be gone');
    const b = d.getElementById('sponsorTop');
    if (!b) { fail('sponsor:missing', 'no sponsor banner'); w.close(); return failures; }
    // Black, with the WHITE mark. The colour logo's byline is black on
    // transparent and would vanish here.
    if (win.getComputedStyle(b).backgroundColor !== 'rgb(0, 0, 0)') {
      fail('sponsor:bg', 'the banner should be black, got ' + win.getComputedStyle(b).backgroundColor);
    }
    const img = d.querySelector('.sponsor img');
    if (!/white\.png$/.test(img.getAttribute('src'))) {
      fail('sponsor:logo', 'the black bar needs the white artwork, got ' + img.getAttribute('src'));
    }
    if (win.getComputedStyle(img).width !== 'auto') fail('sponsor:aspect', 'the logo width should follow its height');
    // The caption is gone, and the bar and mark grew to fill its place.
    if (/presented\s*by/i.test(b.textContent)) {
      fail('sponsor:caption', 'the "presented by" wording should be gone: ' + b.textContent.replace(/\s+/g, ' ').trim());
    }
    if (parseInt(win.getComputedStyle(img).height, 10) < 50) {
      fail('sponsor:size', 'the logo should be scaled up with the bar, got ' + win.getComputedStyle(img).height);
    }

    const L = d.querySelector('.spleft'), R = d.querySelector('.spright');
    if (L.textContent.trim() !== 'nettech.net') fail('sponsor:web', 'expected nettech.net on the left, got ' + L.textContent);
    if (R.textContent.trim() !== '318.387.0001') fail('sponsor:phone', 'expected the phone number on the right, got ' + R.textContent);
    if (win.getComputedStyle(L).textAlign !== 'left') fail('sponsor:left-align', 'the web address should be left justified');
    if (win.getComputedStyle(R).textAlign !== 'right') fail('sponsor:right-align', 'the phone number should be right justified');
    // EQUAL outer zones, so the mark sits on the panel's centre line and
    // not on the midpoint between two strings of different length.
    if (win.getComputedStyle(L).flexGrow !== win.getComputedStyle(R).flexGrow ||
        win.getComputedStyle(L).flexGrow !== '1') {
      fail('sponsor:balance', 'the two outer zones must balance for the logo to be centred: ' +
        win.getComputedStyle(L).flexGrow + ' vs ' + win.getComputedStyle(R).flexGrow);
    }
    // Top of the panel, above the cards.
    const order = [...d.getElementById('panel').children].map(c => c.id || c.className);
    if (order[0] !== 'sponsorTop') fail('sponsor:position', 'the banner should head the panel, got ' + order.join(' > '));
    w.close();

    // Portrait carries it at its own scale.
    const p2 = await bootPage('broadcast_stats.html',
      { query: '?id=test-game-1&layout=portrait', readyWhen: win2 => !!win2.document.getElementById('panel') });
    await paint(p2, rows);
    const ph = parseInt(p2.window.getComputedStyle(p2.document.querySelector('.sponsor img')).height, 10);
    if (!(ph > 0 && ph < 62)) fail('sponsor:portrait-scale', 'the portrait logo should be smaller than the landscape one, got ' + ph);
    p2.close();

    // And can be dropped for a game with no sponsor to name.
    const n = await bootPage('broadcast_stats.html',
      { query: '?id=test-game-1&sponsor=none', readyWhen: win3 => !!win3.document.getElementById('panel') });
    await paint(n, rows);
    if (n.window.getComputedStyle(n.document.getElementById('sponsorTop')).display !== 'none') {
      fail('sponsor:none', 'sponsor=none should hide the banner');
    }
    n.close();
  }

  // TRANSLUCENT, WITH A BLUR BEHIND. Shown at halftime and after the
  // final only, so there is no live play to obscure -- that is what makes
  // it safe here and would not make it safe over a snap.
  {
    const w = await bootPage('broadcast_stats.html',
      { query: '?id=test-game-1', readyWhen: win => !!win.document.getElementById('panel') });
    await paint(w, rows);
    const d = w.document, win = w.window;
    for (const sel of ['.card', '.lside']) {
      const c = win.getComputedStyle(d.querySelector(sel));
      // The ALPHA AS A NUMBER, not a regex on the string. A pattern
      // matching "0.8 or 0.9" also matched the 0.97 it replaced, so the
      // check passed with the change reverted -- it could not see the
      // thing it was for.
      const alpha = parseFloat((c.backgroundColor.match(/rgba\([^)]*,\s*([0-9.]+)\)/) || [])[1]);
      if (!(alpha > 0 && alpha <= 0.92)) {
        fail('glass:alpha', sel + ' should be translucent enough to see through, got ' + c.backgroundColor);
      }
      // The blur is what stops yard lines and crowd showing through as
      // detail -- alpha alone makes the graphic shimmer.
      const src = require('fs').readFileSync(__dirname + '/../broadcast_stats.html', 'utf8');
      if (!/backdrop-filter:\s*blur/.test(src)) {
        fail('glass:blur', 'translucency without a backdrop blur will shimmer over the field');
      }
      if (!/-webkit-backdrop-filter/.test(src)) {
        fail('glass:webkit', 'the vMix Chromium build wants the -webkit- prefix as well');
      }
    }
    // The greys are the first casualty of the alpha, so they were
    // darkened -- a check that survives someone lightening them back.
    const lab = win.getComputedStyle(d.querySelector('.slab')).color;
    if (lab !== 'rgb(61, 66, 73)') {
      fail('glass:contrast', 'the row labels need the darker grey to survive the transparency, got ' + lab);
    }
    // The sponsor bar stays solid: white artwork on a see-through black
    // bar would lose the byline against a bright field.
    if (win.getComputedStyle(d.getElementById('sponsorTop')).backgroundColor !== 'rgb(0, 0, 0)') {
      fail('glass:sponsor', 'the sponsor bar should stay solid');
    }
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
