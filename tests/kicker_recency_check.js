// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// Each kicking tree remembers its own kicker
// ==========================================
// Reported 27 August 2026. Every kicking role was pooled: one recency map
// built from every `kicker` and `punter` on the team, feeding all four
// kicking pickers. So a kickoff specialist floated to the top of the field
// goal picker, and the last field goal kicker to the top of the PAT picker.
//
// In high school these are frequently three different boys -- a placekicker,
// a kickoff man with the stronger leg, and a punter. Pooled, the suggestion
// is wrong more often than right, and a wrong suggestion is worse than none
// because it invites a tap.
//
// DISCOVERY IS UNCHANGED. A boy who has only punted is still offered for a
// field goal, because he might take one. Only the ORDER narrows.
//
//   node tests/kicker_recency_check.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Kicker recency, per tree ===\n');

const grab = n => (new RegExp('function ' + n + '\\([\\s\\S]*?\\n\\}').exec(src) || [''])[0];

chk(/function lastUsedByRole\(team, roleKeys, playTypes\)\{/.test(src),
    'lastUsedByRole can be limited to particular play types');
chk(/if \(playTypes && playTypes\.indexOf\(r\.playType\) === -1\) return;/.test(src),
    'and skips plays outside them');
chk(/function specialTeamsEligible\(team, playType\)\{/.test(src),
    'the special-teams list takes the tree it is building for');
chk(/specialTeamsEligible\(off, type\)/.test(src),
    'the play panel passes its own type');
chk(/specialTeamsEligible\(guided\.kickingTeam, 'kickoff'\)/.test(src),
    "and the guided flow passes 'kickoff', which is all it ever is");

// THE MUFF-RECOVERY PICKER STAYS POOLED, on purpose: any coverage player can
// fall on a loose ball, so there is no single role whose recency would help.
chk(/kicking \? specialTeamsEligible\(off\) : defenseEligible\(def\)/.test(src),
    'the recovery credit picker is left pooled — any coverage player can ' +
    'recover, so no one role tells you who');

// ---- run it --------------------------------------------------------------
{
  const source = [grab('lastUsedByRole'), grab('byRecency'),
                  grab('specialTeamsEligible')].join('\n');
  const build = (plays) => new Function('plays', 'TEAMS', 'rosterName',
    source + '; return specialTeamsEligible;')(
      plays,
      { teamA: { rosterSpecialTeams: {'12':'Ward','33':'Reed','45':'Boone','88':'Nash'},
                 ambiguousSpecialTeams: {} } },
      (t, n) => '#' + n);

  // three specialists, which is the ordinary shape of a high school team
  const PLAYS = [
    { roles: { playType:'fg',      kicker: { team:'teamA', num:'12' } } },
    { roles: { playType:'pat',     kicker: { team:'teamA', num:'33' } } },
    { roles: { playType:'kickoff', kicker: { team:'teamA', num:'45' } } },
    { roles: { playType:'punt',    punter: { team:'teamA', num:'88' } } },
    { roles: { playType:'pat',     kicker: { team:'teamA', num:'33' } } },
    { roles: { playType:'fg',      kicker: { team:'teamA', num:'12' } } }
  ];
  const f = build(PLAYS);
  const first = t => f('teamA', t)[0].num;

  chk(first('fg') === '12', 'the field goal picker suggests the field goal kicker');
  chk(first('pat') === '33',
      'the PAT picker suggests the PAT kicker — a different boy, and the ' +
      'case that was reported');
  chk(first('kickoff') === '45', 'the kickoff picker suggests the kickoff man');
  chk(first('punt') === '88',
      'and the punt picker the punter — numbered 88 on purpose, because a ' +
      'punter with the lowest number would come first under plain numeric ' +
      'order and the assertion would pass without the recency working');

  // THE OLD BEHAVIOUR, for contrast: pooled, every picker led with whoever
  // kicked last, whatever they had kicked.
  chk(f('teamA')[0].num === '12',
      'pooled, they would all have led with the same man — which is what ' +
      'was happening');

  // DISCOVERY UNCHANGED. Everyone who has kicked anything is still offered
  // in every picker; only the order differs.
  ['fg', 'pat', 'kickoff', 'punt'].forEach(t => {
    const nums = f('teamA', t).map(p => p.num).sort().join();
    chk(nums === '12,33,45,88',
        t + ': all four are still offered, just in a different order');
  });

  // A tree nobody has kicked in yet has no recency to go on and must not
  // throw or come back empty.
  const fresh = build([]);
  chk(fresh('teamA', 'fg').length === 4,
      'with no plays at all, the roster is still offered');
}

// ---- THE SECOND MECHANISM: preselection ---------------------------------
// KICK_DEFAULTS drives which button comes up already `suggested`, and it is
// entirely separate from the ordering above. Both were pooled; scoping only
// specialTeamsEligible left this one still drawing from ['fg','pat'], so a
// live test found the field goal kicker PRESELECTED on the first PAT.
//
// Two mechanisms doing the same job is the shape that hides a fix: the first
// change was real, verifiable, and did not solve the reported problem.
{
  const m = /const KICK_DEFAULTS = \{[\s\S]*?\n    \};/.exec(src);
  chk(!!m, 'KICK_DEFAULTS is present');
  const defs = new Function(
    m[0].replace(/^\s*\/\/[^\n]*$/gm, '') + '; return KICK_DEFAULTS;')();

  chk(JSON.stringify(defs.fg.from) === '["fg"]',
      'the field goal tree suggests from field goals only');
  chk(JSON.stringify(defs.pat.from) === '["pat"]',
      'and the PAT tree from PATs only — these both drew from both, which is ' +
      'what put the placekicker on the first PAT');
  chk(JSON.stringify(defs.kickoff.from) === '["kickoff"]', 'kickoff from kickoffs');
  chk(JSON.stringify(defs.punt.from) === '["punt"]', 'punt from punts');
  chk(defs.fg.label !== defs.pat.label,
      'and the two carry different labels, so the tooltip says which kick it ' +
      'is remembering');

  // run the lookup the panel actually performs
  const plays = [];
  const suggest = (type) => {
    const kd = defs[type];
    for (let i = plays.length - 1; i >= 0; i--){
      const r = plays[i].roles;
      if (!r || !kd.from.includes(r.playType)) continue;
      const who = r[kd.role];
      if (who && who.team === 'teamA' && who.num) return who.num;
    }
    return null;
  };

  plays.push({ roles: { playType:'fg', kicker: { team:'teamA', num:'12' } } });
  chk(suggest('fg') === '12', 'after a field goal, the FG tree suggests that kicker');
  chk(suggest('pat') === null,
      'and the PAT tree suggests NOBODY — the reported bug, and no suggestion ' +
      'is better than a wrong one because a wrong one invites a tap');

  plays.push({ roles: { playType:'pat', kicker: { team:'teamA', num:'33' } } });
  chk(suggest('pat') === '33', 'after a PAT, the PAT tree suggests that kicker');
  chk(suggest('fg') === '12',
      'and the FG tree still suggests the field goal kicker, not the PAT one');
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
