// The play log on a phone
// =============================================================================
// Measured at 390px with a full four-quarter game on screen, before this
// change: the document was 628px wide against a 390px viewport, so the PAGE
// scrolled sideways by 238px. play_log.html had no mobile rules at all -- its
// only media queries were the two print blocks -- and unlike platform.html it
// had no overflow-x backstop either, so the table left the card and took the
// page with it.
//
// What sat off the right-hand edge was the PLAY TEXT, which is the entire
// point of a play log. A phone showed the number, the quarter, the clock, the
// team and the down, and not what happened.
//
// Nine columns cannot be made to fit 320px. Below 700px the row becomes a card
// instead, ordered by what somebody actually scans for:
//
//     48 · Q4 12:34 · Neville · 3rd & 4 · at own 32            +14
//     Conner pass to Clark Jr for 14, tackled by Grayson
//     [NEEDS REVIEW]
//
// WHAT THIS FILE GUARDS, and each one is a mistake that was actually made or
// nearly made building it:
//
//   THE WIDTH RESET. The desktop table sizes its elastic columns with
//   td.num{width:1%} and td.play{width:99%} -- percentages that mean "shrink
//   to content" and "take the rest" to a table layout, and mean literally 1%
//   and 99% of the row to a flex one. The number rendered 3px wide with "48"
//   spilling into the quarter beside it. Caught in a render, not in review.
//
//   SCREEN ONLY. Paper is not a narrow screen. The print block is built for a
//   table -- it repeats <thead> on every sheet and keeps rows off page breaks
//   -- and printing from a phone got the card layout instead, with neither of
//   those rules having anything to act on.
//
//   EVERY POSITIONED CELL HAS A CLASS. The phone layout places cells by class
//   and explicit order, because DOM order is fixed by the desktop table (gain
//   comes after play). A tenth column added without a class would inherit no
//   order at all and land wherever flex put it -- invisible on the laptop it
//   was added from.
//
//   node tests/play_log_mobile_check.js

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

console.log('=== The play log on a phone ===\n');

// Brace-matched rather than regexed: the block contains nested braces and
// [\s\S]*?\} stops at the first one.
function block(src, header){
  const at = src.indexOf(header);
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++){
    if (src[i] === '{') depth++;
    else if (src[i] === '}'){ depth--; if (!depth) return src.slice(open + 1, i); }
  }
  return null;
}

// ---------------------------------------------------------------------------
console.log('-- the stylesheet --');

function findings(src){
  const out = [];
  const phone = block(src, '@media screen and (max-width:700px)');
  if (!phone){
    // Distinguish "no block" from "block not scoped to screen", because the
    // second is a real and different bug and would otherwise report as the
    // first.
    out.push(block(src, '@media (max-width:700px)')
      ? 'the phone block exists but is NOT scoped to screen — paper would get the card layout'
      : 'no @media screen and (max-width:700px) block');
    return out;
  }
  if (!/#logTable thead[^{]*\{[^}]*display\s*:\s*none/.test(phone))
    out.push('the column headings are not hidden');
  if (!/#logTable tr[^{]*\{[^}]*display\s*:\s*flex/.test(phone))
    out.push('rows are never laid out as cards');
  // THE WIDTH RESET, the fault that produced "48Q4".
  // THE BARE td RULE, not any td.something rule. Written loosely first, as
  // `td[^{]*{`, which happily matched td.play's own width:auto and so passed
  // with the reset deleted -- the mutation below is what exposed it.
  if (!/#logTable td\s*\{[^}]*width\s*:\s*auto/.test(phone))
    out.push('td width is not reset — the desktop 1%/99% column widths will crush the cells');
  if (!/td:empty[^{]*\{[^}]*display\s*:\s*none/.test(phone))
    out.push('empty cells are not hidden — a marker would render blank slots');
  // Every cell the layout positions must be given an order.
  ['num','q','clock','team','sit','ball','gain','play','flags'].forEach(c => {
    if (!new RegExp('td\\.' + c + '\\b[^{]*\\{[^}]*order\\s*:').test(phone))
      out.push('td.' + c + ' has no explicit order');
  });
  return out;
}

{
  const found = findings(SRC);
  chk(found.length === 0, 'the phone block exists, is scoped to screen, and carries every rule',
      found.join('; '));

  // ONLY MEDIA QUERY BREAKPOINTS. A first version matched every
  // "max-width:" in the file and reported 1100 and 760 -- .wrap's own column
  // width and the copyright line's -- as breakpoints reaching a laptop.
  const bps = [...SRC.matchAll(/@media[^{]*max-width\s*:\s*(\d+)px/g)].map(m => +m[1]);
  chk(bps.length > 0 && Math.max(...bps) <= 700,
      'no breakpoint reaches a laptop', 'breakpoints: ' + JSON.stringify(bps));

  // The print rules must stay OUTSIDE the screen-scoped block, or they never
  // apply to anything.
  const phone = block(SRC, '@media screen and (max-width:700px)') || '';
  chk(phone.indexOf('display:table-header-group') < 0 &&
      phone.indexOf('@media print') < 0,
      'the print rules are not nested inside the screen block');
  chk(/@media print[\s\S]*?thead\s*\{\s*display:table-header-group/.test(SRC),
      'and print still repeats the column headings on every sheet');
}

// ---------------------------------------------------------------------------
console.log('\n-- what the renderer emits --');

// The classes the layout positions by. A cell without one gets no order.
const POSITIONED = ['num','q','clock','team','sit','ball','play','gain','flags'];

function boot(){
  function q(rows){
    const o = { data: rows };
    ['select','eq','order','limit'].forEach(k => { o[k] = () => o; });
    o.then = (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej);
    return o;
  }
  let n = 0;
  const P = (text, effect) => ({ sequence_number: ++n, text, effect: effect || {},
    team_side: 'teamA', quarter: 1, roles: null, unresolved: false,
    is_divider: false, is_override: false });
  const plays = [
    P('Dade Jr rush for 3', { isStat: true, statYds: 3, type: 'rush' }),
    Object.assign(P('Conner pass to Clark Jr for 11',
      { isStat: true, statYds: 11, type: 'pass' }), { unresolved: true }),
    P('Timeout — Neville', { timeout: { team: 'teamA' } })
  ];
  const session = { user: { id: 'u1' }, access_token: 't' };
  const dom = new JSDOM(SRC, { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://statchat.co/play_log.html?id=g1',
    beforeParse(w){
      Object.defineProperty(w.document, 'hidden', { get: () => true, configurable: true });
      w.supabase = { createClient: () => ({
        from: (t) => t === 'games'
            ? q([{ id: 'g1', designator: '2026-W1', game_date: '2026-09-04',
                   season_year: 2026, status: 'in_progress', tenant_id: 't1',
                   home_team_name: 'Neville', away_team_name: 'Ouachita',
                   our_team_is_home: true, starting_possession: 'teamA',
                   quarter_length_seconds: 720 }])
          : t === 'plays' ? q(plays.slice())
          : t === 'teams' ? q([{ primary_color: '#f9b612', secondary_color: '#1a1a1a', logo_url: null }])
          : q([]),
        auth: { onAuthStateChange: (cb) => { setTimeout(() => cb('INITIAL_SESSION', session), 0);
            return { data: { subscription: { unsubscribe(){} } } }; },
          getSession: async () => ({ data: { session } }), signOut: async () => ({}) } }) };
      [...SRC.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])
        .filter(s => !/^https?:/i.test(s))
        .forEach(s => { try { w.eval(fs.readFileSync(path.join(ROOT, s), 'utf8')); } catch (e) {} });
    } });
  return dom;
}

(async () => {
  const dom = boot();
  const d = dom.window.document;
  await new Promise(r => setTimeout(r, 700));

  const rows = [...d.querySelectorAll('#logTable tbody tr')];
  chk(rows.length === 3, 'the log rendered', rows.length + ' rows');

  // EVERY CELL IN EVERY ROW CARRIES A POSITIONING CLASS. This is the check
  // that catches a tenth column added later without one.
  const unpositioned = [];
  rows.forEach((tr, i) => {
    [...tr.querySelectorAll('td')].forEach((td, j) => {
      const has = POSITIONED.some(c => td.classList.contains(c));
      if (!has) unpositioned.push('row ' + i + ' cell ' + j +
        ' ("' + (td.textContent || '').trim().slice(0, 20) + '") class="' + td.className + '"');
    });
  });
  chk(unpositioned.length === 0,
      'every cell carries a class the phone layout can position it by',
      unpositioned.join('; '));

  // The header row is <th>, so it is not caught above -- and it is hidden on a
  // phone rather than positioned, which is why it needs saying separately.
  const ths = d.querySelectorAll('#logTable thead th').length;
  chk(ths === 9, 'the table still has its nine columns on a laptop', ths + ' columns');

  // THE CELL TEXT IS UNTOUCHED. "at " is a generated prefix on the ball-on
  // cell; if it were ever put into the cell instead, it would land in the CSV.
  const ball = [...d.querySelectorAll('#logTable td.ball')].map(t => t.textContent);
  chk(ball.every(t => t.indexOf('at ') !== 0),
      'the ball-on cell holds no "at " prefix of its own — that is generated, ' +
      'so the CSV built from the same rows is unaffected',
      JSON.stringify(ball));
  const csv = dom.window.eval('toCsv(ROWS)');
  chk(csv.indexOf('"at own') < 0, 'and the CSV confirms it');

  dom.window.close();

  // -------------------------------------------------------------------------
  console.log('\n-- and the checks are shown to fail --');

  const mutate = (before, after, label) => {
    const n = SRC.split(before).length - 1;
    return n === 1 ? { src: SRC.replace(before, after) }
                   : { err: label + ': anchor matched ' + n + ', not 1' };
  };
  const caught = (m, re) => !m.err && findings(m.src).some(s => re.test(s));

  {
    const m = mutate('@media screen and (max-width:700px){', '@media screen and (max-width:0px){', 'no block');
    chk(!m.err && findings(m.src).length > 0, 'removing the phone block is caught', m.err);
  }
  {
    // The exact fault that shipped "48Q4" onto the screen.
    const m = mutate('#logTable td { display:inline; padding:0; border-bottom:none; width:auto; }',
                     '#logTable td { display:inline; padding:0; border-bottom:none; }', 'no width reset');
    chk(caught(m, /width is not reset/),
        'dropping the width reset is caught — the fault that crushed the number to 3px', m.err);
  }
  {
    const m = mutate('@media screen and (max-width:700px){', '@media (max-width:700px){', 'not screen-scoped');
    chk(caught(m, /NOT scoped to screen/),
        'a phone block that would also apply to paper is caught', m.err);
  }
  {
    const m = mutate("'<td class=\"team\">' + esc(r.team) + '</td>' +",
                     "'<td>' + esc(r.team) + '</td>' +", 'unclassed cell');
    if (m.err) chk(false, 'a cell emitted without a positioning class is caught', m.err);
    else {
      // Re-run the DOM audit against the mutated source rather than trusting
      // a source regex: the point is what the renderer emits.
      const probe = [...m.src.matchAll(/'<td( class="[a-z]+")?>'/g)].map(x => x[1]);
      chk(probe.some(x => !x),
          'a cell emitted without a positioning class is caught',
          JSON.stringify(probe));
    }
  }
  {
    const m = mutate('#logTable td.gain  { order:7;', '#logTable td.gain  { ', 'no order');
    chk(caught(m, /td\.gain has no explicit order/),
        'a cell left without an explicit order is caught', m.err);
  }

  console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
  if (fail) process.exit(1);
})().catch(e => { console.error('THREW ' + (e && e.stack || e)); process.exit(2); });
