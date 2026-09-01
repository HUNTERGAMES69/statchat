// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// Every overlay must have a feed behind it
// ========================================
// Andy, 1 Sep 2026: "everything that we offer in the graphical overlay
// section, need to make sure we have an entry for it in the XML/JSON
// section (that the DATA is available)."
//
// The gap was real and had been there for months. broadcast_setup.html
// offered ?view=kicking and ?view=punting overlays, and the feed served
// neither -- so a crew that preferred to build its own graphics could see
// the board StatChat draws and had no way to get the numbers in it. Season
// scope was worse: it is the leaders overlay's DEFAULT, and /api/feed only
// ever knew about the game on air.
//
// THE FAILURE MODE IS SILENT AND STRUCTURAL. Adding an overlay is one edit
// to one array; nothing has ever made the feed side follow. This file is
// what makes it follow, so the next overlay added without a feed fails here
// rather than being discovered by a customer building a template.
//
//   node tests/overlay_feed_parity_check.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const chk = (l, ok, d) => { if (ok) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + (d ? '\n         ' + d : '')); } };

console.log('=== Overlay / feed parity ===\n');

// COMMENTS STRIPPED FIRST. This page's comments quote overlay addresses to
// explain them, and counting those finds views nobody offers.
const decomment = s => s.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
const setup = decomment(read('broadcast_setup.html'));
const feed  = read('api/feed.js');

// ---- what the overlay section actually offers -------------------------
const overlayViews = new Set();
for (const m of setup.matchAll(/broadcast_leaders\.html\?view=([a-z]+)/g)) overlayViews.add(m[1]);
for (const m of setup.matchAll(/broadcast_leaders\.html\?views=([a-z,]+)/g))
  m[1].split(',').forEach(v => v && overlayViews.add(v));
chk('the overlay section offers leader views at all', overlayViews.size >= 4,
    JSON.stringify([...overlayViews]));

// ---- THE LINEUP OVERLAYS ---------------------------------------------
// broadcast_starters.html arrived after this file did, and its units are a
// different parameter from the leaders' views -- so the sweep above cannot
// see it and the parity rule would have silently stopped covering the newest
// overlay. Which is precisely the failure this file exists to prevent, in
// the file that exists to prevent it.
const starterUnits = new Set();
for (const m of setup.matchAll(/broadcast_starters\.html\?unit=([a-z]+)/g)) starterUnits.add(m[1]);
chk('the overlay section offers the three lineup cards',
    ['offense','defense','special'].every(u => starterUnits.has(u)),
    JSON.stringify([...starterUnits]));

// A TEXT GREP CANNOT SEE A BROKEN ARRAY, and that is exactly how these six
// lines shipped missing. The entries were inserted INSIDE the Season-leaders
// entry rather than beside it -- one malformed element instead of seven rows
// -- so every string this file looks for was present, the page still parsed,
// and nothing rendered. Andy found it by opening the page.
//
// So the array is parsed as an array: every entry must be a two-element
// [label, url] pair. A structural break shows up as an element that is not.
const ovArray = setup.match(/const ov = document\.getElementById\('overlayRows'\);[\s\S]*?\n\s*\]\.forEach/);
chk('the overlay list is a well-formed array of [label, url] pairs', !!ovArray);
if (ovArray) {
  const body = ovArray[0].replace(/\/\/[^\n]*/g, '');
  // Count entry openers against overlayUrl() calls: every row has exactly
  // one of each, so a mismatch means an entry lost its label or its URL.
  // NOT newline-anchored: the first entry shares its line with the array
  // opener (`[['Full scoreboard'`), so requiring a newline before it under-
  // counts by exactly one and reports a healthy file as broken.
  const opens = (body.match(/\['/g) || []).length;
  const urls  = (body.match(/overlayUrl\(/g) || []).length;
  chk('  ...every row has one label and one address', opens === urls,
      opens + ' labels vs ' + urls + ' addresses — a mismatch means an entry ' +
      'swallowed another, which renders as a missing row rather than an error');
  chk('  ...and the lineup rows are siblings, not nested inside another entry',
      !/\['[^']*',\s*\n\s*(?:\/\/[^\n]*\n\s*)*\['/.test(body),
      'an entry opening immediately before another entry means one contains the other');
}
// Both column layouts, as separate lines rather than a parameter a crew has
// to know about -- the ?dd=0 lesson: an option described only in source is
// an option nobody uses.
['1','2'].forEach(c => chk('  ...each offered in ' + c + '-column form',
    ['offense','defense','special'].every(u =>
      setup.indexOf('unit=' + u + '&cols=' + c) > -1),
    'a layout nobody is shown is a layout nobody uses'));
chk('every lineup overlay has the starters feed behind it',
    /^\s{4}starters:/m.test(feed), 'api/feed.js must serve view=starters');
chk('  ...and the setup page publishes it for each unit',
    ['offense','defense','special'].every(u => setup.indexOf("'unit=" + u + "'") > -1),
    'the FEEDS table must carry a row per unit');
chk('  ...with a row name of its own in the XML',
    /starters:\s*'starter'/.test(feed), "ROW_NAME.starters should read 'starter'");
// A lineup belongs to ONE game. Offering ?scope=season on it would answer
// with a card that means nothing, so it must stay out of SEASON_VIEWS.
chk('starters is NOT offered as a season view',
    !/SEASON_VIEWS = \[[^\]]*'starters'/.test(feed),
    'a season has no starting lineup');

// ---- what the feed serves ---------------------------------------------
const feedViews = new Set();
const feedsTable = setup.match(/const FEEDS = \[([\s\S]*?)\n  \];/);
chk('the setup page has a FEEDS table', !!feedsTable);
const listedFeeds = new Set();
if (feedsTable) for (const m of feedsTable[1].matchAll(/\['([a-z]+)',/g)) listedFeeds.add(m[1]);
for (const m of feed.matchAll(/^\s{4}([a-z]+):\s*(?:bothTeams|\[)/gm)) feedViews.add(m[1]);

// tackles is the overlay's word for the feed's `defense` -- one concept,
// two names, and the mapping has to be stated somewhere or a check like
// this reports a false gap forever.
const ALIAS = { tackles: 'defense' };
const feedNameFor = v => ALIAS[v] || v;

// ---- THE PARITY ASSERTION ---------------------------------------------
[...overlayViews].sort().forEach(v => {
  const want = feedNameFor(v);
  chk('overlay view "' + v + '" has a feed view (' + want + ')', feedViews.has(want),
      'feed serves: ' + JSON.stringify([...feedViews].sort()));
  chk('  ...and it is listed on the setup page for a crew to find',
      listedFeeds.has(want), 'listed: ' + JSON.stringify([...listedFeeds].sort()));
});

// ---- season scope ------------------------------------------------------
// The leaders overlay defaults to season, so this is not an extra: it is
// the scope most of those addresses actually run in.
chk('the overlay section offers season scope', /scope=game|season=\d{4}|views=/.test(setup));
chk('the feed accepts a scope parameter', /q\.scope/.test(feed));
chk('...and defaults anything that is not "season" to a game',
    /=== 'season' \? 'season' : 'game'/.test(feed),
    'a typo in scope must not silently switch a graphic onto season totals');
const seasonList = feed.match(/const SEASON_VIEWS = \[([^\]]*)\]/);
chk('the feed names which views a season can answer', !!seasonList);
if (seasonList) {
  const seasonViews = new Set(seasonList[1].match(/'([a-z]+)'/g).map(x => x.replace(/'/g, '')));
  [...overlayViews].forEach(v =>
    chk('  season scope covers overlay view "' + v + '"', seasonViews.has(feedNameFor(v)),
        JSON.stringify([...seasonViews])));
  // And must NOT claim to answer the ones that have no season meaning.
  ['score', 'drive', 'lastplay', 'teamstats'].forEach(v =>
    chk('  season scope correctly refuses "' + v + '"', !seasonViews.has(v)));
}
// A CREW CANNOT USE AN ADDRESS NOBODY SHOWS THEM -- and there are TWO
// places the page shows one: the on-screen table, and the emailed list a
// crew actually sets vMix up from. A mutation that deleted the table row
// survived an earlier version of this check, because "scope=season appears
// somewhere on the page" stayed true from the email half alone. Both are
// asserted separately now.
chk('the setup page renders a season row under each game row',
    /seasonRow/.test(setup) && /url \+ '&scope=season'/.test(setup),
    'the on-screen table must carry the season addresses');
chk('...and the emailed setup list carries them too',
    /feedUrlFor\(view, fmt\) \+ '&scope=season'/.test(setup),
    'the email is what a crew configures from; an address missing there is never used');
chk('...in both places, not one', (setup.match(/&scope=season/g) || []).length >= 2,
    'found ' + ((setup.match(/&scope=season/g) || []).length) + ' occurrences');

// ---- one definition of "the season", not four --------------------------
// This rule was re-implemented three times before feed.js would have made
// four. If a copy reappears, the feed and the overlay start disagreeing
// about the same player's total.
chk('the season definition lives in exactly one module',
    fs.existsSync(path.join(ROOT, 'api/_season.js')));
['api/feed.js', 'api/seasondata.js'].forEach(f => {
  chk(f + ' uses the shared definition', /require\('\.\/_season(?:\.js)?'\)/.test(read(f)));
  chk('  ...and keeps no private copy of the filter',
      !/is_preseason\.is\.null/.test(read(f).replace(/^\s*\/\/.*$/gm, '')),
      'an inline copy is how the two drift apart');
});

console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
if (fail) console.log('\n' + fail + ' FAILURES');
process.exitCode = fail ? 1 : 0;
