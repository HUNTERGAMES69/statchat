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
    // ON A KICKOFF, posteam IS THE RECEIVING TEAM. Verified against the
    // 2023 file: Matt Prater kicks off for Arizona and every one of those
    // rows carries posteam WAS. Since `note` fixes a player's team the
    // first time it sees him, and the first thing a kicker does in a game
    // is kick off, every kicker in every game was being filed with the
    // OPPONENT -- invisible while kickoffs were the only plays he
    // appeared in, and wrong the moment he did anything else.
    //
    // 2023_18_JAX_TEN is where it showed: Tennessee's punter takes an
    // aborted snap and runs for seven. StatChat recorded the carry
    // correctly; this file had him down as a Jacksonville player, so the
    // comparison looked for it on the wrong roster and reported the app
    // had missed a carry it had not missed.
    //
    // A field goal or an extra point keeps posteam, where the kicking
    // team IS the team with the ball.
    note(r.kicker_player_id, r.kicker_player_name,
         r.play_type === 'kickoff' ? r.defteam : r.posteam, 'K');
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
    // A TRY THAT WAS RUN TO A CONCLUSION IS NOT A NON-PLAY, whatever
    // play_type says. A flag on the try -- 2023_07_BUF_NE, defensive
    // holding enforced between downs -- turns play_type into 'no_play'
    // while the two points stay on the board, so this skip was throwing
    // away a real score. The two-point block below is the one thing
    // allowed past it, and only when the result column says the try
    // actually finished; a try wiped out before the snap leaves that
    // column empty and is still skipped, so nothing is entered twice.
    if (!(truthy(row.two_point_attempt) &&
          (row.two_point_conv_result === 'success' ||
           row.two_point_conv_result === 'failure'))) return null;
  }

  const jersey = id => (id && id !== 'NA') ? numberFor.get(id) : null;
  const gained = num(row.yards_gained);

  // TWO-POINT CONVERSIONS.
  // ------------------------------------------------------------------
  // nflverse gives these `play_type` run or pass with
  // `two_point_attempt` set, so before 14 Aug 2026 they fell straight
  // through into the ordinary rush and pass branches below. That was
  // wrong twice over: the two points never reached the score, AND the
  // attempt was entered as a scrimmage play, inflating rushing and
  // receiving totals with yardage NFHS keeps out of season stats
  // altogether.
  //
  // It hid because run_qa's tier 1 skips `two_point_attempt` rows when
  // comparing per-player yardage -- so the phantom attempt was never
  // compared against anything.
  //
  // A conversion returned by the DEFENCE is dropped rather than
  // guessed at: NFHS gives the defence no score on a try, so there is
  // no StatChat play that means it.
  if (truthy(row.two_point_attempt)) {
    // 'g' good, 'x' failed. NOT 'n' -- that radio value does not exist,
    // and the driver reported it honestly rather than silently entering
    // the default, which is why this surfaced on the first failed try
    // rather than as a wrong number months later.
    const good = row.two_point_conv_result === 'success';
    // A FLAG ON THE TRY MAKES play_type 'no_play', AND THE TRY STILL
    // COUNTS. 2023_07_BUF_NE: Allen to Knox succeeds and New England is
    // flagged for defensive holding "enforced between downs" -- the two
    // points are on the board, but the row comes through as no_play, so
    // neither branch below matched and Buffalo finished two short with
    // nothing in the output to say why.
    //
    // WHAT DECIDES IT IS THE RESULT COLUMN, NOT play_type. nflverse
    // fills two_point_conv_result only when a try was actually run to a
    // conclusion; a try wiped out by a pre-snap flag leaves it empty and
    // is followed by the re-try's own row, so keying on the result
    // enters each try exactly once. The role columns are populated on a
    // no_play row just as they are on any other, which is what makes
    // this fixable here rather than another deduction in run_qa.
    const ran = good || row.two_point_conv_result === 'failure';
    const carrier = jersey(row.rusher_player_id);
    const passer = jersey(row.passer_player_id);
    const receiver = jersey(row.receiver_player_id);
    if (type === 'run' || (ran && carrier && !passer)) {
      if (!carrier) return null;
      return { kind: 'play', spec: { type: 'twopt', sub: 'rush', carrier, result: good ? 'g' : 'x' } };
    }
    if (type === 'pass' || (ran && passer && receiver)) {
      if (!passer || !receiver) return null;
      return { kind: 'play', spec: { type: 'twopt', sub: 'pass', passer, receiver, result: good ? 'g' : 'x' } };
    }
    return null;
  }

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
  // Did the team WITHOUT the ball score on this play? That is a
  // defensive or return touchdown -- an interception or fumble taken
  // back, or a punt returned all the way. `scoredIt` below deliberately
  // refuses these, because they are not a touchdown BY the player being
  // credited with the play; they need their own branch, which is what
  // this enables.
  const defensiveTd = truthy(row.touchdown) && row.td_team &&
    row.td_team !== 'NA' && row.posteam && row.td_team !== row.posteam;

  const scoredIt = (playerId) =>
    truthy(row.touchdown) &&
    row.td_team === row.posteam &&
    (!row.td_player_id || row.td_player_id === 'NA' ||
     row.td_player_id === playerId);

  if (type === 'run') {
    const carrier = jersey(row.rusher_player_id);
    if (!carrier) return null;
    // A fumble taken back for a score. Entered as StatChat's own fumble
    // play so the six points reach the defence, rather than as a rush
    // with a `fumble: 'lost'` flag that loses them.
    // ENTERED AS THE RUSH IT WAS, WITH THE FUMBLE HUNG OFF IT -- not as a
    // bare `fumble` play. The bare form was what this emitted until 31
    // Aug 2026, and it threw the carry away: no attempt, no rushing
    // yards, nothing for the back who ran it. That is how a real scorer
    // enters it too -- the Rush tree's own fumble toggle, recovered by
    // the opponent, returned for a touchdown -- so this now exercises
    // the panel a Friday-night scorer actually uses, and the rushing
    // production the play produced is compared instead of skipped.
    if (truthy(row.fumble_lost) && defensiveTd) {
      return { kind: 'play', spec: {
        type: 'rush', carrier,
        yards: String(Math.abs(gained)), loss: gained < 0,
        fumbled: true, fumrec: 'opp',
        credit: jersey(row.fumble_recovery_1_player_id) || undefined,
        fumTd: true
      } };
    }
    // A SAFETY on a run: tackled in his own end zone. The two points
    // belong to the defence and there is no yardage to record.
    if (truthy(row.safety)) {
      return { kind: 'play', spec: {
        type: 'rush', carrier, yards: String(Math.abs(gained)),
        loss: gained < 0, safety: true
      } };
    }
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
      // A STRIP-SACK taken back for a score: the sack panel's own
      // Fumbled branch, so the six points reach the defence. Checked
      // before the plain sack, because a strip-sack is still a sack and
      // would otherwise be entered as one and lose the touchdown.
      if (truthy(row.fumble_lost) && defensiveTd) {
        return { kind: 'play', spec: {
          type: 'sack', passer, yards: String(Math.abs(gained)),
          fumbled: true, fumrec: 'opp',
          credit: jersey(row.fumble_recovery_1_player_id) || undefined,
          retyds: String(num(row.return_yards) || 0),
          fumTd: true
        } };
      }
      // Sacked in his own end zone: two points to the defence. By far the
      // most common way a safety happens, and both real examples checked
      // (2023_03_IND_BAL, 2023_03_NE_NYJ) are exactly this.
      return { kind: 'play', spec: {
        type: 'sack', passer, yards: String(Math.abs(gained)),
        safety: truthy(row.safety) || undefined
      } };
    }
    if (truthy(row.interception)) {
      return { kind: 'play', spec: {
        type: 'int', passer,
        credit: jersey(row.interception_player_id),
        receiver: jersey(row.receiver_player_id),
        // Taken back all the way. Without this the interception was
        // entered but its six points were not.
        td: defensiveTd || undefined,
        yards: defensiveTd ? String(num(row.return_yards) || 0) : undefined
      } };
    }
    const receiver = jersey(row.receiver_player_id);
    if (!truthy(row.complete_pass)) {
      return { kind: 'play', spec: {
        type: 'pass', passer, receiver, incomplete: true
      } };
    }
    // CAUGHT, STRIPPED, TAKEN BACK -- entered as the COMPLETION it was,
    // with the fumble hung off it.
    //
    // The old comment here said "the catch itself still counts as
    // receiving yardage" and then emitted a bare `fumble` play, which
    // counts no such thing. 2023_09_MIA_KC is the proof: Tagovailoa to
    // Hill for -7, stripped by McDuffie, Kansas City recovers. nflverse
    // has Hill at 8 catches on 10 targets for 62 and Tagovailoa at 21 of
    // 34 for 193; StatChat had 7/9/69 and 20 of 33 for 200, because this
    // branch dropped the whole completion and the comparison never saw
    // it.
    //
    // The app has always had the right panel for it -- the Pass tree's
    // fumble toggle, recovered by the opponent, returned for a
    // touchdown -- so nothing in StatChat needed changing. Only this,
    // which was entering a play no scorer would enter.
    if (truthy(row.fumble_lost) && defensiveTd) {
      return { kind: 'play', spec: {
        type: 'pass', passer, receiver,
        yards: String(Math.abs(gained)), loss: gained < 0,
        fumbled: true, fumrec: 'opp',
        credit: jersey(row.fumble_recovery_1_player_id) || undefined,
        fumTd: true
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
    // A punt returned all the way. `defensiveTd` is the right test even
    // here: on a punt the KICKING team is the team in possession, so a
    // return touchdown is scored by the side without the ball.
    return { kind: 'play', spec: {
      type: 'punt', punter, yards: String(num(row.kick_distance) || 0),
      credit: defensiveTd ? jersey(row.punt_returner_player_id) : undefined,
      retyds: defensiveTd ? String(num(row.return_yards) || 0) : undefined,
      td: defensiveTd || undefined
    } };
  }

  if (type === 'field_goal') {
    const kicker = jersey(row.kicker_player_id);
    if (!kicker) return null;
    // BLOCKED AND RETURNED for a score. The plain branch below has only
    // made/missed, so this was entered as a miss and the six points
    // vanished. 2023_01_DAL_NYG is the standing example.
    if (defensiveTd) {
      return { kind: 'play', spec: {
        type: 'fg', kicker, yards: String(num(row.kick_distance) || 0),
        blocked: true,
        credit: jersey(row.fumble_recovery_1_player_id) ||
                jersey(row.blocked_player_id) || undefined,
        retyds: String(num(row.return_yards) || 0),
        td: true
      } };
    }
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
