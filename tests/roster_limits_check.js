// Roster import has a hard size cap and a hard row cap
// ====================================================
// The roster spreadsheet NEVER TOUCHES STORAGE — it is parsed in the
// browser and inserted straight into `players` as rows. So migration
// 011's bucket limits (2MB, image MIME types) do not apply to it at all,
// and until 24 Aug 2026 there was no limit of any kind at either end:
//
//   * XLSX.read loads the whole workbook into memory, so a very large
//     file freezes the scorer's own tab before anything can report it;
//   * the parsed rows went into `players` with no ceiling. There is NO
//     per-tenant quota anywhere in this system, so one customer could
//     fill the database.
//
// BOTH CAPS REFUSE RATHER THAN TRUNCATE, and that is the part worth
// testing. Silently importing the first 200 rows LOOKS like it worked;
// the missing players are not discovered until somebody cannot be found
// in a picker on a Friday night. create_game.html already carried a
// comment making exactly that argument about malformed rows — the caps
// follow it.
//
// Asserted from source text: the guards run inside a FileReader onload
// against a real XLSX parse, and standing that up proves less than
// reading the rule.
//
//   node tests/roster_limits_check.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function run() {
  const fails = [];
  const bad = (area, d) => fails.push({ area, detail: d });

  for (const [file, inputId] of [
    ['roster.html', 'rosterFile'],
    ['create_game.html', 'opponentFile'],
  ]) {
    // COMMENTS STRIPPED FIRST. A first version of this check matched
    // `XLSX.read` inside the explanatory comment ABOVE the size guard and
    // reported both files as broken when both were correct. That is the
    // third check today to read its own commentary as code — the others
    // were the CSS audits, which strip comments for exactly this reason.
    const s = read(file).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    const bytes = (s.match(/const MAX_ROSTER_BYTES\s*=\s*([^;]+);/) || [])[1];
    if (!bytes) bad(file, 'no MAX_ROSTER_BYTES constant');
    else if (!/5 \* 1024 \* 1024/.test(bytes)) bad(file, 'size cap is not 5MB: ' + bytes.trim());

    const rows = (s.match(/const MAX_ROSTER_ROWS\s*=\s*(\d+);/) || [])[1];
    if (!rows) bad(file, 'no MAX_ROSTER_ROWS constant');
    else if (Number(rows) !== 200) bad(file, 'row cap is ' + rows + ', not 200');

    if (!/file\.size > MAX_ROSTER_BYTES/.test(s)) {
      bad(file, 'the size cap is never compared against file.size');
    }
    if (!/\.length > MAX_ROSTER_ROWS/.test(s)) {
      bad(file, 'the row cap is never compared against a row count');
    }

    // THE SIZE CHECK MUST PRECEDE THE PARSE. XLSX.read is what consumes
    // the memory, so a check after it has already lost.
    const sizeAt = s.indexOf('file.size > MAX_ROSTER_BYTES');
    const parseAt = s.indexOf('XLSX.read');
    if (sizeAt === -1 || parseAt === -1 || sizeAt > parseAt) {
      bad(file, 'the size check does not run BEFORE XLSX.read — by then the file is ' +
                'already in memory and the tab may be gone');
    }

    // AND THE ROW CHECK MUST PRECEDE THE INSERT-BUILDING LOOP, or rows
    // are collected before anything decides to refuse them.
    const rowAt = s.indexOf('.length > MAX_ROSTER_ROWS');
    const collectAt = Math.min(
      ...[s.indexOf('const parsed = []'), s.indexOf('const entries = []')]
        .filter(i => i !== -1).concat([Infinity]));
    if (rowAt === -1 || rowAt > collectAt) {
      bad(file, 'the row cap runs after rows are collected');
    }

    // REFUSE, NOT TRUNCATE. A slice would be the silent failure.
    if (/\.slice\(0,\s*MAX_ROSTER_ROWS\)/.test(s)) {
      bad(file, 'rows are TRUNCATED to the cap instead of refused. A short import looks ' +
                'like it worked; the missing players surface mid-game.');
    }

    // The file input must be cleared, or choosing the same file again
    // fires no change event and the user thinks the page is frozen.
    const guard = s.slice(sizeAt, sizeAt + 700);
    if (!new RegExp("getElementById\\('" + inputId + "'\\)\\.value = ''").test(guard)) {
      bad(file, 'the file input is not cleared after a refusal — re-choosing the same ' +
                'file fires no change event and looks like nothing happened');
    }
  }

  return fails;
}

if (require.main === module) {
  const f = run();
  console.log('=== Roster import limits ===\n');
  console.log('Failures: ' + f.length);
  f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
  if (!f.length) console.log('  both importers refuse oversized files and oversized rosters, before parsing.');
  process.exitCode = f.length ? 1 : 0;
}

module.exports = { run };
