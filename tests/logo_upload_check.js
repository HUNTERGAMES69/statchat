// Logo uploads are refused when the file is CHOSEN, not when it is saved
// ======================================================================
// Migration 011 put a MIME allowlist and a 2MB cap on the team-logos
// bucket, so a PDF is refused by the server. It worked — the PDF never
// reached storage. The problem was everything around it:
//
//   * `accept="image/*"` on the input is a picker FILTER, not a control.
//     Switching the dialog to "All files" walks straight past it, and
//     nothing behind it checked anything.
//   * The refusal surfaced at SAVE time, one filled-in form later.
//   * create_game.html then OVERWROTE that error with 'Game created.' in
//     green and redirected 800ms later. The failure was displayed for a
//     fraction of a second and then contradicted.
//
// So the user's report was "I was able to upload a PDF". They were not.
// They were told they had.
//
// **A message that is immediately overwritten is not a message**, and a
// server-side control with no client-side echo produces a correction
// minutes after the mistake, about a choice the user no longer remembers
// making.
//
//   node tests/logo_upload_check.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
// Comments stripped: three checks earlier the same day matched their own
// explanatory prose and reported correct files as broken.
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

function run() {
  const fails = [];
  const bad = (a, d) => fails.push({ area: a, detail: d });

  for (const file of ['create_game.html', 'customize.html']) {
    const s = read(file);

    const types = (s.match(/const LOGO_TYPES\s*=\s*\[([^\]]*)\]/) || [])[1] || '';
    if (!types) bad(file, 'no LOGO_TYPES allowlist');
    else ['image/png','image/jpeg','image/webp','image/svg+xml'].forEach(t => {
      if (!types.includes(t)) bad(file, 'LOGO_TYPES is missing ' + t +
        ' — it must match the bucket allowlist in sql/011_storage_scoping.sql, ' +
        'or the browser refuses a file the server would have taken');
    });

    const cap = (s.match(/const LOGO_MAX_BYTES\s*=\s*([^;]+);/) || [])[1] || '';
    if (!/2 \* 1024 \* 1024/.test(cap)) {
      bad(file, 'LOGO_MAX_BYTES is ' + (cap.trim() || 'absent') + ', not 2MB — it must ' +
                'match file_size_limit on the bucket');
    }

    if (!/LOGO_TYPES\.includes\(/.test(s)) bad(file, 'the type allowlist is never applied');
    if (!/\.size > LOGO_MAX_BYTES/.test(s)) bad(file, 'the size cap is never applied');

    // The check must run at SELECTION, which means before the upload call.
    const pick = s.indexOf('LOGO_TYPES.includes(');
    const up = s.indexOf("from('team-logos').upload");
    if (pick === -1 || up === -1 || pick > up) {
      bad(file, 'the type check does not run before the upload — the refusal would ' +
                'arrive at save time, which is what made a rejected PDF look accepted');
    }

    // showMsg's SIGNATURE DIFFERS BETWEEN THESE TWO FILES: create_game
    // takes (elementId, text, type) and customize takes (text, type).
    // Calling one with the other's arity renders the element id as the
    // message, and node --check cannot see it.
    const arity = /function showMsg\(\s*(\w+)\s*,\s*(\w+)\s*(,\s*\w+)?\s*\)/.exec(s);
    if (arity) {
      const takesId = !!arity[3];
      const calls = s.match(/showMsg\(\s*'[^']*'/g) || [];
      calls.forEach(c => {
        // AN ID IS AN ID, whatever it is called. A first version of this
        // only recognised names ending in "Msg" and flagged five correct
        // calls passing 'opponentRosterStatus'. The reliable test is
        // whether the string is a bare identifier with no spaces — a
        // message always has spaces.
        const first = (/showMsg\(\s*'([^']*)'/.exec(c) || [])[1] || '';
        const looksLikeId = /^[A-Za-z][A-Za-z0-9_]*$/.test(first) && first.length < 40;
        if (takesId && !looksLikeId) {
          bad(file, "showMsg takes an element id first, but a call passes a message: " + c);
        }
        if (!takesId && looksLikeId) {
          bad(file, "showMsg takes (text, type), but a call passes an element id: " + c +
                    " — the id would be rendered as the message text");
        }
      });
    }
  }

  // create_game must not announce success over a logo failure.
  const cg = read('create_game.html');
  if (!/logoFailed/.test(cg)) {
    bad('create_game.html', 'no logoFailed flag — a refused logo is announced as ' +
        "'Game created.' and the real message is overwritten");
  }
  if (!/logoFailed \? 6000 : 800/.test(cg)) {
    bad('create_game.html', 'the redirect is not held back when a logo failed. 800ms is ' +
        'enough to register a green tick and nowhere near enough to read a failure.');
  }

  return fails;
}

if (require.main === module) {
  const f = run();
  console.log('=== Logo upload validation ===\n');
  console.log('Failures: ' + f.length);
  f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
  if (!f.length) console.log('  a bad file is refused when it is chosen, and a failure is never announced as success.');
  process.exitCode = f.length ? 1 : 0;
}

module.exports = { run };
