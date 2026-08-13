// Offline play queue
// ------------------
// When the server cannot be reached, plays are held in localStorage and
// pushed later. It has been confirmed working by hand and had NO
// automated test until 12 August 2026.
//
// WHY THAT MATTERED MORE THAN MOST GAPS: this is the one feature that
// fails SILENTLY. A broken picker is obvious within a play. A broken
// queue looks exactly like a working one — plays appear on screen, the
// game feels normal, and you discover afterwards that a drive is
// missing. Stadium wifi is precisely where it gets exercised, and a
// Friday night is the worst possible time to find out.
//
// It is also the gap the game-export backup does NOT cover: queued plays
// have never reached the database, so they are not in any backup either.
//
// The harness gained `db.failNext` for this. A mock that always succeeds
// cannot test a queue, because the queue only does anything when an
// insert fails.

const { bootGamePage } = require('./harness');
const { enterPlay, setDrive, click } = require('./ui_driver');

const KEY = 'statchat_pending_test-game-1';

function queued(h) {
  const raw = h.window.localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : [];
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });
  const settle = () => new Promise(r => setTimeout(r, 120));

  // --- a play entered offline is kept, not lost -----------------------
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    h.db.failNext = 'offline';
    enterPlay(h, { type: 'rush', carrier: '22', yards: '6' });
    await settle();

    const q = queued(h);
    if (!q.length) {
      fail('capture', 'a play entered while offline was NOT queued — it is ' +
           'simply gone, which is the exact silent-loss failure this ' +
           'feature exists to prevent');
    }
    // It must also still be on screen. A scorer who cannot see the play
    // will enter it again, and then it lands twice.
    const shown = h.evalIn('plays.filter(p => p.effect && p.effect.isStat).length');
    if (Number(shown) < 1) {
      fail('capture', 'the play vanished from the game page while queued');
    }
    h.close();
  }

  // --- it survives a reload -------------------------------------------
  // The realistic disaster: connection drops, the scorer reloads hoping
  // to fix it, and the queue is in memory only.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 30 });
    h.db.failNext = 'offline';
    enterPlay(h, { type: 'rush', carrier: '22', yards: '4' });
    await settle();
    const saved = h.window.localStorage.getItem(KEY);
    h.close();

    if (!saved) {
      fail('reload', 'nothing was written to localStorage, so a reload ' +
           'loses every queued play');
    } else {
      const h2 = await bootGamePage({ seedStorage: { [KEY]: saved } });
      await settle();
      const afterReload = queued(h2);
      if (!afterReload.length && !h2.db.plays.length) {
        fail('reload', 'the queue was neither restored nor drained after ' +
             'a reload — the play is lost');
      }
      h2.close();
    }
  }

  // --- it drains when the server comes back ---------------------------
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 40 });
    h.db.failNext = 2;                       // two failures, then recovery
    enterPlay(h, { type: 'rush', carrier: '22', yards: '5' });
    await settle();
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '11' });
    await settle();

    if (queued(h).length === 0) {
      fail('drain', 'nothing queued while the server was failing');
    }

    h.db.failNext = null;                    // back online
    h.evalIn('drainPendingQueue(true);');
    await new Promise(r => setTimeout(r, 400));

    const left = queued(h);
    if (left.length) {
      fail('drain', left.length + ' play(s) still queued after the server ' +
           'came back: ' + JSON.stringify(left.map(r => r.sequence_number)));
    }
    const landed = h.db.plays.filter(p => p.text).length;
    if (landed < 2) {
      fail('drain', 'expected both plays to reach the server, got ' + landed);
    }
    h.close();
  }

  // --- a duplicate is treated as done, not stuck ----------------------
  // An insert can succeed while the RESPONSE is lost. The retry then hits
  // a unique violation. If that were treated as a failure the queue would
  // never clear and the banner would nag forever.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 35 });
    h.db.failNext = 'offline';
    enterPlay(h, { type: 'rush', carrier: '22', yards: '3' });
    await settle();
    if (!queued(h).length) {
      fail('duplicate', 'setup failed — nothing queued');
    } else {
      h.db.failNext = 'duplicate';
      h.evalIn('drainPendingQueue(true);');
      await new Promise(r => setTimeout(r, 400));
      if (queued(h).length) {
        fail('duplicate', 'a duplicate-key error left the play queued. It ' +
             'already landed; retrying forever is wrong');
      }
    }
    h.close();
  }

  // --- a permanent refusal must not retry forever ---------------------
  // The database refuses play changes on a finalized game. Without this
  // the queue would retry every few seconds for the rest of the session.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 20 });
    h.db.failNext = 'offline';
    enterPlay(h, { type: 'rush', carrier: '22', yards: '7' });
    await settle();
    h.db.failNext = 'final';
    h.evalIn('drainPendingQueue(true);');
    await new Promise(r => setTimeout(r, 400));

    if (queued(h).length) {
      fail('permanent failure', 'a "game is final" refusal left the play ' +
           'queued to retry forever');
    }
    // ...and the scorer must be TOLD, or plays disappear with no
    // explanation, which is worse than the retry loop.
    const msg = h.document.getElementById('gameMsg');
    const text = msg ? msg.textContent : '';
    if (!/final/i.test(text) || !/discard/i.test(text)) {
      fail('permanent failure', 'the discarded plays were not explained to ' +
           'the scorer. Message was: "' + text.slice(0, 90) + '"');
    }
    h.close();
  }

  // --- WAKE FROM SLEEP -------------------------------------------------
  // The realistic case, not an edge case: halftime is twenty minutes, and
  // a scorer who shuts the laptop lid and reopens it for the second half
  // is ordinary behaviour.
  //
  // The `online` event alone does not cover it. Closing a lid does not
  // necessarily change the browser's network state, so on waking there
  // may be no 'online' event at all -- while the websocket has certainly
  // dropped and any queued play is still in localStorage. game.html had
  // NO visibilitychange handler until 12 Aug 2026; view.html did.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    h.db.failNext = 'offline';
    enterPlay(h, { type: 'rush', carrier: '22', yards: '4' });
    await settle();
    if (!queued(h).length) {
      fail('wake', 'setup failed — nothing queued');
    } else {
      // The server is reachable again, and the tab becomes visible.
      h.db.failNext = null;
      Object.defineProperty(h.document, 'hidden', { value: false, configurable: true });
      h.document.dispatchEvent(new h.window.Event('visibilitychange'));
      await new Promise(r => setTimeout(r, 600));

      if (queued(h).length) {
        fail('wake', 'a play was still queued after the tab woke up. A ' +
             'scorer returning for the second half would carry the gap ' +
             'through the rest of the game, and nothing would say so');
      }
      if (!h.db.plays.filter(p => p.text).length) {
        fail('wake', 'nothing reached the server after waking');
      }
    }
    h.close();
  }

  // --- waking with nothing queued must be harmless ---------------------
  // It fires on every tab switch, so it has to be cheap and safe.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '6' });
    await settle();
    const before = Number(h.evalIn('plays.length'));
    Object.defineProperty(h.document, 'hidden', { value: false, configurable: true });
    for (let i = 0; i < 3; i++) {
      h.document.dispatchEvent(new h.window.Event('visibilitychange'));
    }
    await new Promise(r => setTimeout(r, 400));
    const after = Number(h.evalIn('plays.length'));
    if (after !== before) {
      fail('wake', 'switching tabs changed the play count from ' + before +
           ' to ' + after + ' — waking must be idempotent, it fires ' +
           'constantly');
    }
    h.close();
  }

  // --- the connection loss is announced BEFORE a play fails ------------
  // The sync banner only appears once something has already failed to
  // save. This one is proactive, because knowing the connection is gone
  // before you type the next play is worth more than being told after.
  //
  // navigator.onLine alone is not enough -- it reports whether a network
  // INTERFACE exists, not whether anything is reachable. A laptop joined
  // to stadium wifi with a dead uplink reports "online" all night.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    await new Promise(r => setTimeout(r, 400));
    const el = h.document.getElementById('connStatus');
    if (!el) {
      fail('connectivity', 'no connection indicator on the game page');
    } else {
      if (el.style.display !== 'none') {
        fail('connectivity', 'the offline warning is showing while online');
      }
      Object.defineProperty(h.window.navigator, 'onLine',
        { value: false, configurable: true });
      h.window.dispatchEvent(new h.window.Event('offline'));
      await new Promise(r => setTimeout(r, 200));

      if (el.style.display === 'none') {
        fail('connectivity', 'the connection dropped and nothing on screen ' +
             'said so. The scorer keeps entering plays believing they are ' +
             'saving');
      }
      const t = el.textContent;
      if (!/do not refresh/i.test(t)) {
        fail('connectivity', 'the offline warning does not warn against ' +
             'refreshing. The page cannot RELOAD without a network, so a ' +
             'refresh locks the scorer out until the connection returns');
      }
      if (!/nothing is lost/i.test(t) && !/saved on this device/i.test(t)) {
        fail('connectivity', 'the warning does not say the queued plays are ' +
             'safe. A scorer who thinks data is being lost will do something ' +
             'drastic');
      }
    }
    h.close();
  }

  // --- the browser's own guard, armed only when it matters -------------
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    await new Promise(r => setTimeout(r, 300));

    const quiet = new h.window.Event('beforeunload', { cancelable: true });
    h.window.dispatchEvent(quiet);
    if (quiet.defaultPrevented) {
      fail('unload guard', 'the "leave site?" dialog fires with NOTHING ' +
           'queued. Nagging on every navigation teaches people to click ' +
           'through it, which is exactly when it needs to be noticed');
    }

    h.db.failNext = 'offline';
    enterPlay(h, { type: 'rush', carrier: '22', yards: '5' });
    await settle();
    const armed = new h.window.Event('beforeunload', { cancelable: true });
    h.window.dispatchEvent(armed);
    if (!armed.defaultPrevented) {
      fail('unload guard', 'refreshing with unsaved plays queued does NOT ' +
           'prompt. The browser dialog is the only thing standing between a ' +
           'reflexive Ctrl-R and being locked out mid-game');
    }
    h.close();
  }

  // --- GAME-ROW writes retry too -----------------------------------
  // Status, phase, guided state and the final score all live on the game
  // row, and used to fire once and give up. Pressing End game offline
  // left the game showing as finished on screen and still in-progress in
  // the database: the recap would not open, and the season report would
  // exclude it.
  //
  // Handled differently from plays, deliberately. The play queue is a
  // LIST of things that each happened once. The game row is one record's
  // current state, so only the LATEST value matters -- replaying four
  // status changes in order would be re-enacting history rather than
  // catching up. The pending fields are merged and re-sent instead.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '6' });
    await settle();

    h.db.failUpdates = true;
    const before = h.db.updated.filter(u => u.table === 'games').length;
    await h.evalIn('setGameStatus("final", {us:7, opp:0})');
    await settle();

    if (h.db.updated.filter(u => u.table === 'games').length !== before) {
      fail('game row', 'a game-row write appeared to land while the server ' +
           'was refusing updates');
    }
    const held = h.evalIn('pendingGameFields ? Object.keys(pendingGameFields).length : 0');
    if (!Number(held)) {
      fail('game row', 'End game failed and nothing was held for retry. The ' +
           'game would stay in-progress in the database with only a ' +
           'one-line message to explain why');
    }
    const msg = h.document.getElementById('gameMsg');
    if (msg && !/retry/i.test(msg.textContent)) {
      fail('game row', 'the failure message does not say it will retry: "' +
           msg.textContent.slice(0, 70) + '"');
    }

    // Back online, tab wakes.
    h.db.failUpdates = null;
    Object.defineProperty(h.document, 'hidden', { value: false, configurable: true });
    h.document.dispatchEvent(new h.window.Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 600));

    if (Number(h.evalIn('pendingGameFields ? 1 : 0'))) {
      fail('game row', 'game-row fields were still pending after the ' +
           'connection returned');
    }
    const last = h.db.updated.filter(u => u.table === 'games').slice(-1)[0];
    if (!last || last.fields.status !== 'final') {
      fail('game row', 'the retry did not write status=final: ' +
           JSON.stringify(last && last.fields));
    }
    // The score must survive the retry, not just the status.
    if (!last || last.fields.final_score_us !== 7) {
      fail('game row', 'the final score was lost on retry: ' +
           JSON.stringify(last && last.fields));
    }
    h.close();
  }

  // --- the scorer can see there is a problem --------------------------
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 45 });
    h.db.failNext = 'offline';
    enterPlay(h, { type: 'rush', carrier: '22', yards: '2' });
    await settle();
    const body = h.document.body.textContent.replace(/\s+/g, ' ');
    if (!/not yet saved|pending|unsaved|offline/i.test(body)) {
      fail('visibility', 'nothing on the page tells the scorer plays are ' +
           'unsaved. They would keep entering plays believing all is well');
    }
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Offline play queue ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) {
      console.log('  plays survive going offline, a reload, and coming back.');
    }
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
