// Season data for the broadcast overlay.
// =====================================================================
// The same shape and the same reason as api/gamedata.js: a browser input
// in vMix is UNAUTHENTICATED, and every RLS policy on plays and rosters
// requires an authenticated role. A page that queried Supabase directly
// got nothing back and rendered a black rectangle.
//
// So this reads server-side with the service key and hands the overlay a
// finished season in one response. It returns RAW rows, not computed
// leaders: the overlay already carries the engine, and computing the box
// score in two places is how the two stop agreeing.
//
//     /api/seasondata                -> the team's current season
//     /api/seasondata?season=2025    -> a specific one
//
// FINAL GAMES ONLY. A game in progress has no settled numbers, and a
// leaderboard that changes while it is on screen is worse than one that
// waits for the whistle.

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    res.status(500).json({ error: 'Server is missing SUPABASE_URL or SUPABASE_SECRET_KEY' });
    return;
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    const q = req.query || {};
    const teamRes = await db.from('teams')
      .select('primary_color, secondary_color, logo_url, name, current_season_year')
      .eq('is_our_team', true).limit(1);
    const ourBranding = (teamRes.data || [])[0] || {};

    // An explicit season wins; otherwise the team's current one. Without
    // either there is nothing sensible to show, and guessing "the most
    // recent games in the table" would quietly mix two seasons.
    let season = parseInt(q.season, 10);
    let resolvedBy = 'query';
    if (!Number.isFinite(season)) {
      season = ourBranding.current_season_year;
      resolvedBy = 'team-current-season';
    }
    if (!season) {
      res.status(404).json({ error: 'No season specified and no current season set' });
      return;
    }

    const { data: games, error: gamesErr } = await db.from('games')
      .select('*').eq('season_year', season).eq('status', 'final')
      .order('game_date', { ascending: true });
    if (gamesErr) throw gamesErr;

    if (!games || !games.length) {
      // NO FALLBACK TO ANOTHER SEASON, deliberately.
      // ----------------------------------------------------------------
      // Quietly answering with last season's leaders when this one has no
      // finished games would put a panel on air labelled for a year
      // nobody asked about. A season with nothing final has no leaders,
      // and the overlay showing nothing is the correct answer.
      //
      // `reason` is for a person reading this endpoint directly. The
      // overlay does not print it on air; ?debug=1 shows it in a browser.
      res.status(200).json({ season, games: [], ourBranding,
        reason: 'No finalized games found for this season',
        served: new Date().toISOString(), resolvedBy });
      return;
    }

    const ids = games.map(g => g.id);
    // Two queries for the whole season rather than two per game: a nine
    // game season was eighteen round trips, and an overlay that polls is
    // making them repeatedly.
    const [rosterRes, playsRes] = await Promise.all([
      db.from('game_rosters').select('*').in('game_id', ids),
      db.from('plays').select('*').in('game_id', ids).order('sequence_number', { ascending: true })
    ]);

    const rostersByGame = {};
    (rosterRes.data || []).forEach(r => {
      (rostersByGame[r.game_id] = rostersByGame[r.game_id] || []).push(r);
    });
    const playsByGame = {};
    (playsRes.data || []).forEach(p => {
      (playsByGame[p.game_id] = playsByGame[p.game_id] || []).push(p);
    });

    res.status(200).json({
      season,
      ourBranding,
      games: games.map(g => ({
        game: g,
        roster: rostersByGame[g.id] || [],
        plays: playsByGame[g.id] || []
      })),
      served: new Date().toISOString(),
      resolvedBy
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
};
