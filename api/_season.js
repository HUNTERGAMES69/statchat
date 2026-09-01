// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// WHICH GAMES COUNT AS "THE SEASON" — ONE DEFINITION, TWO CALLERS.
// =====================================================================
// This rule has been re-learned three times in this repo, and the comment
// in seasondata.js says so in as many words: "a third season-wide surface
// that never picked up the rule the other two follow." Every time a new
// season-wide surface appeared it re-implemented the filter and left one
// clause out, and each omission put wrong numbers on air for a week.
//
// api/feed.js grew a season scope on 1 Sep 2026 and would have been the
// FOURTH copy. It is a caller instead.
//
// THE RULE, and why each clause is here:
//   season_year = the season asked for
//   status = 'final'   -- a game still being played has no final numbers,
//                         and half a game in a season total is worse than
//                         no game at all
//   deleted_at is null -- the service key has BYPASSRLS, so nothing else
//                         removes a deleted game. A school that deleted two
//                         games saw "2 games" on its season overlays.
//   NOT is_preseason   -- a scrimmage is not the season. This also excludes
//                         the sample game 028 seeds into every new account,
//                         which is marked is_preseason for exactly that
//                         reason.
//   tenant_id          -- same reason as deleted_at: no RLS here.
//
// NULLABLE BOOLEAN. is_preseason is nullable, and `NULL = false` is NULL,
// not true -- so .eq('is_preseason', false) silently drops every game where
// nobody ever touched the flag, which is most of them. The .or() is not
// stylistic.
function seasonGames(db, tenantId, season) {
  return db.from('games')
    .select('*')
    .eq('season_year', season)
    .eq('status', 'final')
    .is('deleted_at', null)
    .or('is_preseason.is.null,is_preseason.eq.false')
    .eq('tenant_id', tenantId);
}

// ONE PLAYER, ONE LINE, ACROSS A SEASON.
// =====================================================================
// computeBoxScore keys its buckets by DISPLAY NAME, deliberately -- see
// engine.js:1195. Within one game that is exactly right. Across a season it
// splits a player whose name was spelled two ways into two lines, and both
// look plausible.
//
// The same merge already runs in season_report.html. It is repeated here
// rather than imported because that file is a browser page, not a module,
// and the alternative was leaving the feed to disagree with the report.
const normName = (n) => String(n).trim().replace(/\s+/g, ' ').toLowerCase();

// Picks the key an incoming name should merge into, and decides which
// SPELLING survives. A roster typed in caps and one in title case are the
// same player; title case is the one a broadcast should show, so an
// all-caps key gives way to a mixed-case one when both appear.
function canonicalKey(target, name) {
  const want = normName(name);
  const found = Object.keys(target).find(k => normName(k) === want);
  if (!found) return name;
  const foundShouts = found === found.toUpperCase();
  const nameShouts = name === name.toUpperCase();
  if (foundShouts && !nameShouts) {
    target[name] = target[found];
    delete target[found];
    return name;
  }
  return found;
}

// A LIST OF MAXIMA, not sums. Every "long" is a max: summing three 20-yard
// runs into a 60-yard long is the classic season-aggregation bug, and it
// reads as a career night rather than as an error.
const MAXIMA = new Set(['long', 'fgLong', 'puntLong', 'retLong', 'kickRetLong', 'puntRetLong']);

function mergeInto(target, rawKey, delta) {
  const key = canonicalKey(target, rawKey);
  if (!target[key]) target[key] = {};
  Object.keys(delta).forEach(k => {
    const v = delta[k];
    if (typeof v !== 'number') { if (target[key][k] === undefined) target[key][k] = v; return; }
    target[key][k] = MAXIMA.has(k)
      ? Math.max(target[key][k] || 0, v)
      : (target[key][k] || 0) + v;
  });
}

// Aggregates one side's buckets across every game of a season.
//
// OWN TEAM ONLY, and that is not an oversight. season_report.html:550 and
// broadcast_leaders.html:338 both read box.teamA, where teamA is always the
// tenant's own team. Opponent players are recorded per game and never
// carried across a season -- there is no players row for them, only a
// per-game game_rosters snapshot -- so a season-scoped opponent line would
// be inventing a total nothing else in the product agrees with.
const CATEGORIES = ['rushing', 'passing', 'receiving', 'defense', 'specialTeams'];

function aggregateSeason(boxes) {
  const agg = {};
  CATEGORIES.forEach(c => { agg[c] = {}; });
  boxes.forEach(box => {
    const side = (box && box.teamA) || {};
    CATEGORIES.forEach(cat => {
      Object.keys(side[cat] || {}).forEach(name => {
        // TEAM is a bucket for unattributed work, not a person. It belongs
        // in a team total and never in a leader board.
        if (name === 'TEAM' || name === 'Unknown') return;
        mergeInto(agg[cat], name, side[cat][name]);
      });
    });
  });
  return agg;
}

module.exports = { seasonGames, aggregateSeason, mergeInto, canonicalKey, normName, MAXIMA };
