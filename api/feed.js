// Broadcast data feed
// ===================
// Serves live game data to broadcast software as XML or JSON.
//
//   GET /api/feed?view=score&format=xml&key=<static>
//
// THE URL NEVER CHANGES. No game id, no season, nothing that varies week
// to week -- the crew sets up their data sources once and never touches
// them again. The endpoint resolves WHICH game itself, from the
// `is_broadcast` flag set on the dashboard.
//
// VENDOR-NEUTRAL BY DESIGN. vMix is what Andy uses today, but this is a
// URL returning data; OBS, Singular, CasparCG and Wirecast all consume
// the same thing. Only `format` varies. No field is ever named after a
// vendor -- the feed describes FOOTBALL, and each suite maps it to its
// own template.
//
// AUTHENTICATION is one static key, because broadcast software cannot
// sign in. It is a shared secret in a URL: it stops casual discovery,
// not a determined person. Acceptable because the payload is a live
// scoreboard, and RLS protects everything that matters.

const { createClient } = require('@supabase/supabase-js');
const { tenantFromKey } = require('./_tenant');
const engine = require('./_engine.js');
const { countPossessions, countTurnovers, quarterLabel } = engine;

// ---------------------------------------------------------------- utils

function xmlEscape(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Rows -> XML. Every value becomes an attribute, because that is what
// broadcast data sources bind to most easily.
function toXml(rowName, rows, meta) {
  const attrs = o => Object.keys(o)
    .map(k => ' ' + k + '="' + xmlEscape(o[k]) + '"').join('');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<feed' + attrs(meta || {}) + '>\n' +
    rows.map(r => '  <' + rowName + attrs(r) + ' />').join('\n') +
    '\n</feed>\n';
}

const mmss = (secs) => {
  const s = Math.max(0, Math.round(secs || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

// ---------------------------------------------------------------- views
// Each returns an array of rows. One row = one record in the consuming
// software; a title binds to a row, so the shape matters as much as the
// numbers.

// NO ABBREVIATION FIELDS. There used to be homeAbbr / awayAbbr /
// possessionAbbr, derived by taking the first word of the team name --
// which for "Neville" and "Ruston" returned the full name unchanged. A
// field called `abbr` that returns the whole name is worse than no
// field: bind a narrow scoreboard slot to it expecting "RUS" and you get
// "Ruston" with nothing to explain why.
//
// Andy uses full names, so they were removed rather than faked. If short
// codes are ever wanted they need a STORED field per team -- deriving
// them guesses badly ("St. Aloysius" -> "St.").
function buildViews(ctx) {
  const { state, box, teams, plays, game } = ctx;

  const sideName = k => (teams[k] || {}).name || '';

  const distanceLabel = (state.down && state.fieldPos !== null &&
    state.fieldPos + state.distance >= 100) ? 'Goal' : state.distance;

  const markerLabel = (fp) => {
    if (fp === null || fp === undefined) return '';
    if (fp === 50) return 'the 50';
    return fp < 50 ? 'own ' + fp : 'opp ' + (100 - fp);
  };

  const sumOf = (bucket, key) => Object.keys(bucket || {})
    .reduce((t, n) => t + ((bucket[n] || {})[key] || 0), 0);

  const teamRow = (k) => {
    const s = box[k] || {};
    const rush = sumOf(s.rushing, 'yds');
    const pass = sumOf(s.passing, 'yds');
    return {
      team: sideName(k),
      score: (state.scores || {})[k] || 0,
      rushYards: rush, passYards: pass, totalYards: rush + pass,
      rushAtt: sumOf(s.rushing, 'att'),
      passComp: sumOf(s.passing, 'comp'),
      passAtt: sumOf(s.passing, 'att'),
      firstDowns: (s.oppDowns || {}).firstDowns || 0,
      thirdDownConv: (s.oppDowns || {}).d3conv || 0,
      thirdDownAtt: (s.oppDowns || {}).d3att || 0,
      thirdDownPct: (s.oppDowns || {}).d3Pct || 0,
      fourthDownConv: (s.oppDowns || {}).d4conv || 0,
      fourthDownAtt: (s.oppDowns || {}).d4att || 0,
      explosive: (s.oppDowns || {}).explosive || 0,
      sacks: sumOf(s.defense, 'sacks'),
      interceptions: sumOf(s.defense, 'int'),
      fumbleRec: sumOf(s.defense, 'fumRec'),
      timeouts: (state.timeouts || {})[k] || 0,
      timeOfPossession: mmss((state.possessionTime || {})[k]),
      // Added 12 Aug after the coverage test found them missing. All
      // three are on the view page's per-team tiles, so a production
      // team looking at the app would reasonably expect them -- and
      // nothing would have told us they were absent.
      possessions: (countPossessions(plays) || {})[k] || 0,
      turnovers: (countTurnovers(plays) || {})[k] || 0,
      penaltyCount: ((state.penalties || {})[k] || {}).count || 0,
      penaltyYards: ((state.penalties || {})[k] || {}).yds || 0,
      // Pre-formatted the way the view page shows it ("4-35"), so a
      // single text field can bind straight to it.
      penalties: (((state.penalties || {})[k] || {}).count || 0) + '-' +
                 (((state.penalties || {})[k] || {}).yds || 0),
      totalPlays: plays.filter(p => p.team === k && p.roles &&
        ['rush','pass','incomplete','sack','int','fumble']
          .includes(p.roles.playType)).length
    };
  };

  // Players, best first, so a "leaders" graphic can simply take row 1.
  const players = (teamKey, cat, sortKey) => {
    const b = (box[teamKey] || {})[cat] || {};
    return Object.keys(b)
      .map(name => Object.assign({ player: name, team: sideName(teamKey) }, b[name]))
      // Keep anyone with ANY stat in the category, not just the one being
      // sorted on. The old filter tested the sort key plus att/rec/tgt,
      // which meant a defender with a sack and no tackles was dropped --
      // and the whole `defense` view returned zero rows for a game that
      // contained a sack and an interception. The coverage test found it.
      .filter(r => Object.keys(r).some(k =>
        k !== 'player' && k !== 'team' && (r[k] || 0) !== 0))
      .sort((a, b2) => (b2[sortKey] || 0) - (a[sortKey] || 0));
  };
  const bothTeams = (cat, sortKey) =>
    players('teamA', cat, sortKey).concat(players('teamB', cat, sortKey));

  const lastReal = [...plays].reverse()
    .find(p => p.effect && p.effect.isStat);

  return {
    // One row: the scoreboard bug.
    score: [{
      homeTeam: sideName('teamA'),
      homeScore: (state.scores || {}).teamA || 0,
      awayTeam: sideName('teamB'),
      awayScore: (state.scores || {}).teamB || 0,
      // Through quarterLabel, so the scoreboard bug says OT1 / OT2 / OT3
      // exactly as the app does. A flat 'OT' told a viewer nothing about
      // which overtime they were watching, which by the third is the only
      // thing anyone wants to know.
      quarter: quarterLabel(state),
      quarterNumber: state.quarter,
      // The overtime round on its own, for an operator who wants to build
      // their own wording. 0 outside overtime, so a template can test it.
      overtimeRound: state.quarter >= 5 ? Math.max(1, Math.ceil((state.otSeries || 1) / 2)) : 0,
      down: state.down || '',
      downOrdinal: state.down ? ['', '1st', '2nd', '3rd', '4th'][state.down] : '',
      distance: state.down ? distanceLabel : '',
      downAndDistance: state.down
        ? (['', '1st', '2nd', '3rd', '4th'][state.down] + ' & ' + distanceLabel) : '',
      ballOn: markerLabel(state.fieldPos),
      possession: sideName(state.possession),
      homeHasBall: state.possession === 'teamA' && state.down ? 'true' : 'false',
      awayHasBall: state.possession === 'teamB' && state.down ? 'true' : 'false',
      homeTimeouts: (state.timeouts || {}).teamA || 0,
      awayTimeouts: (state.timeouts || {}).teamB || 0
    }],

    // One row: the current drive.
    drive: [(() => {
      const starts = engine.findDriveStarts(plays);
      const from = starts.length ? starts[starts.length - 1] : 0;
      const drive = plays.slice(from);
      const scrimmage = drive.filter(p => p.effect && p.effect.isStat);
      return {
        team: sideName(state.possession),
        plays: scrimmage.length,
        yards: scrimmage.reduce((t, p) => t + (p.effect.statYds || 0), 0),
        startedAt: markerLabel(state.fieldPos)
        // NO timeOfPossession HERE. It used to report
        // state.possessionTime[possession], which is the team's CUMULATIVE
        // total for the game -- the same figure the teamstats row carries,
        // sitting in a row whose every other field (plays, yards,
        // startedAt) is scoped to this drive. An operator binding it would
        // read "time on this drive" and put a wrong number on air, and it
        // would look plausible all night because it grows.
        //
        // Dropped rather than corrected, on Andy's call: a drive's own TOP
        // only accrues when a closing clock event is entered, so a LIVE
        // drive reads 0:00 until it ends. A field that is always zero
        // while anyone would look at it is not worth broadcasting.
        // Cumulative time of possession is in the teamstats view.
      };
    })()],

    // One row: ticker text.
    lastplay: [{
      text: lastReal ? lastReal.text : '',
      // A play in overtime is tagged OT, not Q5 -- matching the drive log
      // on both pages. Unnumbered on purpose: the tag belongs to the
      // PLAY, and the round is a property of the current state, so
      // numbering it here would relabel an old play as the game moved on.
      quarter: lastReal ? ((lastReal.quarter || state.quarter) >= 5 ? 'OT' : 'Q' + (lastReal.quarter || state.quarter)) : '',
      team: lastReal ? sideName(lastReal.team) : ''
    }],

    // Two rows, one per team: side-by-side comparison.
    teamstats: [teamRow('teamA'), teamRow('teamB')],

    rushing: bothTeams('rushing', 'yds'),
    passing: bothTeams('passing', 'yds'),
    receiving: bothTeams('receiving', 'yds'),
    defense: bothTeams('defense', 'tackles')
  };
}

const ROW_NAME = {
  score: 'game', drive: 'drive', lastplay: 'play', teamstats: 'team',
  rushing: 'player', passing: 'player', receiving: 'player', defense: 'player'
};

// --------------------------------------------------------------- handler

module.exports = async (req, res) => {
  // Broadcast software fetches cross-origin like any browser.
  res.setHeader('Access-Control-Allow-Origin', '*');
  // NEVER CACHE. This is the classic cause of a data source that fetches
  // once and then appears frozen for the rest of the night -- it works
  // perfectly in testing and fails on air.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const q = (req.query) || {};
  const view = String(q.view || 'score').toLowerCase();
  const format = String(q.format || 'xml').toLowerCase();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    res.status(500).json({ error: 'Server is missing Supabase configuration' });
    return;
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // THE KEY IS NOW THE TENANT, not a single shared secret. See
  // api/_tenant.js for why, and for why the old `if (FEED_KEY && ...)`
  // could not simply be deleted — it only checked the key IF the
  // variable was set, so unsetting it opened the feed to everyone.
  //
  // This runs BEFORE any query. The service role bypasses RLS, so
  // nothing downstream will stop a caller reading another school.
  const { tenantId, error: keyError, status: keyStatus } =
    await tenantFromKey(db, q.key);
  if (keyError) { res.status(keyStatus).json({ error: keyError }); return; }

  try {
    // Which game? THE FLAG, and only the flag.
    // SCOPED TO THE TENANT THE KEY NAMES. Without this the endpoint
    // serves whichever school happens to be on air — and after 010 the
    // broadcast flag is unique PER TENANT, so with two schools
    // broadcasting there are genuinely two rows to choose between.
    let { data: flagged } = await db.from('games')
      .select('*').eq('is_broadcast', true).eq('tenant_id', tenantId).limit(1);
    let game = (flagged || [])[0];
    let resolvedBy = 'broadcast flag';
    // THE in-progress FALLBACK WAS REMOVED, 22 Aug 2026 -- see the note in
    // api/gamedata.js, which carried the identical block. With no game
    // flagged the feed served the most recent in-progress game instead,
    // so "off air" changed nothing a viewer could see.
    
    if (!game) {
      const empty = { error: 'No game is on air' };
      if (format === 'json') { res.status(200).json(empty); return; }
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.status(200).send(toXml('game', [], { onAir: 'false' }));
      return;
    }

    const [rosterRes, playsRes, teamRes] = await Promise.all([
      db.from('game_rosters').select('*').eq('game_id', game.id),
      db.from('plays').select('*').eq('game_id', game.id)
        .order('sequence_number', { ascending: true }),
      db.from('teams').select('primary_color, secondary_color, logo_url')
        .eq('tenant_id', tenantId).limit(1)
        // ^ BRANDING BY TENANT, not by is_our_team. Hazard 0 inside a
        // service-key endpoint, where it is worse than in the app: RLS
        // would have scoped it there, and here nothing does. With two
        // schools `is_our_team` matches a row in EACH, and an unordered
        // limit(1) returns whichever Postgres feels like — the overlay
        // would wear the wrong school's colours, with no error anywhere
    ]);

    const ctx = engine.buildContext(game, rosterRes.data || [],
                                    playsRes.data || [],
                                    (teamRes.data || [])[0] || {});
    const views = buildViews(ctx);
    const rows = views[view];
    if (!rows) {
      res.status(400).json({
        error: 'Unknown view: ' + view,
        available: Object.keys(views)
      });
      return;
    }

    const meta = {
      view,
      onAir: 'true',
      game: [game.home_team_name, game.away_team_name].filter(Boolean).join(' vs '),
      gameDate: game.game_date || '',
      status: game.status || '',
      resolvedBy,
      // So a graphic can grey itself out, and a producer can see at a
      // glance whether the feed is actually live.
      updated: new Date().toISOString()
    };

    if (format === 'json') {
      res.status(200).json(Object.assign({}, meta, { rows }));
      return;
    }
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(200).send(toXml(ROW_NAME[view] || 'row', rows, meta));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
};
