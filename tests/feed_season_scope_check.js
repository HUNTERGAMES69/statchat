// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// The feed's kicking, punting and season views, driven for real
// =============================================================
// These three were added on 1 Sep 2026 to close the overlay/feed gap:
// broadcast_setup.html offered kicking and punting overlays, and season is
// the leaders overlay's DEFAULT scope, and /api/feed served none of them.
//
// DRIVEN, NOT MOCKED. The handler runs against a stubbed Supabase whose
// rows come from verify/mkseason.js -- a three-game season built by driving
// game.html's own entry panels, so the plays, roles and effects are the
// shapes the app really writes. A fixture of pre-computed totals would test
// the sort order and nothing else.
//
// THE STUB REJECTS WHAT IT CANNOT DO. Its .or() throws on any expression
// other than the one this codebase uses, so a filter change that the stub
// silently ignored could not pass unnoticed.
//
// NOTHING HERE PASSES ON AN EMPTY RESULT. [].every() is true, and the first
// run of this file reported "sorted correctly" and "no opponent players"
// as green against a season that had returned nothing at all. Every such
// check now requires rows first.
//
//   node tests/feed_season_scope_check.js
//   (needs /tmp/season.json -- regenerate with verify/mkseason.js)

const path = require('path');
const fs = require('fs');
const ROOT = require('path').join(__dirname, '..') + '/';
const SEASON = JSON.parse(fs.readFileSync('/tmp/season.json', 'utf8'));

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'stub-secret';

let pass = 0, fail = 0;
const chk = (l, ok, d) => { if (ok) { pass++; console.log('ok   ' + l); }
  else { fail++; console.log('FAIL ' + l + (d ? '\n       ' + d : '')); } };

// ---- the stubbed database ------------------------------------------
// Games carry a season_year, status, deleted_at, is_preseason and tenant so
// the real filters have something to actually filter.
const TENANT = 'tenant-1';
const GAMES = SEASON.games.map((g, i) => Object.assign({}, g.game, {
  id: 'g' + i, tenant_id: TENANT, season_year: 2026, status: 'final',
  deleted_at: null, is_preseason: null, is_broadcast: i === 0,
  our_team_is_home: true, home_team_name: 'Riverside', away_team_name: 'Northgate'
}));
// Two rows that MUST be excluded, so the filters are doing work rather than
// passing because there was nothing to reject.
GAMES.push(Object.assign({}, GAMES[0], { id: 'gdel', deleted_at: '2026-08-01T00:00:00Z', is_broadcast: false }));
GAMES.push(Object.assign({}, GAMES[0], { id: 'gpre', is_preseason: true, is_broadcast: false }));
const ROSTERS = [], PLAYS = [];
SEASON.games.forEach((g, i) => {
  (g.roster || []).forEach(r => ROSTERS.push(Object.assign({}, r, { game_id: 'g' + i })));
  (g.plays || []).forEach(p => PLAYS.push(Object.assign({}, p, { game_id: 'g' + i })));
});
['gdel', 'gpre'].forEach(id => {
  (SEASON.games[0].roster || []).forEach(r => ROSTERS.push(Object.assign({}, r, { game_id: id })));
  (SEASON.games[0].plays || []).forEach(p => PLAYS.push(Object.assign({}, p, { game_id: id })));
});

function table(rows){
  const f = { _rows: rows.slice(), _ors: [] };
  const api = {
    select(){ return api; },
    eq(c, v){ f._rows = f._rows.filter(r => r[c] === v); return api; },
    is(c, v){ f._rows = f._rows.filter(r => (r[c] === null || r[c] === undefined) === (v === null)); return api; },
    in(c, vs){ f._rows = f._rows.filter(r => vs.indexOf(r[c]) > -1); return api; },
    or(expr){
      // Only the one expression this codebase uses; anything else must
      // fail loudly rather than silently pass everything through.
      if (expr !== 'is_preseason.is.null,is_preseason.eq.false')
        throw new Error('stub does not implement or(): ' + expr);
      f._rows = f._rows.filter(r => r.is_preseason === null || r.is_preseason === undefined || r.is_preseason === false);
      return api;
    },
    order(){ return api; },
    limit(n){ f._rows = f._rows.slice(0, n); return api; },
    then(res){ return Promise.resolve({ data: f._rows, error: null }).then(res); }
  };
  return api;
}
const DB = { from(t){
  if (t === 'games') return table(GAMES);
  if (t === 'game_rosters') return table(ROSTERS);
  if (t === 'plays') return table(PLAYS);
  // tenant_id IS REQUIRED ON THIS ROW. feed.js scopes the teams lookup by
  // tenant (Hazard 0 inside a service-key endpoint), so a stub row without
  // it is filtered out, current_season_year comes back undefined, and the
  // season branch 404s -- which is what the first run of this file reported
  // as "scope=season is not served".
  if (t === 'teams') return table([{ tenant_id: TENANT, primary_color:'#123456',
                                     secondary_color:'#ffffff', logo_url:null,
                                     name:'Riverside', current_season_year:2026 }]);
  if (t === 'tenants') return table([{ id: TENANT, feed_key: 'KEY', deleted_at: null }]);
  return table([]);
} };

// intercept the supabase client and the tenant lookup
// Resolve @supabase/supabase-js FROM api/feed.js's own directory -- the
// package sits in the repo's node_modules, not this file's.
const supaPath = require.resolve('@supabase/supabase-js', { paths: [ROOT + 'api', ROOT] });
require.cache[supaPath] = { id:supaPath, filename:supaPath, loaded:true,
  exports: { createClient: () => DB } };
const tenantPath = require.resolve(ROOT + 'api/_tenant.js');
require.cache[tenantPath] = { id:tenantPath, filename:tenantPath, loaded:true,
  exports: { tenantFromKey: async () => ({ tenantId: TENANT }), serviceClient: () => DB } };

const handler = require(ROOT + 'api/feed.js');

// XML is this endpoint's DEFAULT format, so a harness that omits it gets
// res.send and no .json -- which is how the first run of this file reported
// a working view as broken. Every call asks for JSON unless it is testing
// XML on purpose.
function call(query){
  if (!query.format) query = Object.assign({}, query, { format: 'json' });
  return new Promise(resolve => {
    const res = { _status:200, _headers:{},
      setHeader(k,v){ this._headers[k]=v; },
      status(c){ this._status=c; return this; },
      json(o){ resolve({ status:this._status, json:o, headers:this._headers }); return this; },
      send(t){ resolve({ status:this._status, body:t, headers:this._headers }); return this; } };
    handler({ query, method:'GET', headers:{} }, res);
  });
}

(async () => {
  // ---- kicking and punting, game scope ------------------------------
  const kick = await call({ view:'kicking', key:'KEY' });
  chk('view=kicking is served, not rejected', kick.status === 200 && !!kick.json,
      JSON.stringify(kick.json && kick.json.error));
  chk('...and every row actually attempted a kick',
      (kick.json.rows || []).every(r => (r.fgAtt||0)+(r.patAtt||0) > 0),
      JSON.stringify(kick.json.rows));
  chk('...with a kicker in it', (kick.json.rows || []).length > 0,
      JSON.stringify(kick.json.rows));

  const punt = await call({ view:'punting', key:'KEY' });
  chk('view=punting is served', punt.status === 200 && !!punt.json.rows);
  chk('...and every row actually punted',
      (punt.json.rows || []).every(r => (r.punts||0) > 0), JSON.stringify(punt.json.rows));
  // THE DIRECTION THAT MATTERS: a kicker who never punted must not appear
  // on the punting board with zeros, because a title bound to it puts him
  // on air as 0 for 0.
  const kickers = new Set((kick.json.rows||[]).map(r => r.player));
  const punters = new Set((punt.json.rows||[]).map(r => r.player));
  chk('a player with no punts is absent from punting, not listed as zero',
      [...kickers].every(k => !punters.has(k) || (punt.json.rows.find(r=>r.player===k).punts||0) > 0),
      JSON.stringify({kickers:[...kickers], punters:[...punters]}));

  // ---- season scope -------------------------------------------------
  const sr = await call({ view:'rushing', scope:'season', key:'KEY' });
  chk('scope=season is served', sr.status === 200, JSON.stringify(sr.json && sr.json.error));
  chk('...and says it is a season, with the year and the game count',
      sr.json.scope === 'season' && sr.json.season === '2026' && sr.json.games === '3',
      JSON.stringify({scope:sr.json.scope, season:sr.json.season, games:sr.json.games}));
  chk('...counting only the three FINAL, undeleted, non-preseason games',
      sr.json.games === '3', 'deleted and preseason rows were in the table and must not count');
  chk('...with rows', (sr.json.rows||[]).length > 0, JSON.stringify(sr.json.rows));
  // EVERY ONE OF THESE REQUIRES ROWS. `[].every()` is true, so the first
  // run of this file reported "sorted" and "no opponent players" as passing
  // against a season that had returned nothing at all.
  chk('...sorted by the ranking stat, descending',
      (sr.json.rows||[]).length > 1 &&
      (sr.json.rows||[]).every((r,i,arr) => i===0 || (arr[i-1].yds||0) >= (r.yds||0)),
      JSON.stringify((sr.json.rows||[]).map(r=>[r.player,r.yds])));

  // A season total must EXCEED any single game's, or the aggregation is
  // not aggregating.
  const g1 = await call({ view:'rushing', key:'KEY' });
  const topSeason = (sr.json.rows||[])[0] || {};
  const sameInGame = (g1.json.rows||[]).find(r => r.player === topSeason.player) || {};
  chk('a season total is larger than that player\'s single game',
      (topSeason.yds||0) > (sameInGame.yds||0),
      JSON.stringify({season:topSeason.yds, game:sameInGame.yds, player:topSeason.player}));

  chk('season rows carry no opponent players',
      (sr.json.rows||[]).length > 0 &&
      (sr.json.rows||[]).every(r => r.team === 'Riverside'),
      JSON.stringify([...new Set((sr.json.rows||[]).map(r=>r.team))]));

  // ---- season scope on a view that cannot mean anything ---------------
  for (const v of ['score','drive','lastplay','teamstats']) {
    const bad = await call({ view:v, scope:'season', key:'KEY' });
    chk('scope=season on view=' + v + ' is refused, not answered with game data',
        bad.status === 400 && /no season equivalent/i.test(bad.json.error || ''),
        JSON.stringify(bad.json));
  }

  // ---- season kicking/punting ----------------------------------------
  const sk = await call({ view:'kicking', scope:'season', key:'KEY' });
  chk('season kicking is served and filtered the same way',
      sk.status === 200 && (sk.json.rows||[]).length > 0 &&
      (sk.json.rows||[]).every(r => (r.fgAtt||0)+(r.patAtt||0) > 0),
      JSON.stringify(sk.json.rows));

  // ---- XML, which is what vMix actually binds to ----------------------
  const xml = await call({ view:'rushing', scope:'season', format:'xml', key:'KEY' });
  chk('season XML is served as XML',
      /application\/xml/.test(xml.headers['Content-Type'] || ''), JSON.stringify(xml.headers));
  chk('...and parses', (() => { try {
      new (require('jsdom').JSDOM)(xml.body, { contentType:'text/xml' });
      return !/parsererror/.test(xml.body); } catch(e){ return false; } })(),
      String(xml.body).slice(0,160));
  chk('...with one <player> element per row',
      (sr.json.rows||[]).length > 0 &&
      (String(xml.body).match(/<player[ >]/g) || []).length === (sr.json.rows||[]).length,
      String(xml.body).slice(0,200));

  console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
