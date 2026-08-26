// The dashboard tells a new admin what to do, in the right order
// ==============================================================
// A brand-new tenant admin used to land on a dashboard whose only guidance
// was "No games yet -- click New game to set up your first one". That is
// STEP THREE: creating a game needs a roster and asks for team colors, and
// help.html's own first section is called "Before the first game".
//
// The card reads real state rather than a "seen it" flag. That matters more
// than it sounds: a flag has to be stored, can be wrong in both directions,
// and would hide the card at exactly the moment it became useful again --
// a school starting a new season with an empty roster wants it back.
//
//   node tests/getting_started_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const raw = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
const code = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/<!--[\s\S]*?-->/g, '');
const doc = new JSDOM(raw).window.document;

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Getting started card ===\n');

// ---- it exists and is positioned ----------------------------------------
chk(!!doc.getElementById('gettingStarted'), 'the card is in the markup');
const gs = doc.getElementById('gettingStarted');
const games = doc.getElementById('gamesBody');
chk(gs && games && (gs.compareDocumentPosition(games) & 4) !== 0,
    'and sits ABOVE the games list — guidance below the thing it is guiding ' +
    'you toward is guidance you scroll past');
chk(/id="gettingStarted"[^>]*display:none/.test(raw),
    'hidden until the render decides otherwise, so it never flashes on a ' +
    'fully set-up dashboard');

// ---- the order Andy asked for -------------------------------------------
const fn = /function renderGettingStarted[\s\S]*?\n  \}/.exec(code)[0];
const order = ['customize.html', 'roster.html', 'create_game.html']
  .map(h => fn.indexOf(h));
chk(order.every(i => i > -1) && order[0] < order[1] && order[1] < order[2],
    'the steps are Customize, then Roster, then New game — branding is what ' +
    'the roster and game pages are shown against');

// ---- it reads real state, not a flag ------------------------------------
chk(!/localStorage|sessionStorage|seen_?getting|has_?seen/i.test(fn),
    'no "seen it" flag anywhere — the card is derived from the three things ' +
    'it asks for');
chk(/if \(left === 0\)\{[\s\S]{0,60}display = 'none'/.test(fn),
    'and hides itself when all three are done');
chk(/customized: gsCustomized/.test(code) && /hasRoster:\s+gsPlayerCount > 0/.test(code) &&
    /hasGames:\s+allGames\.length > 0/.test(code),
    'the three states come from the team row, a player count and the games list');

// ---- the state is honest -------------------------------------------------
chk(/gsCustomized = !!\(team\.primary_color \|\| team\.logo_url\)/.test(code),
    'CUSTOMIZED means a color or logo was chosen — create_tenant() writes the ' +
    'team row with a name but neither, so a null primary_color is an honest ' +
    '"nobody has been to that page"');
chk(/count: 'exact', head: true/.test(code),
    'the player count is a HEAD count — the number without fetching rows');
chk(/allGames\.length > 0/.test(code) && !/games\.length > 0/.test(
      /renderGettingStarted\(\{[\s\S]*?\}\);/.exec(code)[0]),
    'games are counted from allGames, not the season-filtered list — a school ' +
    'that played last year has created a game, and being told to create their ' +
    'first one because the season selector moved would be wrong');

// ---- a failed count must not break the page -----------------------------
const countStart = code.indexOf("from('players')");
const countBlock = countStart > -1
  ? [code.slice(code.lastIndexOf('try {', countStart),
               code.indexOf('}', code.indexOf('catch (e) {', countStart)) + 1)]
  : null;
chk(!!countBlock, 'the count is wrapped in try/catch');
const catchBody = countBlock ? /catch \(e\) \{([\s\S]*?)\}/.exec(countBlock[0]) : null;
chk(catchBody && catchBody[1].trim() === '',
    'and a failure does NOT stop the dashboard — worst case the roster step ' +
    'reads as not done and offers a link that is not needed, which beats a ' +
    'page that will not load');

// ---- the old misleading line is gone ------------------------------------
chk(!/click "New game" to set up your first one/.test(raw),
    'the old empty state no longer sends a new admin to step three');

// ---- declaration order --------------------------------------------------
const decl = code.indexOf('let gsCustomized');
const use  = code.indexOf('customized: gsCustomized');
chk(decl > -1 && decl < use,
    'gsCustomized is declared before it is read — a `let` is in its temporal ' +
    'dead zone until then');

// ---- the fourth step, admins only ---------------------------------------
// An admin can change the roster, delete games and invite people; a view or
// game-entry account cannot, so the exposure differs and so should the
// nagging. It is LAST because the three above are needed before a game can
// be scored at all -- putting security ahead of the thing somebody signed in
// to do is how a checklist gets ignored wholesale.
{
  const { JSDOM } = require('jsdom');
  const fnSrc = /  function renderGettingStarted[\s\S]*?\n  \}/.exec(code)[0];
  const dom = new JSDOM('<div id="gettingStarted" style="display:none">' +
    '<p id="gsSub"></p><div id="gsSteps"></div></div>', { runScripts: 'outside-only' });
  const w = dom.window, d2 = dom.window.document;
  w.__d = d2;
  w.eval('(function(document){' + fnSrc + '; window.__render = renderGettingStarted;})(__d);');
  const render = st => { w.__render(st); return {
    hidden: d2.getElementById('gettingStarted').style.display === 'none',
    sub: d2.getElementById('gsSub').textContent,
    steps: [...d2.querySelectorAll('.gs-t')].map(e => e.textContent),
    done: d2.querySelectorAll('.gs-step.done').length }; };

  const ALL = { customized:true, hasRoster:true, playerCount:48, hasGames:true };

  let r = render({ ...ALL, customized:false, hasRoster:false, hasGames:false,
                   playerCount:0, isAdmin:true, hasMfa:false });
  chk(r.steps.length === 4, 'an admin sees four steps');
  chk(/two-factor/i.test(r.steps[3]),
      'and two-factor is LAST — the other three are needed before a game can ' +
      'be scored, this is not');
  chk(r.sub === '4 things before your first game.',
      'the caption COUNTS the steps rather than saying "Three" — it would ' +
      'otherwise contradict the list under it (got: "' + r.sub + '")');

  r = render({ ...ALL, customized:false, hasRoster:false, hasGames:false,
               playerCount:0, isAdmin:false, hasMfa:false });
  chk(r.steps.length === 3,
      'a NON-admin sees three — a view account cannot change the roster or ' +
      'delete a game, so the exposure is not the same');

  r = render({ ...ALL, isAdmin:false, hasMfa:false });
  chk(r.hidden,
      'and their card disappears at three, not held open by a step they were ' +
      'never shown');

  r = render({ ...ALL, isAdmin:true, hasMfa:false });
  chk(!r.hidden && r.done === 3 && r.sub === 'One to go.',
      'an admin with the first three done still sees the card, with two-factor ' +
      'outstanding');

  r = render({ ...ALL, isAdmin:true, hasMfa:true });
  chk(r.hidden, 'and it goes once two-factor is on');
}

// ---- the MFA state is honest --------------------------------------------
chk(/f\.status === 'verified'/.test(code),
    "only a VERIFIED factor counts — an enrollment started and abandoned sits " +
    "at 'unverified' and protects nothing");
chk(/catch \(e\) \{[\s\S]{0,220}gsHasMfa = false/.test(code),
    'and an unreachable check reads as NOT on — the other way round would hide ' +
    'a security step from somebody who has not done it');

// ---- the guide is reachable forever -------------------------------------
chk(!!doc.getElementById('helpLink'),
    'and the full guide stays one click away, for the questions that arrive ' +
    'later rather than on day one');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
