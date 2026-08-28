// The stat line is checked against the play log
// =============================================
// validateGame re-derived STATE from the log -- down, distance, quarter --
// and caught a play whose sentence disagreed with what the log implied. It
// never touched the box score. So a fault in computeBoxScore produced a
// wrong stat line from a correct log, and nothing on the page said so.
//
// compareBoxScores counts the same plays a SECOND time, straight off
// `roles`, and reports the disagreements. Deliberately not by calling
// computeBoxScore's helpers -- sharing them would share their mistakes and
// agree for the wrong reason.
//
// WHAT IT CANNOT DO: catch a rule both implementations get wrong the same
// way. What it does catch is a credit going to the wrong bucket, a double
// count, a dropped path, or a statistic written under two keys. That last
// one is why this exists: mapping the crediting rules to write it is how
// the cmp/comp fault was found, before a line of it was written.
//
//   node tests/box_score_audit_check.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
const gameSrc   = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Box score audited against the play log ===\n');

// ---- it exists, in the shared engine --------------------------------------
chk(/function auditBoxScore\(playsList\)\{/.test(engineSrc),
    'auditBoxScore lives in engine.js, so every page that loads the engine ' +
    'has it rather than one page owning the only copy');
chk(/function compareBoxScores\(playsList, box\)\{/.test(engineSrc),
    'and compareBoxScores alongside it');

// ---- validateGame calls it ------------------------------------------------
// A checker nothing calls is a checker that never runs.
chk(/const statIssues = compareBoxScores\(plays, computeBoxScore\(plays\)\);/.test(gameSrc),
    'validateGame runs it');

// AT FINALIZE ONLY. Every other check in validateGame names something a
// scorer can act on mid-game -- a wrong down, a missing spot. A stat-line
// disagreement is not that: it says two counts differ and cannot say which
// is right, so there is nothing to do about it during a drive. A warning
// with no action attached is noise at the moment noise costs most.
chk(/if \(forFinal\) try \{\s*\n\s*const statIssues = compareBoxScores/.test(gameSrc),
    'and ONLY when finalizing — the live panel keeps the checks that have a fix');
{
  // run the gate rather than trusting the shape of it
  const i = gameSrc.indexOf('if (forFinal) try {');
  const body = gameSrc.slice(i, gameSrc.indexOf('return issues;', i));
  const run = (forFinal, found) => {
    const issues = [];
    new Function('forFinal', 'issues', 'plays', 'compareBoxScores', 'computeBoxScore', body)(
      forFinal, issues, [], () => found, () => ({}));
    return issues;
  };
  chk(run(false, ['a', 'b', 'c']).length === 0,
      'mid-game it stays silent even with disagreements to report');
  chk(run(true, ['a', 'b', 'c']).length === 3,
      'at finalize it reports them');
  chk(run(true, []).length === 0, 'and says nothing when there is nothing');
  const many = run(true, Array.from({ length: 14 }, (_, n) => 'd' + n));
  chk(many.length === 9 && /and 6 more/.test(many[many.length - 1]),
      'capping at eight with a count of the rest, so one systematic fault ' +
      'cannot bury the other checks');
}
chk(/statIssues\.slice\(0, 8\)/.test(gameSrc),
    'and caps the report — one systematic fault would otherwise repeat per ' +
    'player and bury everything else');
{
  const m = /try \{[\s\S]{0,700}?compareBoxScores[\s\S]{0,900}?\} catch \(err\)[\s\S]{0,400}?\}/.exec(gameSrc);
  chk(!!m, 'wrapped in try/catch — a warning that breaks must not make a ' +
           'game with good numbers unfinishable');
}

// ---- the counting is its own -----------------------------------------------
{
  const fn = /function auditBoxScore\(playsList\)\{[\s\S]*?\n\}/.exec(engineSrc);
  chk(!!fn, 'auditBoxScore is a real function');
  if (fn) {
    chk(!/computeBoxScore|bucket\(/.test(fn[0]),
        'and counts without calling computeBoxScore or its bucket helper — ' +
        'the whole value is in it being a separate implementation');
    // BUCKET NAMING is shared on purpose: a different key would report every
    // player as a disagreement and drown any real fault.
    chk(/playerName\(/.test(fn[0]),
        'though it does share the bucket NAMING, which is not counting');
  }
}

// ---- run it: agreement on a clean game, and every injected fault caught ----
const TEAM = { posOffense:{}, posDefense:{}, rosterOffense:{},
               rosterDefense:{}, rosterSpecialTeams:{} };
const P = (r, e) => ({ id: Math.random(), text: 'x', quarter: 1, roles: r, effect: e || {} });
const PLAYS = [
  P({ playType:'rush', carrier:{team:'teamA',num:'22',name:'RB',yards:8},
      defense:{team:'teamB',num:'55',name:'LB'} }, {isStat:true,statYds:8}),
  P({ playType:'rush', carrier:{team:'teamA',num:'22',name:'RB',yards:-3},
      defense:{team:'teamB',num:'55',name:'LB'} }, {isStat:true,statYds:-3}),
  P({ playType:'pass', passer:{team:'teamA',num:'7',name:'QB',yards:14},
      receiver:{team:'teamA',num:'80',name:'WR',yards:14} }, {isStat:true,statYds:14}),
  P({ playType:'incomplete', passer:{team:'teamA',num:'7',name:'QB',yards:0},
      receiver:{team:'teamA',num:'80',name:'WR',yards:0} }, {isStat:true,statYds:0}),
  P({ playType:'sack', passer:{team:'teamA',num:'7',name:'QB',yards:6},
      defense:{team:'teamB',num:'99',name:'DE'} }, {isStat:true,statYds:-6}),
  P({ playType:'int', passer:{team:'teamA',num:'7',name:'QB',yards:0},
      receiver:{team:'teamA',num:'80',name:'WR',yards:0},
      defense:{team:'teamB',num:'21',name:'CB'} }, {isStat:true,statYds:0}),
  P({ playType:'fumble', attempt:'pass', passer:{team:'teamA',num:'7',name:'QB',yards:11},
      receiver:{team:'teamA',num:'80',name:'WR',yards:11} }, {isStat:true,statYds:11}),
  P({ playType:'fumble', attempt:'rush', carrier:{team:'teamA',num:'22',name:'RB',yards:4} },
    {isStat:true,statYds:4}),
  P({ playType:'fg',  kicker:{team:'teamA',num:'1',name:'K',result:'g',yards:34} }, {}),
  P({ playType:'pat', kicker:{team:'teamA',num:'1',name:'K',result:'g'} }, {}),
  P({ playType:'punt', punter:{team:'teamA',num:'9',name:'P',yards:42} }, {}),
  P({ playType:'kickoff', kicker:{team:'teamA',num:'1',name:'K'},
      returner:{team:'teamB',num:'5',name:'RET',yards:19,kind:'kick'} }, {})
];

function runWith(src){
  const ctx = vm.createContext({
    TEAMS: { teamA: Object.assign({}, TEAM, {name:'Home'}),
             teamB: Object.assign({}, TEAM, {name:'Away'}) },
    startingPossession: 'teamA', PENALTIES: {},
    otherTeam: (t) => (t === 'teamA' ? 'teamB' : 'teamA'),
    TIMEOUTS_PER_HALF: 3,
    isAdminMarker: (p) => !!(p && p.isDivider),
    clockToAbsSeconds: () => null,
    globalThis: {}, console, Math, JSON, Object, Array, String, Number, Set,
    plays: PLAYS, out: null
  });
  vm.runInContext(src + '\nout = compareBoxScores(plays, computeBoxScore(plays));', ctx);
  return ctx.out;
}

chk(runWith(engineSrc).length === 0,
    'on a clean twelve-play game covering every crediting path, the two ' +
    'counts agree exactly — a checker that cries wolf is worse than none');

// EVERY ONE OF THESE MUST BE CAUGHT. This is the only evidence that the
// audit is doing anything: agreement on a correct game proves nothing on
// its own, since a function returning [] would also pass.
[
  ['a rush credits two attempts',
   s => s.replace("s.att = (s.att||0) + 1;\n        s.yds = (s.yds||0) + (r.carrier.yards||0);",
                  "s.att = (s.att||0) + 2;\n        s.yds = (s.yds||0) + (r.carrier.yards||0);")],
  ['rushing yards doubled',
   s => s.replace("s.yds = (s.yds||0) + (r.carrier.yards||0);",
                  "s.yds = (s.yds||0) + 2*(r.carrier.yards||0);")],
  ['the cmp/comp fault returns',
   s => s.replace("ps.comp = (ps.comp||0) + 1;", "ps.cmp = (ps.cmp||0) + 1;")],
  ['sack yardage credited as a gain',
   s => s.replace("ts.yds = (ts.yds||0) - (r.passer.yards||0);",
                  "ts.yds = (ts.yds||0) + (r.passer.yards||0);")],
  ['a made field goal stops counting',
   s => s.replace("s.fgMade = (s.fgMade||0) + 1;", "")],
  ['punt yardage dropped',
   s => s.replace("s.puntYds = (s.puntYds||0) + (r.punter.yards||0);", "")],
  ['return yards become a count of one',
   s => s.replace("s[pre + 'Yds'] = (s[pre + 'Yds']||0) + (r.returner.yards||0);",
                  "s[pre + 'Yds'] = (s[pre + 'Yds']||0) + 1;")],
  ['a tackle is double counted',
   s => s.replace("s.tackles = (s.tackles||0) + 1;", "s.tackles = (s.tackles||0) + 2;")]
].forEach(([label, mutate]) => {
  const broken = mutate(engineSrc);
  if (broken === engineSrc){
    chk(false, 'could not inject: ' + label + ' (the code it targets moved)');
    return;
  }
  let found = [];
  try { found = runWith(broken); } catch (e) { found = ['threw: ' + e.message]; }
  chk(found.length > 0 && !/^threw:/.test(found[0] || ''),
      'caught: ' + label);
});

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
