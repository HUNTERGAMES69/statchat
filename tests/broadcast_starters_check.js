// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// The full starting lineup — the setup section and its rules
// =========================================================
// Three starter overlays need eleven, eleven and four named players, and the
// section that collects them sits beside the six seeded starters on the game
// setup screen. It is broadcast-only: the entry pickers read seed_starters
// and never read this, which is why it has a column of its own.
//
// EVERY RULE HERE CAME FROM ANDY, AND EACH ONE IS ASSERTED:
//   * a number starts ONCE per unit -- shared jersey or not. Two players may
//     wear one number on a roster, never on the field together, so a unit
//     cannot start both. The duplicate is REMOVED, not merely flagged.
//   * a rejected duplicate gets no shared-number picker. Offering "which of
//     the two #7s is this?" against a slot that cannot legally exist invites
//     configuring something the rules forbid.
//   * the same number on offence AND defence is allowed -- a team without
//     the roster to two-platoon plays its best athletes both ways -- but is
//     confirmed once, because a typo and a two-way starter are identical to
//     software.
//   * special teams combines: one boy in FG and PAT is one line, FG/PAT.
//   * eleven slots is not eleven men, so the tally counts PEOPLE.
//   * prefill from the seeded six matches by POSITION and never overwrites.
//   * a saved lineup comes back when the game is edited -- without that,
//     opening a game to change its kickoff time would save an empty lineup
//     over a full one, silently.
//
// Driven through the real page with tests/harness.js, the same way
// needs_assignment_seed_check.js drives the seeded-starter resolver.
//
//   node tests/broadcast_starters_check.js

const { bootPage } = require('./harness');

let pass = 0, fail = 0;
const chk = (l, ok, d) => { if (ok) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + (d ? '\n         ' + d : '')); } };

// Two players share #7 and two share #21 -- the case the resolver exists for.
// TWO FIXTURE DETAILS THAT MATTER, both learned by getting them wrong:
//   * the jersey column is `default_jersey_number`, not `number`
//   * create_game.html scopes the roster query by team_id AND season_year,
//     so a row missing team_id is filtered out and the roster resolves to
//     nothing at all
// Either mistake makes the page report "not on the roster loaded here",
// which is CORRECT behaviour for an empty roster -- so the shared-number
// assertions below would have been testing nothing while looking fine.
// tests/harness.js's team is DEFAULT_BRANDING.id.
const PLAYERS = [
  { default_jersey_number:'7',  name:'Devin Whitfield',    primary_position:'QB', season_year:2026, team_id:'test-team-1' },
  { default_jersey_number:'7',  name:'Darius Whitfield',   primary_position:'LB', season_year:2026, team_id:'test-team-1' },
  { default_jersey_number:'21', name:'LaBroderick Wilson', primary_position:'RB', season_year:2026, team_id:'test-team-1' },
  { default_jersey_number:'21', name:'Lamar Wilson',       primary_position:'CB', season_year:2026, team_id:'test-team-1' },
  { default_jersey_number:'22', name:'Trey Delgado',       primary_position:'RB', season_year:2026, team_id:'test-team-1' },
  { default_jersey_number:'80', name:'Kai Nakamura',       primary_position:'WR', season_year:2026, team_id:'test-team-1' },
  { default_jersey_number:'11', name:'Andre Ellis',        primary_position:'WR', season_year:2026, team_id:'test-team-1' },
  { default_jersey_number:'55', name:'Dominic Reyes',      primary_position:'C',  season_year:2026, team_id:'test-team-1' },
  { default_jersey_number:'91', name:'Zane Okoro',         primary_position:'DE', season_year:2026, team_id:'test-team-1' },
  { default_jersey_number:'3',  name:'Cole Barnett',       primary_position:'K',  season_year:2026, team_id:'test-team-1' },
  { default_jersey_number:'2',  name:'Marcus Reddick',     primary_position:'WR', season_year:2026, team_id:'test-team-1' },
  { default_jersey_number:'4',  name:'Tyrell Okafor',      primary_position:'CB', season_year:2026, team_id:'test-team-1' },
  { default_jersey_number:'5',  name:'Jaylen Brooks',      primary_position:'TE', season_year:2026, team_id:'test-team-1' }
];

const boot = () => bootPage('create_game.html',
  { query:'?nothing=1', players:PLAYERS, branding:{ current_season_year:2026, team_id:'test-team-1' } });

const inp = (w,u,i) => w.document.querySelector('input.bcNum[data-unit="'+u+'"][data-i="'+i+'"]');
const settle = (ms) => new Promise(r => setTimeout(r, ms || 80));

async function typeInto(w, u, i, v){
  const el = inp(w,u,i);
  el.value = v;
  el.dispatchEvent(new w.window.Event('input',  { bubbles:true }));
  await settle();
  el.dispatchEvent(new w.window.Event('change', { bubbles:true }));
  await settle();
  return el;
}

(async () => {
  console.log('=== Broadcast starters ===\n');

  // ---- the section exists and is subordinate -------------------------
  {
    const w = await boot(); await settle(150);
    const d = w.document;
    const wrap = d.getElementById('bcStartersWrap');
    chk('the section is on the page', !!wrap && !!d.getElementById('bcGroups'));
    chk('...and is collapsed by default, not competing with the seeded six',
        !!wrap && !wrap.open);
    chk('...and the seeded starters block is untouched',
        !!d.getElementById('ourStarterQB') && !!d.getElementById('ourStarterResolve'));
    chk('26 slots: 11 offence, 11 defence, 4 special teams',
        d.querySelectorAll('input.bcNum[data-unit="offense"]').length === 11 &&
        d.querySelectorAll('input.bcNum[data-unit="defense"]').length === 11 &&
        d.querySelectorAll('input.bcNum[data-unit="special"]').length === 4);
    // NOT VACUOUS: if the roster does not load, every shared-number check
    // below "passes" against a page correctly reporting an empty roster.
    // Asserted through candidatesForNumber() rather than by reading
    // ourResolved: that variable lives inside the page's own scope and is
    // not on window, so a guard poking at it reports an empty roster even
    // when the roster is fine. Behaviour, not internals.
    chk('the master roster actually resolved',
        (w.window.candidatesForNumber('our','22') || []).length === 1,
        JSON.stringify(w.window.candidatesForNumber('our','22')));
    chk('...and #7 really is a shared number in this fixture',
        (w.window.candidatesForNumber('our','7') || []).length === 2,
        JSON.stringify(w.window.candidatesForNumber('our','7')));
    chk('the questionable slots are selectors, the line and QB are not',
        d.querySelectorAll('select.bcPos').length === 20,
        d.querySelectorAll('select.bcPos').length + ' selectors');
    w.close();
  }

  // ---- a number starts once per unit ---------------------------------
  {
    const w = await boot(); await settle(150);
    await typeInto(w, 'offense', 1, '22');            // RB
    await typeInto(w, 'offense', 2, '22');            // WR -- duplicate
    chk('a duplicate number on offence is REMOVED, not just flagged',
        inp(w,'offense',2).value === '', JSON.stringify(inp(w,'offense',2).value));
    chk('...and says which slot already has it',
        /already the RB on offense/.test(w.document.getElementById('bcRes_offense').innerHTML),
        w.document.getElementById('bcRes_offense').textContent.slice(0,110));
    chk('...while the first slot keeps it',
        inp(w,'offense',1).value === '22');

    // THE ONE ANDY CAUGHT: a SHARED number was still enterable twice,
    // because the resolver offered to pick a different player for each.
    await typeInto(w, 'offense', 3, '7');
    // WHILE IT IS BEING TYPED, before blur removes it. This is the only
    // moment the no-picker-for-a-refused-slot rule is observable: after
    // `change` the duplicate is gone, so there is one #7 either way and a
    // check that looks afterwards can never see the difference. An earlier
    // version of this file looked afterwards and a mutation walked past it.
    const dup = inp(w,'offense',4);
    dup.value = '7';
    dup.dispatchEvent(new w.window.Event('input', { bubbles:true }));
    await settle();
    const midPickers = w.document.querySelectorAll('#bcRes_offense button.bcPick').length;
    chk('a refused duplicate is offered NO shared-number picker',
        midPickers === 2,
        midPickers + ' buttons — 2 is the one legitimate picker; 4 means the ' +
        'rejected slot is being offered a choice it must not have');
    dup.dispatchEvent(new w.window.Event('change', { bubbles:true }));
    await settle();
    chk('...and a SHARED number is still refused on blur, like any other',
        inp(w,'offense',4).value === '', JSON.stringify(inp(w,'offense',4).value));

    await typeInto(w, 'defense', 0, '91');
    await typeInto(w, 'defense', 1, '91');
    chk('the same rule holds on defence', inp(w,'defense',1).value === '');
    w.close();
  }

  // ---- special teams combines ----------------------------------------
  {
    const w = await boot(); await settle(150);
    await typeInto(w, 'special', 0, '3');             // FG
    await typeInto(w, 'special', 1, '3');             // PAT
    chk('special teams KEEPS the same player in two slots',
        inp(w,'special',1).value === '3');
    chk('...and says it will be one line on the card',
        /FG\/PAT/.test(w.document.getElementById('bcRes_special').innerHTML),
        w.document.getElementById('bcRes_special').textContent.slice(0,110));
    chk('...and the tally counts him once',
        /2\/4 slots · 1 player/.test(w.document.getElementById('bcTally_special').textContent),
        w.document.getElementById('bcTally_special').textContent);

    // WHAT ACTUALLY REACHES THE OVERLAY. The tally cannot tell combining
    // apart from skipping -- both give one row -- so the difference only
    // shows in the stored key: FG/PAT combined, versus a bare FG with the
    // PAT slot silently dropped. Saving is what this feature is for, so the
    // saved payload is what gets asserted.
    // EVERY REQUIRED FIELD, or the page refuses to save and this asserts
    // nothing -- which is exactly what the first run did: no game row was
    // inserted and the check read `undefined` as a combining failure.
    const setv = (id, v) => { const el = w.document.getElementById(id); if (el) el.value = v; };
    setv('designator', 'RIV-W3');
    setv('seasonYear', '2026');
    setv('gameDate', '2026-09-04');
    setv('opponentName', 'Northgate');
    setv('quarterLen', '12');
    // The opponent roster is mandatory unless explicitly skipped, and this
    // test is not about the opponent.
    const skip = w.document.getElementById('skipOpponentRosterBtn') ||
                 w.document.querySelector('[id*="kipRoster"], [id*="kipOpponent"]');
    if (skip) { skip.click(); await settle(120); }
    w.document.getElementById('createGameBtn').click();
    await settle(400);
    // The harness records every insert in db.inserted as { table, row } --
    // the documented way to inspect what a page actually wrote.
    const gameRow = (w.db.inserted || []).filter(r => r.table === 'games').pop();
    const saved = gameRow && gameRow.row;
    const st = saved && saved.broadcast_starters && saved.broadcast_starters.special;
    chk('the game actually saved, so the payload below means something',
        !!saved, (w.document.getElementById('setupMsg')||{}).textContent);
    // A unit is an ORDERED ARRAY of { pos, num, name } since 1 Sep 2026.
    // The combined man is ONE row whose pos carries both labels -- not two
    // rows, and not a bare FG with the PAT slot quietly dropped.
    chk('the saved lineup carries the COMBINED position label on one row',
        Array.isArray(st) && st.length === 1 && st[0].pos === 'FG/PAT',
        JSON.stringify(st) + '  (a bare FG means the PAT slot was dropped, not combined)');
    w.close();
  }

  // ---- two-way starters ----------------------------------------------
  {
    const w = await boot(); await settle(150);
    await typeInto(w, 'offense', 1, '22');
    await typeInto(w, 'defense', 5, '22');
    chk('the same number on offence AND defence is allowed',
        inp(w,'defense',5).value === '22');
    chk('...and asks once, rather than assuming',
        !!w.document.querySelector('#bcRes_offense button.bcTwoWay'),
        w.document.getElementById('bcRes_offense').textContent.slice(0,120));
    w.document.querySelector('#bcRes_offense button.bcTwoWay').click();
    await settle();
    chk('...and settles once confirmed',
        !w.document.querySelector('#bcRes_offense button.bcTwoWay') &&
        /two-way starter/.test(w.document.getElementById('bcRes_offense').innerHTML));
    w.close();
  }

  // ---- eleven slots is not eleven men --------------------------------
  {
    const w = await boot(); await settle(150);
    const nums = ['7','22','80','11','21','3','55','91','2','4','5'];
    for (let i = 0; i < 11; i++) await typeInto(w, 'offense', i, nums[i]);
    const t = w.document.getElementById('bcTally_offense').textContent;
    chk('a full unit reads eleven players', /11\/11 slots · 11 players/.test(t), t);
    chk('...and is marked done', /✓/.test(t), t);
    w.close();
  }

  // ---- prefill from the seeded six -----------------------------------
  {
    const w = await boot(); await settle(150);
    const d = w.document;
    [['QB','7'],['RB1','22'],['WR1','80'],['WR2','11']].forEach(([r,v]) => {
      const el = d.getElementById('ourStarter' + r);
      el.value = v; el.dispatchEvent(new w.window.Event('input', { bubbles:true }));
    });
    await settle();
    d.querySelector('button.bcFill').click();
    await settle();
    chk('prefill places the seeded six by position',
        inp(w,'offense',0).value === '7' && inp(w,'offense',1).value === '22',
        'QB=' + inp(w,'offense',0).value + ' RB=' + inp(w,'offense',1).value);
    // NEVER OVERWRITES: someone part-way through has said more than the seeds.
    inp(w,'offense',0).value = '99';
    inp(w,'offense',0).dispatchEvent(new w.window.Event('input', { bubbles:true }));
    await settle();
    d.querySelector('button.bcFill').click();
    await settle();
    chk('...and never overwrites a slot already filled',
        inp(w,'offense',0).value === '99', inp(w,'offense',0).value);
    w.close();
  }

  // ---- the edit path -------------------------------------------------
  // THE DANGEROUS ONE. Without a loader, opening a saved game for any
  // reason -- changing a kickoff time -- redraws this section empty and
  // saves that emptiness over a lineup the coach entered. Silent, and it
  // looks exactly like the data never having been stored.
  {
    const SAVED = {
      offense: { QB:{num:'7',name:'Devin Whitfield'}, RB:{num:'22',name:'Trey Delgado'},
                 // A DUPLICATE IN STORED DATA. It cannot be typed any more,
                 // but a row saved before the rule existed can hold one, and
                 // re-saving it must not put it back.
                 WR:{num:'22',name:'Trey Delgado'} },
      special: { 'FG/PAT':{num:'3',name:'Cole Barnett'} }
    };
    const w = await bootPage('create_game.html', {
      query:'?edit=test-game-1', players:PLAYERS,
      branding:{ current_season_year:2026 },
      game:{ id:'test-game-1', designator:'RIV-W3', season_year:2026,
             game_date:'2026-09-04', opponent_name:'Northgate',
             home_team_name:'Riverside', away_team_name:'Northgate',
             our_team_is_home:true, quarter_length_seconds:720,
             broadcast_starters:SAVED }
    });
    await settle(400);
    chk('editing a game restores its saved lineup',
        inp(w,'offense',0).value === '7' && inp(w,'offense',1).value === '22',
        'QB=' + inp(w,'offense',0).value + ' RB=' + inp(w,'offense',1).value);
    chk('...including a combined special-teams slot',
        inp(w,'special',0).value === '3', inp(w,'special',0).value);
    // COLLAPSED EVEN WITH A LINEUP SAVED. It used to open itself, and that
    // pushed the opponent roster off the screen on the page a coach opened
    // to change a kickoff time. The summary tally says there is something
    // inside without spending 26 rows to say it. Andy, 1 Sep 2026.
    chk('...and the section stays collapsed, letting the tally say it has content',
        !w.document.getElementById('bcStartersWrap').open);
    chk('...with the tally actually showing a count, or nothing says it at all',
        /\d+\s*\/\s*26/.test(w.document.getElementById('bcSummary').textContent),
        JSON.stringify(w.document.getElementById('bcSummary').textContent));
    chk('...and a two-way starter already confirmed is not asked about again',
        !w.document.querySelector('#bcRes_offense button.bcTwoWay'));
    // A stored duplicate must not survive a re-save.
    const before = (w.db.inserted || []).length + (w.db.updated || []).length;
    w.document.getElementById('createGameBtn').click();
    await settle(400);
    // An edit UPDATEs rather than inserts, and the harness records the two
    // differently: inserts as { table, row }, updates as { table, fields }.
    const up  = (w.db.updated  || []).filter(r => r.table === 'games').pop();
    const ins = (w.db.inserted || []).filter(r => r.table === 'games').pop();
    const rec = (up && up.fields) || (ins && ins.row) || null;
    const off = rec && rec.broadcast_starters && rec.broadcast_starters.offense;
    const nums = (off || []).map(r => r.num);
    chk('a duplicate held in stored data is not written back',
        nums.length > 0 && new Set(nums).size === nums.length,
        JSON.stringify(off));
    w.close();
  }

  // ---- REPEATED POSITION LABELS ---------------------------------------
  // THE BUG THIS BLOCK EXISTS FOR, found 1 Sep 2026. A unit used to be an
  // object keyed by position label, and position labels are not unique on a
  // football field: the DEFAULT defensive set is DE, DT, DT, DE, WLB, MLB,
  // SLB, CB, CB, FS, SS. Each repeat overwrote the one before it, so a coach
  // who filled all eleven slots saw eleven on screen and stored EIGHT -- with
  // no warning, and an eight-man defence on the overlay. Offense lost two of
  // its three WRs the same way.
  //
  // COUNT-BASED, DELIBERATELY. An assertion that named the eight surviving
  // keys would have passed against the broken build. The only thing that
  // catches this class of fault is: put eleven in, get eleven out.
  {
    const w = await boot(); await settle(200);
    const d = w.document;
    const set = (id,v) => { const e = d.getElementById(id); if (e) e.value = v; };
    set('designator','DUP-1'); set('seasonYear','2026'); set('gameDate','2026-09-04');
    set('opponentName','Northgate'); set('quarterLen','12');
    d.getElementById('skipOpponentBtn').click(); await settle(120);

    // All eleven defensive slots, every label left on its default.
    for (let i = 0; i < 11; i++) await typeInto(w, 'defense', i, String(60 + i));
    // All three WR slots (2,3,4) left on their default 'WR' label.
    for (const [i,n] of [[2,'11'],[3,'12'],[4,'13']]) await typeInto(w, 'offense', i, n);

    const labels = [0,1,2,3].map(i => {
      const sel = d.querySelector('select.bcPos[data-unit="defense"][data-i="'+i+'"]');
      return sel ? sel.value : ''; });
    chk('the default defensive labels really do repeat, or this proves nothing',
        new Set(labels).size < labels.length, JSON.stringify(labels));

    d.getElementById('createGameBtn').click(); await settle(500);
    const row = (w.db.inserted || []).filter(r => r.table === 'games').pop();
    const bs  = row && row.row.broadcast_starters;
    const def = bs && bs.defense, offn = bs && bs.offense;

    chk('a unit is stored as an ORDERED ARRAY, not keyed by position',
        Array.isArray(def), JSON.stringify(def && Object.keys(def)).slice(0,80));
    chk('eleven defenders entered, eleven defenders saved',
        (def || []).length === 11, ((def||[]).length) + ' saved: ' + JSON.stringify(def));
    chk('...and every jersey number survived, none overwritten',
        new Set((def||[]).map(r => r.num)).size === 11,
        JSON.stringify((def||[]).map(r => r.num)));
    chk('...with both DEs, both DTs and both CBs kept as separate men',
        ['DE','DT','CB'].every(p => (def||[]).filter(r => r.pos === p).length === 2),
        JSON.stringify((def||[]).map(r => r.pos)));
    chk('...in the slot order the card reads down',
        JSON.stringify((def||[]).map(r => r.pos)) ===
        JSON.stringify(['DE','DT','DT','DE','WLB','MLB','SLB','CB','CB','FS','SS']),
        JSON.stringify((def||[]).map(r => r.pos)));
    chk('three receivers entered, three receivers saved',
        (offn||[]).filter(r => r.pos === 'WR').length === 3,
        JSON.stringify(offn));
    w.close();
  }

  // ---- and the round trip, which is where a lossy shape bites twice ----
  // Opening a game to change its kickoff time re-saves the lineup. If load
  // could not place two DEs back into two slots, the second edit would write
  // the loss to disk permanently.
  {
    const saved = { defense: [
      {pos:'DE',num:'91',name:'Zane Okoro'}, {pos:'DT',num:'55'},
      {pos:'DT',num:'77'}, {pos:'DE',num:'44'}, {pos:'WLB',num:'54'},
      {pos:'MLB',num:'52'}, {pos:'SLB',num:'56'}, {pos:'CB',num:'4'},
      {pos:'CB',num:'24'}, {pos:'FS',num:'9'}, {pos:'SS',num:'31'} ] };
    const w = await bootPage('create_game.html', {
      query:'?edit=test-game-1', players:PLAYERS,
      branding:{ current_season_year:2026, team_id:'test-team-1' },
      game: { id:'test-game-1', tenant_id:'t1', designator:'DUP-2', season_year:2026,
              game_date:'2026-09-04', home_team_name:'Us', away_team_name:'Northgate',
              our_team_is_home:true, quarter_length_seconds:720, status:'setup',
              seed_starters:{ teamA:{}, teamB:{} }, broadcast_starters: saved } });
    await settle(500);
    const filled = [...w.document.querySelectorAll('input.bcNum[data-unit="defense"]')]
      .filter(i => i.value.trim()).length;
    chk('all eleven come back into the form when the game is reopened',
        filled === 11, filled + ' slots filled');
    w.document.getElementById('createGameBtn').click(); await settle(500);
    const up = (w.db.updated || []).filter(r => r.table === 'games').pop();
    const back = up && up.fields.broadcast_starters && up.fields.broadcast_starters.defense;
    chk('...and re-saving an untouched lineup loses nobody',
        (back || []).length === 11, JSON.stringify((back||[]).map(r => r.num)));
    chk('...with the same men in the same order',
        JSON.stringify((back||[]).map(r => r.pos + r.num)) ===
        JSON.stringify(saved.defense.map(r => r.pos + r.num)),
        JSON.stringify((back||[]).map(r => r.pos + r.num)));
    w.close();
  }

  // ---- a lineup saved in the OLD object shape still reads -------------
  // Nothing is known to have been saved before the correction, but a reader
  // that cannot open the shape it shipped with is a reader that loses data
  // it was handed.
  {
    const w = await bootPage('create_game.html', {
      query:'?edit=test-game-2', players:PLAYERS,
      branding:{ current_season_year:2026, team_id:'test-team-1' },
      game: { id:'test-game-2', tenant_id:'t1', designator:'LEG-1', season_year:2026,
              game_date:'2026-09-04', home_team_name:'Us', away_team_name:'Northgate',
              our_team_is_home:true, quarter_length_seconds:720, status:'setup',
              seed_starters:{ teamA:{}, teamB:{} },
              broadcast_starters: { offense:{ QB:{num:'7',name:'Devin Whitfield'},
                                              RB:{num:'22'} } } } });
    await settle(500);
    chk('a legacy position-keyed lineup still loads into the form',
        inp(w,'offense',0).value === '7' && inp(w,'offense',1).value === '22',
        'QB=' + inp(w,'offense',0).value + ' RB=' + inp(w,'offense',1).value);
    w.document.getElementById('createGameBtn').click(); await settle(500);
    const up = (w.db.updated || []).filter(r => r.table === 'games').pop();
    const off = up && up.fields.broadcast_starters && up.fields.broadcast_starters.offense;
    chk('...and is written back in the array shape, migrating itself on save',
        Array.isArray(off) && off.length === 2 && off[0].num === '7',
        JSON.stringify(off));
    w.close();
  }

  console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
  if (fail) console.log('\n' + fail + ' FAILURES');
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
