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

async function boot(db){
  const html = fs.readFileSync(path.join(REPO, 'account.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://nevillestatchat.vercel.app/account.html',
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
