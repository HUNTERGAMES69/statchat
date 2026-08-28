// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// The broadcast score bar: equal columns, scores outboard, home right
// ===================================================================
// .side was a plain flex row -- poss, logo, name, score, in that order --
// which gave three faults at once:
//
//   1. Each column sized to its own content, so a long name made one half
//      wider than the other.
//   2. The score sat straight after the name, which on the LEFT half put it
//      against the centre line instead of at the outer edge.
//   3. teamA is always OUR team, so home was only on the right when we
//      happened to be playing away.
//
// The bar is now a grid: 1fr auto 1fr. Two 1fr tracks are equal BY
// DEFINITION and never narrower than their own content, which is the whole
// requirement with no measuring and no script.
//
// An earlier attempt equalised the sides from JavaScript and could not be
// made to hold: #bug clips its overflow for the rounded corners, so any
// width the script set beyond what the bar had allowed was simply cut off.
//
//   node tests/scorebar_layout_check.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'broadcast.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Broadcast score bar ===\n');

// ---- equal columns -------------------------------------------------------
chk(/grid-template-columns:1fr auto 1fr/.test(src),
    'the bar is a grid with two 1fr team tracks — equal by definition, and ' +
    'never narrower than their content');
chk(!/equaliseSides/.test(src),
    'and no script equalises them: #bug clips its overflow, so a width set ' +
    'from script beyond what the bar allowed was simply cut off');

// SCORE-ONLY DROPS THE MIDDLE TRACK. With #situation display:none the grid
// has two items for three tracks, and home lands in the `auto` one. Caught
// in Chromium: away 501, home 398.
chk(/body\.layout-bug #bug \{ grid-template-columns:1fr 1fr; \}/.test(src),
    'score-only mode re-declares two tracks — hiding the situation panel ' +
    'otherwise leaves home in the auto track and narrower than away');

// ---- scores outboard, identity centred -----------------------------------
chk(/#sideAway \.pts \{ text-align:left;  order:1; \}/.test(src),
    'the away score is first and left-aligned — the outer edge on that side');
chk(/#sideHome \.pts \{ text-align:right; order:3; \}/.test(src),
    'and the home score is last and right-aligned');
chk(/#sideAway \.sgap \{ order:3; \}/.test(src) && /#sideHome \.sgap \{ order:1; \}/.test(src),
    'a spacer sits opposite each score');
chk(/\.sgap \{ flex:0 0 var\(--sc-ptsw\); \}/.test(src) &&
    /\.pts  \{ flex:0 0 var\(--sc-ptsw\)/.test(src),
    'and it is the SAME width as the score, from one variable — otherwise ' +
    'the identity block centres in the leftover space and sits slightly off');
chk(/\.ident\{ flex:1 0 auto; display:flex;[\s\S]{0,80}justify-content:center; \}/.test(src),
    'logo and name are one element, centred, and do not shrink below their ' +
    'content');

// MIRRORED BY ORDER, not by emitting different markup. One builder for both
// sides means they cannot drift apart.
{
  const fn = /const sideHtml = \(teamKey\) => \{[\s\S]*?\n    \};/.exec(src);
  chk(!!fn, 'sideHtml is a single builder');
  if (fn) {
    chk(/class="ident"/.test(fn[0]) && /class="sgap"/.test(fn[0]),
        'emitting score, identity and spacer in one fixed order for both sides');
    chk((fn[0].match(/class="pts"/g) || []).length === 1,
        'with the score written once — a second branch for the home side is ' +
        'how two layouts start disagreeing');
  }
}

// ---- home on the right ---------------------------------------------------
// teamA is OUR team. Which column it lands in now depends on the fixture.
chk(/id="sideAway"/.test(src) && id_absent(),
    'the sides are named away and home, not A and B — the old names meant ' +
    '"us" and "them", which is exactly the thing that changed');
function id_absent(){ return !/id="sideA"|id="sideB"/.test(src); }

chk(/const homeKey = ourTeamIsHome \? 'teamA' : 'teamB';/.test(src),
    'home is resolved from the fixture, not assumed');
chk(/paint\('sideAway', awayKey\);\s*\n\s*paint\('sideHome', homeKey\);/.test(src),
    'and each column is painted with the team that belongs in it');

// renderAll has no game row -- it is also called from the poll with no
// arguments -- so the flag is remembered at module scope.
chk(/let ourTeamIsHome = true;/.test(src),
    'the home flag is held at module scope');
chk(/ourTeamIsHome = !!game\.our_team_is_home;/.test(src),
    'and set in buildTeams, which is the only place with the game row');
{
  const d = src.indexOf('let ourTeamIsHome'), s2 = src.indexOf('ourTeamIsHome = !!game'),
        u = src.indexOf("const homeKey = ourTeamIsHome");
  chk(d > -1 && d < s2 && s2 < u, 'declared, then set, then used');
}

// ---- and it is still an overlay ------------------------------------------
chk(/html, body \{ background:transparent !important/.test(src),
    'the page is still transparent — this composites into a live picture');
chk(!/class="sc-copyright"/.test(src),
    'and carries no visible copyright line, which would be burnt into air');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
