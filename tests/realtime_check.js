// Realtime sync
// -------------
// The view page subscribes to Postgres Changes so a spectator — and the
// vMix overlay — see plays appear as they are entered. It had NO test
// until 12 August 2026.
//
// WHY IT MATTERS FOR BROADCAST: if this breaks, the view page shows a
// frozen scoreboard. It does not error, it does not blank, it just stops
// changing. On air that is worse than an obvious failure, because nobody
// notices until the score is visibly wrong.
//
// THE DELETE CASE IS THE FRAGILE ONE. Postgres Changes cannot filter
// deletes by game_id server-side, so the page listens to EVERY delete on
// the plays table and checks game_id itself when the event arrives. That
// only works because the migration set REPLICA IDENTITY FULL — without
// it a delete event carries only the row id and `payload.old.game_id` is
// undefined, so the check silently fails and Undo stops propagating.
// Nothing in the app would tell you.
//
// The harness gained realtime recording for this: the old stub swallowed
// every subscription and returned itself, so the page could have been
// listening to the wrong table entirely and no test could tell.

const { bootPage } = require('./harness');

const PLAYS = [
  { id: 1, game_id: 'test-game-1', sequence_number: 1, text: 'rush for 6',
    team_side: 'teamA', quarter: 1, effect: { isStat: true, statYds: 6 },
    roles: { carrier: { team: 'teamA', num: '22', yards: 6 }, playType: 'rush' } }
];

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  const v = await bootPage('view.html', { existingPlays: PLAYS });
  const rt = v.db.realtime;

  // --- it actually subscribed -----------------------------------------
  if (!rt.subscribed.length) {
    fail('subscribe', 'view.html never called .subscribe() — there is no ' +
         'live update at all, and the page would simply sit frozen');
  }
  if (!rt.channels.length) {
    fail('subscribe', 'no channel was opened');
  }

  // --- to the right game ----------------------------------------------
  const chName = (rt.channels[0] || {})._name || '';
  if (chName.indexOf('test-game-1') === -1) {
    fail('subscribe', 'the channel name does not carry the game id ("' +
         chName + '"). Two games open at once would share a channel');
  }

  // --- all three events -----------------------------------------------
  const events = rt.handlers.map(h => (h.cfg || {}).event);
  for (const needed of ['INSERT', 'UPDATE', 'DELETE']) {
    if (!events.includes(needed)) {
      fail('coverage', 'no handler for ' + needed + '. ' +
           (needed === 'DELETE'
             ? 'Undo would stop propagating to the view page and the '
             + 'spectator would keep seeing a play that no longer exists'
             : needed === 'UPDATE'
               ? 'An edited play would not refresh'
               : 'New plays would never appear'));
    }
  }

  // --- INSERT and UPDATE are filtered to this game --------------------
  // Without the filter every game in the database wakes every open view
  // page. It works, but it is a lot of needless reloading.
  for (const ev of ['INSERT', 'UPDATE']) {
    const h = rt.handlers.find(x => (x.cfg || {}).event === ev);
    if (h && !((h.cfg || {}).filter || '').includes('test-game-1')) {
      fail('filter', ev + ' is not filtered to this game, so every game in ' +
           'the database would trigger a reload here');
    }
  }

  // --- DELETE is deliberately NOT filtered ----------------------------
  // Postgres Changes cannot filter deletes server-side. If someone
  // "tidies up" by adding a filter here, deletes stop arriving entirely
  // and Undo silently stops propagating.
  {
    const h = rt.handlers.find(x => (x.cfg || {}).event === 'DELETE');
    if (h && (h.cfg || {}).filter) {
      fail('delete filter', 'the DELETE handler has a server-side filter. ' +
           'Postgres Changes cannot filter deletes — adding one stops the ' +
           'events arriving at all, and Undo would stop propagating with ' +
           'no error anywhere');
    }
  }

  // --- the page reacts when an event arrives --------------------------
  // Everything above checks the wiring. This checks it does something.
  {
    const before = Number(v.evalIn('plays.length'));
    v.db.existingPlays = PLAYS.concat([{
      id: 2, game_id: 'test-game-1', sequence_number: 2, text: 'pass for 14',
      team_side: 'teamA', quarter: 1, effect: { isStat: true, statYds: 14 },
      roles: { passer: { team: 'teamA', num: '7', yards: 14 }, playType: 'pass' }
    }]);
    const fired = rt.emit('INSERT', { new: { game_id: 'test-game-1' } });
    if (!fired) {
      fail('reaction', 'emitting an INSERT fired no handler');
    }
    await new Promise(r => setTimeout(r, 300));
    const after = Number(v.evalIn('plays.length'));
    if (after <= before) {
      fail('reaction', 'an INSERT event did not reload the plays — the page ' +
           'is subscribed but does nothing with what arrives (' +
           before + ' -> ' + after + ')');
    }
  }

  // --- a delete for ANOTHER game must be ignored ----------------------
  // The flip side of listening to every delete on the table.
  {
    const h = rt.handlers.find(x => (x.cfg || {}).event === 'DELETE');
    if (h) {
      let threw = null;
      try {
        h.cb({ old: { id: 99, game_id: 'some-other-game' } });
      } catch (e) { threw = e.message; }
      if (threw) {
        fail('delete guard', 'a delete from another game threw: ' + threw);
      }
      // And one with no game_id at all — what REPLICA IDENTITY FULL being
      // absent would actually look like.
      try {
        h.cb({ old: { id: 99 } });
      } catch (e) {
        fail('delete guard', 'a delete event with no game_id threw: ' +
             e.message + '. That is what a missing REPLICA IDENTITY FULL ' +
             'looks like, and it must not take the page down');
      }
    }
  }

  // --- THE BACKSTOP: a missed event must still self-correct -----------
  // Reported from real use on 12 Aug: undoing a play on the game page
  // did not update the view page until the next play was entered. The
  // delete event was not arriving, despite REPLICA IDENTITY FULL being
  // set and `plays` being in the supabase_realtime publication.
  //
  // Rather than keep chasing the cause, the page now reconciles on a
  // timer. This asserts that behaviour directly: change what the server
  // holds, fire NO event at all, and the page must still catch up.
  //
  // That is the property worth having. Realtime is fiddly -- dropped
  // websockets, throttled tabs, RLS interactions -- and a missed event
  // is invisible: the page looks fine and is wrong.
  {
    const p2 = await bootPage('view.html', { existingPlays: PLAYS.concat([{
      id: 2, game_id: 'test-game-1', sequence_number: 2, text: 'pass for 9',
      team_side: 'teamA', quarter: 1, effect: { isStat: true, statYds: 9 },
      roles: { passer: { team: 'teamA', num: '7', yards: 9 }, playType: 'pass' }
    }]) });
    const before = Number(p2.evalIn('plays.length'));
    p2.db.existingPlays = PLAYS;          // an undo, with no event fired
    await new Promise(r => setTimeout(r, 5200));
    const after = Number(p2.evalIn('plays.length'));
    if (after !== 1) {
      fail('reconciliation', 'a play was removed on the server with no ' +
           'realtime event, and the view page did not catch up: ' +
           before + ' -> ' + after + ' (expected 1). Without this backstop ' +
           'a spectator keeps seeing a play that no longer exists');
    }
    await new Promise(r => setTimeout(r, 200));
    p2.close();
  }

  // Let any reload triggered above finish before tearing the page down.
  // Without this the async reload lands after close(), finds `document`
  // gone, and throws a process-level error AFTER the suite has already
  // printed "Failures: 0" -- a passing test followed by a stack trace.
  await new Promise(r => setTimeout(r, 300));
  v.close();
  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Realtime sync ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) {
      console.log('  the view page subscribes correctly and reacts to events.');
    }
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
