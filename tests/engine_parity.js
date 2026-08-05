// Engine parity check
// -------------------
// game.html, view.html, recap.html, stat_package.html and
// season_report.html each carry their OWN verbatim copy of the core
// engine functions. TODO.md item #1 exists because a fix has to be
// repeated correctly in every copy, and twice already it wasn't
// (the sack-yardage inconsistency, and the RECEIVE_POS omission).
//
// Until the shared-engine-file consolidation happens, this check is the
// safety net: it extracts each copy and compares them character by
// character (after normalising whitespace), so drift is caught
// immediately instead of at report-generation time.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');

const FILES = ['game.html', 'view.html', 'recap.html', 'stat_package.html', 'season_report.html'];
const FUNCS = ['computeState', 'parseInput', 'computeBoxScore', 'buildTeams',
               'nameInOffense', 'nameInDefense', 'nameInSpecialTeams', 'playerName',
               'extractNameTag', 'ordinal', 'formatDuration',
               'countPossessions', 'findDriveStarts', 'markerLabel', 'otherTeam',
               'computePlayerStats', 'posToUnit', 'clockToAbsSeconds'];

// Extract a function's full source by brace matching from `function NAME`.
function extractFunction(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(', 'g');
  const m = re.exec(src);
  if (!m) return null;
  const start = src.indexOf('{', m.index);
  if (start === -1) return null;

  // A naive brace scanner gets this badly wrong: an apostrophe inside a
  // // comment ("they're") reads as a string opener and swallows the
  // rest of the file. Comments, strings, template literals and regex
  // literals all have to be skipped properly.
  let depth = 0;
  let j = start;
  // Tracks whether a '/' begins a regex literal or is a division sign.
  let prevSignificant = '';

  while (j < src.length) {
    const c = src[j], c2 = src[j + 1];

    if (c === '/' && c2 === '/') {
      j = src.indexOf('\n', j);
      if (j === -1) return null;
      continue;
    }
    if (c === '/' && c2 === '*') {
      j = src.indexOf('*/', j);
      if (j === -1) return null;
      j += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      j++;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j++;
      }
      j++;
      prevSignificant = 'x';
      continue;
    }
    if (c === '/' && /[({[,=:;!&|?+\-*%~^]|^$/.test(prevSignificant)) {
      // Regex literal -- skip it, honouring escapes and character classes.
      j++;
      let inClass = false;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        else if (src[j] === '\n') break;
        j++;
      }
      j++;
      prevSignificant = 'x';
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(m.index, j + 1);
    }
    if (!/\s/.test(c)) prevSignificant = c;
    j++;
  }
  return null;
}

// Comments and indentation legitimately differ between copies; logic
// must not. Strip both before comparing.
function normalise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(l => l.replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\s+/g, ' ');
}

// Divergences that have been reviewed and accepted. Anything NOT listed
// here that differs is unreviewed drift and fails the check.
// `groups` must match the actual grouping exactly -- if a new file joins
// the divergence, or a group's membership changes, this stops matching
// and the check goes red again on purpose.
const EXPECTED_VARIANTS = {
  nameInOffense: {
    openBug: true,
    reason: 'OPEN BUG. view.html/recap/stat_package/season_report fall back to the ' +
            'special-teams roster when a number is not on the offense roster; ' +
            'game.html does NOT. game.html is the only file that matters here, ' +
            'because it generates the play-log text ONCE at save time and stores ' +
            'it -- the other four only display that stored string, so their better ' +
            'fallback never runs for a log line. Tracked in TODO.md.',
    groups: [['game.html'], ['view.html', 'recap.html', 'stat_package.html', 'season_report.html']]
  },
  nameInSpecialTeams: {
    openBug: true,
    reason: 'OPEN BUG, same shape as nameInOffense and same reason it matters: the ' +
            'four display pages fall back to the offense roster, game.html does ' +
            'not, and only game.html\'s version reaches the stored text. ' +
            'Tracked in TODO.md.',
    groups: [['game.html'], ['view.html', 'recap.html', 'stat_package.html', 'season_report.html']]
  },
  buildTeams: {
    reason: 'Intentional and page-appropriate: game.html needs seedOrder for the ' +
            'entry UI\'s seeded starters; view.html and the report pages apply a ' +
            'colorDistance clash adjustment for display; the report pages carry ' +
            'isHome. No page needs another page\'s extras.',
    groups: [
      ['game.html'],
      ['view.html'],
      ['recap.html', 'stat_package.html', 'season_report.html']
    ]
  },
  clockToAbsSeconds: {
    reason: 'KNOWN STALE, NOT YET FIXED. view.html still has the pre-Aug-4 version: ' +
            'no colon-less entry ("1156"), no secs>59 rejection, no quarter-length ' +
            'bound. Currently dead code in view.html (defined, never called), so it ' +
            'is not a live bug -- but it is a live trap. Remove it or sync it.',
    groups: [['game.html'], ['view.html']]
  }
};

function sameGrouping(actual, expected) {
  const norm = gs => gs.map(g => g.slice().sort().join(',')).sort().join(' | ');
  return norm(actual) === norm(expected);
}


function run() {
  const sources = {};
  FILES.forEach(f => { sources[f] = fs.readFileSync(path.join(REPO, f), 'utf8'); });

  const results = [];
  let drift = 0;

  for (const fn of FUNCS) {
    const copies = {};
    for (const f of FILES) {
      const src = extractFunction(sources[f], fn);
      if (src) copies[f] = src;
    }
    const owners = Object.keys(copies);
    if (owners.length <= 1) {
      results.push({ fn, status: 'single', owners });
      continue;
    }
    const groups_ = new Map();
    for (const f of owners) {
      const key = normalise(copies[f]);
      if (!groups_.has(key)) groups_.set(key, []);
      groups_.get(key).push(f);
    }
    if (groups_.size === 1) {
      results.push({ fn, status: 'identical', owners });
    } else {
      const groups = [...groups_.values()];
      const accepted = EXPECTED_VARIANTS[fn];
      if (accepted && sameGrouping(groups, accepted.groups)) {
        results.push({ fn, status: accepted.openBug ? 'known-bug' : 'accepted', owners, groups, reason: accepted.reason });
      } else {
        drift++;
        results.push({ fn, status: 'DRIFT', owners, groups, raw: copies });
      }
    }
  }

  return { results, drift };
}

if (require.main === module) {
  const { results, drift } = run();
  console.log('=== Engine parity across duplicated copies ===\n');
  for (const r of results) {
    if (r.status === 'single') {
      console.log(`  -   ${r.fn.padEnd(20)} only in ${r.owners.join(', ')}`);
    } else if (r.status === 'identical') {
      console.log(`  OK  ${r.fn.padEnd(20)} ${r.owners.length} copies identical  (${r.owners.join(', ')})`);
    } else if (r.status === 'known-bug') {
      console.log(`  BUG ${r.fn.padEnd(20)} ${r.groups.length} versions -- KNOWN OPEN BUG:`);
      r.groups.forEach(g => console.log(`        ${g.join(', ')}`));
      console.log(`        ${r.reason}`);
    } else if (r.status === 'accepted') {
      console.log(`  ~   ${r.fn.padEnd(20)} ${r.groups.length} accepted variants:`);
      r.groups.forEach(g => console.log(`        ${g.join(', ')}`));
      console.log(`        reason: ${r.reason}`);
    } else {
      console.log(`  !!  ${r.fn.padEnd(20)} ${r.owners.length} copies, ${r.groups.length} DIFFERENT VERSIONS:`);
      r.groups.forEach((g, i) => console.log(`        version ${i + 1}: ${g.join(', ')}`));
    }
  }
  const openBugs = results.filter(r => r.status === 'known-bug').length;
  console.log(`\n${drift === 0 ? 'No unreviewed drift.' : drift + ' function(s) have UNREVIEWED drift.'}` +
    (openBugs ? `  ${openBugs} known open bug(s) still outstanding -- see TODO.md.` : ''));
  process.exitCode = drift === 0 ? 0 : 1;
}

module.exports = { run, extractFunction, normalise, FILES, FUNCS };
