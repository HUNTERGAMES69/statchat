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
engine = '\n'.join(lines[:cut])              # config, supabase, engine, helpers
# NOTHING from view.html's boot is carried across. Its init() paints into
# DOM the overlay lacks, and -- more importantly -- it queries Supabase
# directly, which an unauthenticated browser input cannot do: every RLS
# policy is `auth.role() = 'authenticated'`, so the queries returned
# nothing and the overlay rendered an empty canvas. That is what a black
# page in vMix looked like. The overlay boots against /api/gamedata
# instead, which reads server-side with the service key.
tail = ''

head_scripts = ''.join('<script src="%s"></script>\n' % m
                       for m in re.findall(r'<script src="([^"]+)"></script>', src))
# Since the Aug 2026 consolidation the engine is no longer inline in
# view.html, so the slice above no longer contains it. The overlay loads
# engine.js like every other page -- which is the point of the exercise:
# this file is no longer a copy of anything.
if 'engine.js' not in head_scripts:
    head_scripts += '<script src="engine.js"></script>\n'

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
             // Full team name. `t.abbr` was removed from the engine --
             // it only ever returned the first word, which for
             // single-word names was the whole name anyway.
             '<span class="name">' + t.name + '</span>' +
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

  // ---- boot ---------------------------------------------------------
  // Everything comes from /api/gamedata, which reads server-side with the
  // service key. The overlay cannot query Supabase directly: it has no
  // session, and every RLS policy requires one.
  //
  // POLLING, not realtime. Supabase realtime also needs a session, so the
  // overlay re-fetches on an interval instead. Two seconds is well inside
  // what a scoreboard needs and is trivial load for one game.
  const POLL_MS = 2000;

  function showFatal(msg){
    document.body.innerHTML =
      '<p style="position:absolute;left:40px;bottom:40px;margin:0;color:#fff;' +
      'background:#8a1414;padding:14px 20px;border-radius:6px;' +
      'font:500 20px sans-serif;">' + msg + '</p>';
  }

  async function fetchAndRender(){
    const r = await fetch('/api/gamedata' +
      (currentGameId ? '?id=' + encodeURIComponent(currentGameId) : ''),
      { cache: 'no-store' });
    if (!r.ok){
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || ('HTTP ' + r.status));
    }
    const d = await r.json();
    startingPossession = d.game.starting_possession || 'teamA';
    quarterLengthSec   = d.game.quarter_length_seconds || 720;
    buildTeams(d.game, d.roster || [], d.ourBranding || {});
    plays = (d.plays || []).map(p => ({
      id: p.id, seq: p.sequence_number, text: p.text,
      effect: p.effect || {}, roles: p.roles || null,
      team: p.team_side, quarter: p.quarter,
      isDivider: !!p.is_divider, unresolved: !!p.unresolved
    }));
    renderAll();
  }

  async function initOverlay(){
    const params = new URLSearchParams(window.location.search);
    // An id is OPTIONAL now. Without one, /api/gamedata resolves the game
    // set ON AIR -- which is the whole point of the flag, and means the
    // overlay address never needs editing. The old behaviour was a
    // leftover from before the flag existed, and produced
    // "No game id" for anyone who used the address as given.
    currentGameId = params.get('id') || '';
    try {
      await fetchAndRender();
    } catch (e){
      showFatal('Could not load the game: ' + e.message);
      return;
    }
    // A later failure must not blank a working scoreboard -- keep showing
    // the last good state and try again on the next tick.
    setInterval(() => { fetchAndRender().catch(() => {}); }, POLL_MS);
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
  .name { font-size:34px; }
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
