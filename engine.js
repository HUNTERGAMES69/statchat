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

// COLOR HELPERS
// -------------
// Five pages blend a team's colours, and what reaches these functions is
// not reliably a clean six-digit hex. The opponent's colours come from a
// database column a human filled in, and #fff is what most colour
// pickers hand you. Sliced as if it were six digits, #fff yields NaN --
// and NaN poisons every comparison silently, because `NaN > 0.55` is
// false, so a bad value quietly chose white text instead of failing
// anywhere anyone would look.
//
// Three separate defences had grown up around that. game.html redefined
// luminance and safeTextColor with length guards (silently OVERRIDING
// these, since its inline script loads after engine.js -- so the play
// page and the report pages were running different code). broadcast.html
// wrapped safeTextColor in a try/catch. The pages `|| '#8B0000'` a
// missing value, which catches null and '' but not '#fff'. Each was
// added when a specific site misbehaved: the blacklist pattern
// PROJECT_NOTES.md warns about, found one stray at a time.
//
// Consolidated 13 Aug 2026: normalise once, here, and the callers need
// no defences at all. Note game.html's guard was not merely redundant,
// it was wrong -- `#fff` failed its length test and returned 0, scoring
// white as black.
function normalizeHex(hex){
  if (typeof hex !== 'string') return null;
  const h = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(h)) return h.toLowerCase();
  // #abc IS #aabbcc -- the same colour, not an invalid one.
  if (/^#[0-9a-fA-F]{3}$/.test(h)) return ('#' + h[1]+h[1] + h[2]+h[2] + h[3]+h[3]).toLowerCase();
  return null;
}

// Genuinely unreadable input scores as black, so safeTextColor puts
// white on it. A wrong-but-legible choice beats NaN, which produced a
// choice that only LOOKED deliberate.
// The quarter as a coach says it: Q1..Q4, then OT1, OT2, OT3.
// ---------------------------------------------------------------------
// Both banners used to inline `quarter <= 4 ? 'Q' + quarter : 'OT'`, which
// gave every overtime period the same name -- fine for one, useless by the
// third, when the only question anyone asks is which OT it is.
//
// Numbered from OT1 rather than plain "OT" for the first: a bare OT reads
// as "some overtime" and has to be re-derived by anyone reading a log.
function quarterLabel(state){
  const q = (state && state.quarter) || 1;
  if (q <= 4) return 'Q' + q;
  const round = Math.max(1, Math.ceil(((state && state.otSeries) || 1) / 2));
  return 'OT' + round;
}

// Seconds as M:SS. Lives here because THREE pages had their own copy and
// the report pages had none, so adding time of possession to the recap
// would have meant a fourth. Same reasoning as markerLabel and the colour
// helpers: a `function formatDuration` later in a page shadows this
// harmlessly, so the existing copies keep working untouched.
function formatDuration(sec){
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

// FIELD POSITION -> the way a coach says it.
// -----------------------------------------
// fieldPos is possession-relative: 0 is the offence's own goal line, 100
// is the one they are attacking. So 0-49 is "own N", 51-100 is "opp N",
// and 50 is NEITHER.
//
// NOBODY OWNS THE 50. It is the one yard line that belongs to both teams
// and is named after neither: on the field, in the rule book and in the
// press box it is just "the 50". The old form said "own 50", which is
// wrong in a way that is easy to skim past and then jarring when noticed
// -- and worse, it implied the 50 sits on one team's half, which is the
// exact confusion the own/opp wording exists to prevent.
//
// Consolidated here 13 Aug 2026. This lived as three byte-identical
// copies in game.html, view.html and broadcast.html; fixing "own 50"
// would have meant three edits and left the next change free to fix two
// of them. Same duplication class as the colour helpers above.
function markerLabel(fp){
  if (fp === null || fp === undefined) return '';
  if (fp === 50) return 'the 50';
  return fp < 50 ? ('own ' + fp) : ('opp ' + (100 - fp));
}

function luminance(hex){
  const h = normalizeHex(hex);
  if (!h) return 0;
  const r = parseInt(h.slice(1,3), 16), g = parseInt(h.slice(3,5), 16), b = parseInt(h.slice(5,7), 16);
  return (0.299*r + 0.587*g + 0.114*b) / 255;
}

function colorDistance(hexA, hexB){
  const na = normalizeHex(hexA), nb = normalizeHex(hexB);
  // A colour we cannot read is reported as maximally distant, so a
  // caller asking "are these too similar?" keeps what it has rather
  // than swapping on the strength of a comparison it never made.
  if (!na || !nb) return Infinity;
  const a = { r: parseInt(na.slice(1,3),16), g: parseInt(na.slice(3,5),16), b: parseInt(na.slice(5,7),16) };
  const b = { r: parseInt(nb.slice(1,3),16), g: parseInt(nb.slice(3,5),16), b: parseInt(nb.slice(5,7),16) };
  return Math.sqrt((a.r-b.r)**2 + (a.g-b.g)**2 + (a.b-b.b)**2);
}

// Blend a colour toward another, 0 = all A, 1 = all B.
// Used to turn a team's brand colour into a pale tint a dark label can sit
// on. Mixing toward white rather than using rgba() because these tints go
// on cards that are themselves layered, and a translucent fill would pick
// up whatever is behind it.
function mixHex(hexA, hexB, amount){
  const a = normalizeHex(hexA), b = normalizeHex(hexB);
  if (!a) return b || null;
  if (!b) return a;
  const t = Math.max(0, Math.min(1, amount));
  const ch = i => {
    const x = parseInt(a.slice(1 + i * 2, 3 + i * 2), 16);
    const y = parseInt(b.slice(1 + i * 2, 3 + i * 2), 16);
    return Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  };
  return '#' + ch(0) + ch(1) + ch(2);
}

// WCAG CONTRAST RATIO. This is what "can you read it" actually means.
// ---------------------------------------------------------------------
// luminance() above is Rec.601 luma -- a perceptual brightness, right for
// "is this colour light or dark", and WRONG for contrast. safeTextColor
// used to compare two luma values and keep the preference if they
// differed by 0.35, which let #999999 sit on a navy banner: the gap is
// 0.41, comfortably over the line, and the text is washed out and hard to
// read at a glance. Reported from a real game on 14 Aug 2026.
//
// The fix is to measure the right thing. WCAG relative luminance
// linearises each channel first, and contrast is a RATIO from 1:1
// (identical) to 21:1 (black on white) -- not a difference. #999999 on
// that navy is 2.6:1; the same navy with white is 10.9:1.
function relLuminance(hex){
  const h = normalizeHex(hex);
  if (!h) return 0;
  const ch = [h.slice(1,3), h.slice(3,5), h.slice(5,7)].map(x => {
    const v = parseInt(x, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrastRatio(hexA, hexB){
  const a = relLuminance(hexA), b = relLuminance(hexB);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

// The minimum a team's own colours have to clear to be used as given.
// 4.5:1 is the WCAG standard for body text. The banner's text is large
// enough that 3:1 would technically pass, but this same function colours
// the report pages too, and a scoreboard read from the far side of a
// field in daylight is not a laboratory.
const MIN_CONTRAST = 4.5;

function safeTextColor(bgHex, preferredHex){
  const bg = normalizeHex(bgHex), pref = normalizeHex(preferredHex);
  // No usable background: nothing to contrast against, so honour the
  // preference if there is one.
  if (!bg) return pref || '#ffffff';
  // No usable preference: pick for legibility on the background rather
  // than defaulting to white on a pale field, which is what the
  // previous game.html guard did.
  // Black or white, whichever actually reads better on this background.
  // Chosen by measuring both rather than by a luma threshold: a mid-tone
  // sits near the old 0.55 cutoff and the wrong side of it is a coin
  // toss, while comparing the two ratios is never ambiguous.
  // PURE black or white, not the softer #1a1a1a used elsewhere in the
  // app. This branch only fires on a pair that cannot be read, so its
  // one job is maximum contrast -- and the difference is decisive on a
  // mid-tone: #1a1a1a on a mid grey gives 4.35:1 and pure black gives
  // 5.32:1. The worst possible background still clears 4.58:1 against
  // one of the two, so the 4.5:1 floor is always reachable.
  const fallback = () =>
    contrastRatio(bg, '#000000') >= contrastRatio(bg, '#ffffff') ? '#000000' : '#ffffff';
  if (!pref) return fallback();
  // A team's own colours are used whenever they can be read. This is not
  // a house style being imposed -- it rescues the pairs that cannot be.
  if (contrastRatio(bg, pref) >= MIN_CONTRAST) return pref;
  return fallback();
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
  // On the roster, but no unit was ever resolved for this number --
  // still a genuine, named player, not a call-up. Requested directly:
  // resolving every unrecognized-position player to a unit is
  // impractical on a large roster with no position data at all, and
  // this is the fallback that keeps a manually-typed number from
  // reading as "not on the roster" just because nobody ever picked
  // Offense/Defense/Special for him at setup. Checked LAST, after
  // every preferred unit has already failed to match, since a player
  // WITH a known unit should always resolve through that first.
  if (t.rosterUnassigned && t.rosterUnassigned[num]) return t.rosterUnassigned[num];
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
  // Same fallback as rosterName above, for the same reason: a player
  // genuinely on the roster with no unit ever resolved for him must
  // still show his real name in a recap, stat package, or report --
  // not a bare "#22" -- once he has actually been credited on a play.
  if (t.rosterUnassigned && t.rosterUnassigned[num]) return t.rosterUnassigned[num];
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
      // SKIP PAST THE OPENING KICKOFF/PUNT AND ANY TRY, exactly as the
      // general check two branches below already learned to do the
      // same night, for the same reason -- but this branch never got
      // the same fix, because it does not detect a possession change
      // at all; it FORCES a boundary regardless of whether one
      // happened, specifically so a team that keeps the ball across
      // the interval still gets a fresh drive. The new half always
      // opens with a kickoff, and the kickoff itself flips possession
      // again -- so without this, the boundary landed ON the kickoff
      // in EVERY SINGLE GAME with a halftime, not just the rare
      // defensive-score case that surfaced the general check's version
      // of this bug. countPossessions (which shares this exact array)
      // credited a second, spurious possession to whichever team the
      // kickoff itself favoured, every time. Found by a systematic
      // audit specifically checking whether this fix generalized,
      // not by a live-game report.
      let target = firstRealPlayFrom(i + 1);
      while (target !== -1){
        const tp = playsList[target].roles && playsList[target].roles.playType;
        if (tp === 'pat' || tp === 'twopt'){ target = firstRealPlayFrom(target + 1); continue; }
        if ((tp === 'kickoff' || tp === 'punt') &&
            playsList[target].effect && playsList[target].effect.flip && playsList[target].effect.flipApplied){
          target = firstRealPlayFrom(target + 1); continue;
        }
        break;
      }
      pushStart(target);
      priorPoss = computeState(playsList.slice(0, i + 1)).possession;
      continue;
    }
    const possAfter = computeState(playsList.slice(0, i + 1)).possession;
    if (possAfter !== priorPoss){
      let target = firstRealPlayFrom(i + 1);
      // A PAT OR 2-POINT TRY IS NEVER A DRIVE, no matter what
      // possession looks like there. Reported from a real game, 19 Aug
      // 2026, the SAME NIGHT as the kickoff fix directly below this
      // comment: a defensive score's own PAT was registering as ITS
      // OWN phantom possession, because a try never flips possession
      // (flipEligible is always false for one -- the scoring team kicks
      // off next regardless of who holds the try-ball), so the check
      // just below this loop -- "does possession still match where we
      // landed" -- saw a match and pushed a boundary anyway. The try is
      // PART OF the score that preceded it, never a drive of its own,
      // so this walks past any number of them to find whatever real
      // play actually follows.
      while (target !== -1){
        const tp = playsList[target].roles && playsList[target].roles.playType;
        if (tp !== 'pat' && tp !== 'twopt') break;
        target = firstRealPlayFrom(target + 1);
      }
      // ONLY IF THE CHANGE ACTUALLY STICKS. Reported from a real game,
      // 19 Aug 2026: a defensive score (a blocked kick, an interception,
      // a fumble, anything that flips possession to a team that was not
      // already driving) is immediately followed by that same team's
      // OWN kickoff, since the scoring team always kicks off next. The
      // kickoff carries its own flip, back to the team that just lost
      // the ball -- so by the time firstRealPlayFrom lands on it, the
      // "possession" this branch just detected has already reversed
      // itself before any actual drive happened. Pushing a boundary
      // there registered a one-play phantom drive that was really just
      // a kickoff, and countPossessions (which deliberately shares this
      // exact array rather than reimplementing it) credited it to
      // whichever team the kickoff itself favoured -- an extra,
      // unearned possession for the receiving team, with the scoring
      // team's own touchdown never counted as one at all.
      //
      // The kickoff's OWN flip still fires its own iteration of this
      // same loop, later, and correctly pushes the boundary at the
      // receiving team's actual first play -- this check only silences
      // the earlier, spurious one, it does not need to push anything
      // in its place.
      if (target !== -1 && computeState(playsList.slice(0, target + 1)).possession === possAfter){
        pushStart(target);
      }
    }
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

// SCORING SUMMARY — how the points actually got on the board.
// =====================================================================
// Every report had a quarter line and a box score, and nothing that said
// WHO scored and WHEN. That is the first thing a game story leads with
// and the first thing anybody asks.
//
// Nothing here is computed: every scoring play already carries its team,
// its points and its text. This assembles them.
//
// A TOUCHDOWN AND ITS TRY ARE ONE ENTRY, which is how scoring summaries
// are written everywhere -- "Roberson 4 run (Lyon kick)". They are two
// plays in the log, so the try is folded into the touchdown before it and
// not listed again. A try that follows nothing (which should not happen)
// is left as its own line rather than dropped, because losing points
// silently is worse than an odd-looking row.
//
// The running score is recomputed as the walk proceeds rather than read
// from state, so the number beside each entry is the score AT THAT
// MOMENT, not at the end.
// Replace bare "#12" tokens in a play's stored text with the player's
// name from the CURRENT roster.
// ---------------------------------------------------------------------
// A play's text is generated when it is saved, so a play entered before
// the roster was uploaded -- or through manual entry -- has the jersey
// number baked into it for ever. The roster may know the name now.
//
// playerName() returns '#N' unchanged when nobody is on that number, so
// an unresolvable token is left exactly as it was rather than blanked.
//
// Both players in "#1 pass to #6" are on the same team, so one team key
// resolves the whole line.
function resolveNumbersInText(text, team){
  const t = String(text || '');
  if (t.indexOf('#') === -1 || !team || !TEAMS[team]) return t;
  return t.replace(/#(\d+)/g, function(whole, num){
    const nm = playerName(team, num);
    return (nm && nm !== '#' + num) ? nm : whole;
  });
}

// Strip the team name that follows a player's name in brackets.
// ---------------------------------------------------------------------
// A play's text is written as "Parker Robinson (Neville) pass to Ze'Land
// Young (Neville) for 4 -- TOUCHDOWN". In the log that qualifier once
// earned its place, because the log is a single run of plays with both
// sides mixed together.
//
// Everywhere it is now shown it is redundant: the scoring summary has a
// TEAM column, and the live log is grouped by drive. It is also what
// pushes most rows onto a second line -- two of them in a pass play.
//
// Only the two teams' own names are removed, so "(TEAM)" for a team rush
// and anything else in brackets survives untouched.
function stripTeamNames(text){
  let t = String(text || '');
  if (t.indexOf('(') === -1) return t;
  ['teamA', 'teamB'].forEach(function(k){
    const nm = TEAMS[k] && TEAMS[k].name;
    if (!nm) return;
    // Split/join rather than a built regex: a school name can contain
    // characters a regex would read as syntax (St. Thomas More, Ze'Land).
    t = t.split(' (' + nm + ')').join('');
  });
  return t;
}

function scoringSummary(playsList){
  const list = playsList || plays;
  const out = [];
  const running = { teamA: 0, teamB: 0 };
  // THE QUARTER IS DERIVED FROM THE MARKERS, not read off the play.
  // ------------------------------------------------------------------
  // p.quarter is a column written at save time, and it is null on any
  // play saved before the app tracked it -- which made `p.quarter || 1`
  // report an entire game as Q1. computeState() has always derived the
  // quarter by walking setQuarter markers; this walk does the same, so
  // the two can never disagree.
  //
  // The play's own column is still preferred when it HAS a value: a play
  // inserted out of order carries its true quarter, and the marker walk
  // would give it whatever the surrounding plays say.
  let walkQuarter = 1;

  const tryText = (p) => {
    // What goes in the brackets. A missed try is worth saying: a 6 in the
    // quarter line with no explanation reads like a mistake.
    //
    // Deliberately string matching rather than a regex. tests/
    // engine_standalone_check.js scans this file for identifiers it uses
    // without defining -- the guard that stops api/feed.js throwing on a
    // browser-only global -- and it cannot parse regex literals, so
    // /GOOD|CONVERSION/ was read as two undefined globals. Teaching it to
    // skip regexes turned out to eat real code as well, and a working
    // guard is worth more than a tidier three lines here.
    const t = String(p.text || '').toUpperCase();
    const failed = t.indexOf('NO GOOD') !== -1 || t.indexOf('FAILED') !== -1 ||
                   t.indexOf('MISSED') !== -1 || t.indexOf('BLOCKED') !== -1;
    const good = !failed && (t.indexOf('GOOD') !== -1 || t.indexOf('CONVERSION') !== -1);
    const two = (p.effect.score && p.effect.score.points === 2);
    if (!good) return two ? 'two-point failed' : 'kick failed';
    return two ? 'two-point good' : 'kick good';
  };

  for (let i = 0; i < list.length; i++){
    const p = list[i];
    const e = p.effect || {};
    if (e.setQuarter) walkQuarter = e.setQuarter;
    const sc = e.score;

    // A TRY IS HANDLED BEFORE THE SCORE CHECK, because a MISSED try
    // scores nothing and would otherwise be skipped entirely -- leaving
    // the touchdown above it with a blank where "(kick failed)" belongs.
    // Blank is ambiguous: it reads as "no try was entered" rather than
    // "the kick was missed", and those are different facts.
    const isTry = (p.roles && (p.roles.playType === 'pat' || p.roles.playType === 'twopt'));
    if (isTry && out.length && out[out.length - 1].isTouchdown){
      if (sc && sc.team && sc.points) running[sc.team] += sc.points;
      const prev = out[out.length - 1];
      prev.detail = tryText(p);
      prev.teamA = running.teamA;
      prev.teamB = running.teamB;
      continue;
    }

    if (!sc || !sc.team || !sc.points) continue;
    running[sc.team] += sc.points;
    out.push({
      quarter: p.quarter || walkQuarter,
      team: sc.team,
      points: sc.points,
      text: stripTeamNames(resolveNumbersInText(p.text, sc.team)),
      isTouchdown: sc.points === 6,
      // A touchdown with no try after it stays blank rather than claiming
      // a kick that was never entered.
      detail: '',
      teamA: running.teamA,
      teamB: running.teamB
    });
  }
  return out;
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

    // A MUFFED PUNT RECOVERED BY THE KICKING TEAM.
    // ------------------------------------------------------------------
    // The ball changed hands and nothing was counted, because this play
    // is playType 'punt' and the two rules above only look at 'int' and
    // 'fumble'. Reported from a real game on 14 Aug 2026.
    //
    // Charged to the RECEIVING team: they are the ones who lost it. The
    // punting team's own drive ended with the punt, as it always does,
    // so charging them would count one turnover twice over.
    //
    // The test is that the recoverer is on the SAME team as the punter.
    // A muff the receiving team recovers themselves is not a turnover --
    // they keep the ball, exactly as they would have anyway.
    //
    // A BLOCKED punt cannot be caught by this rule by accident: blocked
    // plays record no `recovery` role at all, whichever side recovers.
    // That is checked, not assumed.
    if (r.playType === 'punt' && r.punter && r.recovery &&
        r.recovery.team === r.punter.team){
      const receiving = otherTeam(r.punter.team);
      counts[receiving] = (counts[receiving] || 0) + 1;
    }

    // A MUFFED KICKOFF OR ONSIDE KICK RECOVERED BY THE KICKING TEAM.
    // ------------------------------------------------------------------
    // The exact same gap as the punt rule above, on the same play family
    // (playType 'kickoff' covers an ordinary return, a muff, AND an
    // onside kick) -- never fixed here when it was fixed for punt. Found
    // by reading this function directly, not reported from a game: a
    // muffed kickoff and an onside kick the kicking team recovers both
    // already write roles.recovery correctly, and neither had ever been
    // read by anything counting turnovers.
    //
    // Charged to the RECEIVING team, for the same reason as the punt
    // rule: they are the ones who lost it. The kicking team's own
    // "drive" was the kick itself, which is not a possession they are
    // giving up in the down/distance sense, so charging them would
    // invent a turnover that never happened on their side.
    //
    // The test is that the recoverer is on the SAME team as the kicker.
    // A muff or onside kick the receiving team recovers themselves is
    // not a turnover -- they keep the ball, exactly as they would have
    // anyway.
    //
    // NOT AN ONSIDE KICK, though -- reported from a real game, 18 Aug
    // 2026. This comment's own reasoning two lines up ("the kicking
    // team's own drive was the kick itself, not a possession they are
    // giving up") applies with equal force to the RECEIVING team on an
    // onside kick: nobody has controlled the ball yet, so a recovery by
    // either side is not a turnover -- it is simply a recovery, the same
    // distinction football statistics keep between "muffed, recovered
    // by the other team" (a turnover -- the receiving team HAD the ball,
    // however briefly, before losing it) and "onside kick recovered by
    // the kicking team" (never a turnover -- nobody had it to lose).
    // Muffed kickoffs are unaffected: this only excludes plays with
    // roles.kicker.onside set, which 'km' (muff) never carries.
    if (r.playType === 'kickoff' && r.kicker && r.recovery && !r.kicker.onside &&
        r.recovery.team === r.kicker.team){
      const receiving = otherTeam(r.kicker.team);
      counts[receiving] = (counts[receiving] || 0) + 1;
    }
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
    // How many SERIES overtime has run, counted from 1 once it starts and
    // 0 before. NFHS overtime is played in rounds of one series each way,
    // so the round a coach names is ceil(series / 2) -- OT1 covers the
    // first two series, OT2 the next two.
    //
    // Counted here rather than derived from findDriveStarts because the
    // banner needs it on every render and findDriveStarts walks the whole
    // play list re-running computeState for each play.
    otSeries: 0,
    otSeriesTeam: null,
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
          // DISTANCE MEASURES THE BALL, NOT THE STAT SHEET.
          // ----------------------------------------------------------
          // These were the same number everywhere until an own-recovery
          // fumble made them diverge: a runner's yardage is measured to
          // the spot of the FUMBLE, while the ball ends where his team
          // recovered it. Distance-to-go is a fact about the ball, so it
          // has to follow fieldDelta. Behaviour is unchanged for every
          // other play, where the two are equal by construction.
          const moved = (e.fieldDelta !== undefined && e.fieldDelta !== null)
            ? e.fieldDelta : e.statYds;
          state.distance = Math.max((state.distance || 10) - moved, 1);
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
    if (e.forcePossession){
      // A forced possession in overtime opens a series. This is how the
      // guided start hands the ball over, and how each subsequent series
      // is set.
      // ONLY A GUIDED SERIES MARKER OPENS A SERIES.
      // ----------------------------------------------------------------
      // Counted from an explicit otSeriesStart flag, not from the
      // forcePossession effect itself. "Manual flip possession" writes
      // the same effect, so a correction mid-series was indistinguishable
      // from a new series and pushed the round on: one flip during
      // series 2 and the banner read OT2 with three series played.
      //
      // Counted against the SERIES team rather than possession, because a
      // series usually ends with the ball ALREADY in the other team's
      // hands -- a turnover on downs hands it over before the next series
      // is set, so comparing with possession saw no change at all.
      if (state.quarter >= 5 && e.otSeriesStart &&
          e.forcePossession !== state.otSeriesTeam) state.otSeries++;
      // WHOSE series this is, which is not the same as who currently has
      // the ball: a turnover inside a series hands the ball over without
      // ending the series, and a score leaves it with the team that just
      // scored. The next series belongs to the other team either way, so
      // it has to be tracked from the series START rather than inferred
      // from possession at the moment it ends.
      if (state.quarter >= 5 && e.otSeriesStart) state.otSeriesTeam = e.forcePossession;
      state.possession = e.forcePossession;
    }
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
      // TIME OF POSSESSION STOPS AT THE END OF REGULATION.
      // ----------------------------------------------------------------
      // Overtime is played in series, not against a running clock: each
      // side simply gets the ball from the opponent's 10. There is no
      // game clock to take time off, so any elapsed time recorded there
      // is an artefact of the entry, not of the football -- and adding it
      // to a team's total makes a 24-minute figure that cannot be
      // reconciled against a 48-minute game.
      //
      // A possession that began in Q4 and is closed by an event carrying
      // an overtime quarter contributes nothing either: this skips on the
      // quarter of the EVENT, so the pending start from regulation is
      // simply never paid out.
      //
      // Clearing those pending starts here as well would be dead code --
      // written first, and removed when a mutation test showed nothing
      // could tell the difference. The quarter never decreases within a
      // replay, so once this fires it fires for every later event.
      if (state.quarter < 5){
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
  // Requested directly: view.html's Current Drive tile needs to show
  // WHEN the clock was logged at the start of an ongoing possession
  // (before it has a closing value and can be turned into a real
  // duration). pendingClockStart already tracks exactly that internally
  // -- it was simply never handed back. A plain copy, not the live
  // object itself, so nothing outside this function can mutate the
  // value this function is still using on a later call.
  state.pendingClockStart = { teamA: pendingClockStart.teamA, teamB: pendingClockStart.teamB };
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
  // One spelling, used by the engine and matched by the report pages when
  // they decide where to sort it. Changing it here changes it everywhere.
  const UNKNOWN_RECEIVER = 'Unknown';
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
  // The kicker of the most recent kickoff, for crediting an outcome that
  // was written as its own play. See the compatibility branch below.
  let lastKickoffKicker = null;
  playsList.forEach(p => {
    const r = p.roles || {};
    const e = p.effect || {};
    const type = r.playType;
    if (type === 'kickoff' && r.kicker) lastKickoffKicker = r.kicker;

    // `attempt` is a fumble that ENDED a rush -- one play, not two. The
    // carry and its yardage are credited here exactly as they were when
    // the rush was written as its own separate play; only the play count
    // changes, because there is now correctly one of them.
    if (r.carrier && (type === 'rush' || (type === 'fumble' && r.attempt === 'rush'))){
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
      // Same reasoning as view.html's drive summary: the play now SAYS
      // what it ended, so the roster-position guess is a fallback for
      // plays saved before `attempt` existed. A standalone fumble has no
      // attempt and still needs the guess.
      const targetCat = r.attempt === 'pass' ? 'receiving'
        : (r.attempt === 'rush' || r.attempt === 'sack') ? 'rushing'
        : (RECEIVE_POS.has(pos) ? 'receiving' : 'rushing');
      const s = bucket(r.carrier.team, targetCat, r.carrier.num, r.carrier.name);
      if (s) s.fum = (s.fum||0) + 1;
    }
    // A target is a pass thrown AT someone, caught or not. Counted on
    // completions above, and here for the two ways a pass fails with a
    // known intended receiver. Two-point conversions are excluded --
    // NFHS keeps conversion attempts out of season passing and
    // receiving totals, so 'tpp' never reaches this branch.
    // A fumble that ended a COMPLETION still throws and still catches.
    // Credited off the roles the panel attached, so the reception is not
    // lost with the separate pass play that used to carry it.
    if (type === 'fumble' && r.attempt === 'pass' && r.passer){
      const ps = bucket(r.passer.team, 'passing', r.passer.num, r.passer.name);
      // `comp`, not `cmp`. This wrote cmp until 26 August 2026 while the
      // ordinary completion path a few lines up wrote comp -- same
      // passing bucket, two keys. Every report reads .comp and nothing
      // reads .cmp, so a completion that ended in a fumble was filed
      // under a name no page looks at: the throw counted as an attempt
      // and the completion simply vanished from the line.
      if (ps){ ps.att = (ps.att||0) + 1; ps.comp = (ps.comp||0) + 1;
        ps.yds = (ps.yds||0) + (r.passer.yards||0); ps.long = Math.max(ps.long||0, r.passer.yards||0); }
      if (r.receiver){
        const rs = bucket(r.receiver.team, 'receiving', r.receiver.num, r.receiver.name);
        if (rs){ rs.rec = (rs.rec||0) + 1; rs.tgt = (rs.tgt||0) + 1;
          rs.yds = (rs.yds||0) + (r.receiver.yards||0); rs.long = Math.max(rs.long||0, r.receiver.yards||0); }
      }
    }
    if (type === 'incomplete' || type === 'int'){
      // Same reasoning as the completion below: an unnamed intended
      // receiver still had a ball thrown at him, and leaving it out makes
      // total targets disagree with total attempts.
      const rs = r.receiver
        ? bucket(r.receiver.team, 'receiving', r.receiver.num, r.receiver.name)
        : bucket(r.passer && r.passer.team, 'receiving', 'UNKNOWN', UNKNOWN_RECEIVER);
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
      // A COMPLETION WITH NO RECEIVER NAMED still has to appear in the
      // receiving column, under UNKNOWN.
      // ----------------------------------------------------------------
      // The receiver is optional on purpose -- a deep ball is exactly the
      // play where a scorer does not catch the number, and blocking entry
      // would be worse. But leaving the yardage out of the receiving
      // table entirely breaks the check that matters most on a stat
      // sheet: PASSING YARDS SHOULD EQUAL THE SUM OF RECEIVING YARDS.
      // A coach seeing Passing 245 against Receiving 198 has no way to
      // tell a missing entry from a bug.
      //
      // Bucketed here rather than written onto the play, for two reasons:
      // no invented player ever reaches the database, and every game
      // already entered reconciles the moment this ships.
      //
      // Distinct from the TEAM bucket in rushing, which means "correctly
      // credited to nobody, by rule" -- a sack, a kneel, a bad snap.
      // UNKNOWN means "this happened to a player we did not record", and
      // conflating the two would hide a data-entry gap behind a rule.
      const rcv = r.receiver
        ? bucket(r.receiver.team, 'receiving', r.receiver.num, r.receiver.name)
        : bucket(r.passer && r.passer.team, 'receiving', 'UNKNOWN', UNKNOWN_RECEIVER);
      if (rcv){
        rcv.rec = (rcv.rec||0) + 1;
        rcv.tgt = (rcv.tgt||0) + 1;
        const y = r.receiver ? (r.receiver.yards||0) : (r.passer ? (r.passer.yards||0) : 0);
        rcv.yds = (rcv.yds||0) + y;
        rcv.long = Math.max(rcv.long||0, y);
        if (e.td) rcv.td = (rcv.td||0) + 1;
      }
    }
    // A fumble that ended a SACK is still a sack: the quarterback is
    // charged, and NFHS still books the yardage as a team rushing loss.
    if (r.passer && (type === 'sack' || (type === 'fumble' && r.attempt === 'sack'))){
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
    // TACKLES. The app has always captured "tackled by" -- it is stored in
    // roles.defense and used to rank the tackler picker -- and then thrown
    // it away: only int, sack and fumRec were ever counted, so an ordinary
    // tackle produced no stat at all.
    //
    // Counted on any SCRIMMAGE play with a credited defender. A sack is a
    // tackle as well as a sack, which is how stat sheets treat it. Kicks
    // and returns are excluded: the credit field means something different
    // there, and lumping them in would inflate the number quietly.
    //
    // SINGLE NUMBER, no solo/assisted split. The panel takes ONE tackler,
    // so every tackle is implicitly solo today; splitting would need a
    // second field on the fastest-moving entry in the app. Revisit after a
    // season of real use.
    //
    // TFL falls out for free: a credited tackle on a play that lost
    // yardage. Note this will NOT match the team TFL already reported --
    // team TFL counts from the play log and needs no named tackler, so it
    // is a ceiling and this is a floor. Both are correct; they answer
    // different questions. Do not "fix" one to match the other.
    //
    // LOSS IS READ FROM `effect.statYds`, NOT from the role objects.
    // Fixed 12 Aug 2026; before this, no sack ever produced a TFL.
    //
    // The role yardages do not share a sign convention. A rush stores a
    // loss as a negative number (-3), but a SACK stores it as a POSITIVE
    // magnitude: seven yards lost is `passer.yards = 7`. That is what
    // game.html writes, what the play code "#12s 7" carries, what the
    // team-rushing charge twenty lines above relies on (it SUBTRACTS the
    // value), and what the sack-yards tiles in view.html, recap.html,
    // stat_package.html and season_report.html all sum. Six writers and
    // readers agree; this one check disagreed, read +7 as a seven-yard
    // gain, and silently credited no tackle for loss on any sack.
    //
    // `effect.statYds` is signed net yardage, set for exactly the isStat
    // plays -- rush, pass, incomplete and sack -- and it is already the
    // field view.html counts team TFL from. Reading the same field here
    // means the floor and the ceiling measure the same thing and differ
    // only by whether a tackler was named, which is the whole point of
    // the distinction. Fumbles carry no statYds and so contribute no
    // per-player TFL, which is unchanged behaviour (fumble roles have no
    // `yards` either) and matches view.html's team TFL_TYPES, which also
    // omits fumbles.
    // NO 'fumble'. On a fumble play `roles.defense` is the RECOVERER, not
    // a tackler -- he picked the ball up, which is a different act and is
    // already credited as fumRec in its own block below. Counting it as a
    // tackle inflated every recovering defender by one and made the
    // per-player tackle column disagree with what anyone watching saw.
    //
    // Removed 13 Aug 2026, on Andy's call, after the golden-game fixture
    // showed a linebacker with three tackles when he had made two.
    //
    // The recovery itself is untouched: fumRec is credited whether or not
    // anyone is named, including to a TEAM bucket.
    const TACKLE_TYPES = ['rush', 'pass', 'sack'];
    if (r.defense && TACKLE_TYPES.includes(type)){
      const s = bucket(r.defense.team, 'defense', r.defense.num, r.defense.name);
      if (s){
        s.tackles = (s.tackles||0) + 1;
        if (typeof e.statYds === 'number' && e.statYds < 0) s.tfl = (s.tfl||0) + 1;
      }
    }

    if (r.defense && (type === 'int' || type === 'sack' || type === 'fumble')){
      const s = bucket(r.defense.team, 'defense', r.defense.num, r.defense.name);
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
    // A fumble that ended a SACK still counts as a team sack on
    // defense, exactly as it already does on the passer's own line
    // (the "sacked" credit near the top of this function). Reported
    // directly, 20 Aug 2026: a sack-turned-fumble, recovered by the
    // defense, showed the recovery but never the sack -- on either the
    // named recoverer's own line or the team's. Confirmed it was not
    // about the yardage (still missing at 7 lost, not just 0); the gap
    // was that this check only ever tested type === 'sack' directly,
    // never the fumble-carries-an-attempt shape the passer-side credit
    // already knew about.
    //
    // Deliberately its OWN check, run unconditionally, rather than
    // folded into the if/else-if above: roles.defense on a fumble play
    // is who RECOVERED it, not who made the sack, and those are
    // frequently different players. Crediting the recoverer directly
    // would repeat the exact mistake already fixed for tackles on 13
    // Aug 2026 (a linebacker with three tackles when he had made two,
    // because picking the ball up is a different act from making the
    // hit). The team level is the only claim this app can make with
    // confidence, since the panel never separately asks who made the
    // sack once a fumble is involved -- and it applies whether the
    // defense recovers or the offense keeps its own fumble, since the
    // sack happened either way.
    if (type === 'fumble' && r.attempt === 'sack' && r.carrier && r.carrier.team){
      const s = bucket(otherTeam(r.carrier.team), 'defense', 'TEAM');
      if (s) s.sacks = (s.sacks||0) + 1;
    }
    if (r.kicker && type === 'kickoff'){
      const s = bucket(r.kicker.team, 'specialTeams', r.kicker.num);
      if (s){
        s.kickoffs = (s.kickoffs||0) + 1;
        if (r.kicker.touchback) s.touchbacks = (s.touchbacks||0) + 1;
      }
    }
    // A TOUCHBACK RECORDED ON ITS OWN PLAY.
    // ------------------------------------------------------------------
    // The guided start-of-game flow cannot put the touchback on the kick:
    // it writes the kick before anybody knows where the ball came down,
    // and the outcome arrives as a separate play. That play carries
    // kickoffTouchback instead, naming the kicker it belongs to.
    //
    // Counted as a TOUCHBACK ONLY -- the kickoff itself was already
    // counted above, on the play that recorded the kick. Incrementing
    // kickoffs here as well would report two kicks for one.
    if (r.kickoffTouchback){
      const s = bucket(r.kickoffTouchback.team, 'specialTeams', r.kickoffTouchback.num);
      if (s) s.touchbacks = (s.touchbacks||0) + 1;
    } else if (type === 'kickoff_return' &&
               String(p.text || '').toUpperCase().indexOf('TOUCHBACK') !== -1){
      // TOUCHBACKS SAVED BEFORE THE ROLE EXISTED.
      // ----------------------------------------------------------------
      // kickoffTouchback is written at save time, so plays already in the
      // database do not carry it and no amount of reloading will make
      // them. Those games would have shown 0% for ever, and the only
      // remedy would have been re-entering the opening kickoff.
      //
      // String matching rather than a regex, for the same reason as
      // tryText() above: tests/engine_standalone_check.js scans this file
      // for SCREAMING_CASE identifiers it uses without defining, and read
      // /TOUCHBACK/ as an undefined global. That guard is worth more than
      // the tidier expression.
      //
      // The old rows are still unambiguous: a kickoff_return play whose
      // text says TOUCHBACK is one, and the kick it belongs to is the
      // kickoff immediately before it. Reading the text is not something
      // to make a habit of -- the role is the right mechanism and is what
      // new plays use -- but here it recovers real data that is otherwise
      // simply lost.
      if (lastKickoffKicker){
        const s = bucket(lastKickoffKicker.team, 'specialTeams', lastKickoffKicker.num);
        if (s) s.touchbacks = (s.touchbacks||0) + 1;
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
    // RETURNS — kickoff and punt COMBINED into one line (Andy's call).
    // ---------------------------------------------------------------------
    // Read from `roles.returner`, a role of its own rather than the
    // `defense` key returners used to share with tacklers, interceptors
    // and fumble recoverers. Sharing that key is why a kick returner
    // turned up in the "Tackled by" picker for the rest of a game, and it
    // meant return yardage could not be told apart from anything else a
    // defender did.
    //
    // Only the three paths Andy asked for write this role: kickoff, punt
    // and the guided kickoff. A muffed kick or a blocked kick recovered
    // and advanced is deliberately NOT a return -- it is a loose ball, and
    // counting it would inflate the average that makes the stat worth
    // having.
    //
    // Nothing backfills. Returns recorded before this shipped carry no
    // returner role, so they simply do not appear -- which is honest, and
    // better than a partial season that looks complete.
    if (r.returner){
      const s = bucket(r.returner.team, 'specialTeams', r.returner.num, r.returner.name);
      if (s){
        // SPLIT BY KIND, kickoff and punt kept apart (Andy's call, 23 Aug
        // -- combined first, split the same day).
        // -------------------------------------------------------------
        // A 22-yard kickoff average and an 8-yard punt average are
        // different skills in different game situations; averaging them
        // gives a number that describes neither. The role has carried
        // `kind` since it was written, so no play needs re-entering and
        // nothing has to be backfilled.
        //
        // Anything without a kind is treated as a KICK return: the only
        // plays that could lack one predate the field, and there are none
        // -- but defaulting keeps a future writer from silently dropping
        // a return by forgetting it.
        const pre = r.returner.kind === 'punt' ? 'puntRet' : 'kickRet';
        s[pre] = (s[pre]||0) + 1;
        s[pre + 'Yds'] = (s[pre + 'Yds']||0) + (r.returner.yards||0);
        s[pre + 'Long'] = Math.max(s[pre + 'Long']||0, r.returner.yards||0);
        // A return that scores. `effect.score` belongs to the returning
        // side on these plays, so the team check keeps a kicking-team
        // score (a muff recovered in the end zone) off the returner.
        if (e.score && e.score.team === r.returner.team && e.score.points === 6){
          s[pre + 'Td'] = (s[pre + 'Td']||0) + 1;
        }
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
// Pure data, defaulted for EVERY environment, not just Node.
// ---------------------------------------------------------------------
// RECEIVE_POS was defaulted only inside the Node block below, and each
// browser page declared its own copy. game.html never did, because it
// never calls computeBoxScore -- so the omission was invisible.
//
// It is still a trap: the first box-score readout added to the game page
// would throw "RECEIVE_POS is not defined", and ONLY on games containing
// a fumble, because that is the single branch that reads it. Reproduced
// 13 Aug 2026 while building the golden-game fixture.
//
// A `const RECEIVE_POS` later in a page shadows this harmlessly, so the
// five existing page copies keep working untouched.
if (typeof globalThis !== 'undefined' && globalThis.RECEIVE_POS === undefined){
  globalThis.RECEIVE_POS = new Set(['WR','TE','SE','FL','SLOT']);
}

if (typeof module !== 'undefined' && module.exports) {
  if (typeof globalThis.isAdminMarker !== 'function') {
    globalThis.isAdminMarker = function isAdminMarker(p){
      if (!p) return true;
      const e = p.effect || {};
      if (e.isReset) return false;
      // e.timeout added 19 Aug 2026 -- see game.html for the full
      // reasoning. Kept in sync with the six HTML copies by hand;
      // TODO.md already tracks this duplication as an ongoing cost.
      return !!(e.clockEvent || e.setQuarter || e.forcePossession || e.timeout || p.isDivider);
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
    name: name || '',
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
    mixHex,
    contrastRatio,
    relLuminance,
    quarterLabel,
    formatDuration,
    markerLabel,
    normalizeHex,
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
    scoringSummary,
    resolveNumbersInText,
    stripTeamNames,
    computeState,
    computeBoxScore,
    buildContext
  };
}

// AN INDEPENDENT COUNT OF THE BOX SCORE.
// ===========================================================================
// validateGame re-derives STATE from the log -- down, distance, quarter --
// and catches a play whose sentence disagrees with what the log implies. It
// never touched the box score, so a fault in computeBoxScore produced a
// wrong stat line from a correct log and nothing on the page said so.
//
// This counts the same plays a SECOND time and compares. Deliberately not
// by calling computeBoxScore's helpers: sharing them would share their
// mistakes and agree for the wrong reason. Everything here is read straight
// off `roles` and `effect`.
//
// It cannot catch a rule both implementations get wrong the same way. It
// catches the other kind -- a credit that goes to the wrong bucket, a
// double count, a dropped path, a key written under two names. That last
// one is not hypothetical: mapping these rules to write this function is
// how the cmp/comp fault was found.
//
// Returns a list of human-readable disagreements, empty when they agree.
function auditBoxScore(playsList){
  const mine = { teamA: {}, teamB: {} };
  const put = (team, cat, who, field, n) => {
    if (!team || !who) return;
    const t = mine[team] || (mine[team] = {});
    const c = t[cat] || (t[cat] = {});
    const w = c[who] || (c[who] = {});
    w[field] = (w[field] || 0) + n;
  };
  const high = (team, cat, who, field, n) => {
    if (!team || !who) return;
    const t = mine[team] || (mine[team] = {});
    const c = t[cat] || (t[cat] = {});
    const w = c[who] || (c[who] = {});
    w[field] = Math.max(w[field] || 0, n);
  };
  // BUCKET NAMING IS SHARED ON PURPOSE. The engine keys by the role's name
  // when it has one and otherwise resolves the jersey number against the
  // roster, and a different rule here would report every player as a
  // disagreement rather than reporting any real fault.
  //
  // Sharing this is safe in a way sharing the COUNTING would not be: a
  // wrong bucket name makes both sides wrong identically and hides
  // nothing, because the audit is about whether a statistic was credited
  // correctly, not about what the row is called.
  const UNIT = { rushing: null, passing: null, receiving: null,
                 defense: 'defense', specialTeams: 'special' };
  const resolve = (cat, p) => (typeof playerName === 'function'
    ? playerName(p.team, p.num, UNIT[cat] || undefined) : '#' + p.num);
  const key = (cat, p, useName) =>
    (useName !== false && p.name) ? p.name : resolve(cat, p);
  // Every specialTeams bucket in the engine passes only a jersey number and
  // lets the roster resolve it -- except the returner, which passes a name.
  const stKey = (p) => key('specialTeams', p, false);

  (playsList || []).forEach(p => {
    const r = p.roles, e = p.effect || {};
    if (!r || !r.playType) return;
    const t = r.playType;

    // --- rushing. A fumble on a running play is still a carry.
    if (r.carrier && (t === 'rush' || (t === 'fumble' && r.attempt === 'rush'))){
      const k = key('rushing', r.carrier), y = r.carrier.yards || 0;
      put(r.carrier.team, 'rushing', k, 'att', 1);
      put(r.carrier.team, 'rushing', k, 'yds', y);
      high(r.carrier.team, 'rushing', k, 'long', y);
      if (e.td) put(r.carrier.team, 'rushing', k, 'td', 1);
    }
    // --- the fumble itself, charged wherever the carrier is bucketed
    if (r.carrier && t === 'fumble' && r.attempt !== 'sack'){
      put(r.carrier.team, r.attempt === 'pass' ? 'receiving' : 'rushing',
          key(r.attempt === 'pass' ? 'receiving' : 'rushing', r.carrier), 'fum', 1);
    }

    // --- passing. A completion that ends in a fumble still throws.
    if (r.passer && (t === 'pass' || (t === 'fumble' && r.attempt === 'pass'))){
      const k = key('passing', r.passer), y = r.passer.yards || 0;
      put(r.passer.team, 'passing', k, 'att', 1);
      put(r.passer.team, 'passing', k, 'comp', 1);
      put(r.passer.team, 'passing', k, 'yds', y);
      high(r.passer.team, 'passing', k, 'long', y);
      if (e.td) put(r.passer.team, 'passing', k, 'td', 1);
    }
    if (r.passer && t === 'incomplete') put(r.passer.team, 'passing', key('passing', r.passer), 'att', 1);
    if (r.passer && t === 'int'){
      put(r.passer.team, 'passing', key('passing', r.passer), 'att', 1);
      put(r.passer.team, 'passing', key('passing', r.passer), 'intThrown', 1);
    }
    // A sack is charged to TEAM rushing, not to the quarterback's passing --
    // NFHS, and the difference from NFL convention that catches people out.
    // The panel sends a POSITIVE loss, so the engine negates it.
    if (r.passer && (t === 'sack' || (t === 'fumble' && r.attempt === 'sack'))){
      put(r.passer.team, 'passing', key('passing', r.passer), 'sacked', 1);
      put(r.passer.team, 'rushing', 'TEAM', 'att', 1);
      put(r.passer.team, 'rushing', 'TEAM', 'yds', -(r.passer.yards || 0));
    }

    // --- receiving. rec only on a catch; tgt on a catch, an incompletion
    // or an interception.
    if (r.receiver && (t === 'pass' || (t === 'fumble' && r.attempt === 'pass'))){
      const k = key('receiving', r.receiver), y = r.receiver.yards || 0;
      put(r.receiver.team, 'receiving', k, 'rec', 1);
      put(r.receiver.team, 'receiving', k, 'tgt', 1);
      put(r.receiver.team, 'receiving', k, 'yds', y);
      high(r.receiver.team, 'receiving', k, 'long', y);
      if (e.td) put(r.receiver.team, 'receiving', k, 'td', 1);
    }
    if (r.receiver && (t === 'incomplete' || t === 'int'))
      put(r.receiver.team, 'receiving', key('receiving', r.receiver), 'tgt', 1);

    // --- defense
    if (r.defense && ['rush','pass','sack','fumble','kickoff','punt'].indexOf(t) !== -1){
      const k = key('defense', r.defense);
      put(r.defense.team, 'defense', k, 'tackles', 1);
      const lost = (r.carrier && (r.carrier.yards || 0) < 0) || t === 'sack';
      if (lost) put(r.defense.team, 'defense', k, 'tfl', 1);
      if (t === 'sack') put(r.defense.team, 'defense', k, 'sacks', 1);
    }
    if (r.defense && t === 'int') put(r.defense.team, 'defense', key('defense', r.defense), 'int', 1);

    // --- special teams
    if (r.kicker && t === 'kickoff'){
      put(r.kicker.team, 'specialTeams', stKey(r.kicker), 'kickoffs', 1);
      if (r.kicker.touchback) put(r.kicker.team, 'specialTeams', stKey(r.kicker), 'touchbacks', 1);
    }
    if (r.kicker && t === 'fg'){
      const k = stKey(r.kicker);
      put(r.kicker.team, 'specialTeams', k, 'fgAtt', 1);
      if (r.kicker.result === 'g'){
        put(r.kicker.team, 'specialTeams', k, 'fgMade', 1);
        high(r.kicker.team, 'specialTeams', k, 'fgLong', r.kicker.yards || 0);
      }
      if (r.kicker.result === 'b') put(r.kicker.team, 'specialTeams', k, 'fgBlocked', 1);
    }
    if (r.kicker && t === 'pat'){
      const k = stKey(r.kicker);
      put(r.kicker.team, 'specialTeams', k, 'patAtt', 1);
      if (r.kicker.result === 'g') put(r.kicker.team, 'specialTeams', k, 'patMade', 1);
      if (r.kicker.result === 'b') put(r.kicker.team, 'specialTeams', k, 'patBlocked', 1);
    }
    if (r.punter && t === 'punt'){
      const k = stKey(r.punter);
      put(r.punter.team, 'specialTeams', k, 'punts', 1);
      if (r.punter.blocked){
        put(r.punter.team, 'specialTeams', k, 'blocked', 1);
      } else {
        put(r.punter.team, 'specialTeams', k, 'puntYds', r.punter.yards || 0);
        put(r.punter.team, 'specialTeams', k, 'puntsWithYards', 1);
        high(r.punter.team, 'specialTeams', k, 'puntLong', r.punter.yards || 0);
      }
    }
    if (r.returner){
      const k = key('specialTeams', r.returner);
      const pre = r.returner.kind === 'punt' ? 'puntRet' : 'kickRet';
      const y = r.returner.yards || 0;
      put(r.returner.team, 'specialTeams', k, pre, 1);
      put(r.returner.team, 'specialTeams', k, pre + 'Yds', y);
      high(r.returner.team, 'specialTeams', k, pre + 'Long', y);
      if (e.score && e.score.team === r.returner.team && e.score.points === 6)
        put(r.returner.team, 'specialTeams', k, pre + 'Td', 1);
    }
  });
  return mine;
}

// COMPARE THE TWO COUNTS.
// Reports in plain language, because this surfaces to a scorer finalizing a
// game, not to a developer reading a diff.
function compareBoxScores(playsList, box){
  const mine = auditBoxScore(playsList);
  const out = [];
  const CATS = ['rushing', 'passing', 'receiving', 'defense', 'specialTeams'];
  ['teamA', 'teamB'].forEach(team => {
    const label = (typeof TEAMS !== 'undefined' && TEAMS[team] && TEAMS[team].name) || team;
    CATS.forEach(cat => {
      const a = (mine[team] || {})[cat] || {};
      const b = ((box || {})[team] || {})[cat] || {};
      const who = [...new Set(Object.keys(a).concat(Object.keys(b)))];
      who.forEach(w => {
        const x = a[w] || {}, y = b[w] || {};
        const fields = [...new Set(Object.keys(x).concat(Object.keys(y)))];
        fields.forEach(f => {
          const mv = x[f] || 0, bv = y[f] || 0;
          if (mv !== bv){
            out.push(label + ' ' + w + ' ' + cat + ' ' + f +
                     ': the log says ' + mv + ', the stat line says ' + bv);
          }
        });
      });
    });
  });
  return out;
}
