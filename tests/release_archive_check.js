// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// Archiving a notice must never hide a LIVE one
// =============================================
// Archiving shelves a note in the platform console. It is cosmetic to that
// page: it does not touch releases.js, a dashboard, or who has dismissed
// what.
//
// THE RULE THIS FILE EXISTS FOR: a note that is still published CANNOT be
// archived. Andy's call, 2 Sep 2026. Without it, archiving would leave a
// note on every dashboard it was aimed at while removing it from the only
// page that can see it is there -- the exact failure this project has now
// met three times (is_broadcast, status='in_progress', and the release_state
// schema-cache silence): a feature nobody can tell is on.
//
// The rule lives in two places and both are checked here, because either one
// alone fails quietly. The API refusal is the real enforcement; the UI's
// missing button is what stops a person meeting an error they cannot explain.
//
//   node tests/release_archive_check.js

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Release archive ===\n');

// ---- the migration -------------------------------------------------------
{
  const sql = read('sql/040_release_archive.sql');
  chk(/alter table public\.release_state/i.test(sql), '040: alters release_state');
  chk(/add column if not exists archived_at\s+timestamptz/i.test(sql),
      '040: adds archived_at');
  chk(/add column if not exists archived_by\s+uuid/i.test(sql),
      '040: adds archived_by');
  // The verify has to PRINT something. A migration whose check returns no
  // rows cannot be told apart from a migration that never ran -- which is
  // how 037 and 038 each cost a round.
  const exec = sql.replace(/--[^\n]*/g, '');
  chk(/\bselect\b[\s\S]*\bcommit;/i.test(exec),
      '040: ends with a select that returns a row, so "no rows" means it did not run');
}

// ---- the API is the enforcement -----------------------------------------
{
  const api = read('api/send-release.js');
  chk(/action === 'archive'/.test(api) && /action === 'unarchive'/.test(api),
      'api: handles archive and unarchive');

  // The refusal itself. Pinned on the actual condition, not on the wording.
  const block = /if \(action === 'archive' \|\| action === 'unarchive'\)\s*\{([\s\S]*?)\n  \}/.exec(api);
  chk(!!block, 'api: found the archive block');
  if (block) {
    const body = block[1];
    chk(/action === 'archive'\s*&&\s*row\s*&&\s*row\.published_at/.test(body),
        'api: REFUSES to archive a note whose published_at is set');
    chk(/res\.status\(409\)/.test(body),
        'api: the refusal is a 409, not a silent success');
    chk(/select\('release_id, published_at'\)/.test(body),
        'api: reads published_at before deciding — the check has something to check');
    chk(/archived_at: null/.test(body) && /archived_by: null/.test(body),
        'api: unarchive clears both columns');
  }

  // status must carry archived_at or the console cannot tell what is shelved.
  chk(/\.select\('release_id, published_at, emailed_at, recipient_count, archived_at'\)/.test(api),
      'api: the status action returns archived_at');
}

// ---- the UI keeps a person out of that error ----------------------------
{
  const ui = read('platform.html');
  chk(/id="relShowArchived"/.test(ui), 'platform: has a "Show archived" toggle');
  chk(/id="relArchivedCount"/.test(ui),
      'platform: says how many are archived — the shelf is never a place things vanish into');

  chk(/const arch = !!st\.archived_at;/.test(ui), 'platform: reads archived_at per row');
  chk(/const sendable = live && !sent && !arch;/.test(ui),
      'platform: an archived note is NOT tickable for email');

  // No Archive button on a live row. The API would refuse it anyway; a
  // control that always errors reads as a bug rather than a rule.
  chk(/take down before archiving/.test(ui),
      'platform: a live row says to take it down first instead of offering Archive');
  const rowBtns = /\(arch\s*\n\s*\?\s*'<button type="button" class="relUnarchive"/.test(ui);
  chk(rowBtns, 'platform: an archived row offers Restore');
  chk(/class="relArchive"/.test(ui), 'platform: a draft row offers Archive');

  // The archived hint must not tell you to publish something you shelved.
  chk(/!live && !arch\s*\n\s*\? '<span class="sub" style="font-size:12px;">publish before emailing/.test(ui),
      'platform: an archived row is not told to "publish before emailing"');

  chk(/e\.target\.id === 'relShowArchived'\) loadReleases\(\)/.test(ui),
      'platform: toggling the filter re-renders rather than just hiding rows');
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
