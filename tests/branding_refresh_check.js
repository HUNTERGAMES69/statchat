// Branding that changes mid-game reaches the crew view
// ====================================================
// refreshBranding polled the `teams` table and updated TEAMS.teamA -- our
// own school. The opponent's branding lives on the GAME row, because an
// opponent has no tenant of their own, and nothing re-read it after load.
//
// So a logo uploaded for the opponent during a game never appeared. Reported
// from a live game, 27 August 2026. Their colours had the same fault.
//
//   node tests/branding_refresh_check.js

const fs = require('fs');
const path = require('path');
const view = fs.readFileSync(path.join(__dirname, '..', 'view.html'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Mid-game branding refresh ===\n');

// ---- the opponent is read at all -----------------------------------------
{
  const fn = /async function refreshBranding\(force\)\{[\s\S]*?\n    \}/.exec(view);
  chk(!!fn, 'refreshBranding is present');
  if (fn) {
    chk(/\.from\('games'\)/.test(fn[0]),
        'it reads the GAMES row — the opponent has no tenant, so their ' +
        'branding lives there and not on `teams`');
    chk(/opponent_logo_url/.test(fn[0]) &&
        /opponent_primary_color/.test(fn[0]) &&
        /opponent_secondary_color/.test(fn[0]),
        'and all three opponent fields, not just the logo');
    chk(/TEAMS\.teamB\.logo = g\.opponent_logo_url \|\| null;/.test(fn[0]),
        'and applies them');
    chk(/if \(!TEAMS\.teamA \|\| !TEAMS\.teamB\) return;/.test(fn[0]),
        'guarding on both teams, since it now touches both');
  }
}

// ---- the separation is shared, not duplicated ----------------------------
// Assigning three colour fields is not enough: if the opponent's primary
// sits close to ours, one of them has to move or both spines look the same.
chk(/function separateTeamColors\(oppPrimary, oppSecondary\)\{/.test(view),
    'the contrast rule is a function rather than inline in buildTeams');
chk((view.match(/separateTeamColors\(/g) || []).length === 3,
    'called from both the initial build and the refresh (plus its own ' +
    'definition) — the refresh used not to re-run it at all, so changing ' +
    'OUR colour mid-game to something near theirs left both spines alike');

// ---- run the separation --------------------------------------------------
{
  const grab = n => (new RegExp('function ' + n + '\\([\\s\\S]*?\\n\\}').exec(engine) || [''])[0];
  const deps = ['normalizeHex', 'colorDistance', 'luminance'].map(grab).join('\n');
  const sep = /function separateTeamColors\(oppPrimary, oppSecondary\)\{[\s\S]*?\n  \}/.exec(view)[0];
  const run = (ours, theirs, second) => {
    const TEAMS = { teamA: { bg: ours }, teamB: { bg: theirs, text: '#fff' } };
    new Function('TEAMS', 'p', 's', deps + '\n' + sep + '; separateTeamColors(p, s);')(TEAMS, theirs, second);
    return TEAMS.teamB.bg;
  };
  chk(run('#1a4d9e', '#c8102e', '#ffffff') === '#c8102e',
      'two clearly different colours are left alone');
  chk(run('#1a4d9e', '#1a4da0', '#ffffff') === '#ffffff',
      'two near-identical blues push the opponent to their secondary');
  chk(run('#1a4d9e', '#1a4da0', '#1b4ea1') === '#c8c8c8',
      'and when the secondary is close too, to a neutral gray');
}

// ---- change detection: no loop, no misses --------------------------------
// COMPARED AGAINST THE RAW STORED VALUES, not against TEAMS.teamB.bg. The
// separation above may have moved that on purpose, and comparing to the
// moved value would report a change on every poll and re-render the page
// once a minute for the whole game.
chk(/let lastOppPrimary = null, lastOppSecondary = null;/.test(view),
    'the raw opponent colours are remembered separately');
{
  const m = /const changed =[\s\S]*?;\s*\n\s*if \(!changed\) return;/.exec(view);
  chk(!!m, 'the change check is a single expression');
  if (m) {
    const body = m[0].replace('if (!changed) return;', 'return changed;');
    const run = (teamB, teamsRow, gameRow) => new Function(
      'TEAMS', 'b', 'g', 'oppPrimary', 'oppSecondary', 'lastOppPrimary', 'lastOppSecondary', body
    )({ teamA: { logo: 'a.png', bg: '#1a4d9e' }, teamB }, teamsRow, gameRow,
      gameRow.opponent_primary_color, gameRow.opponent_secondary_color, '#c8102e', '#ffffff');

    // teamB.bg is #ffffff here because the separation moved it off #c8102e
    const B = { logo: 'old.png', bg: '#ffffff' };
    const ours = { logo_url: 'a.png', primary_color: '#1a4d9e' };
    const G = o => Object.assign({ opponent_logo_url: 'old.png',
      opponent_primary_color: '#c8102e', opponent_secondary_color: '#ffffff' }, o || {});

    chk(run(B, ours, G()) === false,
        'nothing changed after the separation moved a colour — otherwise the ' +
        'page re-renders every minute for the whole game');
    chk(run(B, ours, G({ opponent_logo_url: 'new.png' })) === true,
        'a new opponent logo is detected — the reported fault');
    chk(run(B, ours, G({ opponent_primary_color: '#0b6e3a' })) === true,
        'and a changed opponent colour');
    chk(run(B, { logo_url: 'b.png', primary_color: '#1a4d9e' }, G()) === true,
        'and our own logo, which already worked');
  }
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
