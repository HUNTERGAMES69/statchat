// The play log reads like a feed: live, newest first, plays numbered
// =============================================================================
// Three changes asked for on 4 September 2026, all to play_log.html:
//
//   LIVE. The page had no refresh at all -- it loaded once and then went
//   quietly stale, which is the wrong behaviour for a page a booth leaves up
//   during a game. It now polls on the same four-second cadence as
//   scoresummary.html, for the same reason and with the same document.hidden
//   guard. Rebuilding every row costs single-digit milliseconds even over a
//   300-play game (measured), so there is no incremental-fetch cleverness
//   here and no ordering bugs to go with it.
//
//   NEWEST FIRST, ON SCREEN ONLY. A feed is read from the top. A CSV and a
//   printed sheet are both read from the start, so those stay oldest-first --
//   Andy's call. That is why the reversal lives in renderTable() and not in
//   buildRows(): buildRows stays the one chronological source the table and
//   the export are both built from, so they cannot disagree about a play.
//
//   THE NUMBER COUNTS PLAYS, NOT ROWS. A timeout or a change of possession is
//   not a play and does not get one. The remaining numbers run consecutively
//   with no gaps, so "#47" means the 47th play of the game the way it does on
//   a stat sheet -- rather than leaving a hole in the sequence, which reads as
//   missing data.
//
// WHAT THIS FILE GUARDS BEYOND THOSE THREE. Two things that are easy to get
// right once and lose later, and one that was got wrong on the first pass:
//
//   A poll that finds nothing new must not redraw. Rewriting identical
//   innerHTML every four seconds drops a text selection mid-copy, which is
//   exactly what somebody reading a log is doing.
//
//   A poll that finds a CORRECTION -- same number of plays, changed text --
//   must redraw. Those are the same case to a length check and different
//   cases to a reader.
//
//   The game going final must reach the subtitle. Finalizing does not add a
//   play, so a status check sitting behind "nothing new to draw" never runs
//   on the one transition it exists for. It was written that way first and
//   caught here; the check now happens before that early return.
//
//   node tests/play_log_live_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'play_log.html'), 'utf8');

let pass = 0, fail = 0;
const chk = (ok, m, detail) => {
  if (ok) { pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (detail ? '\n         ' + detail : '')); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));

// A drive with markers threaded through it, because the numbering rule is
// only visible where the two kinds of row alternate.
let seq = 0;
const P = (text, effect) => ({
  sequence_number: ++seq, text, effect: effect || {}, team_side: 'teamA',
  quarter: 1, roles: null, unresolved: false, is_divider: false, is_override: false
});
const START = [
  P('Dade Jr rush for 3',             { isStat: true, statYds: 3,  type: 'rush' }),
  P('Conner pass to Clark Jr for 11', { isStat: true, statYds: 11, type: 'pass' }),
  P('Timeout — Neville',         { timeout: { team: 'teamA' } }),
  P('Roberson rush for 2',            { isStat: true, statYds: 2,  type: 'rush' }),
  P('Clock — 4:00 start of possession (Neville)',
                                      { clockEvent: { type: 'start', team: 'teamA', absSec: 480 } }),
  P('Sorrell pass incomplete',        { isStat: true, statYds: 0,  type: 'pass' })
];

function boot(state){
  function q(rows){
    const o = { data: rows };
    ['select','eq','order','limit','is','not','in'].forEach(k => { o[k] = () => o; });
    o.then = (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej);
    return o;
  }
  const dom = new JSDOM(SRC, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://statchat.co/play_log.html?id=g1',
    beforeParse(w){
      // jsdom reports every document as hidden, which would make the refresh
      // loop return immediately and quietly test nothing at all.
      Object.defineProperty(w.document, 'hidden', { get: () => state.hidden, configurable: true });
      const session = { user: { id: 'u1' }, access_token: 't' };
      w.supabase = { createClient: () => ({
        from: (t) => t === 'games'
            ? q([{ id: 'g1', designator: '2026-W1', game_date: '2026-09-04',
                   season_year: 2026, status: state.status, tenant_id: 't1',
                   home_team_name: 'Neville', away_team_name: 'Ouachita',
                   our_team_is_home: true, starting_possession: 'teamA',
                   quarter_length_seconds: 720 }])
          : t === 'plays' ? (state.fetches++, q(state.plays.slice()))
          : t === 'teams' ? q([{ primary_color: '#123456', secondary_color: '#fff', logo_url: null }])
          : q([]),
        auth: {
          onAuthStateChange: (cb) => { setTimeout(() => cb('INITIAL_SESSION', session), 0);
            return { data: { subscription: { unsubscribe(){} } } }; },
          getSession: async () => ({ data: { session } }),
          signOut: async () => ({})
        } }) };
      // A LOCAL <script src> HAS NO textContent, so a jsdom that only runs
      // inline scripts drops engine.js and the page renders nothing.
      [...SRC.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])
        .filter(s => !/^https?:/i.test(s))
        .forEach(s => { try { w.eval(fs.readFileSync(path.join(ROOT, s), 'utf8')); } catch (e) {} });
    } });
  return dom;
}

const readRows = (d) => [...d.querySelectorAll('#logTable tbody tr')].map(tr => {
  const td = [...tr.querySelectorAll('td')];
  return { n: td[0].textContent.trim(), play: td[6].textContent.trim(),
           marker: tr.className.indexOf('marker') >= 0 };
});

(async () => {
  console.log('=== The play log: live, newest first, plays numbered ===\n');

  const state = { plays: START.slice(), status: 'in_progress', hidden: false, fetches: 0 };
  const dom = boot(state);
  const w = dom.window, d = w.document;
  await wait(700);

  const rows = readRows(d);
  chk(rows.length === 6, 'the log rendered every entry', rows.length + ' rows');

  // ---- newest first, on screen ---------------------------------------------
  chk(rows[0].play === 'Sorrell pass incomplete' &&
      rows[rows.length - 1].play === 'Dade Jr rush for 3',
      'the newest play is at the top and the oldest at the bottom',
      'top: ' + rows[0].play + ' | bottom: ' + rows[rows.length - 1].play);

  // ---- numbering ------------------------------------------------------------
  const marked = rows.filter(r => r.marker);
  chk(marked.length === 2 && marked.every(r => r.n === ''),
      'a timeout and a clock marker carry no number at all',
      JSON.stringify(marked.map(r => r.n)));
  // Read bottom-up, because the screen is reversed and the numbering is not.
  const playNums = rows.filter(r => !r.marker).map(r => Number(r.n)).reverse();
  chk(JSON.stringify(playNums) === '[1,2,3,4]',
      'the plays are numbered consecutively with no gaps where the markers were',
      JSON.stringify(playNums));
  // THE FAULT THIS REPLACES: markers blanked but the sequence left holed, so
  // the plays would read 1, 2, 4, 6. Asserted as a property rather than a
  // list, so it still means something when the fixture grows.
  chk(playNums.every((n, i) => n === i + 1),
      'and each number is one more than the last, not the row’s position');

  // ---- print goes back to chronological ------------------------------------
  w.dispatchEvent(new w.Event('beforeprint'));
  const printed = readRows(d);
  chk(printed[0].play === 'Dade Jr rush for 3',
      'printing re-renders oldest-first, so a printed log is not read backwards',
      'first printed row: ' + printed[0].play);
  chk(printed.filter(r => !r.marker).map(r => Number(r.n)).join() === '1,2,3,4',
      'and the numbers on paper are the same numbers as on screen');
  w.dispatchEvent(new w.Event('afterprint'));
  chk(readRows(d)[0].play === 'Sorrell pass incomplete',
      'and the screen goes back to newest-first afterwards');

  // ---- the CSV is not reversed either --------------------------------------
  const csv = w.eval('toCsv(ROWS)').split('\n');
  chk(/Dade Jr rush for 3/.test(csv[1]),
      'the CSV export stays oldest-first, whatever the screen is showing',
      csv[1] ? csv[1].slice(0, 70) : '(no row)');
  chk(/^"",/.test(csv[3]),
      'and a marker exports with an empty number rather than a borrowed one',
      csv[3] ? csv[3].slice(0, 50) : '(no row)');

  // ---- live ------------------------------------------------------------------
  state.plays = state.plays.concat([P('Young 41 yd TD reception',
    { isStat: true, statYds: 41, type: 'pass', score: { points: 6 } })]);
  await wait(4600);
  const live = readRows(d);
  chk(live.length === 7 && live[0].play === 'Young 41 yd TD reception',
      'a play logged elsewhere appears at the top without a reload',
      'top row: ' + (live[0] || {}).play);
  chk(live[0].n === '5', 'and it takes the next play number', 'n = ' + live[0].n);
  chk(/5 plays/.test(d.getElementById('counts').textContent),
      'and the counts line above the table moves with it',
      d.getElementById('counts').textContent);

  // ---- a quiet poll must not redraw -----------------------------------------
  const node = d.querySelector('#logTable tbody');
  await wait(4600);
  chk(d.querySelector('#logTable tbody') === node,
      'a poll that finds nothing new does not rewrite the table, so a ' +
      'selection being copied survives');

  // ---- a correction must redraw ---------------------------------------------
  state.plays[0] = Object.assign({}, state.plays[0],
    { text: 'Dade Jr rush for 9', effect: { isStat: true, statYds: 9, type: 'rush' } });
  await wait(4600);
  chk(readRows(d).some(r => r.play === 'Dade Jr rush for 9'),
      'a correction that changes a play without adding one still redraws');

  // ---- hidden tabs stop polling ---------------------------------------------
  const before = state.fetches;
  state.hidden = true;
  await wait(9000);
  chk(state.fetches === before,
      'a tab left in the background stops polling entirely',
      (state.fetches - before) + ' fetches while hidden');
  state.hidden = false;

  // ---- the header goes final -------------------------------------------------
  // THE ONE THAT WAS WRONG FIRST TIME. Finalizing adds no play, so a status
  // check behind the "nothing new" return never runs.
  state.status = 'final';
  await wait(4600);
  chk(/Final/.test(d.getElementById('subtitle').textContent),
      'the game going final reaches the subtitle, though it adds no play',
      d.getElementById('subtitle').textContent);

  dom.window.close();
  console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
  if (fail) process.exit(1);
})().catch(e => { console.error('THREW ' + (e && e.stack || e)); process.exit(2); });
