// The platform console on a phone — platform.html
// ==============================================================================
// Until 3 September 2026 this page had NO mobile rules at all. Its only media
// queries were a DESKTOP widening at 1240px, @media print, and one inside the
// Numbers screenshot card -- which is why Numbers was the only part of the
// console that read properly on a phone.
//
// Measured at 390px with 17 schools and 35 accounts on screen:
//
//   tenants table   611px inside a 322px card   47% off to the right
//   users table     862px inside a 322px card   63% off to the right
//   deleted games   389px inside a 322px card
//   the tenant picker escaped the page entirely -- document 451px at a 390px
//   viewport, because a <select> sizes to its longest option and nothing
//   capped it
//
// The overflow-x backstop kept the tables inside their cards, which is not the
// same as being usable: the part off to the right was the ACTIONS column in
// every one of them. You could see which school a row was and not reach the
// menu that does anything to it.
//
// So below 700px each <tr> becomes a card. This file guards the two things
// that make that work and that a later edit would quietly break.
//
//   THE LABELS. A cell's column heading moves into the cell as data-label,
//   because a heading row that has scrolled out of sight is worse than no
//   heading. Add a seventh column to the tenants table without one and it
//   renders on a phone as a bare value under no caption -- invisible on a
//   laptop, which is where it would be added.
//
//   THE ROW CLASSES. hdr on the heading row so it can be hidden, grp on a
//   school heading so it is not drawn as a card, and act on the control
//   cell so the controls get their own line.
//
// WHAT THIS FILE DOES NOT DO: measure. jsdom has no layout, so the widths
// above came from Chromium and cannot be reasserted here. What is asserted
// is the STRUCTURE those widths depend on -- and Part C proves the assertions
// can fail, by breaking the page on purpose and requiring each one to notice.
//
//   node tests/platform_mobile_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const FILE = path.join(__dirname, '..', 'platform.html');
const SRC = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
const chk = (label, ok, detail) => {
  if (ok) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '\n         ' + detail : '')); }
};

console.log('=== The platform console on a phone ===\n');

// The five list containers, named once. Every rule below applies to all of
// them, and a sixth list added without joining this set is the failure this
// naming makes visible.
const BODIES = ['usersBody', 'tenantsBody', 'gamesBody', 'recoveryBody', 'delTenantsBody'];

// ---------------------------------------------------------------------------
// PART A — the stylesheet
// ---------------------------------------------------------------------------
console.log('-- the stylesheet --');

// Pulled by brace matching rather than a regex: the block contains nested
// braces, and [\s\S]*?\} stops at the first one.
function mediaBlock(src, header){
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

function styleFindings(src){
  const out = [];
  const phone = mediaBlock(src, '@media (max-width:700px)');
  if (!phone){ out.push('no @media (max-width:700px) block'); return out; }

  // The backstop must be OFF below the breakpoint. A scroll container clips
  // what overflows it in both axes, and the row menu opens downward out of
  // the cell -- leaving it on would hide the control this layout exists to
  // put back within reach.
  BODIES.forEach(id => {
    if (phone.indexOf('#' + id) < 0) out.push('#' + id + ' is not in the phone block');
  });
  if (!/overflow-x\s*:\s*visible/.test(phone)) out.push('the overflow-x backstop is never released');

  // The heading row, the school heading and the control cell.
  if (!/tr\.hdr[^{]*\{[^}]*display\s*:\s*none/.test(phone)) out.push('tr.hdr is not hidden');
  if (!/tr\.grp/.test(phone)) out.push('tr.grp gets no phone treatment — a school heading would render as a card');
  if (!/td\.act/.test(phone)) out.push('td.act gets no phone treatment — the controls would not get their own line');

  // THE LABEL RULE ITSELF. Without this every data-label in the markup is
  // inert and the values render uncaptioned.
  if (!/td\[data-label\]::before[^}]*content\s*:\s*attr\(data-label\)/.test(phone))
    out.push('td[data-label]::before does not print attr(data-label)');

  // The rows have to stop being rows.
  if (!/display\s*:\s*grid/.test(phone)) out.push('rows are never laid out as cards');

  // THE PICKER, which was the only element that escaped the page rather than
  // its card. A <select> sizes to its longest option; nothing else caps it.
  const picker = /<select id="userTenantPick"[^>]*>/.exec(src);
  if (!picker) out.push('the tenant picker is gone');
  else if (!/max-width\s*:\s*100%/.test(picker[0]))
    out.push('the tenant picker has no max-width — it will size to its longest school name');

  return out;
}

{
  const found = styleFindings(SRC);
  chk('the phone block exists and carries every rule the card layout needs',
      found.length === 0, found.join('; '));

  // A PC MUST NOT BE ABLE TO REACH IT. Verified in Chromium as 35 pixel-
  // identical full-page screenshots across 7 widths and 5 tabs; asserted here
  // as the thing that would make that untrue, which is a breakpoint moving up.
  const bp = [...SRC.matchAll(/@media\s*\(max-width\s*:\s*(\d+)px\)/g)].map(m => +m[1]);
  chk('no max-width breakpoint reaches a laptop',
      bp.length > 0 && Math.max(...bp) <= 700, 'breakpoints: ' + JSON.stringify(bp));

  // The desktop widening is untouched and still the only min-width rule.
  chk('the 1240px desktop widening for the users tab survives',
      /@media\s*\(min-width:\s*1240px\)/.test(SRC) && /body\.wide-users\s+\.wrap/.test(SRC));
}

// ---------------------------------------------------------------------------
// PART B — the markup the renderers actually emit
// ---------------------------------------------------------------------------
console.log('\n-- what the renderers emit --');

// Cells that carry no data-label ON PURPOSE, and why:
//   name   is the card's title, so a "NAME" caption over it says nothing
//   act    is the control strip, which is separated by a rule instead
//   pills  are self-describing markers, and a caption over an empty cell is
//          worse than the cell
const EXEMPT = ['name', 'act', 'pills'];

async function auditDom(src){
  const problems = [];

  const TEN = (o) => Object.assign({
    id:'t1', name:'Riverside', full_name:'Riverside High School',
    subscription:'active', renews_on:'2026-12-01', created_at:'2026-02-01T10:00:00Z',
    disabled_at:null, disabled_reason:null, deleted_at:null, is_demo:false, teams:[]
  }, o);
  const TENANTS = [
    TEN({}),
    TEN({ id:'t2', name:'Northgate', full_name:'Northgate High School', subscription:'trial', renews_on:null }),
    TEN({ id:'t3', name:'Old Gone', full_name:'Old Gone High School', deleted_at:'2026-08-20T10:00:00Z' })
  ];
  const GAME = (o) => Object.assign({
    id:'g1', tenant_id:'t1', designator:'2026-W1', game_date:'2026-09-01',
    season_year:2026, home_team_name:'Riverside', away_team_name:'Northgate',
    status:'in_progress', is_broadcast:true, deleted_at:null, is_sample:false,
    tenants:{ name:'Riverside' }
  }, o);
  const GAMES = [
    GAME({}),
    GAME({ id:'g2', tenant_id:'t2', status:'final', is_broadcast:false }),
    GAME({ id:'g3', tenant_id:'t1', deleted_at:'2026-08-30T10:00:00Z', status:'final' })
  ];
  const USERS = [
    { id:'u1', email:'ad@riverside.k12.la.us', displayName:'Riverside AD', role:'admin',
      tenantId:'t1', tenantName:'Riverside', tenantDeleted:false, disabled:false,
      emailConfirmedAt:'2026-02-02T10:00:00Z', lastSignInAt:'2026-08-20T10:00:00Z',
      mfaVerified:false, mustChangePassword:false },
    // An INVITED account, because it is the widest row the table can produce:
    // four action buttons instead of three.
    { id:'u2', email:'coach@northgate.k12.la.us', displayName:'Northgate Coach',
      role:'game_entry', tenantId:'t2', tenantName:'Northgate', tenantDeleted:false,
      disabled:false, emailConfirmedAt:null, lastSignInAt:null,
      mfaVerified:false, mustChangePassword:true }
  ];

  // A chainable query mock. Every filter is a no-op that returns `this`; the
  // renderers do their own filtering in JS on what comes back, which is what
  // is being exercised.
  function q(rows){
    const o = { data:rows };
    ['select','order','eq','in','is','not','limit','gte'].forEach(k => { o[k] = () => o; });
    o.then = (res, rej) => Promise.resolve({ data:rows, error:null }).then(res, rej);
    return o;
  }

  const dom = new JSDOM(src, { runScripts:'dangerously',
    url:'https://statchat.co/platform.html',
    beforeParse(w){
      w.fetch = async (url, opts) => {
        const body = JSON.parse((opts && opts.body) || '{}');
        if (body.action === 'list')
          return { ok:true, json: async () => ({ users:USERS, mfaKnown:true, signedInUserId:'u1' }) };
        return { ok:true, json: async () => ({ ok:true }) };
      };
      const session = { user:{ id:'u1', email:'andy@statchat.co' }, access_token:'tok' };
      w.supabase = { createClient: () => ({
        from: (t) => t === 'profiles'
          ? q([{ is_super_admin:true, tenant_id:null }])
          : q(t === 'tenants' ? TENANTS : GAMES),
        rpc: async () => ({ data:null, error:null }),
        auth: {
          getSession: async () => ({ data:{ session } }),
          onAuthStateChange: (cb) => { setTimeout(() => cb('INITIAL_SESSION', session), 0);
            return { data:{ subscription:{ unsubscribe(){} } } }; },
          signOut: async () => ({ error:null })
        }
      }) };
      w.alert = () => {}; w.confirm = () => true;
      // A LOCAL <script src> HAS NO textContent, so a jsdom that only runs
      // inline scripts drops billing.js and releases.js silently -- and every
      // tenant row then throws "seasonState is not defined" halfway through
      // rendering, leaving a half-built table that this file would audit as
      // though it were the real one. Inlined by source, the same way
      // tests/platform_console_check.js does it, and general rather than named
      // so the next shared script needs no change here.
      [...SRC.matchAll(/<script src="([^"]+)"><\/script>/g)]
        .map(m => m[1])
        .filter(src => !/^https?:/i.test(src))
        .forEach(src => { w.eval(fs.readFileSync(path.join(__dirname, '..', src), 'utf8')); });
    } });

  const w = dom.window, d = w.document;
  await new Promise(r => setTimeout(r, 500));
  // The users list needs a tenant chosen before it draws anything.
  try {
    const pick = d.getElementById('userTenantPick');
    if (pick && [...pick.options].some(o => o.value === 'grp:all')){
      pick.value = 'grp:all';
      await w.loadUsers('tok');
    }
  } catch (e) { /* reported below as an empty table */ }
  await new Promise(r => setTimeout(r, 250));

  let tablesSeen = 0;
  BODIES.forEach(id => {
    const table = d.querySelector('#' + id + ' table');
    if (!table){ problems.push(id + ': no table rendered — nothing under it was tested'); return; }
    tablesSeen++;
    const rows = [...table.querySelectorAll('tr')];

    // THE HEADING ROW, which has to be findable to be hidden.
    const hdr = rows.filter(r => r.classList.contains('hdr'));
    if (hdr.length !== 1) problems.push(id + ': ' + hdr.length + ' rows carry class="hdr", expected 1');
    if (hdr[0] && hdr[0] !== rows[0]) problems.push(id + ': the hdr row is not first');
    if (hdr[0] && !hdr[0].querySelector('th')) problems.push(id + ': the hdr row holds no <th>');
    const cols = hdr[0] ? hdr[0].querySelectorAll('th').length : 0;

    // A SCHOOL HEADING SPANS THE TABLE. If its colspan ever falls short the
    // desktop table splits a heading across columns -- which is why this is
    // checked against the header's own count rather than a number.
    rows.filter(r => r.classList.contains('grp')).forEach(r => {
      const td = r.querySelector('td');
      if (!td) { problems.push(id + ': a grp row holds no cell'); return; }
      if (+td.getAttribute('colspan') !== cols)
        problems.push(id + ': a grp row spans ' + td.getAttribute('colspan') + ' of ' + cols + ' columns');
    });

    // EVERY DATA CELL IS EITHER CAPTIONED OR DELIBERATELY EXEMPT.
    const dataRows = rows.filter(r => !r.classList.contains('hdr') && !r.classList.contains('grp'));
    if (!dataRows.length) problems.push(id + ': no data rows rendered');
    dataRows.forEach((r, i) => {
      const cells = [...r.querySelectorAll('td')];
      if (cells.length !== cols)
        problems.push(id + ' row ' + i + ': ' + cells.length + ' cells against ' + cols + ' headings');
      cells.forEach((td, j) => {
        const exempt = EXEMPT.some(c => td.classList.contains(c));
        const labeled = td.hasAttribute('data-label') && td.getAttribute('data-label').trim();
        if (!exempt && !labeled)
          problems.push(id + ' row ' + i + ' cell ' + j + ' ("' +
            (td.textContent || '').trim().slice(0, 24) + '") has no data-label and is not name/act/pills');
      });
      // AND THE CONTROLS ARE FINDABLE. Every one of these tables has a
      // control column; without class="act" it does not get its own line and
      // lands back beside a value.
      if (!r.querySelector('td.act'))
        problems.push(id + ' row ' + i + ': no td.act — the controls would not be separated');
    });
  });

  if (tablesSeen < BODIES.length)
    problems.push('only ' + tablesSeen + ' of ' + BODIES.length + ' lists rendered');
  dom.window.close();
  return problems;
}

(async () => {
{
  const found = await auditDom(SRC);
  chk('all five lists render, and every cell in them is captioned or exempt',
      found.length === 0, found.slice(0, 8).join('\n         '));
}

// ---------------------------------------------------------------------------
// PART C — the checks above are shown to fail
// ---------------------------------------------------------------------------
// A structural assertion that has never been seen to fail is indistinguishable
// from one whose selector no longer matches anything. Each mutation below
// breaks the page in the exact way a future edit would, and the check that
// should catch it has to.
console.log('\n-- and the checks are shown to fail --');

function mutate(before, after, label){
  const n = SRC.split(before).length - 1;
  if (n !== 1) return { err: label + ': the mutation anchor matched ' + n + ' times, not 1' };
  return { src: SRC.replace(before, after) };
}

{
  // 1. The phone block goes away entirely.
  const m = mutate('@media (max-width:700px){', '@media (max-width:0px){', 'no phone block');
  chk('removing the phone block is caught',
      !m.err && styleFindings(m.src).length > 0, m.err);
}
{
  // 2. The label rule is there but prints nothing.
  const m = mutate('content:attr(data-label); display:block;', 'content:""; display:block;', 'inert label rule');
  chk('a label rule that prints nothing is caught',
      !m.err && styleFindings(m.src).some(s => /attr\(data-label\)/.test(s)), m.err);
}
{
  // 3. The backstop is left on, which would clip the row menu.
  const m = mutate(`    #usersBody, #tenantsBody, #gamesBody, #recoveryBody, #delTenantsBody {
      overflow-x:visible;
    }`, '', 'backstop left on');
  chk('leaving the scroll backstop on below the breakpoint is caught',
      !m.err && styleFindings(m.src).some(s => /overflow-x|is not in the phone block/.test(s)), m.err);
}
{
  // 4. The picker cap is removed -- the original bug, exactly.
  const m = mutate('min-width:min(190px,100%); max-width:100%;', 'min-width:190px;', 'uncapped picker');
  chk('an uncapped tenant picker is caught — the fault this began with',
      !m.err && styleFindings(m.src).some(s => /max-width/.test(s)), m.err);
}
{
  // 5. A column is added to the tenants table with no caption. This is the
  //    realistic regression: it is invisible on the laptop it is added from.
  const m = mutate(`'<td data-label="Games">' + (live[t.id] || 0) + '</td>' +`,
                   `'<td>' + (live[t.id] || 0) + '</td>' +`, 'uncaptioned cell');
  if (m.err) chk('an uncaptioned cell is caught', false, m.err);
  else {
    const found = await auditDom(m.src);
    chk('an uncaptioned cell is caught',
        found.some(s => /has no data-label/.test(s)), found.slice(0, 3).join('; ') || 'nothing reported');
  }
}
{
  // 6. The heading row loses its class, so nothing hides it and it draws as
  //    a card full of empty captions.
  const m = mutate(`'<table><tr class="hdr"><th>Tenant</th><th>Status</th>`,
                   `'<table><tr><th>Tenant</th><th>Status</th>`, 'hdr class dropped');
  if (m.err) chk('a heading row that lost class="hdr" is caught', false, m.err);
  else {
    const found = await auditDom(m.src);
    chk('a heading row that lost class="hdr" is caught',
        found.some(s => /class="hdr"/.test(s)), found.slice(0, 3).join('; ') || 'nothing reported');
  }
}

console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
if (fail) process.exit(1);
})();
