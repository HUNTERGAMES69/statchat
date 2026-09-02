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
// ANCHORED ON THE SIGNATURE, not the name. `/function renderGettingStarted/`
// also matches a helper called renderGettingStartedIfReady -- and did, on
// 2 Sep 2026, silently handing this check the wrong function's body so it
// reported the step order was wrong when it was fine.
const fn = /function renderGettingStarted\(state\)\{[\s\S]*?\n  \}/.exec(code)[0];
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
    /hasGames:\s+ownGames\.length > 0/.test(code),
    'the three states come from the team row, a player count and the games list');

// ---- a seeded sample is not a game THEY created --------------------------
// 028 puts an example game in a new school's dashboard so the first screen is
// not empty. It is still a row in `games`, so counting it would tick "create
// your first game" on day one -- telling a school it had done something the
// platform did for it, which is the checklist lying in the one direction that
// makes it useless.
chk(/const ownGames = allGames\.filter\(g => g\.is_sample !== true\)/.test(code),
    'the sample game is filtered OUT of the games that count as theirs');
chk(/is_sample !== true/.test(code) && !/!g\.is_sample\b/.test(code),
    'and tested against true explicitly, not by truthiness -- is_sample is ' +
    'nullable, so every game predating the column is null and must read as ' +
    '"not a sample" rather than relying on null being falsy today');
chk(/hasSample:\s+allGames\.some\(g => g\.is_sample === true\)/.test(code),
    'while hasSample is counted from the UNfiltered list -- filtering it out ' +
    'and then asking whether it is there would always answer no');
chk(/\.select\('[^']*is_sample[^']*'\)/.test(code),
    'and is_sample is NAMED in the explicit select -- unnamed it reads ' +
    'undefined, which marks step three done AND hides the delete step: ' +
    'silent in both directions');

// ---- the state is honest -------------------------------------------------
chk(/gsCustomized = !!\(team\.primary_color \|\| team\.logo_url\)/.test(code),
    'CUSTOMIZED means a color or logo was chosen — create_tenant() writes the ' +
    'team row with a name but neither, so a null primary_color is an honest ' +
    '"nobody has been to that page"');
chk(/count: 'exact', head: true/.test(code),
    'the player count is a HEAD count — the number without fetching rows');
// FROM allGames, VIA ownGames -- not from the season-filtered `games`.
// The derivation gained a step on 31 Aug 2026 (the sample game is filtered
// out of it), so this no longer looks for `allGames.length > 0` literally.
// What it still pins is the thing that matters: the source is the full list.
// A school that played last year HAS created a game, and being told to create
// their first one because the season selector moved would be wrong.
{
  // FOUND BY ITS CONTENTS, not by the call syntax. This used to match
  // `renderGettingStarted({ ... });` literally, which broke the moment the
  // state object was hoisted into a variable so the MFA check and the
  // dashboard load could both feed it. What is being asserted is where
  // hasGames comes from, and that does not depend on how the object reaches
  // the renderer.
  const call = (/(?:gsState\s*=|renderGettingStarted\()\s*\{[\s\S]*?hasGames:[\s\S]*?\n    \}/.exec(code) || [])[0];
  chk(!!call, 'found the getting-started state object');
  chk(/const ownGames = allGames\.filter\(/.test(code),
      'the games that count as theirs are derived from allGames');
  chk(/hasGames:\s+ownGames\.length > 0/.test(call) && !/\bgames\.length > 0/.test(call),
      'games are counted from that, not the season-filtered list');
}

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

  // A NON-ADMIN SEES NOTHING AT ALL. This asserted "three steps" until 31 Aug
  // 2026, from when the fourth was two-factor and the first three were still
  // shown to everyone. The card now hides outright: EVERY step on it is an
  // action a view-only account is bounced off -- customize, roster, new game,
  // account -- and the New game button in particular read as a permission
  // they do not have. The test kept passing its own old expectation against a
  // page that had stopped agreeing with it.
  r = render({ ...ALL, customized:false, hasRoster:false, hasGames:false,
               playerCount:0, isAdmin:false, hasMfa:false });
  chk(r.hidden,
      'a NON-admin sees no card at all — every step on it is an action a view ' +
      'account is bounced off, and New game reads as a permission they do not have');

  r = render({ ...ALL, isAdmin:false, hasMfa:false });
  chk(r.hidden, 'and that holds with everything else done, too');

  r = render({ ...ALL, isAdmin:true, hasMfa:false });
  chk(!r.hidden && r.done === 3 && r.sub === 'One to go.',
      'an admin with the first three done still sees the card, with two-factor ' +
      'outstanding');

  r = render({ ...ALL, isAdmin:true, hasMfa:true });
  chk(r.hidden, 'and it goes once two-factor is on');

  // ---- the sample-game step --------------------------------------------
  // Shown only once the school has created a game of its own. The sample is
  // there to be used; pointing "delete this" at the only thing on a brand-new
  // dashboard works against the reason it was seeded, and a step people are
  // meant to leave undone teaches them to ignore the card.
  r = render({ ...ALL, customized:false, hasRoster:false, hasGames:false,
               playerCount:0, hasSample:true, isAdmin:true, hasMfa:false });
  chk(!r.steps.some(t => /sample/i.test(t)),
      'the delete-the-sample step is ABSENT before they have a game of their ' +
      'own — it is the example their empty dashboard needed');

  r = render({ ...ALL, hasSample:true, isAdmin:true, hasMfa:false });
  chk(r.steps.some(t => /sample/i.test(t)),
      'and appears once they have created a real game — which is the moment ' +
      'their season starts and the example has done its job');
  chk(/two-factor/i.test(r.steps[r.steps.length - 1]),
      'with two-factor still LAST, ahead of nothing');

  r = render({ ...ALL, hasSample:false, isAdmin:true, hasMfa:true });
  chk(r.hidden,
      'and the card goes once the sample is deleted and everything else is done');

  // NO BUTTON on that step, and no href="undefined" either. Deleting happens
  // from the game row's own menu on this page, so a "go" link would point at
  // the page you are already on. Every other step has one, so the renderer
  // read s.href unconditionally until this step existed.
  {
    const html = d2.getElementById('gsSteps').innerHTML;
    render({ ...ALL, hasSample:true, isAdmin:true, hasMfa:false });
    const withSample = d2.getElementById('gsSteps').innerHTML;
    chk(!/undefined/.test(withSample),
        'a step with no href renders no button, rather than href="undefined"');
    void html;
  }
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
