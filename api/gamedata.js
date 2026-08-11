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

  const gameId = (req.query && req.query.id) ||
    new URL(req.url, 'http://x').searchParams.get('id');
  if (!gameId) { res.status(400).json({ error: 'A game id is required' }); return; }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    res.status(500).json({ error: 'Server is missing SUPABASE_URL or SUPABASE_SECRET_KEY' });
    return;
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    const [gameRes, rosterRes, playsRes, teamRes] = await Promise.all([
      db.from('games').select('*').eq('id', gameId).limit(1),
      db.from('game_rosters').select('*').eq('game_id', gameId),
      db.from('plays').select('*').eq('game_id', gameId).order('sequence_number', { ascending: true }),
      db.from('teams').select('primary_color, secondary_color, logo_url').eq('is_our_team', true).limit(1)
    ]);

    const game = (gameRes.data || [])[0];
    if (!game) { res.status(404).json({ error: 'No such game' }); return; }

    res.status(200).json({
      game,
      roster: rosterRes.data || [],
      plays: playsRes.data || [],
      ourBranding: (teamRes.data || [])[0] || {},
      // So an overlay can tell how fresh this is, and grey itself out if
      // the scorer's device has stopped sending.
      served: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
};
