// Both roster uploads explain the file, and explain it the same way
// =================================================================
// Until 25 Aug 2026 only create_game.html described the spreadsheet
// format — and that is the OPPONENT roster. A coach uploading their own
// squad, which is the first thing anybody does, got a file dialog and no
// guidance. roster.html now shows the same card, lifted from the same
// source rather than rewritten, so the two cannot drift into saying
// different things about one file format.
//
// AND BOTH SHOW A PICTURE OF THE FILE. The word-table describing three
// columns was already there and people still got the shape wrong:
// "column A" means nothing until you have seen it in a spreadsheet, with
// the letters and row numbers a spreadsheet actually shows.
//
//   node tests/roster_format_help_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const live = f => read(f).replace(/<!--[\s\S]*?-->/g, '');

const PAGES = [
  { file: 'create_game.html', card: 'oppFormatCard',
    go: 'oppFormatContinue', no: 'oppFormatCancel', input: 'opponentFile' },
  { file: 'roster.html', card: 'rosterFormatCard',
    go: 'rosterFormatContinue', no: 'rosterFormatCancel', input: 'rosterFile' },
];

function run() {
  const fails = [];
  const bad = (f, why) => fails.push({ f, why });
  const grids = [];

  for (const p of PAGES) {
    const s = live(p.file);
    const d = new JSDOM(read(p.file)).window.document;

    if (!d.getElementById(p.card)) { bad(p.file, 'no format card'); continue; }

    // THE CARD COMES FIRST, THEN THE PICKER. roster.html used to open the
    // file dialog straight from the button, which is how it ended up with
    // no guidance at all.
    if (!new RegExp("getElementById\\('" + p.card + "'\\)\\.style\\.display = 'block'").test(s)) {
      bad(p.file, 'the upload button does not open the format card first');
    }
    if (!new RegExp("getElementById\\('" + p.input + "'\\)\\.click\\(\\)").test(s)) {
      bad(p.file, 'nothing opens the file picker');
    }
    ['go', 'no'].forEach(k => {
      if (!d.getElementById(p[k])) bad(p.file, 'missing control: ' + p[k]);
    });

    // The spreadsheet picture.
    const mock = d.querySelector('.sheetMock table');
    if (!mock) { bad(p.file, 'no spreadsheet example'); continue; }
    const rows = [...mock.rows].map(r => [...r.cells].map(c => c.textContent.trim()));
    if (rows[0].join('') !== 'ABC') {
      bad(p.file, 'the example does not show column letters A, B, C — that is the whole ' +
                  'reason it is a picture rather than a table (' + rows[0].join(',') + ')');
    }
    if (!rows.slice(1).every((r, i) => r[0] === String(i + 1))) {
      bad(p.file, 'the example does not show row numbers');
    }
    // A player with no position, because "position is optional" is the
    // part people disbelieve.
    if (!rows.some(r => r.length === 4 && r[3] === '' && r[1] !== '')) {
      bad(p.file, 'the example never shows a player with a blank position, which is the ' +
                  'part of the rule people do not believe');
    }
    // Asked of the DOM, not of a window of raw text. A first version
    // sliced 300 characters either side of the string "sheetMock" and
    // missed an attribute that was plainly there.
    const mockEl = d.querySelector('.sheetMock');
    const label = mockEl && mockEl.getAttribute('aria-label');
    if (!label || label.length < 40) {
      bad(p.file, 'the example has no useful aria-label — it is a picture, so it needs ' +
                  'describing (' + (label ? label.length + ' chars' : 'absent') + ')');
    }
    // The rule must be in force, not sitting in a comment.
    if (!/\.sheetMock table/.test(s)) {
      bad(p.file, 'the .sheetMock CSS is not live (commented out?)');
    }
    grids.push({ file: p.file, rows: JSON.stringify(rows) });
  }

  // ONE FORMAT, ONE EXAMPLE. Two pages describing the same file with
  // different sample data is how the two versions start disagreeing.
  if (grids.length === 2 && grids[0].rows !== grids[1].rows) {
    bad('both', 'the two pages show DIFFERENT example spreadsheets — same file format, ' +
                'so the same example');
  }
  return fails;
}

if (require.main === module) {
  const f = run();
  console.log('=== Roster upload guidance ===\n');
  console.log('Failures: ' + f.length);
  f.forEach(x => console.log('  [' + x.f + '] ' + x.why));
  if (!f.length) console.log('  both uploads explain the format, with the same picture of the same file.');
  process.exitCode = f.length ? 1 : 0;
}

module.exports = { run };
