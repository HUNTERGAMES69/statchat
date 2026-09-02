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
const { seasonGames, aggregateSeason } = require('./_season.js');
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
function buildViews(ctx, unitParam, teamParam) {
  const { state, box, teams, plays, game } = ctx;

  const sideName = k => (teams[k] || {}).name || '';

  const distanceLabel = (state.down && state.fieldPos !== null &&
    state.fieldPos + state.distance >= 100) ? 'Goal' : state.distance;

  const markerLabel = (fp) => {
    if (fp === null || fp === undefined) return '';
    if (fp === 50) return 'the 50';
    return fp < 50 ? 'own ' + fp : 'opp ' + (100 - fp);
  };

  // See the note on startedAt below. Walks forward from the drive's first
  // index to the first position the drive establishes.
  const driveStartFieldPos = (list, from) => {
    for (let i = from; i < list.length; i++) {
      const st = engine.computeState(list.slice(0, i + 1));
      if (st.fieldPos !== null && st.fieldPos !== undefined) return st.fieldPos;
    }
    return null;
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
        // WHERE THE DRIVE STARTED. Was markerLabel(state.fieldPos), which is
        // where the ball is NOW -- the identical expression the score view
        // uses for ballOn, so the two fields were the same number under
        // different names. Found 31 Aug 2026 and confirmed against real
        // plays: a drive that began on own 34 and reached opp 40 reported
        // startedAt "opp 40". Anyone who bound a title to it has had the
        // wrong number on air, and it looked plausible because it moved.
        //
        // Nor is it the state BEFORE the drive's first play: a change of
        // possession sets fieldPos to null, so the play before a drive has
        // no position at all. The start is the first position the drive
        // itself establishes.
        startedAt: markerLabel(driveStartFieldPos(plays, from))
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
    defense: bothTeams('defense', 'tackles'),

    // KICKING AND PUNTING. Both overlays existed months before these views
    // did: broadcast_leaders.html offers ?view=kicking and ?view=punting,
    // and a crew building its own graphics had no way to get the same
    // numbers. Added 1 Sep 2026 for parity with the overlay menu.
    //
    // ONE BUCKET, TWO VIEWS. computeBoxScore keeps kicking and punting in a
    // single `specialTeams` bucket, so a placekicker and a punter sit in the
    // same object -- and on most high-school teams they are the same boy.
    // Splitting on who ATTEMPTED something, not on who is rostered where,
    // is what the overlay does and what these mirror: a punter with no
    // field-goal attempts must not appear on a kicking board with a row of
    // zeros, because a title bound to it would put him on air as 0 for 0.
    // THE STARTING LINEUP, for crews building their own lineup cards.
    // ?unit=offense|defense|special picks which; offense if unsaid.
    //
    // NOT COMPUTED FROM PLAYS. Every other view here is derived from what
    // happened; this one is a thing a coach typed on the setup screen before
    // kickoff, and it is the only view that can legitimately be empty all
    // night. An empty row set is the honest answer -- a title bound to it
    // blanks, rather than holding a lineup from a previous game.
    //
    // BOTH SHAPES ACCEPTED, as everywhere else that reads a starters column:
    // {"QB":"7"} and {"QB":{num,name}}. See game.html's seedNum/seedName.
    starters: (() => {
      // WHOSE LINEUP. ?team=opp publishes the visitors' starters; anything
      // else, including no parameter, publishes ours -- so every feed
      // address already bound in a switcher keeps returning exactly what it
      // returned before this parameter existed.
      const side = teamParam === 'opp' ? 'opp' : 'our';
      // ONE SHAPE RULE, THREE READERS -- identical to sideOf() in
      // broadcast_starters.html and bcSideOf() in create_game.html. The
      // column is nested by side, { teamA, teamB }, matching seed_starters.
      // A lineup saved before 2 Sep 2026 is a bare
      // { offense, defense, special } object and was ours by definition, so
      // it answers for 'our' and the opponent feed is empty for that game.
      const sideOf = (a, sd) => {
        if (!a || typeof a !== 'object') return null;
        if (a.teamA || a.teamB) return (sd === 'our' ? a.teamA : a.teamB) || null;
        if (a.offense || a.defense || a.special) return sd === 'our' ? a : null;
        return null;
      };
      const all = sideOf(game && game.broadcast_starters, side) || {};
      const want = ['offense','defense','special'].indexOf(unitParam) > -1 ? unitParam : 'offense';
      const ourName = game.our_team_is_home ? game.home_team_name : game.away_team_name;
      const oppName = game.our_team_is_home ? game.away_team_name : game.home_team_name;
      // The team column names the team the lineup BELONGS to, which is the
      // whole point of the parameter -- a crew binding an opponent card to
      // this feed needs the visitors' name in it, not ours.
      const lineupTeam = side === 'opp' ? oppName : ourName;
      // TWO STORED SHAPES, ONE FEED. A unit has been an ordered array --
      // [{pos, num, name}] -- since 1 Sep 2026, because position labels
      // repeat in a real lineup (DE, DT, DT, DE) and the position-keyed
      // object it replaced overwrote its own duplicates. Lineups saved
      // before that are still objects and still publish. Row ORDER is the
      // order the card reads down, and the feed preserves it.
      const unitVal = all[want];
      const rows = !unitVal ? []
        : Array.isArray(unitVal)
          ? unitVal.map(e => ({ pos: String((e && e.pos) || ''),
                                num: String((e && e.num) || ''),
                                name: String((e && e.name) || '') }))
          : Object.keys(unitVal).map(pos => {
              const v = unitVal[pos], isObj = v && typeof v === 'object';
              return { pos: String(pos),
                       num: isObj ? String(v.num || '') : String(v || ''),
                       name: isObj ? String(v.name || '') : '' };
            });
      return rows.filter(r => r.num).map(r => ({
        position: r.pos, number: r.num, player: r.name,
        unit: want, team: lineupTeam || ''
      }));
    })(),

    kicking: bothTeams('specialTeams', 'fgMade')
      .filter(r => (r.fgAtt || 0) + (r.patAtt || 0) > 0),
    punting: bothTeams('specialTeams', 'punts')
      .filter(r => (r.punts || 0) > 0)
  };
}

const ROW_NAME = {
  score: 'game', drive: 'drive', lastplay: 'play', teamstats: 'team',
  rushing: 'player', passing: 'player', receiving: 'player', defense: 'player',
  kicking: 'player', punting: 'player',
  // ROW NAME `starter`, not `player`: a vMix operator binding this is
  // building a lineup card, and <starter> reads as what it is in the XPath.
  starters: 'starter'
};

// THE VIEWS A SEASON CAN ANSWER. A season has no current drive, no last
// play and no live scoreboard, so ?scope=season on those is a question with
// no meaning -- refused by name rather than answered with a game's numbers
// under a season label, which is how somebody puts one game's score on air
// believing it is the year's.
// `starters` is absent on purpose: a starting lineup belongs to one game.
// "The season's starters" is not a thing, and answering it with the most
// recent game's card under a season label is how a stale lineup goes on air.
const SEASON_VIEWS = ['rushing', 'passing', 'receiving', 'defense', 'kicking', 'punting'];
// The bucket each leader view reads, and the key it ranks on.
const LEADER_BUCKET = {
  rushing: ['rushing', 'yds'], passing: ['passing', 'yds'],
  receiving: ['receiving', 'yds'], defense: ['defense', 'tackles'],
  kicking: ['specialTeams', 'fgMade'], punting: ['specialTeams', 'punts']
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
  // Anything that is not exactly 'season' is a game, so a typo in the
  // parameter cannot silently switch a graphic onto season totals.
  const scope = String(q.scope || 'game').toLowerCase() === 'season' ? 'season' : 'game';
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
    // ================================================================
    // ?scope=season -- the SAME numbers the season overlays put on air.
    // ================================================================
    // broadcast_leaders.html defaults to season scope, so every season
    // leader board a crew could see had no feed behind it: build your own
    // graphics and the one thing you could not have was the figure the
    // shipped overlay was already showing.
    //
    // THE DEFINITION OF "THE SEASON" IS NOT REPEATED HERE. api/_season.js
    // owns it, and api/seasondata.js -- which is what the overlay itself
    // reads -- calls the same function. That is deliberate: this rule has
    // been re-implemented three times in this repo and lost a clause every
    // time. Two copies would disagree the first week somebody changed one,
    // and the symptom is a feed and an overlay showing different totals for
    // the same player on the same screen.
    if (scope === 'season') {
      if (SEASON_VIEWS.indexOf(view) === -1) {
        res.status(400).json({
          error: 'View "' + view + '" has no season equivalent',
          reason: 'A season has no live scoreboard, current drive or last play.',
          available: SEASON_VIEWS
        });
        return;
      }

      const teamRes = await db.from('teams')
        .select('primary_color, secondary_color, logo_url, name, current_season_year')
        .eq('tenant_id', tenantId).limit(1);
      const ourTeam = (teamRes.data || [])[0] || {};

      // An explicit season wins; otherwise the team's current one. Same
      // resolution order as seasondata.js, so a crew that omits ?season on
      // one address and not the other still gets one answer.
      let season = parseInt(q.season, 10);
      let seasonResolvedBy = 'query';
      if (!Number.isFinite(season)) {
        season = ourTeam.current_season_year;
        seasonResolvedBy = 'team-current-season';
      }
      if (!season) {
        res.status(404).json({ error: 'No season specified and no current season set' });
        return;
      }

      const { data: games } = await seasonGames(db, tenantId, season);
      const list = games || [];

      // NO GAMES IS NOT AN ERROR. Preseason, or the first week. The overlay
      // draws nothing; the feed answers with an empty row set and says why,
      // so a title bound to it blanks rather than holding last week's
      // numbers on screen.
      let rows = [];
      if (list.length) {
        const ids = list.map(g => g.id);
        // Two queries for the whole season, not two per game -- a nine-game
        // season was eighteen round trips on a feed that polls.
        const [rosterRes, playsRes] = await Promise.all([
          db.from('game_rosters').select('*').in('game_id', ids),
          db.from('plays').select('*').in('game_id', ids)
            .order('sequence_number', { ascending: true })
        ]);
        const rostersBy = {}, playsBy = {};
        (rosterRes.data || []).forEach(r => {
          (rostersBy[r.game_id] = rostersBy[r.game_id] || []).push(r); });
        (playsRes.data || []).forEach(p2 => {
          (playsBy[p2.game_id] = playsBy[p2.game_id] || []).push(p2); });

        const boxes = list.map(g => engine.buildContext(
          g, rostersBy[g.id] || [], playsBy[g.id] || [], ourTeam).box);
        const agg = aggregateSeason(boxes);

        const [bucket, sortKey] = LEADER_BUCKET[view];
        const teamName = ourTeam.name ||
          (list[0].our_team_is_home ? list[0].home_team_name : list[0].away_team_name) || '';
        rows = Object.keys(agg[bucket] || {})
          .map(name => Object.assign({ player: name, team: teamName }, agg[bucket][name]))
          // Same split as the game-scoped views: who ATTEMPTED something,
          // not who is rostered where. See the note on those.
          .filter(r => view === 'kicking' ? (r.fgAtt || 0) + (r.patAtt || 0) > 0
                     : view === 'punting' ? (r.punts || 0) > 0
                     : true)
          .sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
      }

      const seasonMeta = {
        view, scope: 'season', season: String(season),
        games: String(list.length),
        team: ourTeam.name || '',
        onAir: 'n/a',
        resolvedBy: seasonResolvedBy,
        updated: new Date().toISOString()
      };
      if (format === 'json') {
        res.status(200).json(Object.assign({}, seasonMeta, { rows }));
        return;
      }
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.status(200).send(toXml('player', rows, seasonMeta));
      return;
    }

    // Which game? THE FLAG, and only the flag.
    // SCOPED TO THE TENANT THE KEY NAMES. Without this the endpoint
    // serves whichever school happens to be on air — and after 010 the
    // broadcast flag is unique PER TENANT, so with two schools
    // broadcasting there are genuinely two rows to choose between.
    // AND NOT A DELETED ONE. delete_game() sets deleted_at and leaves
    // is_broadcast alone, so a game deleted while it was on air stays
    // flagged -- and this query, holding the service key, would go on
    // serving it to every overlay. See the note in api/seasondata.js.
    let { data: flagged } = await db.from('games')
      .select('*').eq('is_broadcast', true).eq('tenant_id', tenantId)
      .is('deleted_at', null).limit(1);
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
    const views = buildViews(ctx, String(q.unit || 'offense').toLowerCase(),
                             String(q.team || 'our').toLowerCase());
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
