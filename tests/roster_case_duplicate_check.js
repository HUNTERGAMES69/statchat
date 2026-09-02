// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// Case-only duplicate names, caught at roster entry
// =================================================
// TWO SPELLINGS OF ONE PLAYER SPLIT EVERY STAT HE HAS. The engine keys its
// buckets by DISPLAY NAME, deliberately -- engine.js:1195 explains why, and
// the alternative was worse: keying on jersey number merged two players who
// shared a number and credited Powell's carries to Reddick. Name-keying is
// correct. It just makes the spelling load-bearing.
//
// season_report.html and broadcast_leaders.html already merge case variants
// when they DISPLAY a season. That is a net over data that is already wrong,
// and it does nothing for a stat package, a CSV export, or anything written
// against the raw rows later. This catches it at the one moment a person can
// still say which spelling was meant.
//
// SCOPE, AND WHY IT IS THIS SMALL. Checked before writing it:
//   * The UPLOAD path already lowercased before comparing, so re-uploading a
//     roster in different caps skipped rather than duplicated. Only the two
//     MANUAL paths, add and edit, had no check.
//   * OPPONENT rosters are per-game only. season_report.html:550 and
//     broadcast_leaders.html:338 both aggregate box.teamA, and teamA is
//     always the tenant's own team -- so an opponent's spelling can never
//     reach a season total, and needs no equivalent guard.
//
// Drives roster.html's real handlers through jsdom against a stubbed
// Supabase, so what is asserted is the shipped code rather than a model of it.
//
//   node tests/roster_case_duplicate_check.js

const fs = require('fs');
const { JSDOM } = require('jsdom');
const SRC = fs.readFileSync(require('path').join(__dirname, '..', 'roster.html'), 'utf8');

let pass = 0, fail = 0;
const chk = (l, ok, d) => { if (ok) { pass++; console.log('ok   ' + l); }
  else { fail++; console.log('FAIL ' + l + (d ? '\n       ' + d : '')); } };

let ROSTER, inserted, updated, failLookup = false;
function reset(){
  ROSTER = [
    { id: 'p1', name: 'LaBroderick Wilson', primary_position: 'RB', default_jersey_number: '21' },
    { id: 'p2', name: 'Van Dyke',           primary_position: 'WR', default_jersey_number: '11' },
  ];
  inserted = []; updated = []; failLookup = false;
}

function makeDom(){
  return new JSDOM(SRC, { runScripts: 'dangerously', url: 'https://statchat.co/roster.html',
    beforeParse(w){
      const sel = () => ({
        eq(){ return this; },
        order(){ return Promise.resolve({ data: ROSTER, error: null }); },
        then(res){ return Promise.resolve({ data: failLookup ? null : ROSTER,
                                            error: failLookup ? { message: 'network' } : null }).then(res); },
      });
      w.supabase = { createClient: () => ({
        auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
          onAuthStateChange: (cb) => { setTimeout(() => cb('SIGNED_IN', { user: { id: 'u1' } }), 0);
            return { data: { subscription: { unsubscribe(){} } } }; } },
        from: (t) => ({
          select: () => sel(),
          insert: (row) => { inserted.push(row); return Promise.resolve({ error: null }); },
          update: (row) => ({ eq: (_c, id) => { updated.push({ id, row }); return Promise.resolve({ error: null }); } }),
          delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }),
        rpc: async () => ({ data: null, error: null }),
      }) };
      w.alert = () => {}; w.confirm = () => true;
    } });
}

(async () => {
  reset();
  const dom = makeDom(); const w = dom.window, d = w.document;
  await new Promise(r => setTimeout(r, 300));

  // ---- the helper itself, which is where the rule lives --------------
  chk('the twin lookup exists on the page', typeof w.findCaseOnlyTwin === 'function');
  if (typeof w.findCaseOnlyTwin !== 'function'){
    console.log('\nhelper not exposed -- refusing to report the rest as passing');
    process.exit(1);
  }

  const twin = async (n, except) => await w.findCaseOnlyTwin(n, except || null);

  chk('a case-only difference is caught',
      ((await twin('Labroderick Wilson')) || {}).name === 'LaBroderick Wilson');
  chk('...in the other direction too',
      ((await twin('LABRODERICK WILSON')) || {}).name === 'LaBroderick Wilson');
  chk('a double space is caught — invisible on screen, same split in the data',
      ((await twin('Van  Dyke')) || {}).name === 'Van Dyke');
  chk('leading and trailing space is caught',
      ((await twin('  van dyke  ')) || {}).name === 'Van Dyke');

  // THE DIRECTION THAT MATTERS MOST. Warning about a name that is NOT a
  // duplicate trains people to click through the warning, which destroys
  // the value of every real one.
  chk('an EXACT match is not reported — that is a different question',
      (await twin('LaBroderick Wilson')) === null);
  chk('a genuinely different player is not reported',
      (await twin('Marcus Wilson')) === null);
  chk('a different first name is not reported',
      (await twin('Labroderick Wilkins')) === null);
  chk('an empty name is not reported', (await twin('')) === null);

  // Editing a row must not flag the row against itself.
  chk('renaming a player does not report him as his own twin',
      (await twin('labroderick wilson', 'p1')) === null);
  chk('...but still catches a clash with a DIFFERENT row',
      ((await twin('van dyke', 'p1')) || {}).name === 'Van Dyke');

  // A FAILED LOOKUP MUST NOT BLOCK A SAVE. This runs on a sideline.
  failLookup = true;
  chk('a failed lookup returns null rather than throwing — the save proceeds',
      (await twin('Labroderick Wilson')) === null);
  failLookup = false;

  // ---- the add path actually uses it --------------------------------
  d.getElementById('newName').value = 'labroderick wilson';
  d.getElementById('newNumber').value = '21';
  d.getElementById('addPlayerBtn').click();
  await new Promise(r => setTimeout(r, 250));
  chk('adding a case-variant does NOT insert straight away',
      inserted.length === 0, JSON.stringify(inserted));
  const warn = d.getElementById('twinWarn');
  chk('...it warns instead, naming the spelling already on the roster',
      !!warn && /LaBroderick Wilson/.test(warn.textContent), warn ? warn.textContent.slice(0,90) : 'no warning');
  chk('...and offers all three ways out',
      !!d.getElementById('twinUseExisting') && !!d.getElementById('twinAnyway') && !!d.getElementById('twinCancel'));

  d.getElementById('twinUseExisting').click();
  await new Promise(r => setTimeout(r, 200));
  chk('choosing the existing spelling saves THAT spelling, not what was typed',
      inserted.length === 1 && inserted[0].name === 'LaBroderick Wilson',
      JSON.stringify(inserted));

  // Cancel must save nothing at all.
  inserted = [];
  d.getElementById('newName').value = 'VAN DYKE';
  d.getElementById('addPlayerBtn').click();
  await new Promise(r => setTimeout(r, 250));
  if (d.getElementById('twinCancel')) d.getElementById('twinCancel').click();
  await new Promise(r => setTimeout(r, 200));
  chk('cancelling saves nothing', inserted.length === 0, JSON.stringify(inserted));

  // And "they are different players" has to actually work, or the check
  // is a block wearing a warning's clothes.
  inserted = [];
  d.getElementById('newName').value = 'van dyke';
  d.getElementById('addPlayerBtn').click();
  await new Promise(r => setTimeout(r, 250));
  if (d.getElementById('twinAnyway')) d.getElementById('twinAnyway').click();
  await new Promise(r => setTimeout(r, 200));
  chk('overriding keeps exactly what was typed',
      inserted.length === 1 && inserted[0].name === 'van dyke', JSON.stringify(inserted));

  // A name with no twin saves with no prompt at all.
  inserted = [];
  d.getElementById('newName').value = 'Marcus Reddick';
  d.getElementById('addPlayerBtn').click();
  await new Promise(r => setTimeout(r, 250));
  chk('a name with no twin saves with no prompt',
      inserted.length === 1 && inserted[0].name === 'Marcus Reddick' && !d.getElementById('twinWarn'),
      JSON.stringify(inserted));

  console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
  process.exitCode = fail ? 1 : 0;
})();
