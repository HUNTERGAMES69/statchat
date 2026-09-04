// Public read-only game data, for the broadcast overlay
// -----------------------------------------------------
// WHY THIS EXISTS: every RLS policy on the database is
// `auth.role() = 'authenticated'`. vMix has no browser session and cannot
// sign in, so when broadcast.html queried Supabase directly it got
// nothing back and drew an empty (transparent) canvas -- which is what a
// black page in vMix looks like.
//
// The alternative was adding public-read RLS policies, which would open
// every game to anyone with the anon key. This is narrower: the service
// role key stays on the server, and this endpoint returns ONE game's
// read-only data and nothing else. No write path, no user data, no
// listing of games -- you must already know the game id.
//
// Still a deliberate decision to make part of a game public. See TODO 8d
// on whether it should require a per-game token.
//
//   GET /api/gamedata?id=<gameId>

const { createClient } = require('@supabase/supabase-js');
const { tenantFromKey } = require('./_tenant');

// A ONE-SECOND MICRO-CACHE. Added 4 September 2026.
// ---------------------------------------------------------------------
// Measured from the API logs that evening: two tenants with games open
// generated 41 requests/second against Postgres, because every overlay
// poll runs this handler and this handler fans out to SEVEN queries. The
// same six queries repeated 40-95 times inside a twelve-second window.
// At sixteen tenants that is roughly 330 requests/second and about 3.5
// million over a three-hour game night.
//
// The "never cache" rule above it is still right, and the reasoning is
// unchanged: a scoreboard thirty seconds stale is worse than no
// scoreboard. But ONE second is not thirty. No human watching a
// broadcast can perceive a scoreboard one second late -- a play takes
// longer than that to type -- and it removes about 95% of the load.
//
// WHAT THE KEY IS. The feed key, plus the explicit game id when one is
// given. The feed key resolves to exactly one tenant, so two schools can
// never share an entry: different key, different cache slot. This is the
// whole multi-tenant argument and it must not be weakened to, say,
// caching on game id alone.
//
// THE COST, STATED PLAINLY: a cache hit skips the key validation too, so
// a REVOKED feed key keeps working for up to one more second. That is a
// deliberate trade and a bounded one -- a key is revoked because it
// leaked, and one second changes nothing about that.
//
// Only 200 and 404 are cached. A 401 must always re-check the key, and a
// 500 must never be repeated back as though it were an answer.
// TWO SECONDS, NOT ONE. Corrected 4 September 2026, an hour before kickoff.
//
// The first version used 1000ms and I claimed it removed ~95% of the load.
// That was wrong, and a Network tab caught it: every overlay polls this
// endpoint every POLL_MS = 2000ms, so a one-second entry ALWAYS expired
// before the next poll arrived. A single overlay could never hit the
// cache once -- every response was the full seven-query fan-out, 430-850ms.
//
// What this actually does is cap database reads at 1/TTL per key, however
// many overlays are watching. So the saving is not a fixed percentage; it
// depends on how many overlays share a feed key:
//
//     overlays   uncached   TTL=1s    TTL=2s
//        1        0.50/s     0.50/s    0.50/s      0%  /  0%
//        2        1.00/s     1.00/s    0.50/s      0%  / 50%
//        3        1.50/s     1.00/s    0.50/s     33%  / 67%
//        6        3.00/s     1.00/s    0.50/s     67%  / 83%
//
// Matching the TTL to the poll interval is the point: it makes every
// second poll a guaranteed hit instead of a guaranteed miss.
//
// THE COST IN FRESHNESS IS ALMOST NOTHING, and this is why Andy agreed to
// it. The overlay only redraws every two seconds, so its data was already
// up to two seconds old before it reached the screen. This takes the
// worst case from about three seconds to about four. The rule that
// mattered -- "a scoreboard thirty seconds stale is worse than no
// scoreboard" -- is nowhere near being tested by four.
const CACHE_TTL_MS = 2000;
const CACHE_MAX = 200;          // bounded: a warm Vercel instance is long-lived
const cache = new Map();

function cacheGet(k){
  const e = cache.get(k);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS){ cache.delete(k); return null; }
  return e;
}
function cacheSet(k, status, body){
  if (cache.size >= CACHE_MAX){
    let oldestKey = null, oldestAt = Infinity;
    for (const [kk, v] of cache){ if (v.at < oldestAt){ oldestAt = v.at; oldestKey = kk; } }
    if (oldestKey !== null) cache.delete(oldestKey);
  }
  cache.set(k, { at: Date.now(), status, body });
}

module.exports = async (req, res) => {
  // The overlay may be served from a different origin than the API in
  // some vMix setups, and a browser input enforces CORS like any browser.
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Never cache. A scoreboard that is thirty seconds stale is worse than
  // no scoreboard, and cached responses are the usual cause of a vMix
  // data source appearing to freeze.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' });
    return;
  }

  // The id is now OPTIONAL. broadcast.html used to require one, which
  // meant the overlay address had to be edited every week -- and once the
  // ON AIR flag existed that was simply wrong: the flag is how you say
  // which game is being broadcast. Without an id, resolve it the same way
  // api/feed.js does, so both routes always agree on the game.
  const gameId = (req.query && req.query.id) || null;

  // The cache is consulted here: after the method checks, before any work.
  // Keyed on the feed key so a hit can never cross tenants.
  const rawKey = (req.query && req.query.key) || '';
  const cacheKey = rawKey + '|' + (gameId || '');
  const hit = cacheGet(cacheKey);
  if (hit){
    res.setHeader('X-StatChat-Cache', 'hit');
    res.status(hit.status).json(hit.body);
    return;
  }
  res.setHeader('X-StatChat-Cache', 'miss');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    res.status(500).json({ error: 'Server is missing SUPABASE_URL or SUPABASE_SECRET_KEY' });
    return;
  }

  // THIS ENDPOINT HAD NO AUTHENTICATION AT ALL until 24 Aug 2026 — no
  // key, no token, nothing. With one school that exposed one school's
  // live game to anyone who found the URL, which was a known and
  // accepted position. With two it is a cross-tenant leak, and the
  // service role bypasses the 009 policies, so nothing downstream would
  // have caught it.
  const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { tenantId, error: keyError, status: keyStatus } =
    await tenantFromKey(db, (req.query && req.query.key));
  if (keyError) { res.status(keyStatus).json({ error: keyError }); return; }

  try {
    // Resolve the game: an explicit id, else the FLAGGED game. Nothing
    // else.
    //
    // THE in-progress FALLBACK WAS REMOVED, 22 Aug 2026. It served the
    // most recent in-progress game when no game was flagged, so that a
    // forgotten flag degraded to "probably right" rather than to
    // nothing. Reported from real use: with no game on air the overlays
    // were still showing data, which meant taking a game OFF air had no
    // observable effect -- the control did not do what it said.
    //
    // It also contradicted the warning the dashboard gives when you take
    // a game down ("if no other game is live they may show nothing at
    // all"), and it silently followed the wrong game whenever two were
    // open, or when one was left at in_progress from a previous week.
    //
    // A blank overlay is a better failure than a confident wrong one: it
    // is obvious from the gallery, and the wrong game is not.
    let resolvedId = gameId, resolvedBy = 'id';
    if (!resolvedId) {
      // NOT A DELETED GAME. delete_game() does not clear is_broadcast, so
      // one deleted while on air stays flagged and this service-key query
      // would keep handing it to the crew view and every overlay.
      const { data: flagged } = await db.from('games')
        .select('id').eq('is_broadcast', true).eq('tenant_id', tenantId)
        .is('deleted_at', null).limit(1);
      if ((flagged || [])[0]) {
        resolvedId = flagged[0].id; resolvedBy = 'broadcast flag';
      }
    }
    if (!resolvedId) {
      const body = { error: 'No game is on air' };
      cacheSet(cacheKey, 404, body);
      res.status(404).json(body);
      return;
    }

    const [gameRes, rosterRes, playsRes, teamRes, tenantRes] = await Promise.all([
      // SCOPED. `?id=` is caller-supplied, so without this a request could
        // name any school's game by id and be handed it.
        // `.is('deleted_at', null)` for the same reason as the scoping
        // beside it: a deleted game is not a game, and an ?id= link to one
        // must 404 rather than render it.
        db.from('games').select('*').eq('id', resolvedId).eq('tenant_id', tenantId)
          .is('deleted_at', null).limit(1),
      db.from('game_rosters').select('*').eq('game_id', resolvedId),
      db.from('plays').select('*').eq('game_id', resolvedId).order('sequence_number', { ascending: true }),
      db.from('teams').select('primary_color, secondary_color, logo_url').eq('tenant_id', tenantId).limit(1),
      // WHO GETS THE SPONSOR BAR, ANSWERED HERE RATHER THAN IN THE URL.
      // broadcast_stats.html carries a banner hardcoded to one school's
      // sponsor. Defaulting it off and switching it on with something like
      // ?sponsor=nettech would hide it, not restrict it -- anyone seeing the
      // parameter could put that sponsor on their own broadcast.
      //
      // tenantId here came FROM THE OVERLAY KEY and was validated above. An
      // overlay is a browser source in vMix with no session, so the key is
      // the only identity it has -- which makes this the one place the
      // question can be answered honestly.
      db.from('tenants').select('sponsor_bar').eq('id', tenantId).limit(1)
    ]);

    const game = (gameRes.data || [])[0];
    if (!game) {
      const body = { error: 'No such game' };
      cacheSet(cacheKey, 404, body);
      res.status(404).json(body);
      return;
    }

    // `served` is stamped when the data was actually READ, and a cache hit
    // replays that original stamp rather than refreshing it. That is the
    // honest answer: an overlay greys itself out from this field, and a
    // stamp refreshed on replay would tell it the data is newer than it is.
    const body = {
      game,
      roster: rosterRes.data || [],
      plays: playsRes.data || [],
      ourBranding: (teamRes.data || [])[0] || {},
      // Explicit boolean, never undefined: the overlay treats anything but
      // true as "no bar", and a missing column should read as off rather
      // than as unknown.
      sponsorBar: !!((tenantRes.data || [])[0] || {}).sponsor_bar,
      // So an overlay can tell how fresh this is, and grey itself out if
      // the scorer's device has stopped sending.
      served: new Date().toISOString(),
      resolvedBy
    };
    cacheSet(cacheKey, 200, body);
    res.status(200).json(body);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
};
