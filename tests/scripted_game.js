// A scripted game covering the play types a coach actually uses.
//
// Each step carries the coach's INTENT (`spec`, driven through the real
// UI) alongside what the app is expected to show afterwards (`expect`).
// Expectations are written out by hand from the rules of football, NOT
// copied from whatever the app happened to produce -- otherwise the test
// just certifies current behaviour, bugs included.
//
// `expect.down/distance/fieldPos/possession` describe game state AFTER
// the play. `expect.textHas` are substrings the log line must contain.

module.exports = [
  // ---- Drive 1: Neville (teamA), starting 1st & 10 at own 25 --------
  { setDrive: { down: 1, distance: 10, side: 'own', yardline: 25 },
    expect: { down: 1, distance: 10, fieldPos: 25, possession: 'teamA' } },

  { note: 'plain rush, gains but does not convert',
    spec: { type: 'rush', carrier: '22', yards: '8' },
    expect: { down: 2, distance: 2, fieldPos: 33, possession: 'teamA',
              textHas: ['N Runningback', 'rush for 8'] } },

  { note: 'completed pass past the marker -> automatic first down',
    spec: { type: 'pass', passer: '7', receiver: '80', yards: '22' },
    expect: { down: 1, distance: 10, fieldPos: 55, possession: 'teamA',
              textHas: ['N Quarterback', 'N Receiver', '22'] } },

  { note: 'SACK: ball must move BACKWARD and distance-to-go must grow',
    spec: { type: 'sack', passer: '7', yards: '7', credit: '55' },
    expect: { down: 2, distance: 17, fieldPos: 48, possession: 'teamA',
              // "a loss of 7", not "for 7 yds". The old wording read as a
              // GAIN of seven on the one play type whose number is always
              // a loss; the sack path now goes through gainPhrase like
              // every other yardage phrase. Asserting the word "loss" is
              // the point of this line, not incidental to it.
              textHas: ['sacked for a loss of 7', 'O Linebacker'] } },

  { note: 'second rush by the same carrier -- totals must accumulate',
    spec: { type: 'rush', carrier: '22', yards: '5' },
    expect: { down: 3, distance: 12, fieldPos: 53, possession: 'teamA',
              textHas: ['rush for 5'] } },

  { note: 'incomplete pass: attempt counted, no yards, no completion',
    spec: { type: 'pass', passer: '7', receiver: '84', incomplete: true },
    expect: { down: 4, distance: 12, fieldPos: 53, possession: 'teamA',
              textHas: ['incomplete'] } },

  { note: 'punt flips possession; returner must NOT earn a defensive stat',
    spec: { type: 'punt', punter: '15', yards: '40', credit: '25', retyds: '10',
            spot: { side: 'own', yardline: 30 } },
    expect: { possession: 'teamB', textHas: ['punt'] } },

  // ---- Drive 2: TEST OPP (teamB) ------------------------------------
  { setDrive: { down: 1, distance: 10, side: 'own', yardline: 30 },
    expect: { down: 1, distance: 10, fieldPos: 30, possession: 'teamB' } },

  { note: 'penalty on the offense: back up AND increase distance-to-go',
    spec: { type: 'penalty', on: 'offense', yards: '10' },
    expect: { down: 1, distance: 20, fieldPos: 20, possession: 'teamB',
              textHas: ['Penalty on TEST OPP', '10 yds', '1st & 20'] } },

  { note: 'penalty on the defense large enough to be an automatic first down',
    spec: { type: 'penalty', on: 'defense', yards: '25' },
    expect: { down: 1, distance: 10, fieldPos: 45, possession: 'teamB',
              textHas: ['Penalty on Neville', '25 yds'] } },

  { note: 'rushing touchdown',
    spec: { type: 'rush', carrier: '22', yards: '55', td: true },
    expect: { possession: 'teamB', scores: { teamA: 0, teamB: 6 },
              textHas: ['O Runningback', 'TOUCHDOWN'] } },

  { note: 'PAT good',
    spec: { type: 'pat', kicker: '3', result: 'g' },
    expect: { scores: { teamA: 0, teamB: 7 } } },

  { note: 'kickoff to Neville, returned',
    spec: { type: 'kickoff', kicker: '3', yards: '55', credit: '25', retyds: '20',
            spot: { side: 'own', yardline: 40 } },
    expect: { possession: 'teamA' } },

  // ---- Drive 3: Neville again ---------------------------------------
  { setDrive: { down: 1, distance: 10, side: 'own', yardline: 40 },
    expect: { down: 1, distance: 10, fieldPos: 40, possession: 'teamA' } },

  { note: 'interception: possession flips, QB charged, defender credited',
    spec: { type: 'int', passer: '7', credit: '21', yards: '5',
            spot: { side: 'own', yardline: 35 } },
    expect: { possession: 'teamB', textHas: ['O Cornerback', 'INTERCEPT'] } },

  // ---- Drive 4: TEST OPP, ends in a field goal ----------------------
  { setDrive: { down: 1, distance: 10, side: 'own', yardline: 35 },
    expect: { down: 1, distance: 10, fieldPos: 35, possession: 'teamB' } },

  { note: 'fumble lost to the defense',
    spec: { type: 'fumble', carrier: '28', credit: '99', yards: '0',
            spot: { side: 'own', yardline: 45 } },
    expect: { possession: 'teamA', textHas: ['FUMBLE'] } },

  { setDrive: { down: 1, distance: 10, side: 'own', yardline: 45 },
    expect: { down: 1, distance: 10, fieldPos: 45, possession: 'teamA' } },

  { note: 'field goal good',
    spec: { type: 'fg', kicker: '3', yards: '42', result: 'g' },
    expect: { scores: { teamA: 3, teamB: 7 }, textHas: ['FIELD GOAL'] } }
];
