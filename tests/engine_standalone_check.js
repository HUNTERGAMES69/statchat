// engine.js must stand alone in Node
// ----------------------------------
// The browser pages define a handful of things the engine leans on --
// `isAdminMarker`, `otherTeam`, `RECEIVE_POS`, `TIMEOUTS_PER_HALF`,
// `clockToAbsSeconds`. `engine.js` loads BEFORE the page script, so in a
// browser the page's own copies win and everything works.
//
// In Node there is no page. `api/feed.js` requires the engine directly,
// and anything it does not define itself is simply undefined.
//
// WHY THIS TEST EXISTS. I added the helpers by listing the ones I
// remembered, said the audit was complete, and missed `RECEIVE_POS`. The
// first real request to the feed returned:
//
//     {"error":"RECEIVE_POS is not defined"}
//
// Recalling a list is not auditing it. This test SEARCHES: it parses
// engine.js, works out every identifier it uses but never defines, and
// fails on any of them. The next missing one cannot hide.
//
// It also exercises the engine for real, because "no undefined
// references" and "produces correct numbers" are different claims.

const fs = require('fs');
const path = require('path');

const ENGINE = path.join(__dirname, '..', 'engine.js');

// Identifiers that are legitimately global in Node.
const BUILTIN = new Set([
  'Object','Array','Math','JSON','String','Number','Boolean','Set','Map',
  'Date','RegExp','Error','isNaN','parseInt','parseFloat','isFinite',
  'console','module','require','globalThis','undefined','null','true',
  'false','typeof','new','this','of','in','return','if','else','const',
  'let','var','function','for','while','switch','case','break','continue',
  'default','try','catch','throw','delete','void','instanceof','do',
  'Infinity','NaN','Symbol','Promise','Intl','encodeURIComponent'
]);

function undefinedReferences(src) {
  const defined = new Set();
  const add = n => { if (n) defined.add(n); };

  for (const m of src.matchAll(/(?:^|\n)\s*(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of src.matchAll(/globalThis\.([A-Za-z_$][\w$]*)\s*=/g)) add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]+)\}/g))
    m[1].split(',').forEach(x => add(x.split(':').pop().trim()));
  for (const m of src.matchAll(/function\s+\w*\s*\(([^)]*)\)/g))
    m[1].split(',').forEach(x => add(x.trim().split(/[=\s]/)[0]));
  for (const m of src.matchAll(/\(([^)]*)\)\s*=>/g))
    m[1].split(',').forEach(x => add(x.trim().split(/[=\s]/)[0]));
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) add(m[1]);
  for (const m of src.matchAll(/(?:for|catch)\s*\(\s*(?:const|let|var)?\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);

  // Strings and comments would otherwise produce nonsense matches.
  const clean = src
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

  const used = new Set();
  // SCREAMING_CASE constants, and anything called as a function.
  for (const m of clean.matchAll(/(?<![.\w$])([A-Z][A-Z0-9_]{2,})(?![\w$])/g)) used.add(m[1]);
  for (const m of clean.matchAll(/(?<![.\w$])([a-zA-Z_$][\w$]*)\s*\(/g)) used.add(m[1]);

  return [...used].filter(n => !defined.has(n) && !BUILTIN.has(n)).sort();
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- nothing undefined ----------------------------------------------
  const missing = undefinedReferences(fs.readFileSync(ENGINE, 'utf8'));
  if (missing.length) {
    fail('undefined', 'engine.js uses but never defines: ' + missing.join(', ') +
         '. In a browser the page supplies these; in Node nothing does, so ' +
         'api/feed.js throws on the first request that reaches that code path');
  }

  // --- it loads and exports -------------------------------------------
  let engine;
  try {
    delete require.cache[require.resolve(ENGINE)];
    engine = require(ENGINE);
  } catch (e) {
    fail('load', 'engine.js will not load in Node: ' + e.message);
    return failures;
  }
  for (const fn of ['computeState', 'computeBoxScore', 'findDriveStarts',
                    'countPossessions', 'buildContext']) {
    if (typeof engine[fn] !== 'function') {
      fail('exports', fn + ' is not exported — api/feed.js needs it');
    }
  }

  // --- and it actually computes ---------------------------------------
  // "No undefined references" and "produces correct numbers" are
  // different claims. The pass below is the one that would have caught
  // RECEIVE_POS even without the search, because receiving credit is
  // where it is used.
  try {
    const ctx = engine.buildContext(
      { id: 'g', our_team_is_home: true, home_team_name: 'Neville',
        away_team_name: 'Ruston', starting_possession: 'teamA',
        quarter_length_seconds: 720 },
      [{ team_side: 'teamA', unit: 'offense', jersey_number: '22',
         player_name: 'Roberson', position: 'RB' },
       { team_side: 'teamA', unit: 'offense', jersey_number: '7',
         player_name: 'Robinson', position: 'QB' },
       { team_side: 'teamA', unit: 'offense', jersey_number: '80',
         player_name: 'Young', position: 'WR' }],
      [{ id: 1, sequence_number: 1, text: 'reset', team_side: 'teamA', quarter: 1,
         effect: { isReset: true, down: 1, distance: 10, fieldPos: 25 } },
       { id: 2, sequence_number: 2, text: 'rush', team_side: 'teamA', quarter: 1,
         effect: { isStat: true, statYds: 8, fieldDelta: 8 },
         roles: { carrier: { team: 'teamA', num: '22', yards: 8 }, playType: 'rush' } },
       { id: 3, sequence_number: 3, text: 'pass', team_side: 'teamA', quarter: 1,
         // `converts` is set by the parser on a real play, not derived
         // by computeState. Omitting it made this fixture claim 3rd down
         // after a 21-yard gain on 2nd & 2 — the engine was right and
         // the fixture was lying.
         effect: { isStat: true, statYds: 21, fieldDelta: 21, converts: true },
         roles: { passer: { team: 'teamA', num: '7', yards: 21 },
                  receiver: { team: 'teamA', num: '80', yards: 21 },
                  playType: 'pass' } }],
      {});

    if (ctx.state.fieldPos !== 54) {
      fail('compute', 'expected fieldPos 54 after 8 + 21 from the 25, got ' +
           ctx.state.fieldPos);
    }
    if (ctx.state.down !== 1) {
      fail('compute', 'expected a first down after 29 yards, got down ' +
           ctx.state.down);
    }
    const rush = (ctx.box.teamA.rushing || {}).Roberson;
    if (!rush || rush.yds !== 8) {
      fail('compute', 'rushing wrong: ' + JSON.stringify(ctx.box.teamA.rushing));
    }
    // THE RECEIVE_POS PATH. A WR's catch must land in `receiving`; if the
    // constant is missing this either throws or files it under rushing.
    const rec = (ctx.box.teamA.receiving || {}).Young;
    if (!rec || rec.yds !== 21) {
      fail('compute', 'receiving wrong — this is the RECEIVE_POS path: ' +
           JSON.stringify(ctx.box.teamA.receiving));
    }
    if (!ctx.teams.teamA.name) {
      fail('compute', 'buildContext produced no team names');
    }
  } catch (e) {
    fail('compute', 'buildContext threw: ' + e.message);
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== engine.js standalone in Node ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) {
      console.log('  no undefined references, and it computes correctly.');
    }
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run, undefinedReferences };
