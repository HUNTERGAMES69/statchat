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
// AND NOTHING OVERRIDES IT INLINE. renderAll set style.display = 'flex' to
// reveal the bar, which silently discarded the grid: the sides went back to
// sizing on their own content and the columns came out unequal on air. A
// test that only read the CSS could not see it -- reported from a real
// overlay after the grid was already in place.
chk(!/style\.display = 'flex'/.test(src),
    'renderAll sets no inline display — an inline style beats the ' +
    'stylesheet, and naming a mode there fights the grid');
chk(/document\.getElementById\('bug'\)\.style\.display = '';/.test(src),
    'it clears the inline value instead, handing the bar back to the CSS');
chk(/classList\.add\('is-live'\)/.test(src),
    'and adds is-live, so clearing the display cannot reveal an empty bar');

chk(!/equaliseSides/.test(src),
    'and no script equalises them: #bug clips its overflow, so a width set ' +
    'from script beyond what the bar allowed was simply cut off');

// SCORE-ONLY DROPS THE MIDDLE TRACK. With #situation display:none the grid
// has two items for three tracks, and home lands in the `auto` one. Caught
// in Chromium: away 501, home 398.
chk(/body\.layout-bug #bug\.is-live \{ grid-template-columns:1fr 1fr; \}/.test(src),
    'score-only mode re-declares two tracks — hiding the situation panel ' +
    'otherwise leaves home in the auto track and narrower than away');

// ---- scores outboard, identity centred -----------------------------------
chk(/#sideAway \.pts \{ text-align:left;  order:1; \}/.test(src),
    'the away score is first and left-aligned — the outer edge on that side');
chk(/#sideHome \.pts \{ text-align:right; order:2; \}/.test(src) &&
    /#sideHome \.ident \{ order:1; \}/.test(src),
    'and the home score is last and right-aligned, with the identity before it');
chk(!/sgap/.test(src),
    'no spacer opposite the score — mirroring the score centres the identity ' +
    'in the WHOLE column, and the requirement is between the score and the ' +
    'CENTRE LINE. The spacer version measured 50px off in Chromium');
chk(/#sideAway \{ padding:14px 0 14px 22px; \}/.test(src) &&
    /#sideHome \{ padding:14px 22px 14px 0; \}/.test(src),
    'horizontal padding on the OUTER edge only — anything between the centre ' +
    'line and the identity track shifts the centre by half of itself');
chk(/\.ident\{[\s\S]{0,180}padding:0 var\(--sc-gap\);/.test(src),
    'and clearance lives INSIDE the identity, symmetric, so widening it ' +
    'cannot move the identity off centre');
chk(/#bug \{ --sc-gap:\d+px; \}/.test(src),
    'driven by one variable — the bar is widened by turning this number and ' +
    'nothing else');
chk(/\.ident\{ flex:1 1 auto; display:flex;[\s\S]{0,60}justify-content:center;/.test(src),
    'logo and name are one element, centred as a block');

// MIRRORED BY ORDER, not by emitting different markup. One builder for both
// sides means they cannot drift apart.
{
  const fn = /const sideHtml = \(teamKey\) => \{[\s\S]*?\n    \};/.exec(src);
  chk(!!fn, 'sideHtml is a single builder');
  if (fn) {
    chk(/class="ident"/.test(fn[0]) && !/class="sgap"/.test(fn[0]),
        'emitting score and identity in one fixed order for both sides, with ' +
        'no spacer — the mirroring is done by CSS order');
    chk((fn[0].match(/class="pts"/g) || []).length === 1,
        'with the score written once — a second branch for the home side is ' +
        'how two layouts start disagreeing');
  }
}

// ---- the score sizes to its digits ---------------------------------------
// The score track was a fixed 78px. A single "0" is about 23px, so 55px of
// empty track sat between the glyph and the identity -- and a viewer reads
// that as part of the gap. The identity was centred between the score TRACK
// and the centre line, which is not what anyone sees.
//
// Worse on the away side, where a long name leaves no slack to hide it. That
// is why home looked right and away did not, with both measuring 0px off.
chk(/\.pts  \{ flex:0 0 auto; font-size:44px;/.test(src) && !/min-width:2ch/.test(src),
    'the score box fits its digits EXACTLY, with no minimum — twice this was ' +
    'a fixed width, and both times the leftover space inside the box sat ' +
    'between the glyph and the identity');
chk(/font-variant-numeric:tabular-nums/.test(src),
    'with tabular figures, so 0 through 99 occupy the same width and the ' +
    'identity does not shift when a team goes from 9 to 10');
chk(!/--sc-ptsw/.test(src),
    'and the old fixed-width variable is gone, with nothing still reading it');

// ---- no possession football -----------------------------------------------
// Not wanted on air, and it was actively breaking the centring. It was drawn
// for both teams and hidden with visibility:hidden for the one without the
// ball -- which STILL OCCUPIES SPACE. The invisible glyph and its 14px gap
// sat inside the identity block, so the visible logo and name were pushed
// off centre while every measurement of the BLOCK read as correct.
//
// That is why the home side looked right and the away side did not: the
// shift is the same on both, but on one it runs toward the score and on the
// other toward the divider.
chk(!/class="poss"/.test(src),
    'the football is not emitted -- hiding a thing is not removing it, and ' +
    'on a centred layout the difference is measurable');
chk(!/\.poss \{/.test(src),
    'and its rule is gone with it');
chk(!/const has = state\.possession === teamKey/.test(src),
    'along with the flag that fed it');

// ---- the situation panel is centred --------------------------------------
// It is a flex row of two spans with a 22px gap. On the score bug the
// down-and-distance is empty -- but an empty span is still a flex item, so
// the gap applied and Q1 sat 11px right of centre.
chk(/#situation \{[\s\S]{0,220}justify-content:center;/.test(src),
    'the situation panel centres its contents');
chk(/#situation > span:empty \{ display:none; \}/.test(src),
    'and an empty child is removed from flow, taking its gap with it — ' +
    'otherwise Q1 sits half a gap off centre on the score bug');

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
