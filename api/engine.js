// StatChat game engine
// ====================
// THE single copy. Until 10 August 2026 this code was duplicated inline
// in five HTML files, and keeping them in step was manual: four engine
// changes on 10 Aug alone each touched four or five files, and one was
// missed -- the `newPossession` check did not reach view.html, a drive
// tile silently failed to split, and it cost a debugging round trip.
// Drift had also produced two documented bugs where different pages
// showed different numbers for the same game.
//
// Every copy was verified byte-identical before this extraction, so
// consolidating changed no behaviour anywhere -- it removed the ability
// for them to disagree.
//
// LOADED BY: game.html, view.html, recap.html, stat_package.html,
//            season_report.html, broadcast.html, and api/feed.js.
//
// The pages expect these as GLOBALS, so they are declared as plain
// top-level functions rather than wrapped in a module or an IIFE. The
// export at the bottom is what lets Node require the same file.
//
// DEPENDS ON the page providing, before this script runs:
//     TEAMS, plays, startingPossession, quarterLengthSec,
//     TIMEOUTS_PER_HALF, isAdminMarker, otherTeam, clockToAbsSeconds
// Those differ legitimately between pages (game.html builds TEAMS from a
// live roster; the reports build it from a saved game) or are page
// state, so they stay put.
//
// TESTING: `engine_parity.js` existed only to detect drift between the
// copies and is retired. The engine is now covered by the suites in
// tests/, the fuzzer, and the NFL replay harness.

function luminance(hex){
  const r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
  return (0.299*r + 0.587*g + 0.114*b) / 255;
}

function colorDistance(hexA, hexB){
  const a = { r: parseInt(hexA.slice(1,3),16), g: parseInt(hexA.slice(3,5),16), b: parseInt(hexA.slice(5,7),16) };
  const b = { r: parseInt(hexB.slice(1,3),16), g: parseInt(hexB.slice(3,5),16), b: parseInt(hexB.slice(5,7),16) };
  return Math.sqrt((a.r-b.r)**2 + (a.g-b.g)**2 + (a.b-b.b)**2);
}

function safeTextColor(bgHex, preferredHex){
  if (Math.abs(luminance(bgHex) - luminance(preferredHex)) > 0.35) return preferredHex;
  return luminance(bgHex) > 0.55 ? '#1a1a1a' : '#ffffff';
}

function rosterName(teamKey, num, order){
  // Kneels are charged to a TEAM bucket that has no roster entry.
  if (num === 'TEAM') return 'TEAM';
  const t = TEAMS[teamKey];
  const buckets = { offense: t.rosterOffense, defense: t.rosterDefense, special: t.rosterSpecialTeams };
  for (const unit of order){
    const roster = buckets[unit];
    if (roster && roster[num]) return roster[num];
  }
  return null;
}

function nameInOffense(teamKey, num){
  const n = rosterName(teamKey, num, ['offense','special','defense']);
  return (n || ('#' + num)) + ' (' + TEAMS[teamKey].name + ')';
}

function nameInDefense(teamKey, num){
  const n = rosterName(teamKey, num, ['defense','special','offense']);
  return (n || ('#' + num)) + ' (' + TEAMS[teamKey].name + ')';
}

function nameInSpecialTeams(teamKey, num){
  const n = rosterName(teamKey, num, ['special','offense','defense']);
  return (n || ('#' + num)) + ' (' + TEAMS[teamKey].name + ')';
}

function playerName(team, num, preferredUnit){
// An NCAA team rush (a QB kneel) is charged to the team, not a player,
// so it carries the sentinel number TEAM and has no roster entry.
if (num === 'TEAM') return 'TEAM';

  const t = TEAMS[team];
  const buckets = { offense: t.rosterOffense, defense: t.rosterDefense, special: t.rosterSpecialTeams };
  const order = preferredUnit ? [preferredUnit, ...Object.keys(buckets).filter(u => u !== preferredUnit)] : ['offense', 'defense', 'special'];
  for (const unit of order){
    const roster = buckets[unit];
    if (roster && roster[num]) return roster[num];
  }
  return '#' + num;
}

function findDriveStarts(playsList){
  // A drive must never START on an administrative marker. Doing so
  // produces a one-play "drive" whose every counter is zero, and
  // because only the last two drives are ever shown, it silently
  // pushes the real drive out of the "previous drive" slot. That is
  // what made a completed scoring drive display as
  // "Clock - 5:00 at change of possession" with 0/0 tiles: the
  // kickoff flipped possession, so the drive began on the clock
  // line that happened to follow it.
  const firstRealPlayFrom = from => {
    for (let j = from; j < playsList.length; j++){
      if (!isAdminMarker(playsList[j])) return j;
    }
    return -1;
  };
  const starts = [];
  // Start indices are produced in non-decreasing order, so checking
  // only the last entry is enough to stop a detected possession
  // change and an explicit reset marker from both claiming the same
  // play (which they often do, since skipping markers lands the
  // possession change exactly on the reset marker that follows it).
  const pushStart = idx => {
    if (idx !== -1 && starts[starts.length - 1] !== idx) starts.push(idx);
  };
  let priorPoss = startingPossession;
  for (let i = 0; i < playsList.length; i++){
    if (playsList[i].effect && playsList[i].effect.isReset){
      // A reset marker only OPENS the game's first drive. Every later
      // drive begins at a real possession change, which is detected
      // below and already lands on the reset marker that follows it.
      // "Adjust down / distance" writes a reset marker purely to
      // correct the chains, so using it mid-drive -- or twice in a row
      // -- must not register another drive, and therefore another
      // possession, for a team that never gave the ball up.
      // ...unless the marker says a new POSSESSION began. An onside kick
      // recovered by the kicking team hands them the ball without any
      // change of possession for the detector below to notice, so
      // without this the drive is invisible: no possession counted, no
      // per-drive stats, and the previous drive stays on screen.
      if (!starts.length || playsList[i].effect.newPossession) pushStart(i);
      priorPoss = computeState(playsList.slice(0, i + 1)).possession;
      continue;
    }
    // A half ends every drive in progress, even when the same team gets
    // the ball back to start the next one. Only a change of possession
    // was treated as a boundary, so a team that finished the first half
    // with the ball and received to open the second had both halves
    // counted as ONE continuous drive -- the Current Drive panel still
    // listed its Q2 kneels, and the drive tiles totalled plays from
    // before the interval.
    // The interval and the start of overtime both end whatever drive
    // was in progress, even when the same team keeps the ball. Only a
    // change of possession counted as a boundary, so a team that
    // finished a period with the ball and got it back to open the
    // next had both counted as ONE drive.
    const endsPeriod = (playsList[i].isDivider && /end of (1st|first) half/i.test(playsList[i].text || '')) ||
      (playsList[i].effect && playsList[i].effect.setQuarter >= 5);
    if (endsPeriod){
      pushStart(firstRealPlayFrom(i + 1));
      priorPoss = computeState(playsList.slice(0, i + 1)).possession;
      continue;
    }
    const possAfter = computeState(playsList.slice(0, i + 1)).possession;
    if (possAfter !== priorPoss) pushStart(firstRealPlayFrom(i + 1));
    priorPoss = possAfter;
  }
  return starts;
}

function countPossessions(playsList){
  // A possession IS a drive, so this must use exactly the same
  // boundary rules as findDriveStarts. It used to reimplement them,
  // and the two disagreed: a detected possession change AND the
  // explicit "New drive" marker that follows it were each counted,
  // so an ordinary kickoff -> clock line -> new drive sequence
  // credited the receiving team twice. A brand-new game in which
  // each side had had the ball exactly once reported 2 possessions
  // apiece. Deriving from findDriveStarts makes the two agree by
  // construction rather than by keeping two copies in step.
  const counts = { teamA: 0, teamB: 0 };
  findDriveStarts(playsList).forEach(idx => {
    // Possession AFTER the starting play, matching how
    // computeDriveSummary attributes a drive to a team.
    // Overtime possessions are excluded. OT is a separate, artificial
    // series -- each side is simply handed the ball -- so counting
    // them alongside regulation drives distorts every per-possession
    // figure and makes two games incomparable on the same axis.
    if ((playsList[idx].quarter || 1) >= 5) return;
    const team = computeState(playsList.slice(0, idx + 1)).possession;
    if (team === 'teamA' || team === 'teamB') counts[team]++;
  });
  return counts;
}

function countTurnovers(playsList){
  const counts = { teamA: 0, teamB: 0 };
  playsList.forEach(p => {
    const r = p.roles;
    if (!r) return;
    if (r.playType === 'int' && r.passer) counts[r.passer.team] = (counts[r.passer.team] || 0) + 1;
    // r.defense used to be the only signal that a fumble was LOST
    // rather than recovered by the offense. Now that naming the
    // recoverer is optional, r.lost carries that meaning explicitly.
    // r.defense is still honoured so plays saved before this change
    // keep counting.
    if (r.playType === 'fumble' && r.carrier && (r.lost || r.defense)) counts[r.carrier.team] = (counts[r.carrier.team] || 0) + 1;
  });
  return counts;
}

function computeState(playsList){
  const list = playsList || plays;
  const state = {
    possession: startingPossession,
    quarter: 1,
    scores: { teamA: 0, teamB: 0 },
    possessionTime: { teamA: 0, teamB: 0 },
    down: null, distance: null, fieldPos: null, startSpot: null, statYards: 0,
    penalties: { teamA: { count: 0, yds: 0 }, teamB: { count: 0, yds: 0 } },
    // NFHS: three timeouts per team per half, and they do NOT carry
    // over -- both teams get a fresh three at the start of the second
    // half regardless of what was left.
    timeouts: { teamA: TIMEOUTS_PER_HALF, teamB: TIMEOUTS_PER_HALF },
    // Which physical end of the field a team attacks. Recorded once and
    // alternated by quarter, because teams change ends after Q1, Q2 and
    // Q3. Everything else in this engine is possession-relative, so this
    // is the only place the app knows anything about actual direction.
    dirTeam: null, dirValue: null, dirQuarter: 1
  };
  const pendingClockStart = { teamA: null, teamB: null };
  for (const p of list){
    const e = p.effect;
    if (!e) continue;
    if (e.isReset){
      state.down = e.down; state.distance = e.distance; state.fieldPos = e.fieldPos;
      state.startSpot = e.fieldPos; state.statYards = 0;
    }
    if (e.isStat){
      if (state.fieldPos !== null){
        state.fieldPos += e.fieldDelta;
        state.fieldPos = Math.max(0, Math.min(100, state.fieldPos));
      }
      state.statYards += e.statYds;
      if (e.td){
        state.down = null; state.distance = null; state.fieldPos = null; state.startSpot = null; state.statYards = 0;
      } else {
        if (e.converts){
          state.down = 1;
          state.distance = state.fieldPos !== null ? Math.max(1, Math.min(10, 100 - state.fieldPos)) : 10;
        }
        else if (e.turnoverOnDowns && e.flipApplied){
          state.possession = otherTeam(state.possession);
          // The ball does not move on a turnover on downs -- it is spotted
          // exactly where the play ended, and the team taking over starts
          // 1st & 10 from there. fieldPos is possession-RELATIVE (0 is the
          // possessing team's own goal line), so keeping the same physical
          // spot means mirroring it to 100 - fieldPos for the new offense.
          // Clearing it instead used to force the coach to re-enter a spot
          // the app already knew.
          state.fieldPos = state.fieldPos !== null ? 100 - state.fieldPos : null;
          state.down = 1;
          state.distance = state.fieldPos !== null ? Math.max(1, Math.min(10, 100 - state.fieldPos)) : 10;
          state.startSpot = state.fieldPos; state.statYards = 0;
        } else if (!e.turnoverOnDowns){
          state.down = (state.down || 1) + 1;
          state.distance = Math.max((state.distance || 10) - e.statYds, 1);
        }
      }
    }
    if (e.endsDrive && !e.isStat){
      state.down = null; state.distance = null; state.fieldPos = null; state.startSpot = null; state.statYards = 0;
    }
    if (e.penaltyTeam){
      state.penalties[e.penaltyTeam].count += 1;
      state.penalties[e.penaltyTeam].yds += e.penaltyYds;
      if (state.fieldPos !== null){
        state.fieldPos += e.fieldDelta;
        state.fieldPos = Math.max(0, Math.min(100, state.fieldPos));
      }
      if (state.distance !== null){
        if (e.noDownChange){
          // Dead-ball foul, or one assessed after a kick or change of
          // possession: it is walked off before the series begins, so
          // the ball moves but the down and distance-to-go stay put.
          // Adjusting distance here would measure against a
          // line-to-gain that no longer exists -- which is how a
          // 10-yard foul against a team that had just taken over at
          // 1st & 10 used to become "1st & 20".
          if (state.fieldPos !== null){
            state.distance = Math.max(1, Math.min(state.distance, 100 - state.fieldPos));
          }
        } else if (e.autoFirstDown){
          // Defensive holding, roughing, pass interference and the like
          // award a first down whatever the yardage -- a 5-yard foul on
          // 3rd & 20 still moves the chains, so the distance maths below
          // must not get a say.
          state.down = 1;
          state.distance = state.fieldPos !== null ? Math.max(1, Math.min(10, 100 - state.fieldPos)) : 10;
        } else {
          state.distance -= e.fieldDelta;
          if (state.distance <= 0){
            // Penalty yardage alone reached or passed the marker --
            // an automatic first down, regardless of what down it was.
            state.down = 1;
            state.distance = state.fieldPos !== null ? Math.max(1, Math.min(10, 100 - state.fieldPos)) : 10;
          } else if (e.lossOfDown && state.down !== null){
            // 'ld' -- illegal touching, illegal forward pass, intentional
            // grounding. The down that was just run is consumed, exactly as
            // an ordinary failed down consumes it: the distance above has
            // already moved by the penalty yardage, so only the number
            // needs advancing.
            //
            // Capped at 4th rather than rolled into a turnover, matching
            // the parser that writes the sentence -- loss of down ON an
            // already-4th-down snap is rare enough that building a turnover
            // path in here is more risk than it removes, and Adjust
            // Down/Distance covers it.
            //
            // ADDED 5 September 2026. This effect was being written by the
            // penalty parser's text branch and by nothing else, so the down
            // it consumed lived in the play's prose and was lost on every
            // replay of the log.
            state.down = Math.min(4, state.down + 1);
          }
        }
      }
    }
    if (e.score){ state.scores[e.score.team] += e.score.points; }
    if (e.scoreAdjust){ state.scores[e.scoreAdjust.team] += e.scoreAdjust.pts; }
    if (e.flip && e.flipApplied && !e.isStat){
      state.possession = e.flipTo;
      state.down = null; state.distance = null; state.fieldPos = null; state.startSpot = null; state.statYards = 0;
    }
    if (e.forcePossession){ state.possession = e.forcePossession; }
    if (e.setQuarter){
      // Crossing into the second half (or into overtime) resets the
      // allowance. Guarded on the quarter actually changing so that
      // re-entering a Q3 marker cannot hand out a second fresh set.
      if (e.setQuarter >= 3 && state.quarter < 3) state.timeouts = { teamA: TIMEOUTS_PER_HALF, teamB: TIMEOUTS_PER_HALF };
      if (e.setQuarter >= 5 && state.quarter < 5) state.timeouts = { teamA: TIMEOUTS_PER_OT, teamB: TIMEOUTS_PER_OT };
      state.quarter = e.setQuarter;
    }
    if (e.setDirection){
      state.dirTeam = e.setDirection.team;
      state.dirValue = e.setDirection.dir;
      state.dirQuarter = state.quarter;
    }
    if (e.timeout && state.timeouts[e.timeout.team] !== undefined){
      // Floored at zero: the log is a record of what the coach called,
      // and a fourth timeout should not read as -1 remaining.
      state.timeouts[e.timeout.team] = Math.max(0, state.timeouts[e.timeout.team] - 1);
    }
    if (e.clockEvent){
      const ce = e.clockEvent;
      if (ce.type === 'start'){ pendingClockStart[ce.team] = ce.absSec; }
      if (ce.type === 'end' && pendingClockStart[ce.team] !== null){
        state.possessionTime[ce.team] += Math.max(0, ce.absSec - pendingClockStart[ce.team]);
        pendingClockStart[ce.team] = null;
      }
      if (ce.type === 'transition'){
        if (pendingClockStart[ce.outgoingTeam] !== null){
          state.possessionTime[ce.outgoingTeam] += Math.max(0, ce.absSec - pendingClockStart[ce.outgoingTeam]);
          pendingClockStart[ce.outgoingTeam] = null;
        }
        pendingClockStart[ce.incomingTeam] = ce.absSec;
      }
    }
    if (e.setScores){ state.scores.teamA = e.setScores.teamA; state.scores.teamB = e.setScores.teamB; }
  }
  // Direction the team WITH THE BALL is currently driving. Derived, not
  // stored: ends alternate every quarter, so one recorded answer covers
  // the whole game, and re-recording it mid-game just re-bases the
  // alternation from that quarter.
  state.driveDir = null;
  if (state.dirValue && state.possession){
    const flipped = Math.abs((state.quarter || 1) - state.dirQuarter) % 2 === 1;
    let d = flipped ? (state.dirValue === 'right' ? 'left' : 'right') : state.dirValue;
    if (state.possession !== state.dirTeam) d = (d === 'right' ? 'left' : 'right');
    state.driveDir = d;
  }
  return state;
}

function computeBoxScore(playsList){
  const stats = {
    teamA: { rushing:{}, passing:{}, receiving:{}, defense:{}, specialTeams:{} },
    teamB: { rushing:{}, passing:{}, receiving:{}, defense:{}, specialTeams:{} }
  };
  // BUCKETS ARE KEYED BY DISPLAY NAME, not by jersey number.
  //
  // Numbers are not identity. Two players can wear one jersey, and
  // keying on the number merged their lines and showed whichever
  // roster row loaded last -- Powell's carries credited to Reddick.
  // A composite "5<sep>Powell" key fixed that but leaked into every
  // consumer, which then had to know how to unpack it.
  //
  // Resolving to the name once, here, keeps the rest of the code
  // simple: a bucket key IS the label, so nothing downstream has to
  // resolve anything. It also matches how season_report has always
  // aggregated across games, so a player's line merges season-wide for
  // free. `name` on the role wins when a play recorded which of two
  // players it was; otherwise the roster answers, falling back to
  // "#21" for someone never rostered.
  const UNIT_FOR_CAT = { rushing: null, passing: null, receiving: null,
                         defense: 'defense', specialTeams: 'special' };
  function keyFor(team, cat, num, name){
    if (name) return name;
    return playerName(team, num, UNIT_FOR_CAT[cat] || undefined);
  }
  function bucket(team, cat, num, name){
    if (!team || !stats[team]) return null;
    const b = stats[team][cat];
    const k = keyFor(team, cat, num, name);
    if (!b[k]) b[k] = {};
    return b[k];
  }
  playsList.forEach(p => {
    const r = p.roles || {};
    const e = p.effect || {};
    const type = r.playType;

    if (r.carrier && type === 'rush'){
      const s = bucket(r.carrier.team, 'rushing', r.carrier.num, r.carrier.name);
      if (s){
        s.att = (s.att||0) + 1;
        s.yds = (s.yds||0) + (r.carrier.yards||0);
        s.long = Math.max(s.long||0, r.carrier.yards||0);
        if (e.td) s.td = (s.td||0) + 1;
      }
    }
    if (r.carrier && type === 'fumble'){
      const teamObj = TEAMS[r.carrier.team];
      const pos = ((teamObj && teamObj.posOffense[r.carrier.num]) || '').toUpperCase();
      const targetCat = RECEIVE_POS.has(pos) ? 'receiving' : 'rushing';
      const s = bucket(r.carrier.team, targetCat, r.carrier.num, r.carrier.name);
      if (s) s.fum = (s.fum||0) + 1;
    }
    // A target is a pass thrown AT someone, caught or not. Counted on
    // completions above, and here for the two ways a pass fails with a
    // known intended receiver. Two-point conversions are excluded --
    // NFHS keeps conversion attempts out of season passing and
    // receiving totals, so 'tpp' never reaches this branch.
    if (r.receiver && (type === 'incomplete' || type === 'int')){
      const rs = bucket(r.receiver.team, 'receiving', r.receiver.num, r.receiver.name);
      if (rs) rs.tgt = (rs.tgt||0) + 1;
    }
    if (r.passer && type === 'incomplete'){
      const s = bucket(r.passer.team, 'passing', r.passer.num, r.passer.name);
      if (s) s.att = (s.att||0) + 1;
    }
    if (r.passer && type === 'pass'){
      const s = bucket(r.passer.team, 'passing', r.passer.num, r.passer.name);
      if (s){
        s.att = (s.att||0) + 1;
        s.comp = (s.comp||0) + 1;
        s.yds = (s.yds||0) + (r.passer.yards||0);
        s.long = Math.max(s.long||0, r.passer.yards||0);
        if (e.td) s.td = (s.td||0) + 1;
      }
      if (r.receiver){
        const rs = bucket(r.receiver.team, 'receiving', r.receiver.num, r.receiver.name);
        if (rs){
          rs.rec = (rs.rec||0) + 1;
          rs.tgt = (rs.tgt||0) + 1;
          rs.yds = (rs.yds||0) + (r.receiver.yards||0);
          rs.long = Math.max(rs.long||0, r.receiver.yards||0);
          if (e.td) rs.td = (rs.td||0) + 1;
        }
      }
    }
    if (r.passer && type === 'sack'){
      const s = bucket(r.passer.team, 'passing', r.passer.num, r.passer.name);
      if (s) s.sacked = (s.sacked||0) + 1;
      // NFHS charges sack yardage to the team as a rushing loss. Doing
      // it here rather than as a subtraction in each page's totals
      // means the rushing rows actually add up to the rushing tile,
      // and every surface gets the same numbers from one place.
      const ts = bucket(r.passer.team, 'rushing', 'TEAM');
      if (ts){
        ts.att = (ts.att||0) + 1;
        ts.yds = (ts.yds||0) - (r.passer.yards||0);
      }
    }
    if (r.passer && type === 'int'){
      const s = bucket(r.passer.team, 'passing', r.passer.num, r.passer.name);
      if (s){
        s.att = (s.att||0) + 1;
        s.intThrown = (s.intThrown||0) + 1;
      }
    }
    if (r.defense && (type === 'int' || type === 'sack' || type === 'fumble')){
      const s = bucket(r.defense.team, 'defense', r.defense.num);
      if (s){
        if (type === 'int') s.int = (s.int||0) + 1;
        if (type === 'sack') s.sacks = (s.sacks||0) + 1;
        if (type === 'fumble') s.fumRec = (s.fumRec||0) + 1;
      }
    } else if (type === 'int' || type === 'sack' || (type === 'fumble' && r.lost)){
      // Naming the tackler, interceptor or recoverer is optional, and
      // these stats used to be keyed entirely off that name -- so a
      // sack with nobody credited recorded no sack anywhere at all,
      // not even for the team. The event happened regardless, so it is
      // credited to a TEAM bucket. Every caller sums the whole defense
      // object, so this reaches all of them without touching each one.
      const victim = (type === 'fumble') ? (r.carrier && r.carrier.team) : (r.passer && r.passer.team);
      if (victim){
        const s = bucket(otherTeam(victim), 'defense', 'TEAM');
        if (s){
          if (type === 'int') s.int = (s.int||0) + 1;
          if (type === 'sack') s.sacks = (s.sacks||0) + 1;
          if (type === 'fumble') s.fumRec = (s.fumRec||0) + 1;
        }
      }
    }
    if (r.kicker && type === 'kickoff'){
      const s = bucket(r.kicker.team, 'specialTeams', r.kicker.num);
      if (s){
        s.kickoffs = (s.kickoffs||0) + 1;
        if (r.kicker.touchback) s.touchbacks = (s.touchbacks||0) + 1;
      }
    }
    if (r.kicker && type === 'fg'){
      const s = bucket(r.kicker.team, 'specialTeams', r.kicker.num);
      if (s){
        s.fgAtt = (s.fgAtt||0) + 1;
        if (r.kicker.result === 'g'){
          s.fgMade = (s.fgMade||0) + 1;
          s.fgLong = Math.max(s.fgLong||0, r.kicker.yards||0);
        }
        if (r.kicker.result === 'b') s.fgBlocked = (s.fgBlocked||0) + 1;
      }
    }
    if (r.kicker && type === 'pat'){
      const s = bucket(r.kicker.team, 'specialTeams', r.kicker.num);
      if (s){
        s.patAtt = (s.patAtt||0) + 1;
        if (r.kicker.result === 'g') s.patMade = (s.patMade||0) + 1;
        if (r.kicker.result === 'b') s.patBlocked = (s.patBlocked||0) + 1;
      }
    }
    if (r.punter && type === 'punt'){
      const s = bucket(r.punter.team, 'specialTeams', r.punter.num);
      if (s){
        s.punts = (s.punts||0) + 1;
        if (!r.punter.blocked){
          s.puntYds = (s.puntYds||0) + (r.punter.yards||0);
          s.puntsWithYards = (s.puntsWithYards||0) + 1;
          s.puntLong = Math.max(s.puntLong||0, r.punter.yards||0);
        } else {
          s.blocked = (s.blocked||0) + 1;
        }
      }
    }
  });

  ['teamA','teamB'].forEach(defTeam => {
    const offTeam = otherTeam(defTeam);
    let d3att=0, d3conv=0, d4att=0, d4conv=0, explosive=0;
    for (let i = 0; i < playsList.length; i++){
      const p = playsList[i];
      const type = p.roles && p.roles.playType;
      // Must match scrimmageTypes exactly. 'incomplete' was missing
      // here (and only here -- every other definition in the codebase
      // includes it), so an incomplete pass on 3rd down, which is the
      // single most common 3rd-down outcome in football, was not even
      // counted as an ATTEMPT. A drive that went incomplete / run for
      // no gain / incomplete / punt reported "no 3rd downs" rather
      // than 0 of 1.
      if (!['rush','pass','incomplete','sack','int','fumble'].includes(type)) continue;
      const before = computeState(playsList.slice(0, i));
      if (before.possession !== offTeam) continue;
      const down = before.down;
      const success = !!(p.effect && (p.effect.converts || p.effect.td));
      if (down === 3){ d3att++; if (success) d3conv++; }
      else if (down === 4){ d4att++; if (success) d4conv++; }
      if (((p.effect && p.effect.statYds) || 0) >= 20) explosive++;
    }
    stats[defTeam].oppDowns = {
      d3Pct: d3att ? Math.round(100*d3conv/d3att) : null, d3att, d3conv,
      d4Pct: d4att ? Math.round(100*d4conv/d4att) : null, d4att, d4conv,
      explosive
    };
  });

  return stats;
}


// ---------------------------------------------------------------------
// Helpers the engine depends on, for NODE ONLY.
//
// Every page already defines these itself, and engine.js loads BEFORE the
// page script -- so declaring them unconditionally here collided:
//   SyntaxError: Identifier 'TIMEOUTS_PER_HALF' has already been declared
// which killed the whole page. `const` at top level cannot be
// redeclared, and a syntax error is fatal to the entire script.
//
// So they are attached to globalThis only when `module` exists, i.e. in
// Node. In a browser this block does nothing at all and the page's own
// definitions are the only ones. That asymmetry is deliberate: adding
// them to the pages instead would mean editing six files to no benefit.
// ---------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  if (typeof globalThis.isAdminMarker !== 'function') {
    globalThis.isAdminMarker = function isAdminMarker(p){
      if (!p) return true;
      const e = p.effect || {};
      if (e.isReset) return false;
      return !!(e.clockEvent || e.setQuarter || e.forcePossession || p.isDivider);
    };
  }
  if (typeof globalThis.otherTeam !== 'function') {
    globalThis.otherTeam = function otherTeam(t){
      return t === 'teamA' ? 'teamB' : 'teamA';
    };
  }
  // Which roster positions catch rather than carry. computeBoxScore uses
  // it to decide whether a pass credit lands in `receiving` or
  // `rushing`. Missed when the helpers were first added, because I
  // listed the ones I remembered instead of searching for undefined
  // references -- the feed's first real request returned
  // {"error":"RECEIVE_POS is not defined"}.
  // tests/engine_standalone_check.js searches now, so the next one
  // cannot hide.
  if (globalThis.RECEIVE_POS === undefined) {
    globalThis.RECEIVE_POS = new Set(['WR','TE','SE','FL','SLOT']);
  }
  if (globalThis.TIMEOUTS_PER_HALF === undefined) globalThis.TIMEOUTS_PER_HALF = 3;
  if (globalThis.TIMEOUTS_PER_OT === undefined) globalThis.TIMEOUTS_PER_OT = 1;
  if (typeof globalThis.clockToAbsSeconds !== 'function') {
    globalThis.clockToAbsSeconds = function clockToAbsSeconds(quarter, clockStr){
      const m = String(clockStr || '').match(/^(\d{1,2}):(\d{2})$/);
      let mins, secs;
      if (m){ mins = parseInt(m[1], 10); secs = parseInt(m[2], 10); }
      else {
        const digits = String(clockStr || '').replace(/\D/g, '');
        if (digits.length < 2) return null;
        secs = parseInt(digits.slice(-2), 10);
        mins = parseInt(digits.slice(0, -2) || '0', 10);
      }
      if (isNaN(mins) || isNaN(secs)) return null;
      const q = quarter || 1;
      const len = globalThis.quarterLengthSec || 720;
      return (q - 1) * len + (len - (mins * 60 + secs));
    };
  }
}

// ---------------------------------------------------------------------
// Server-side context builder.
//
// The browser pages keep engine state in module-level globals -- TEAMS,
// plays, startingPossession, quarterLengthSec -- because a page shows
// exactly one game. A serverless function may handle any game on any
// request, so globals are wrong there: two concurrent requests would
// share them.
//
// buildContext() takes raw database rows and returns everything computed
// for ONE game, with nothing left behind. Same engine, no shared state.
// Browser-only, so it is defined but unused there.
// ---------------------------------------------------------------------
function buildContext(game, rosterRows, playRows, ourBranding){
  const ourName = game.our_team_is_home ? game.home_team_name : game.away_team_name;
  const oppName = game.our_team_is_home ? game.away_team_name : game.home_team_name;
  const b = ourBranding || {};

  const mkTeam = (name, bg, text, logo) => ({
    name: name || '', abbr: (name || '').split(/\s+/)[0] || '',
    bg, text, logo: logo || null,
    rosterOffense: {}, rosterDefense: {}, rosterSpecialTeams: {}, posOffense: {}
  });

  const teams = {
    teamA: mkTeam(ourName, b.primary_color || '#2b3440',
                  b.secondary_color || '#ffffff', b.logo_url),
    teamB: mkTeam(oppName, game.opponent_primary_color || '#6e7885',
                  game.opponent_secondary_color || '#ffffff', game.opponent_logo_url)
  };

  (rosterRows || []).forEach(r => {
    const t = teams[r.team_side];
    if (!t) return;
    if (r.unit === 'offense'){ t.rosterOffense[r.jersey_number] = r.player_name;
                               t.posOffense[r.jersey_number] = r.position; }
    else if (r.unit === 'defense'){ t.rosterDefense[r.jersey_number] = r.player_name; }
    else if (r.unit === 'special'){ t.rosterSpecialTeams[r.jersey_number] = r.player_name; }
  });

  const plays = (playRows || []).map(p => ({
    id: p.id, seq: p.sequence_number, text: p.text,
    effect: p.effect || {}, roles: p.roles || null,
    team: p.team_side, quarter: p.quarter,
    isDivider: !!p.is_divider, unresolved: !!p.unresolved,
    isOverride: !!p.is_override
  }));

  // computeState and computeBoxScore read TEAMS and the other globals
  // from their enclosing scope. In Node that scope is this module, so
  // they are set here for the duration of the call. Safe because a
  // serverless invocation handles one request at a time; if that ever
  // stops being true, these must become parameters.
  if (typeof globalThis !== 'undefined') {
    globalThis.TEAMS = teams;
    globalThis.startingPossession = game.starting_possession || 'teamA';
    globalThis.quarterLengthSec = game.quarter_length_seconds || 720;
    globalThis.TIMEOUTS_PER_HALF = 3;
  }

  return {
    game, teams, plays,
    state: computeState(plays),
    box: computeBoxScore(plays)
  };
}

// Dual export. Browsers get the globals above; Node gets a module.
// The guard matters -- without it the browser throws on `module`.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    luminance,
    colorDistance,
    safeTextColor,
    rosterName,
    nameInOffense,
    nameInDefense,
    nameInSpecialTeams,
    playerName,
    findDriveStarts,
    countPossessions,
    countTurnovers,
    computeState,
    computeBoxScore,
    buildContext
  };
}
