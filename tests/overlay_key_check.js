// The overlay pages must pass the feed key — the caller side of HAZARD 2
// ======================================================================
// Migration 010 scoped the API endpoints by per-tenant key. It did NOT
// scope the three pages that call them, so every overlay returned 401
// while the raw feed addresses worked. The endpoints were tested; their
// callers were not.
//
// **Scoping an endpoint is half the job. Finding its callers is the
// other half**, and nothing in the suite looked for them — which is why
// this file exists rather than a note in TODO.
//
// Asserted from SOURCE TEXT. These pages fetch on load and repoll on a
// timer; standing them up in jsdom to observe a request costs more than
// it proves, and the thing that broke is visible in the source: a fetch
// with no key on it.
//
//   node tests/overlay_key_check.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function run() {
  const fails = [];
  const bad = (area, detail) => fails.push({ area, detail });

  // ---- the three overlays ------------------------------------------
  for (const [file, endpoint] of [
    ['broadcast.html',         'gamedata'],
    ['broadcast_stats.html',   'gamedata'],
    ['broadcast_leaders.html', 'seasondata'],
  ]) {
    const s = read(file);
    if (!/const OVERLAY_KEY = new URLSearchParams\(location\.search\)\.get\('key'\)/.test(s)) {
      bad(file, 'does not read a key from its own URL. An overlay is a browser ' +
                'source with no session — the address it was opened with is the ' +
                'only place a key can come from.');
    }
    // The fetch must actually USE it. Declaring the constant and never
    // sending it is the shape of bug this file exists to catch.
    // THE WINDOW HAS TO LOOK BACKWARDS TOO. A first version of this check
    // read only the 220 characters AFTER the fetch call and reported three
    // failures against correct code — the query string is assembled on the
    // lines ABOVE the fetch, which is the ordinary way to write it.
    // A check that only passes when the code is written the way the check
    // imagined is worse than no check.
    const idxs = [];
    const needle = "fetch('/api/" + endpoint + "'";
    for (let i = s.indexOf(needle); i !== -1; i = s.indexOf(needle, i + 1)) idxs.push(i);
    if (!idxs.length) bad(file, 'no fetch of /api/' + endpoint + ' found — has it moved?');
    idxs.forEach(i => {
      const window = s.slice(Math.max(0, i - 500), i + 220);
      if (!/OVERLAY_KEY/.test(window)) {
        bad(file, 'fetches /api/' + endpoint + ' WITHOUT the key. That request returns 401 ' +
                  'since migration 010 and the overlay stays blank.');
      }
    });
  }

  // ---- and the page that hands the addresses out --------------------
  const setup = read('broadcast_setup.html');
  if (!/const overlayUrl = /.test(setup)) {
    bad('broadcast_setup.html', 'has no overlayUrl() builder — the overlay addresses ' +
        'it copies out will be keyless even when the feed addresses are not.');
  }
  const bare = setup.match(/ORIGIN \+ '\/broadcast[a-z_]*\.html/g) || [];
  if (bare.length) {
    bad('broadcast_setup.html', bare.length + ' overlay address(es) still built from a bare ' +
        'ORIGIN, so they carry no key: ' + bare.slice(0, 3).join(', '));
  }
  if (!/key=' \+ encodeURIComponent\(feedKey\)/.test(setup)) {
    bad('broadcast_setup.html', 'overlayUrl does not append the key');
  }
  // A URL CANNOT BE CONCATENATED ONTO AFTER THE KEY IS ADDED. The emailed
  // instructions built leader addresses as overlayUrl('...?view=') + v,
  // which put the key in the middle: "?view=&key=abc...rushing". Six dead
  // addresses, and only in the email — the on-screen list was fine, which
  // is exactly how it would have gone unnoticed.
  const tacked = setup.match(/overlayUrl\([^)]*\)\s*\+\s*[A-Za-z_]/g) || [];
  if (tacked.length) {
    bad('broadcast_setup.html', tacked.length + ' address(es) append to overlayUrl() AFTER ' +
        'the key: ' + tacked.join(', ') + '. Build the whole path first, then wrap it.');
  }

  return fails;
}

if (require.main === module) {
  const f = run();
  console.log('=== Overlay pages carry the feed key ===\n');
  console.log('Failures: ' + f.length);
  f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
  if (!f.length) console.log('  every overlay sends a key, and the setup page hands out addresses that carry one.');
  process.exitCode = f.length ? 1 : 0;
}

module.exports = { run };
