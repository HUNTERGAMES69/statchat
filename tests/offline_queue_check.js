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
