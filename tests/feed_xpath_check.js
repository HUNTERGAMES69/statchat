// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// The XPath published for every feed must be the one the feed actually emits
// =========================================================================
// Reported 1 Sep 2026: "the XPath value for each of the different data
// options is not apparent for end users." Two faults behind it.
//
//   1. The XPath was documented on vmix.html but NOT on broadcast_setup.html,
//      which is the page a crew copies addresses from. The next thing vMix
//      asks for lived one click away on another page.
//
//   2. That table had gone stale. It listed EIGHT views while api/feed.js
//      served ELEVEN -- kicking, punting and starters had no published XPath
//      anywhere at all, so a crew building those graphics could see the
//      address and never learn what to bind it with.
//
// Fault 2 is the one worth a test. The element name lives in ROW_NAME in
// api/feed.js and is repeated, by hand, in two HTML files. Nothing connected
// them, so it drifted the first time three views were added and would have
// drifted again.
//
// THE SOURCE OF TRUTH IS api/feed.js. This parses ROW_NAME out of it and
// requires both pages to agree -- so a twelfth view fails the suite until
// they are updated, rather than shipping with no XPath.
//
//   node tests/feed_xpath_check.js

const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

let pass = 0, fail = 0;
const chk = (l, ok, d) => { if (ok) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + (d ? '\n         ' + d : '')); } };

// Parse a `const ROW_NAME = { ... }` literal out of a file. Comments inside
// it are stripped first: both copies carry explanatory ones, and a naive
// regex reads `// ... starters` as a mapping.
function rowNames(src, label){
  const m = src.match(/const ROW_NAME\s*=\s*\{([\s\S]*?)\}\s*;/);
  if (!m) return null;
  const body = m[1].replace(/\/\/[^\n]*/g, '');
  const out = {};
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'([^']+)'/g;
  let x; while ((x = re.exec(body))) out[x[1]] = x[2];
  return Object.keys(out).length ? out : null;
}

const feedSrc  = read('api/feed.js');
const setupSrc = read('broadcast_setup.html');
const vmixSrc  = read('vmix.html');

const truth = rowNames(feedSrc, 'api/feed.js');
chk('api/feed.js declares a ROW_NAME map', !!truth);
if (!truth){ console.log('\n0/1 checks pass'); process.exit(1); }

const views = Object.keys(truth);
chk('...covering every view the feed serves', views.length >= 11,
    views.length + ' views: ' + views.join(' '));

// ---- broadcast_setup.html ------------------------------------------
{
  const mirror = rowNames(setupSrc, 'broadcast_setup.html');
  chk('broadcast_setup.html carries a ROW_NAME mirror', !!mirror);
  if (mirror){
    const missing = views.filter(v => !mirror[v]);
    const wrong   = views.filter(v => mirror[v] && mirror[v] !== truth[v]);
    const extra   = Object.keys(mirror).filter(v => !truth[v]);
    chk('...naming every view the feed serves', missing.length === 0,
        'missing: ' + missing.join(', '));
    chk('...with the same element name for each', wrong.length === 0,
        wrong.map(v => v + ': page says ' + mirror[v] + ', feed emits ' + truth[v]).join('; '));
    chk('...and inventing none the feed does not serve', extra.length === 0,
        'extra: ' + extra.join(', '));
  }
  // The value has to REACH the page, not merely be declared in it.
  chk('...and builds the XPath as /feed/<element>',
      /'\/feed\/'\s*\+/.test(setupSrc));
  chk('...labelled and copyable in the row, not buried in prose',
      /stepCell\s*\(/.test(setupSrc) &&
      /'step xpath'/.test(setupSrc) &&
      /copyBtn\(xp/.test(setupSrc));
  chk('...and the emailed crew list carries it too',
      /XPath: '\s*\+\s*xpathFor\(/.test(setupSrc));
}

// ---- vmix.html -------------------------------------------------------
// Prose, not code: assert each view appears with its correct XPath.
{
  const missing = [], wrong = [];
  views.forEach(v => {
    const row = new RegExp('<code>' + v + '</code>[\\s\\S]{0,120}?<code>(/feed/[a-z]+)</code>');
    const m = vmixSrc.match(row);
    if (!m) missing.push(v);
    else if (m[1] !== '/feed/' + truth[v]) wrong.push(v + ': doc says ' + m[1] + ', feed emits /feed/' + truth[v]);
  });
  chk('vmix.html documents an XPath for every view', missing.length === 0,
      'missing: ' + missing.join(', ') + '  (this is exactly how kicking, punting and starters shipped undocumented)');
  chk('...and each one is right', wrong.length === 0, wrong.join('; '));
}

// ---- the shape the XPath actually selects ---------------------------
// The docs are worth nothing if the emitter changed. toXml writes
// `<feed ...>` wrapping `<rowName ... />`, so /feed/<rowName> is only
// correct while that holds.
{
  chk('toXml still wraps rows in <feed>', /'<feed'/.test(feedSrc));
  chk('...and names each row with the ROW_NAME value',
      /'  <'\s*\+\s*rowName/.test(feedSrc));
}

console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
if (fail) console.log('\n' + fail + ' FAILURES');
process.exitCode = fail ? 1 : 0;
