// StatChat test harness
// ----------------------
// Boots the REAL game.html inside jsdom against a mock Supabase backend,
// so tests can drive genuine UI elements (click real buttons, type into
// real <input> fields) instead of calling parseInput() directly.
//
// WHY THIS EXISTS: the sack-yardage bug (Aug 3 2026) lived in the HTML
// input path itself and was invisible to parseInput()-level fuzzing.
// Anything that claims to verify the app must go through the real DOM.
//
// The mock DB also records every row the app *persists*, which is what
// makes it possible to cross-check three independent representations of
// the same play: what was typed -> what got saved -> what is displayed.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.resolve(__dirname, '..');

function makeMockSupabase(db) {
  // Minimal chainable query builder. Every chain method returns `this`;
  // awaiting the builder resolves to {data, error}. Writes are recorded
  // into `db.inserted` / `db.updated` so tests can inspect them.
  function builder(table, op, payload) {
    const b = {
      _table: table,
      _op: op,
      _payload: payload,
      _filters: {},
      // The second argument carries { count, head } for a count-only
      // query. view.html's reconciliation poll uses one, and without
      // support here it would silently return undefined and the poll
      // would appear to work while never reconciling anything.
      select(cols, opts) {
        if (this._op === null) this._op = 'select';
        if (opts && opts.count) this._countOnly = true;
        // REMEMBER THE COLUMN LIST, and honour it below.
        //
        // This mock used to return every column whatever was asked for,
        // which made it KINDER THAN THE REAL DATABASE -- and that hid a
        // real bug: dashboard.html selects an explicit column list, and
        // `is_broadcast` was missing from it. The ON AIR badge read
        // `undefined` in production while every test passed.
        //
        // A mock that answers questions the real thing would not is worse
        // than no mock. If a page forgets to request a column, the test
        // must fail the same way the app does.
        if (typeof cols === 'string' && cols !== '*' && cols.trim()) {
          this._cols = cols.split(',').map(c => c.trim().split(/\s+/)[0])
            .filter(c => c && c !== '*');
        }
        return this;
      },
      insert(rows) {
        this._op = 'insert';
        const arr = Array.isArray(rows) ? rows : [rows];
        // db.failNext lets a test simulate the server being unreachable,
        // or rejecting a row. Without it the offline queue cannot be
        // tested at all: it only does anything interesting when an insert
        // FAILS, and a mock that always succeeds never exercises it.
        //   db.failNext = 'offline'   -> a network-style error
        //   db.failNext = 'duplicate' -> a 23505 unique violation
        //   db.failNext = 'final'     -> the "game is final" refusal
        //   db.failNext = n           -> fail the next n inserts, then stop
        if (db.failNext) {
          this._insertError = db.failNext;
          if (typeof db.failNext === 'number') {
            db.failNext = db.failNext > 1 ? db.failNext - 1 : null;
            this._insertError = 'offline';
          }
          return this;
        }
        arr.forEach(r => db.inserted.push({ table, row: r }));
        if (table === 'plays') arr.forEach(r => db.plays.push(r));
        return this;
      },
      update(fields) {
        this._op = 'update';
        // db.failUpdates lets a test simulate the server refusing an
        // update. Without it the retry logic on game-row writes could not
        // be exercised at all -- a mock that always succeeds never
        // reaches the code that exists for failure.
        if (db.failUpdates) {
          this._insertError = db.failUpdates === true ? 'offline' : db.failUpdates;
          return this;
        }
        db.updated.push({ table, fields });
        Object.assign(db.gameFields, fields);
        return this;
      },
      // Records the intent only -- the row removal happens in then(),
      // once the .eq() filters have been collected.
      delete() { this._op = 'delete'; return this; },
      eq(col, val) { this._filters[col] = val; return this; },
      order() { return this; },
      limit() { return this; },
      then(resolve, reject) {
        if (this._insertError) {
          const messages = {
            offline:   'TypeError: Failed to fetch',
            duplicate: 'duplicate key value violates unique constraint (23505)',
            final:     'This game is final and cannot be modified'
          };
          return Promise.resolve({
            data: null,
            error: { message: messages[this._insertError] || String(this._insertError) }
          }).then(resolve, reject);
        }
        if (this._countOnly) {
          const rows = table === 'plays'
            ? db.existingPlays.concat(db.plays) : [];
          return Promise.resolve({ data: null, count: rows.length, error: null })
            .then(resolve, reject);
        }
        // DELETE, actually performed.
        // ------------------------------------------------------------
        // This was a no-op until 13 Aug 2026: `delete()` set a flag and
        // then() ignored it, so db.plays was insert-only and NO test
        // could verify that a row was removed. Undo "passed" by never
        // being checked -- the page dropped the play from its in-memory
        // array, the mock cheerfully reported success, and whether the
        // delete reached the server was untestable. The group-delete
        // added to undo the same day had to be verified by reading the
        // page's own array instead, which proves the app's state and
        // says nothing about what the server was told.
        //
        // Rows are removed from BOTH lists: existingPlays is what a
        // reload would return, so a delete that misses it looks fine
        // until the page reloads and the row comes back -- which is the
        // exact failure this is here to catch.
        if (this._op === 'delete') {
          const f = this._filters || {};
          const matches = (r) => Object.keys(f).every(k => String(r[k]) === String(f[k]));
          const removed = [];
          for (const listName of ['plays', 'existingPlays']) {
            for (let i = db[listName].length - 1; i >= 0; i--) {
              if (matches(db[listName][i])) removed.unshift(db[listName].splice(i, 1)[0]);
            }
          }
          // Kept so a test can assert WHAT was deleted, not merely that
          // the row is gone -- "deleted the right two rows" and "deleted
          // everything" both leave the table empty.
          db.deleted.push({ table, filters: Object.assign({}, f), rows: removed });
          return Promise.resolve({ data: removed, error: null }).then(resolve, reject);
        }
        let data = [];
        // Narrow every row to the columns actually requested.
        const narrow = (rows) => {
          if (!this._cols || !this._cols.length) return rows;
          return rows.map(r => {
            const o = {};
            this._cols.forEach(c => { if (c in r) o[c] = r[c]; });
            return o;
          });
        };
        if (this._op === 'select') {
          // Configurable via opts.role. It was hardcoded to 'admin',
          // which meant NO role gate could be tested -- a test asking
          // "is this hidden from a view account?" was silently always
          // asking about an admin, and passed regardless.
          if (table === 'profiles') data = [{ role: db.role, id: 'test-user-id' }];
          else if (table === 'games') data = [db.game];
          else if (table === 'game_rosters') data = db.roster;
          else if (table === 'teams') data = [db.branding];
          else if (table === 'plays') {
            // The server holds what was preloaded PLUS anything inserted
            // during this session. Returning only the preloaded rows made
            // the mock lie to any code that inserts and then re-reads --
            // which is exactly what offline-recovery logic does.
            data = db.existingPlays.concat(db.plays);
          }
        }
        return Promise.resolve({ data: narrow(data), error: null }).then(resolve, reject);
      }
    };
    return b;
  }

  return {
    from(table) { return builder(table, null, null); },
    auth: {
      onAuthStateChange(cb) {
        // Fire INITIAL_SESSION exactly the way the real client does --
        // this is the documented pattern every StatChat page relies on.
        setTimeout(() => cb('INITIAL_SESSION', { user: { id: 'test-user-id' } }), 0);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getUser() { return Promise.resolve({ data: { user: { id: 'test-user-id' } }, error: null }); },
      signOut() { return Promise.resolve({ error: null }); }
    },
    // Records what the page subscribed to, and lets a test FIRE an event
    // back. The old stub swallowed everything and returned `this`, which
    // meant realtime could be wired to the wrong table, the wrong event
    // or the wrong game and no test could tell -- the page would simply
    // stop updating live, mid-broadcast, with nothing in the console.
    // Database functions. The broadcast flag is set through one, because
    // exclusivity must be enforced in a single transaction -- two laptops
    // doing "clear all, then set mine" can interleave. Recorded here so a
    // test can assert WHICH function was called with what.
    rpc(fn, args) {
      db.rpcCalls.push({ fn, args });
      if (db.rpcError) return Promise.resolve({ data: null, error: { message: db.rpcError } });
      if (fn === 'set_broadcast_game') {
        db.game.is_broadcast = (db.game.id === (args || {}).p_game_id);
      } else if (fn === 'clear_broadcast_game') {
        if (db.game.id === (args || {}).p_game_id) db.game.is_broadcast = false;
      }
      return Promise.resolve({ data: null, error: null });
    },
    channel(name) {
      const ch = {
        _name: name,
        _handlers: [],
        on(type, cfg, cb) {
          this._handlers.push({ type, cfg, cb });
          db.realtime.handlers.push({ channel: name, type, cfg, cb });
          return this;
        },
        subscribe() { db.realtime.subscribed.push(name); return this; }
      };
      db.realtime.channels.push(ch);
      return ch;
    },
    removeChannel() { db.realtime.removed++; }
  };
}

const DEFAULT_GAME = {
  id: 'test-game-1',
  designator: 'Game 1',
  home_team_name: 'Neville',
  away_team_name: 'TEST OPP',
  our_team_is_home: true,
  opponent_primary_color: '#8B0000',
  opponent_secondary_color: '#ffffff',
  opponent_logo_url: null,
  quarter_length_seconds: 720,
  status: 'in_progress',
  game_phase: 'firstHalf',
  guided_state: null,
  seed_starters: {}
};

const DEFAULT_BRANDING = {
  primary_color: '#ffc72c',
  secondary_color: '#000000',
  logo_url: null
};

// A roster big enough to cover every panel's player picker, on both
// sides, across offense / defense / special teams.
function defaultRoster() {
  const rows = [];
  const add = (side, unit, num, name, pos) =>
    rows.push({ team_side: side, unit, jersey_number: String(num), player_name: name, position: pos });

  ['teamA', 'teamB'].forEach(side => {
    const tag = side === 'teamA' ? 'N' : 'O';
    add(side, 'offense', 7, tag + ' Quarterback', 'QB');
    add(side, 'offense', 22, tag + ' Runningback', 'RB');
    add(side, 'offense', 28, tag + ' Halfback', 'HB');
    add(side, 'offense', 80, tag + ' Receiver', 'WR');
    add(side, 'offense', 84, tag + ' Receiver Two', 'WR');
    add(side, 'offense', 88, tag + ' Tightend', 'TE');
    add(side, 'defense', 55, tag + ' Linebacker', 'LB');
    add(side, 'defense', 21, tag + ' Cornerback', 'CB');
    add(side, 'defense', 99, tag + ' Defensiveend', 'DE');
    add(side, 'special', 3, tag + ' Kicker', 'K');
    add(side, 'special', 15, tag + ' Punter', 'P');
    add(side, 'special', 25, tag + ' Returner', 'KR');
  });
  return rows;
}

/**
 * Boot any StatChat page against the mock backend.
 * @param {string} file    e.g. 'game.html', 'view.html'
 * @param {object} opts    { game, branding, roster, existingPlays, query, readyWhen }
 */
async function bootPage(file, opts = {}) {
  let html = fs.readFileSync(path.join(REPO, file), 'utf8');

  const db = {
    game: Object.assign({}, DEFAULT_GAME, opts.game || {}),
    branding: Object.assign({}, DEFAULT_BRANDING, opts.branding || {}),
    roster: opts.roster || defaultRoster(),
    existingPlays: opts.existingPlays || [],
    plays: [],
    failNext: opts.failNext || null,   // see builder().insert
    failUpdates: opts.failUpdates || null,  // see builder().update
    role: opts.role || 'admin',        // the signed-in user's role
    deleted: [],                       // every delete performed, see builder().then
    rpcCalls: [],                      // see makeMockSupabase().rpc
    rpcError: opts.rpcError || null,
    // Realtime bookkeeping. `emit` replays a postgres_changes event the
    // way Supabase would, so a test can prove the page reacts.
    realtime: {
      channels: [], handlers: [], subscribed: [], removed: 0,
      emit(event, payload) {
        let fired = 0;
        this.handlers.forEach(h => {
          const cfg = h.cfg || {};
          if (cfg.event && cfg.event !== event) return;
          h.cb(payload || {});
          fired++;
        });
        return fired;
      }
    },
    inserted: [],
    updated: [],
    gameFields: {}
  };

  const alerts = [];
  const query = opts.query || '?id=test-game-1';

  // Inline engine.js in place of its <script src>. jsdom does not fetch
  // local files, so without this the pages load with no engine at all --
  // every computeState call is undefined. A browser fetches it normally;
  // this just makes the harness behave the same way.
  //
  // Deliberately a TEXTUAL substitution rather than loading the module
  // separately: it preserves script ORDER, which is the thing most likely
  // to break after the extraction and the thing we most need tested.
  const engineSrc = fs.readFileSync(path.join(REPO, 'engine.js'), 'utf8');
  html = html.replace('<script src="engine.js"></script>',
                      '<script>' + engineSrc + '</script>');

  const dom = new JSDOM(html, {
    url: 'https://nevillestatchat.vercel.app/' + file + query,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      // Stub the CDN Supabase SDK before any page script runs. The real
      // CDN script tag is never fetched by jsdom, so this global IS the
      // library as far as the page is concerned.
      window.supabase = { createClient: () => makeMockSupabase(db) };
      window.alert = msg => { alerts.push(String(msg)); };
      window.confirm = () => (opts.confirmAnswer === undefined ? true : opts.confirmAnswer);
      window.scrollTo = () => {};
      // Lets a test simulate a reload with plays still sitting in the
      // offline sync queue, which is the case that matters most: a play
      // that never reached the server must survive the page reload.
      if (opts.seedStorage){
        try {
          Object.keys(opts.seedStorage).forEach(k => window.localStorage.setItem(k, opts.seedStorage[k]));
        } catch (e) {}
      }
      // season_report.html renders its charts with Chart.js from a CDN,
      // which jsdom never fetches, and jsdom has no canvas backend
      // either. Stub both: the charts are presentation, but the page's
      // NUMBERS are exactly what these tests need to reach.
      // RECORDS every chart's config instead of discarding it. The old
      // stub threw the config away, so nothing could check what the
      // charts were actually handed -- and "the chart drew" says nothing
      // about whether it drew the right numbers. A chart plotting the
      // wrong series looks completely convincing.
      db.charts = [];
      window.Chart = function Chart(canvas, config) {
        db.charts.push({
          id: canvas && canvas.id ? canvas.id : '(no canvas)',
          type: (config || {}).type,
          data: (config || {}).data || {},
          options: (config || {}).options || {}
        });
        return { destroy() {}, update() {}, resize() {}, data: {}, options: {} };
      };
      window.Chart.register = () => {};
      window.Chart.defaults = { font: {}, plugins: { legend: {} } };
      window.HTMLCanvasElement.prototype.getContext = function () {
        return {
          canvas: this, save() {}, restore() {}, beginPath() {}, closePath() {},
          moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {}, clearRect() {},
          fillRect() {}, strokeRect() {}, fillText() {}, strokeText() {},
          measureText: () => ({ width: 0 }), setTransform() {}, translate() {},
          scale() {}, rotate() {}, drawImage() {},
          createLinearGradient: () => ({ addColorStop() {} }),
          getImageData: () => ({ data: [] }), putImageData() {}
        };
      };
      if (!window.Element.prototype.scrollIntoView) {
        window.Element.prototype.scrollIntoView = function () {};
      }
    }
  });

  const { window } = dom;
  window.__alerts = alerts;

  // Wait for init() to finish -- it's async and driven by the
  // INITIAL_SESSION callback, so poll until the page says it's ready.
  const readyWhen = opts.readyWhen || (win => {
    const mv = win.document.getElementById('mainView');
    return mv && !mv.classList.contains('hidden');
  });
  await new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      let ok = false;
      try { ok = !!readyWhen(window); } catch (e) { ok = false; }
      if (ok) return resolve();
      if (Date.now() - started > 8000) {
        const err = window.document.getElementById('errorMsg');
        return reject(new Error(file + ' never became ready. errorMsg=' +
          (err ? err.textContent : '(none)')));
      }
      setTimeout(tick, 5);
    };
    tick();
  });

  // `let` declarations at the top level of a classic script live in the
  // global lexical environment, NOT on `window` -- so window.TEAMS is
  // undefined but window.eval('TEAMS') works.
  const evalIn = code => window.eval(code);

  // Clear pending timers before tearing the window down. view.html now
  // runs a reconciliation poll on setInterval, and a tick that fires
  // after close() finds `document` undefined and throws a
  // process-level error that no test can catch -- a passing suite
  // followed by a stack trace and a non-zero exit.
  const close = () => {
    try {
      const maxId = dom.window.setTimeout(() => {}, 0);
      for (let i = 0; i <= maxId; i++) {
        dom.window.clearTimeout(i);
        dom.window.clearInterval(i);
      }
    } catch (e) { /* already gone */ }
    dom.window.close();
  };

  return { dom, window, document: window.document, db, evalIn, alerts, close };
}

const bootGamePage = (opts = {}) => bootPage('game.html', opts);

module.exports = { bootPage, bootGamePage, defaultRoster, DEFAULT_GAME, DEFAULT_BRANDING };
