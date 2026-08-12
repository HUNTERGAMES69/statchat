// nflverse play-by-play -> StatChat UI actions
// --------------------------------------------
// One PBP row becomes one enterPlay() spec, or null when the row is
// something StatChat does not model as a play (timeouts, end-of-quarter
// markers, two-minute warnings).
//
// The important coordinate translation: nflverse `yardline_100` is yards
// to the OPPONENT'S goal line, while StatChat's fieldPos is
// possession-relative from your OWN goal. They are complements:
//
//     fieldPos = 100 - yardline_100
//
// Rosters are synthesised. nflverse gives names, not jersey numbers, so
// each game gets a roster built from the players who actually appear,
// numbered sequentially. That is enough for the comparison, which is
// about yardage and counts rather than who wore what.

// nflverse marks these as play_type but they are not scrimmage plays we
// can drive through the normal panels.
const SKIP_TYPES = new Set(['no_play', 'qb_kneel', 'qb_spike', '', 'NA']);

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
function truthy(v) {
  return v === '1' || v === 1 || v === 'TRUE' || v === 'True' || v === true;
}

// Build a name -> jersey number roster for one game, split by the role
// each player was actually seen performing so the pickers behave.
function buildRoster(rows, teamAbbrForA) {
  // Keyed by PLAYER ID, not by name. Two different people can share a
  // name -- 2023_03_TEN_CLE has DeAndre Hopkins receiving for Tennessee
  // and Dustin Hopkins kicking for Cleveland, both "D.Hopkins". Keying by
  // name collapsed them into one player filed as a kicker, and the
  // receiver's seven catches vanished. Exactly the lesson the app itself
  // learned about jersey numbers: a label is not an identity.
  const seen = new Map();   // id -> { name, team, positions:Set }
  const note = (id, name, team, pos) => {
    if (!id || id === 'NA' || !name || name === 'NA') return;
    if (!seen.has(id)) seen.set(id, { name, team, positions: new Set() });
    seen.get(id).positions.add(pos);
  };
  for (const r of rows) {
    note(r.rusher_player_id, r.rusher_player_name, r.posteam, 'RB');
    note(r.passer_player_id, r.passer_player_name, r.posteam, 'QB');
    note(r.receiver_player_id, r.receiver_player_name, r.posteam, 'WR');
    note(r.punter_player_id, r.punter_player_name, r.posteam, 'P');
    note(r.kicker_player_id, r.kicker_player_name, r.posteam, 'K');
    note(r.interception_player_id, r.interception_player_name, r.defteam, 'DB');
    note(r.sack_player_id, r.sack_player_name, r.defteam, 'DL');
  }
  const roster = [];
  const numberFor = new Map();   // id -> jersey
  let next = 1;
  for (const [id, info] of seen) {
    const jersey = String(next++);
    const name = info.name;
    numberFor.set(id, jersey);
    const positions = [...info.positions];
    // A player can appear in more than one role across a game (a
    // quarterback who also runs). Only the FIRST role becomes his roster
    // position; the pickers accumulate the rest from actual usage, which
    // is the behaviour we want to exercise anyway.
    const pos = positions[0];
    const unit = (pos === 'DB' || pos === 'DL') ? 'defense'
               : (pos === 'P' || pos === 'K') ? 'special' : 'offense';
    roster.push({
      team_side: info.team === teamAbbrForA ? 'teamA' : 'teamB',
      unit, jersey_number: jersey, player_name: name, position: pos
    });
  }
  return { roster, numberFor };
}

// Convert one row. Returns { kind, spec } or null.
//   kind 'play'  -> drive through ui_driver.enterPlay
//   kind 'setup' -> a down/distance/spot correction before the play
function convertRow(row, numberFor, teamAbbrForA) {
  const type = row.play_type;
  if (SKIP_TYPES.has(type)) {
    // A kneel is still a play for StatChat -- a TEAM rush -- and it is
    // flagged on the row rather than given its own play_type.
    if (truthy(row.qb_kneel)) return { kind: 'kneel' };
    return null;
  }

  const jersey = id => (id && id !== 'NA') ? numberFor.get(id) : null;
  const gained = num(row.yards_gained);

  // A touchdown on the row is NOT necessarily a touchdown by the player
  // who carried or caught it. Week 4 of 2023 turned up:
  //
  //   B.Robinson left end to PHI 1 for no gain. FUMBLES,
  //   recovered by WAS-17-T.McLaurin at PHI -4. TOUCHDOWN.
  //
  //   rusher B.Robinson, yards_gained 0, touchdown 1,
  //   td_player T.McLaurin, td_team WAS == posteam
  //
  // The old test -- touchdown AND td_team === posteam -- was true, so the
  // converter entered it as a RUSHING touchdown by Robinson. StatChat then
  // did exactly the right thing for a rushing TD and filled in the yardage
  // to reach the end zone, giving him one yard he never gained. The app
  // was correct; the harness handed it the wrong play.
  //
  // So: credit the touchdown only when the SCORER is the player being
  // credited with the play.
  const scoredIt = (playerId) =>
    truthy(row.touchdown) &&
    row.td_team === row.posteam &&
    (!row.td_player_id || row.td_player_id === 'NA' ||
     row.td_player_id === playerId);

  if (type === 'run') {
    const carrier = jersey(row.rusher_player_id);
    if (!carrier) return null;
    return { kind: 'play', spec: {
      type: 'rush', carrier,
      yards: String(Math.abs(gained)),
      loss: gained < 0,
      td: scoredIt(row.rusher_player_id),
      fumble: truthy(row.fumble_lost) ? 'lost' : null
    } };
  }

  if (type === 'pass') {
    const passer = jersey(row.passer_player_id);
    if (!passer) return null;
    if (truthy(row.sack)) {
      return { kind: 'play', spec: {
        type: 'sack', passer, yards: String(Math.abs(gained))
      } };
    }
    if (truthy(row.interception)) {
      return { kind: 'play', spec: {
        type: 'int', passer,
        credit: jersey(row.interception_player_id),
        receiver: jersey(row.receiver_player_id)
      } };
    }
    const receiver = jersey(row.receiver_player_id);
    if (!truthy(row.complete_pass)) {
      return { kind: 'play', spec: {
        type: 'pass', passer, receiver, incomplete: true
      } };
    }
    return { kind: 'play', spec: {
      type: 'pass', passer, receiver,
      yards: String(Math.abs(gained)),
      loss: gained < 0,
      // The RECEIVER scores on a completed pass, so that is whose id must
      // match -- a pass caught and then fumbled into the end zone by a
      // team-mate is not a receiving touchdown.
      td: scoredIt(row.receiver_player_id)
    } };
  }

  if (type === 'punt') {
    const punter = jersey(row.punter_player_id);
    if (!punter) return null;
    return { kind: 'play', spec: {
      type: 'punt', punter, yards: String(num(row.kick_distance) || 0)
    } };
  }

  if (type === 'field_goal') {
    const kicker = jersey(row.kicker_player_id);
    if (!kicker) return null;
    return { kind: 'play', spec: {
      type: 'fg', kicker,
      yards: String(num(row.kick_distance) || 0),
      result: row.field_goal_result === 'made' ? 'g' : 'x'
    } };
  }

  if (type === 'extra_point') {
    const kicker = jersey(row.kicker_player_id);
    if (!kicker) return null;
    return { kind: 'play', spec: {
      type: 'pat', kicker,
      result: row.extra_point_result === 'good' ? 'g' : 'x'
    } };
  }

  // Kickoffs are skipped deliberately: StatChat models the ensuing spot
  // through its own guided flow and the comparison here is about
  // scrimmage production, not kick coverage.
  if (type === 'kickoff') return null;

  return null;
}

// fieldPos StatChat expects, from nflverse yardline_100.
function fieldPosFrom(row) {
  const yl100 = num(row.yardline_100);
  if (!row.yardline_100 || row.yardline_100 === 'NA') return null;
  return 100 - yl100;
}

module.exports = { buildRoster, convertRow, fieldPosFrom, num, truthy };
