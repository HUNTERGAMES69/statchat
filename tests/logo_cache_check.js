// Replacing a logo has to change its URL
// ======================================
// Both uploads wrote to a FIXED path with upsert -- `opponent/<gameId>/
// logo.<ext>` and `<teamId>/<kind>.<ext>` -- so replacing an image left the
// stored URL byte-for-byte identical.
//
// Nothing downstream could tell anything had happened. The games row was
// unchanged, so a page comparing it found no change; and a page that DID
// re-render asked for the same URL and got the browser's cached copy.
//
// Reported from a live game on 27 August 2026: a replaced opponent logo
// appeared on no screen at all. Two rounds of refresh work went into
// view.html and game.html before the cause turned out to be here -- the
// refresh was right and had nothing to detect.
//
//   node tests/logo_cache_check.js

const fs = require('fs');
const path = require('path');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Logo uploads produce a new URL each time ===\n');

const cases = [
  ['create_game.html', /async function uploadOppLogo\(file, gameId\)\{[\s\S]*?\n  \}/, 'the opponent logo'],
  ['customize.html',   /async function uploadImage\(file, teamId, kind\)\{[\s\S]*?\n  \}/, 'our own logo']
];

cases.forEach(([file, re, label]) => {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const m = re.exec(src);
  chk(!!m, file + ': the upload function is present');
  if (!m) return;
  const fn = m[0];

  chk(/Date\.now\(\)/.test(fn),
      label + ': the path carries something that changes per upload — a ' +
      'fixed path plus upsert means a replaced image keeps its URL');

  // THE PATH, not a query string. A `?v=` would fix the browser and not the
  // CDN, and would leave the stored URL stale for anything reading it later.
  const pathLine = /const path = [^;]+;/.exec(fn);
  chk(!!pathLine && /Date\.now\(\)/.test(pathLine[0]),
      label + ': and it is in the PATH — a cache-busting query string fixes ' +
      'the browser but not the CDN, and leaves the row unchanged');
  chk(!/\?v=|\?t=|\+ '\?'/.test(fn),
      label + ': with no query-string busting bolted on as well');
});

// ---- run them ------------------------------------------------------------
// Reading the line is not proving two uploads differ.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'create_game.html'), 'utf8');
  const line = /const path = 'opponent\/' \+ gameId \+ [^;]+;/.exec(src);
  chk(!!line, 'the opponent path is a single expression');
  if (line) {
    const extLine = /const ext = [^;]+;/.exec(src);
    chk(!!extLine && /toLowerCase\(\)/.test(extLine[0]),
        'the extension is lowercased in the SOURCE — CREST.PNG and crest.png ' +
        'must not become two objects for one picture');
    const build = (name) => new Function('gameId', 'file',
      (extLine ? extLine[0] : "const ext='png';") + '\n' +
      line[0] + '\nreturn path;')('g-123', { name });
    const a = build('crest.PNG');
    const b = build('crest.PNG');
    // Date.now() can return the same millisecond twice; what matters is that
    // the path is not CONSTANT, so compare across a real gap.
    const later = new Promise(r => setTimeout(() => r(build('crest.PNG')), 5));
    return later.then(c => {
      chk(a !== c, 'two uploads a few milliseconds apart get different paths');
      chk(/\.png$/.test(a),
          'and the extension is lowercased — CREST.PNG and crest.png must not ' +
          'become two different objects for the same picture');
      chk(a.indexOf('g-123') !== -1,
          'the game id stays in the path, so a game\'s logos stay together');
      console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
      process.exitCode = fails ? 1 : 0;
    });
  }
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
