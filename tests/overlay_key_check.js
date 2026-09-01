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
      // THE WINDOW IS THE ENCLOSING FUNCTION, not a fixed number of
      // characters. It was `i - 500`, and on 31 Aug 2026 that reported
      // broadcast_leaders.html as fetching without a key when it plainly
      // does: the query string is still assembled at the top of the
      // function, but a branch for the game-scoped boards was added
      // between the two, and the distance grew to 1,285 characters.
      //
      // The key was on the wire the whole time -- proved by driving the
      // page against a real server and reading the request URL. Only the
      // check was wrong, which is the failure this file's own note above
      // warns about: a check that only passes when the code is written the
      // way the check imagined is worse than no check.
      //
      // A function boundary is the honest limit. `sq` cannot be built in
      // one function and used in another, so anything outside it could not
      // have contributed to this fetch anyway.
      const before = s.slice(0, i);
      const fnStart = Math.max(
        before.lastIndexOf('\n  function '),
        before.lastIndexOf('\n  async function '),
        before.lastIndexOf('\n    function '),
        before.lastIndexOf('\n    async function '));
      const window = s.slice(fnStart === -1 ? Math.max(0, i - 500) : fnStart, i + 220);
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
