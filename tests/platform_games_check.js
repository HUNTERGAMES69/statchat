// The platform console can find a live game
// =========================================
// A super admin could already READ any tenant's game -- games_select and
// plays_select both allow is_super_admin() -- but there was no way to find
// one. When a scorer rings at 8pm saying something looks wrong, the first
// question was "what is the game id", which they have no way to answer.
//
// Added the week two tenants ran real games on the same night.
//
//   node tests/platform_games_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(path.join(__dirname, '..', 'platform.html'), 'utf8');
const doc = new JSDOM(src).window.document;

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Platform: live games ===\n');

// ---- it exists and is wired ----------------------------------------------
chk(!!doc.getElementById('tabGames') && !!doc.getElementById('panelGames'),
    'the tab and its panel exist');
// ORDER-INDEPENDENT. Pinning the exact array meant a reorder failed here
// for no reason -- what matters is that games is wired, not where it sits.
chk(/const TABS = \[[^\]]*'games'[^\]]*\];/.test(src),
    'and games is in TABS, which drives the switching');
chk(/loadGames\(\);\s*\n\s*loadTenants\(\);/.test(src),
    'it loads on sign-in rather than only when the tab is opened');
chk(/loadTenants\(\), loadGames\(\)/.test(src),
    'and Refresh reloads it with everything else');
chk(/forEach\(which => \{/.test(src) &&
    /\['Tenants',[^\]]*'Games'[^\]]*\]\.forEach/.test(src),
    'the refresh buttons loop includes it, so its own button works');

// ---- READ ONLY. This is the constraint that matters ----------------------
// Opening the ENTRY page for somebody else's live game is how two people
// end up scoring one. The link goes to the crew view, which is the same
// read-only page their broadcast crew is already watching.
{
  const fn = /async function loadGames\(\)\{[\s\S]*?\n  \}/.exec(src);
  chk(!!fn, 'loadGames is defined');
  if (fn) {
    chk(/href="view\.html\?id=/.test(fn[0]),
        'it links to the CREW VIEW');
    chk(!/game\.html/.test(fn[0]),
        'and never to the entry page — opening that on somebody else\'s live ' +
        'game is how two people end up scoring it');
    chk(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(fn[0]),
        'and writes nothing');
    chk(/target="_blank"/.test(fn[0]),
        'new tab, so the console stays where it was');
  }
}

// ---- no new endpoint -----------------------------------------------------
// The ordinary client already sees every tenant's games under
// is_super_admin(), so this needed no new surface to secure.
{
  const fn = /async function loadGames\(\)\{[\s\S]*?\n  \}/.exec(src)[0];
  chk(/supabaseClient\s*\n?\s*\.from\('games'\)/.test(fn),
      'it reads the games table directly rather than adding an endpoint');
  chk(!/manage-users|\/api\//.test(fn),
      'and calls no API route');
}

// ---- the filtering, run --------------------------------------------------
// IN PROGRESS ONLY by default. `setup` games are created weeks ahead and
// there are always several; showing them would bury the two that matter.
{
  const today = new Date().toISOString().slice(0, 10);
  const games = [
    { id:'g1', tenant_id:'t1', game_date:today, status:'in_progress' },
    { id:'g2', tenant_id:'t2', game_date:today, status:'in_progress' },
    { id:'g3', tenant_id:'t1', game_date:today, status:'final' },
    { id:'g4', tenant_id:'t1', game_date:'2026-08-21', status:'final' },
    { id:'g5', tenant_id:'t2', game_date:'2026-10-02', status:'setup' }
  ];
  const run = (includeFinal) => {
    const wanted = includeFinal ? ['in_progress','final'] : ['in_progress'];
    let rows = games.filter(g => wanted.includes(g.status));
    if (includeFinal) rows = rows.filter(g => g.status === 'in_progress' || g.game_date === today);
    return rows.map(g => g.id);
  };
  chk(JSON.stringify(run(false)) === JSON.stringify(['g1','g2']),
      'by default only games in progress — two schools, two games');
  chk(!run(false).includes('g5'),
      'a game still in setup for October is not shown, which is the whole ' +
      'reason for filtering: there are always several');
  chk(/const wanted = includeFinal \? \['in_progress', 'final'\] : \['in_progress'\];/.test(src),
      'and the source asks for those statuses and no others — `setup` must ' +
      'never be requested, or the two games that matter tonight are buried');
  chk(run(true).includes('g3') && !run(true).includes('g4'),
      'with the toggle on, a game finished TODAY appears and one from last ' +
      'week does not');
  chk(/g\.status === 'in_progress' \|\| g\.game_date === today/.test(src),
      'and that date window is in the source, not just in this test');
}

// ---- grouped by school ---------------------------------------------------
chk(/nameOf\[g\.tenant_id\] \|\| 'Unknown school'/.test(src),
    'grouped by school name, with a fallback so a game whose tenant row has ' +
    'gone still appears rather than vanishing');
chk(/is_broadcast \? ' <span class="pill live">on air<\/span>'/.test(src),
    'and the on-air game is marked, since that is the one feeding overlays');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
