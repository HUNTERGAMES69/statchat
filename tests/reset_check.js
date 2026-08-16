// "Reset for production" — account.html
// =====================================
// The one-shot, irreversible button that empties the app for live use.
// Added 13 Aug 2026, when it had existed for months and had NEVER BEEN
// RUN. That is the worst combination there is: a destructive action, no
// undo, no export, and no evidence it does what the label says. It is
// also the only page in the app with no test coverage at all.
//
// WHY THIS FILE HAS ITS OWN MOCK, instead of using harness.js.
// ---------------------------------------------------------------------
// harness.js models a GAME page: one game, one roster, a list of plays.
// This page is a different shape entirely — many games at once, a
// separate players table, a teams row, profiles and a password
// re-authentication. Bending the shared harness to fit would touch the
// mock that 25 other suites depend on, to serve one page. The mock below
// is deliberately small and lives next to the only thing it tests.
//
// It models the FOREIGN KEY CASCADE explicitly, because that is the part
// the application does not do: the page deletes from `games` and trusts
// the database to remove the plays and roster snapshots hanging off it.
// A test that quietly ignored the cascade would prove the button issues
// the right statements while saying nothing about whether the data is
// gone, which is the only question that matters. `cascade: false` below
// simulates a schema where that was never configured.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..');

function makeDb(opts = {}){
  return {
    games: (opts.games || [
      { id: 'g1', status: 'final',       season_year: 2025 },
      { id: 'g2', status: 'final',       season_year: 2025 },
      { id: 'g3', status: 'in_progress', season_year: 2025 }
    ]).map(g => Object.assign({}, g)),
    plays: (opts.plays || [
      { id: 'p1', game_id: 'g1' }, { id: 'p2', game_id: 'g1' },
      { id: 'p3', game_id: 'g2' }, { id: 'p4', game_id: 'g3' }
    ]).map(p => Object.assign({}, p)),
    game_rosters: (opts.game_rosters || [
      { id: 'gr1', game_id: 'g1', player_id: 'pl1' },
      { id: 'gr2', game_id: 'g2', player_id: 'pl2' }
    ]).map(r => Object.assign({}, r)),
    players: (opts.players || [
      { id: 'pl1', team_id: 't1', name: 'Alpha Ates' },
      { id: 'pl2', team_id: 't1', name: 'Bravo Boone' },
      { id: 'pl3', team_id: 't1', name: 'Cody Carr' }
    ]).map(p => Object.assign({}, p)),
    teams: (opts.teams || [
      { id: 't1', is_our_team: true, name: 'Neville',
        primary_color: '#1a4d2e', logo_url: 'logo.png', current_season_year: 2025 }
    ]).map(t => Object.assign({}, t)),
    profiles: [{ id: 'test-user-id', role: opts.role || 'admin', display_name: 'Andy' }],
    // Bookkeeping the assertions read.
    ops: [],                                  // every statement, in order
    failOn: opts.failOn || null,              // 'games.delete' | 'players.delete' | 'teams.update'
    cascade: opts.cascade !== false,          // does the schema cascade?
    signInOk: opts.signInOk !== false
  };
}

function makeClient(db){
  function builder(table){
    return {
      _op: 'select', _filters: {}, _in: null, _countOnly: false, _returning: false,
      select(_cols, o){ if (o && o.count) this._countOnly = true; else if (this._op !== 'select') this._returning = true; return this; },
      insert(){ this._op = 'insert'; return this; },
      update(fields){ this._op = 'update'; this._fields = fields; return this; },
      delete(){ this._op = 'delete'; return this; },
      eq(col, val){ this._filters[col] = val; return this; },
      in(col, vals){ this._in = { col, vals }; return this; },
      order(){ return this; },
      limit(){ return this; },
      match(rows){
        return rows.filter(r =>
          Object.keys(this._filters).every(k => String(r[k]) === String(this._filters[k])) &&
          (!this._in || this._in.vals.indexOf(r[this._in.col]) !== -1));
      },
      then(resolve, reject){
        const rows = db[table] || [];
        const key = table + '.' + this._op;
        db.ops.push(key);
        if (db.failOn === key){
          return Promise.resolve({ data: null, error: { message: 'simulated failure on ' + key } })
            .then(resolve, reject);
        }
        if (this._countOnly){
          return Promise.resolve({ data: null, count: rows.length, error: null }).then(resolve, reject);
        }
        if (this._op === 'delete'){
          const doomed = this.match(rows);
          const ids = doomed.map(r => r.id);
          db[table] = rows.filter(r => ids.indexOf(r.id) === -1);
          // THE CASCADE, modelled. The page never deletes these itself.
          // A CASCADING players -> game_rosters key, modelled deliberately.
          // If the app deletes players without unlinking first, the
          // snapshots go too and the assertions above catch it.
          if (table === 'players'){
            const gone = doomed.map(p => p.id);
            db.game_rosters = db.game_rosters.filter(r => gone.indexOf(r.player_id) === -1);
          }
          if (table === 'games' && db.cascade){
            const gone = doomed.map(g => g.id);
            db.plays = db.plays.filter(p => gone.indexOf(p.game_id) === -1);
            db.game_rosters = db.game_rosters.filter(r => gone.indexOf(r.game_id) === -1);
          }
          return Promise.resolve({ data: doomed, error: null }).then(resolve, reject);
        }
        if (this._op === 'update'){
          this.match(rows).forEach(r => Object.assign(r, this._fields));
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: this.match(rows), error: null }).then(resolve, reject);
      }
    };
  }
  return {
    from: (t) => builder(t),
    auth: {
      onAuthStateChange(cb){
        setTimeout(() => cb('INITIAL_SESSION', {
          user: { id: 'test-user-id', email: 'andy@example.com' },
          access_token: 'tok'
        }), 0);
        return { data: { subscription: { unsubscribe(){} } } };
      },
      getUser(){ return Promise.resolve({ data: { user: { id: 'test-user-id' } }, error: null }); },
      signInWithPassword(){
        db.ops.push('auth.signInWithPassword');
        return Promise.resolve(db.signInOk
          ? { data: {}, error: null }
          : { data: null, error: { message: 'Invalid login credentials' } });
      },
      signOut(){ return Promise.resolve({ error: null }); },
      updateUser(){ return Promise.resolve({ error: null }); },
      mfa: {
        listFactors(){ return Promise.resolve({ data: { totp: [] }, error: null }); },
        enroll(){ return Promise.resolve({ data: null, error: null }); }
      }
    },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    functions: { invoke(){ return Promise.resolve({ data: null, error: null }); } },
    channel(){ return { on(){ return this; }, subscribe(){ return this; } }; },
    removeChannel(){}
  };
}

async function boot(db, file){
  const html = fs.readFileSync(path.join(REPO, file || 'account.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://nevillestatchat.vercel.app/' + (file || 'account.html'),
    runScripts: 'dangerously',
    beforeParse(window){
      window.supabase = { createClient: () => makeClient(db) };
      window.alert = () => {};
      window.confirm = () => true;
      window.scrollTo = () => {};
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
  });
  await new Promise(r => setTimeout(r, 150));
  return dom;
}

const tick = (ms = 120) => new Promise(r => setTimeout(r, ms));

async function runReset(dom, db, { password = 'correct', agree = 'I agree' } = {}){
  const doc = dom.window.document, win = dom.window;
  const click = id => doc.getElementById(id).dispatchEvent(new win.Event('click', { bubbles: true }));
  click('startResetBtn');
  doc.getElementById('resetPasswordInput').value = password;
  click('resetPasswordContinueBtn');
  await tick();
  if (!doc.getElementById('resetStep3') || doc.getElementById('resetStep3').classList.contains('hidden')){
    return { reachedStep3: false };
  }
  const preflight = doc.getElementById('resetPreflight').textContent;
  doc.getElementById('resetAgreeInput').value = agree;
  click('resetFinalBtn');
  await tick(250);
  return { reachedStep3: true, preflight, msg: doc.getElementById('resetMsg').textContent };
}

async function run(){
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- only an admin is even offered it ---------------------------------
  {
    const db = makeDb({ role: 'scorer' });
    const dom = await boot(db);
    if (!dom.window.document.getElementById('resetCard').classList.contains('hidden')){
      fail('gate', 'a non-admin can see the Reset for production card');
    }
    dom.window.close();
  }

  // --- the wrong password stops it dead ---------------------------------
  {
    const db = makeDb({ signInOk: false });
    const dom = await boot(db);
    const r = await runReset(dom, db, { password: 'wrong' });
    if (r.reachedStep3) fail('password', 'a wrong password still reached the final step');
    if (db.games.length !== 3) fail('password', 'games were deleted despite a failed password');
    dom.window.close();
  }

  // --- the confirmation phrase must be exact ----------------------------
  for (const typed of ['i agree', 'I agree ', 'yes', '']){
    const db = makeDb();
    const dom = await boot(db);
    await runReset(dom, db, { agree: typed });
    if (db.games.length !== 3 || db.players.length !== 3){
      fail('confirm phrase', 'typing ' + JSON.stringify(typed) + ' deleted data — only an ' +
           'exact "I agree" should');
    }
    dom.window.close();
  }

  // --- the count is shown BEFORE the button, and is right ---------------
  {
    const db = makeDb();
    const dom = await boot(db);
    const r = await runReset(dom, db, { agree: 'no' });
    if (!/3 game\(s\)/.test(r.preflight || '') || !/4 play\(s\)/.test(r.preflight || '') ||
        !/3 roster player\(s\)/.test(r.preflight || '')){
      fail('pre-flight', 'the count shown before the final button is wrong or missing: ' +
           JSON.stringify(r.preflight));
    }
    dom.window.close();
  }

  // --- the happy path: a genuine blank slate ----------------------------
  {
    const db = makeDb();
    const dom = await boot(db);
    await runReset(dom, db);
    if (db.games.length) fail('reset', db.games.length + ' game(s) survived');
    if (db.plays.length) fail('reset', db.plays.length + ' play(s) survived — the cascade ' +
                              'should have taken them with the games');
    if (db.game_rosters.length) fail('reset', 'roster snapshots survived');
    if (db.players.length) fail('reset', db.players.length + ' roster player(s) survived — ' +
                                'the team roster is meant to be emptied too');
    if (db.teams[0].current_season_year !== null){
      fail('reset', 'current_season_year is still ' + db.teams[0].current_season_year +
           ' — a reset that leaves it set is not a blank slate, and the next game ' +
           'created inherits the test season');
    }
    // ...but the things that are NOT test data must survive.
    if (db.teams[0].name !== 'Neville' || db.teams[0].primary_color !== '#1a4d2e' ||
        db.teams[0].logo_url !== 'logo.png'){
      fail('reset', 'team name, colours or logo were destroyed — those are the real ' +
           'team\'s, not test data');
    }
    if (!db.profiles.length) fail('reset', 'user profiles were deleted — that would lock ' +
                                  'the admin out of the app they just cleared');
    dom.window.close();
  }

  // --- finalized games are unlocked before deletion ---------------------
  {
    const db = makeDb();
    const dom = await boot(db);
    await runReset(dom, db);
    if (db.ops.indexOf('games.update') === -1){
      fail('finalized', 'no game was un-finalized — a final game cannot be deleted ' +
           'directly, so two of these three should have been unlocked first');
    }
    if (db.ops.indexOf('games.update') > db.ops.indexOf('games.delete')){
      fail('finalized', 'games were deleted before being un-finalized');
    }
    dom.window.close();
  }

  // --- ORDER: players go after games ------------------------------------
  // game_rosters.player_id references players, so clearing the roster
  // first would either fail on the foreign key or strand the snapshots.
  {
    const db = makeDb();
    const dom = await boot(db);
    await runReset(dom, db);
    const gDel = db.ops.indexOf('games.delete'), pDel = db.ops.indexOf('players.delete');
    if (gDel === -1 || pDel === -1 || pDel < gDel){
      fail('order', 'the roster must be cleared AFTER the games (games.delete at ' + gDel +
           ', players.delete at ' + pDel + ') — game_rosters references players');
    }
    dom.window.close();
  }

  // --- a failure partway must not pretend to have finished --------------
  {
    const db = makeDb({ failOn: 'games.delete' });
    const dom = await boot(db);
    const r = await runReset(dom, db);
    if (db.players.length !== 3){
      fail('partial failure', 'the roster was cleared even though the games could not be ' +
           'deleted — a half-done reset is worse than none');
    }
    if (db.teams[0].current_season_year !== 2025){
      fail('partial failure', 'the season year was cleared after the delete failed');
    }
    if (!/unlocked/i.test(r.msg || '')){
      fail('partial failure', 'two finished games were unlocked before the delete failed ' +
           'and are still unlocked, and the message does not say so: ' +
           JSON.stringify((r.msg || '').slice(0, 120)));
    }
    dom.window.close();
  }
  {
    const db = makeDb({ failOn: 'players.delete' });
    const dom = await boot(db);
    const r = await runReset(dom, db);
    if (db.teams[0].current_season_year !== 2025){
      fail('partial failure', 'the season year was cleared even though the roster ' +
           'could not be — the message promises it is still set');
    }
    if (!/season year is still set/i.test(r.msg || '')){
      fail('partial failure', 'the roster delete failed and the message does not say ' +
           'the season year is untouched: ' + JSON.stringify((r.msg || '').slice(0, 140)));
    }
    dom.window.close();
  }

  // --- NO CASCADE: the orphan case --------------------------------------
  // The application relies entirely on the database here. If the foreign
  // keys were never set to ON DELETE CASCADE, the games vanish and the
  // plays do not — invisible in the app, still in the table, and the
  // stats they represent unrecoverable but not gone. Nothing in the page
  // can detect this, which is exactly why it is asserted: this test is
  // the only place that would ever say so.
  {
    const db = makeDb({ cascade: false });
    const dom = await boot(db);
    await runReset(dom, db);
    if (db.plays.length === 0){
      fail('cascade', 'the mock says the schema does NOT cascade, yet the plays vanished — ' +
           'the test fixture is lying and every other cascade assertion here is worthless');
    }
    // Not a failure of the app: a note that the app cannot see this.
  }

  // === CLEAR ROSTER FOR A NEW SEASON (roster.html) ======================
  // A different button with the opposite requirement to the one above:
  // it must delete the CURRENT roster and leave every past season
  // completely intact. The danger is not the delete, it is the foreign
  // key -- game_rosters.player_id points at players, and if that
  // constraint cascades, clearing the roster would silently destroy the
  // roster snapshot of a game played last October.
  //
  // The mock below cascades ON PURPOSE, so a version that deletes
  // players without unlinking first is caught rather than passing by
  // luck of the schema.
  async function clearRoster(dom, { typed = 'CLEAR' } = {}){
    const doc = dom.window.document, win = dom.window;
    const click = id => doc.getElementById(id).dispatchEvent(new win.Event('click', { bubbles: true }));
    click('clearRosterBtn');
    await tick();
    doc.getElementById('clearRosterInput').value = typed;
    click('clearRosterConfirmBtn');
    await tick(250);
    return doc.getElementById('rosterMsg').textContent;
  }

  {
    const db = makeDb();
    db.rosterCascade = true;   // honoured in the delete branch below
    const dom = await boot(db, 'roster.html');
    const msg = await clearRoster(dom);

    if (db.players.length){
      fail('clear roster', db.players.length + ' player(s) survived — the button is meant ' +
           'to empty the roster so next season can be uploaded fresh');
    }
    // THE POINT OF THE WHOLE FEATURE.
    if (db.game_rosters.length !== 2){
      fail('clear roster', 'a past game lost its roster snapshot (' + db.game_rosters.length +
           ' of 2 left) — last season\'s names and numbers come from these rows, and the ' +
           'coach was told past seasons are untouched');
    }
    if (db.games.length !== 3 || db.plays.length !== 4){
      fail('clear roster', 'clearing the roster removed games or plays — it must touch ' +
           'neither');
    }
    // The link must be severed, not the row.
    if (db.game_rosters.some(r => r.player_id !== null)){
      fail('clear roster', 'game_rosters.player_id was left pointing at deleted players: ' +
           JSON.stringify(db.game_rosters) + ' — a cascading foreign key would then have ' +
           'taken the snapshot with it');
    }
    if (db.ops.indexOf('game_rosters.update') === -1 ||
        db.ops.indexOf('game_rosters.update') > db.ops.indexOf('players.delete')){
      fail('clear roster', 'the snapshots must be unlinked BEFORE the players are deleted, ' +
           'not after — after is too late for a cascade');
    }
    if (!/untouched/i.test(msg || '')){
      fail('clear roster', 'the confirmation does not reassure that past seasons survived');
    }
    dom.window.close();
  }

  // --- the phrase must be exact, and a failed unlink must abort ---------
  {
    const db = makeDb();
    const dom = await boot(db, 'roster.html');
    await clearRoster(dom, { typed: 'clear' });
    if (db.players.length !== 3){
      fail('clear roster', 'typing "clear" in lower case still emptied the roster');
    }
    dom.window.close();
  }
  {
    const db = makeDb({ failOn: 'game_rosters.update' });
    const dom = await boot(db, 'roster.html');
    const msg = await clearRoster(dom);
    if (db.players.length !== 3){
      fail('clear roster', 'the unlink failed and it deleted the players anyway — that is ' +
           'the exact case where a cascading key destroys a past season');
    }
    if (!/[Nn]othing has been deleted/.test(msg || '')){
      fail('clear roster', 'the unlink failed and the message does not say nothing was ' +
           'deleted: ' + JSON.stringify((msg || '').slice(0, 140)));
    }
    dom.window.close();
  }

  // --- PROOF that a past season's reports are unchanged -----------------
  // The assertions above prove the clear does not DELETE games, plays or
  // roster snapshots. This proves the stronger thing the coach was
  // actually promised: that the reports READ THE SAME afterwards.
  //
  // The clear does exactly two things -- nulls game_rosters.player_id and
  // deletes the players rows -- so a finished game is rendered in both
  // states and the output compared character for character. Anything
  // that quietly resolved a name through the players table instead of the
  // snapshot would show up here and nowhere else.
  {
    const { bootGamePage, bootPage, defaultRoster } = require('./harness');
    const D = require('./ui_driver');

    const g = await bootGamePage({ roster: defaultRoster() });
    D.setDrive(g, { down: 1, distance: 10, side: 'own', yardline: 25 });
    D.enterPlay(g, { type: 'rush', carrier: '22', yards: '12', credit: '55' });
    D.enterPlay(g, { type: 'pass', passer: '7', receiver: '80', yards: '23', credit: '44' });
    D.setDrive(g, { down: 1, distance: 10, side: 'opp', yardline: 6 });
    D.enterPlay(g, { type: 'rush', carrier: '22', yards: '6', td: true });
    const plays = g.db.plays.map((p, i) =>
      Object.assign({}, p, { sequence_number: p.sequence_number || i + 1 }));
    g.close();

    const before = defaultRoster().map((r, i) => Object.assign({}, r, { player_id: 'pl' + i }));
    const after  = defaultRoster().map(r => Object.assign({}, r, { player_id: null }));

    const render = async (page, roster, query) => {
      const v = await bootPage(page, { existingPlays: plays, roster, query,
        game: { status: 'final', season_year: 2025, game_date: '2025-10-04' } });
      await tick(400);
      const t = v.document.body.textContent.replace(/\s+/g, ' ').trim();
      v.close();
      return t;
    };

    for (const [page, query] of [['recap.html', undefined],
                                 ['stat_package.html', undefined],
                                 ['season_report.html', '?season=2025']]){
      const a = await render(page, before, query);
      const b = await render(page, after, query);
      // Guard against two blank pages agreeing with each other.
      if (a.length < 200 || !/\d/.test(a)){
        fail('past seasons', page + ' rendered almost nothing, so comparing it proves ' +
             'nothing — fix the fixture before trusting this check');
        continue;
      }
      if (a !== b){
        const at = a.split(' '), bt = b.split(' ');
        let where = '';
        for (let i = 0; i < Math.max(at.length, bt.length); i++){
          if (at[i] !== bt[i]){
            where = ' — first difference: ' + JSON.stringify(at.slice(i, i + 8).join(' ')) +
                    ' vs ' + JSON.stringify(bt.slice(i, i + 8).join(' '));
            break;
          }
        }
        fail('past seasons', page + ' renders DIFFERENTLY after the roster is cleared' + where);
      }
      if (!/Runningback/.test(b)){
        fail('past seasons', page + ' lost its player names once the roster was cleared — ' +
             'names for a finished game must come from the game_rosters snapshot, not players');
      }
    }
  }

  // --- THE PER-GAME RESET RESTORES THE STATUS A NEW GAME HAS ------------
  // Reported 16 Aug 2026: a game reset from the dashboard kept reading
  // "In progress" for ever. The reset wrote status 'in_progress' while
  // setting game_phase 'notStarted', and the dashboard label reads
  // STATUS -- so the row said one thing and the phase said another.
  //
  // This suite covers Reset for PRODUCTION (account.html), not the
  // per-game reset (dashboard.html), which is why nothing caught it.
  // dashboard.html cannot be booted in the harness, so the invariant is
  // checked at the source level instead: whatever status create_game.html
  // gives a NEW game is the status the reset must restore.
  //
  // A reset game and a game that has never been opened should be
  // indistinguishable. That is what reset means, and it is a rule that
  // can be stated without a browser.
  {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const create = fs.readFileSync(path.join(root, 'create_game.html'), 'utf8');
    const dash = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');

    const created = (create.match(/gamePayload\.status\s*=\s*'([a-z_]+)'/) || [])[1];
    if (!created){
      fail('game reset', 'could not find the status create_game.html gives a new game — ' +
           'this check can no longer verify anything and needs re-pointing');
    }

    // The status written by resetGame(), which is the update that also
    // clears the scores.
    const m = dash.match(/status:\s*'([a-z_]+)',\s*game_phase:\s*'notStarted'/);
    const restored = m && m[1];
    if (!restored){
      fail('game reset', 'could not find the status dashboard.html restores on a game ' +
           'reset — the update was rewritten and this check needs re-pointing');
    }

    if (created && restored && created !== restored){
      fail('game reset', 'a new game is created with status ' + JSON.stringify(created) +
           ' but a reset game is left at ' + JSON.stringify(restored) +
           '. The dashboard labels rows from status, so a reset game reads as ' +
           'something it is not — it was showing "In progress" indefinitely');
    }
  }

  return failures;
}

if (require.main === module){
  run().then(f => {
    console.log('=== Reset for production ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length){
      console.log('  admin-only, password and phrase enforced, counts correct,');
      console.log('  games/plays/rosters/players cleared, season year cleared,');
      console.log('  branding and accounts kept, order and partial failures safe.');
    }
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
