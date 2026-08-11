#!/usr/bin/env python3
"""
Generates broadcast.html from view.html.

WHY A GENERATOR RATHER THAN A HAND-WRITTEN PAGE:
the overlay needs the same engine view.html uses, and hand-copying 1000
lines guarantees drift. Regenerating means the engine is byte-identical
to view.html's at the moment it was built.

THIS IS STILL DEBT. It makes a sixth copy of the engine, which is the
duplication TODO 8a exists to remove. When engine.js lands, delete this
script and have broadcast.html load engine.js like everything else.

    python3 tools/make_broadcast.py
"""
import re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'view.html')).read()

scripts = re.findall(r'<script>([\s\S]*?)</script>', src)
body = max(scripts, key=len)
lines = body.split('\n')

cut  = next(n for n, l in enumerate(lines) if l.startswith('  function renderAll'))
boot = next(n for n, l in enumerate(lines) if l.startswith('  async function init('))
reload_at = next(n for n, l in enumerate(lines) if l.startswith('  async function reloadPlaysAndRender'))
engine = '\n'.join(lines[:cut])              # config, supabase, engine, helpers
# view.html's init() paints into DOM the overlay does not have, so only
# the reload + realtime-subscribe functions are carried across and the
# overlay supplies its own boot below.
tail   = '\n'.join(lines[reload_at:])

head_scripts = ''.join('<script src="%s"></script>\n' % m
                       for m in re.findall(r'<script src="([^"]+)"></script>', src))

# view.html's page-fitting code scales a .wrap element and re-renders the
# box score on resize. The overlay has neither, and vMix gives it a fixed
# 1920x1080 canvas anyway, so those calls are neutralised rather than
# carried across. Done as a targeted substitution so the rest of the
# engine stays byte-identical.
engine = engine.replace(
    "  applyDisplayScale();",
    "  // applyDisplayScale() removed: no .wrap on the overlay, and vMix\n"
    "  // renders at a fixed size.")
engine = engine.replace(
    "  window.addEventListener('resize', () => { applyDisplayScale(); if (plays.length) renderBoxScore(); });",
    "  // resize handler removed: fixed canvas.")

# Strip view.html's auth gate. vMix has no browser session and cannot
# sign in, so the redirect would bounce the overlay to the login page.
# The overlay boots itself at the bottom instead. Whether the feed should
# carry a per-game token instead of being open is TODO 8d.
engine = re.sub(
    r"  supabaseClient\.auth\.onAuthStateChange\([\s\S]*?\n  \}\);\n",
    "  // auth gate removed: an overlay cannot sign in. See TODO 8d.\n",
    engine, count=1)

OVERLAY = r'''
  // ---- overlay rendering (NOT copied from view.html) ----------------
  function safeText(bg, fallback){
    try { return safeTextColor(bg, fallback); } catch (e) { return fallback || '#fff'; }
  }

  // view.html's init() paints into elements this page does not have.
  // Stubbed so the shared boot path runs unchanged.
  function showView(){}
  function showMsg(){}
  function renderTeamSummary(){}
  function renderBoxScore(){}
  function applyDisplayScale(){}

  function renderAll(){
    const state = computeState(plays);
    document.getElementById('bug').style.display = 'flex';

    const sideHtml = (teamKey) => {
      const t = TEAMS[teamKey];
      const has = state.possession === teamKey && state.down;
      return '<span class="poss" style="visibility:' + (has ? 'visible' : 'hidden') + ';">\uD83C\uDFC8</span>' +
             (t.logo ? '<img src="' + t.logo + '" alt="">' : '') +
             '<span class="abbr">' + (t.abbr || t.name) + '</span>' +
             '<span class="pts">' + (state.scores[teamKey] || 0) + '</span>';
    };
    const paint = (id, teamKey) => {
      const el = document.getElementById(id), t = TEAMS[teamKey];
      el.style.background = t.bg || '#1a1a2e';
      el.style.color = safeText(t.bg, t.text);
      el.innerHTML = sideHtml(teamKey);
    };
    paint('sideA', 'teamA');
    paint('sideB', 'teamB');

    const dist = (state.down && state.fieldPos !== null &&
                  state.fieldPos + state.distance >= 100) ? 'Goal' : state.distance;
    document.getElementById('downText').textContent = state.down
      ? (ordinal(state.down) + ' & ' + dist + ' at ' + markerLabel(state.fieldPos))
      : '';
    document.getElementById('quarterText').textContent =
      state.quarter >= 5 ? 'OT' : ('Q' + state.quarter);

    const p = new URLSearchParams(window.location.search);
    document.body.classList.toggle('layout-bug', p.get('layout') === 'bug');
    document.body.classList.toggle('debug', p.get('debug') === '1');
  }

  // ---- boot. Deliberately minimal: read the id, load the game, its
  // roster and its plays, build the teams, draw, then subscribe for
  // live updates. No auth gate -- vMix cannot sign in, and a scoreboard
  // is public information anyway (see TODO 8d on whether this should
  // carry a per-game token).
  async function initOverlay(){
    const params = new URLSearchParams(window.location.search);
    currentGameId = params.get('id');
    if (!currentGameId){
      document.body.innerHTML =
        '<p style="color:#fff;background:#900;padding:12px;font:16px sans-serif;">' +
        'No game id. Use broadcast.html?id=&lt;gameId&gt;</p>';
      return;
    }
    const { data: gameRows } = await supabaseClient
      .from('games').select('*').eq('id', currentGameId).limit(1);
    const game = (gameRows || [])[0];
    if (!game) return;
    startingPossession = game.starting_possession || 'teamA';
    quarterLengthSec   = game.quarter_length_seconds || 720;

    const { data: rosterRows } = await supabaseClient
      .from('game_rosters').select('*').eq('game_id', currentGameId);
    const { data: teamRows } = await supabaseClient
      .from('teams').select('primary_color, secondary_color, logo_url')
      .eq('is_our_team', true).limit(1);
    buildTeams(game, rosterRows || [], (teamRows || [])[0] || {});

    await reloadPlaysAndRender();
    subscribeToLiveUpdates();
  }
  initOverlay();
'''

HTML = '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>StatChat broadcast overlay</title>
''' + head_scripts + '''<style>
  /* TRANSPARENT. vMix's Web Browser input keys this out, so anything not
     explicitly painted shows the programme feed through. Do not give
     html or body a background colour. */
  html, body { background:transparent !important; margin:0; padding:0; overflow:hidden;
               font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
               -webkit-font-smoothing:antialiased; }

  /* Sized for a 1920x1080 browser input, anchored bottom-left where a
     score bug normally lives. */
  #bug { position:absolute; left:60px; bottom:60px; display:none; align-items:stretch;
         border-radius:8px; overflow:hidden; box-shadow:0 6px 24px rgba(0,0,0,0.55);
         font-weight:800; }
  .side { display:flex; align-items:center; gap:14px; padding:14px 22px; }
  .side img { height:44px; width:auto; display:block; }
  .abbr { font-size:34px; }
  .pts  { font-size:44px; min-width:64px; text-align:right; font-variant-numeric:tabular-nums; }
  .poss { font-size:26px; }
  #situation { background:rgba(12,12,14,0.92); color:#fff; padding:14px 26px; font-size:30px;
               display:flex; align-items:center; gap:22px; }
  .dim { opacity:0.6; font-weight:600; font-size:24px; }

  body.layout-bug #situation { display:none; }   /* ?layout=bug  */
  body.debug { background:#123 !important; }     /* ?debug=1     */
</style>
</head>
<body>
  <div id="bug">
    <div class="side" id="sideA"></div>
    <div id="situation">
      <span id="downText"></span>
      <span id="quarterText" class="dim"></span>
    </div>
    <div class="side" id="sideB"></div>
  </div>

<script>
// ===================================================================
// BROADCAST OVERLAY -- GENERATED FILE, do not hand-edit.
//   regenerate: python3 tools/make_broadcast.py
//
// TEMPORARY BY DESIGN. The engine below is copied from view.html,
// making this the SIXTH copy in the repo -- the duplication TODO 8a
// exists to remove. Taken this way so an overlay could be in vMix
// today rather than after the extraction. Fold it into engine.js when
// 8a is done; do not let it drift.
//
// VMIX SETUP
//   Add Input -> Web Browser
//   URL   https://nevillestatchat.vercel.app/broadcast.html?id=<gameId>
//   Size  1920 x 1080
//   The background is transparent, so it keys straight over video.
//
//   ?layout=bug   score only, no down and distance
//   ?debug=1      solid background, to see the edges while positioning
// ===================================================================
''' + engine + OVERLAY + tail + '''
</script>
</body>
</html>
'''

open(os.path.join(ROOT, 'broadcast.html'), 'w').write(HTML)
print('broadcast.html regenerated from view.html (%d lines)' % HTML.count('\n'))
