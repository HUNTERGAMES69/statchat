// A message above the field strip clears itself
// =============================================================================
// Reported 4 September 2026: "All plays are now saved to the server" sat above
// the field strip for the rest of the session. showMsg() set innerHTML and
// nothing ever took it down, so every notice it wrote was permanent until the
// page was reloaded.
//
// THE SAME FAULT HAD ALREADY BEEN WORKED AROUND ONCE, which is why this is
// fixed in the lifecycle rather than in the message. The broadcast toggle's
// success message was DELETED, with a comment recording why: "showMsg writes
// into #gameMsg and nothing ever clears it, so 'Now ON AIR: G222' sat at the
// top of the page for the rest of the session". Deleting messages one at a
// time treats each symptom and leaves the next to be found during a game.
//
// THE RULE, matching platform.html:
//
//   success and info time out. They confirm something the scorer just did and
//   watched happen. Once read they are noise -- and noise here is not free,
//   because #gameMsg sits above the field strip and pushes the play panel down.
//
//   errors do NOT. An error is the one thing that might be read after looking
//   away, and a failure that erases its own explanation is worse than no
//   message at all.
//
// Two things below are subtler than the headline and are where this breaks if
// somebody rewrites it:
//
//   A NEW MESSAGE CANCELS THE OLD TIMER. Without that, a success at t=0 and an
//   error at t=1s means the error is wiped when the success's timer fires --
//   the error message would vanish 7 seconds after being shown, which is worse
//   than the bug being fixed.
//
//   A TIMER ONLY CLEARS ITS OWN MESSAGE. #gameMsg is written by more than
//   showMsg: clearing the entry panel empties it directly. A timer that fires
//   after somebody else has written there must leave that alone.
//
//   node tests/message_timeout_check.js

const { bootGamePage } = require('./harness');

let pass = 0, fail = 0;
const chk = (ok, m, detail) => {
  if (ok) { pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (detail ? '\n         ' + detail : '')); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('=== A message above the field strip clears itself ===\n');

  const h = await bootGamePage();
  const { document: doc } = h;
  const text = () => (doc.getElementById('gameMsg').textContent || '').trim();
  const html = () => (doc.getElementById('gameMsg').innerHTML || '').trim();

  // Read from the page rather than hard-coded here: a test carrying its own
  // copy of the number agrees with itself forever and says nothing about the
  // page. Everything below is timed against whatever the page actually uses.
  const LIFE = h.evalIn('typeof MSG_LIFE_MS === "number" ? MSG_LIFE_MS : null');
  chk(typeof LIFE === 'number' && LIFE > 0,
      'the page states how long a message lives', 'MSG_LIFE_MS = ' + LIFE);
  if (typeof LIFE !== 'number'){ h.close(); console.log('\n' + pass + '/' + (pass + fail)); process.exit(1); }
  chk(LIFE >= 4000 && LIFE <= 20000,
      'and it is long enough to read and short enough to go away', LIFE + 'ms');

  const HALF = Math.round(LIFE / 2);
  const PAST = LIFE + 1200;

  // ---- success ------------------------------------------------------------
  h.evalIn("showMsg('gameMsg','All plays are now saved to the server.','success')");
  chk(/All plays are now saved/.test(text()), 'a success message appears');
  await wait(HALF);
  chk(/All plays are now saved/.test(text()),
      'and is still there half way through its life — it is not a flash', text());
  await wait(PAST - HALF);
  chk(text() === '', 'and has cleared itself by the time its life is up', text());

  // ---- info ---------------------------------------------------------------
  h.evalIn("showMsg('gameMsg','Clock set at 12:00 for Neville.','info')");
  await wait(PAST);
  chk(text() === '', 'an info message clears itself too', text());

  // ---- error persists -----------------------------------------------------
  h.evalIn("showMsg('gameMsg','No connection to the server.','error')");
  await wait(PAST);
  chk(/No connection/.test(text()),
      'an error does NOT clear itself — it may be read after looking away', text());

  // ---- a new message cancels the previous timer ---------------------------
  // THE ONE THAT MATTERS MOST. An error written shortly after a success must
  // not inherit the success's countdown.
  h.evalIn("showMsg('gameMsg','Checks passed.','success')");
  await wait(Math.min(1200, HALF));
  h.evalIn("showMsg('gameMsg','Removed here, but failed to remove from the server.','error')");
  await wait(PAST);
  chk(/failed to remove/.test(text()),
      'an error written seconds after a success survives the success’s timer',
      text() || '(empty — the stale timer wiped it)');

  // ---- a timer only clears its own message --------------------------------
  h.evalIn("showMsg('gameMsg','Checks passed.','success')");
  await wait(Math.max(200, LIFE - 1500));
  h.evalIn("document.getElementById('gameMsg').innerHTML = " +
           "'<div class=\"msg error\">written by another path</div>'");
  await wait(2600);
  chk(/written by another path/.test(text()),
      'a timer that fires late leaves a message it did not write alone — ' +
      'clearing the entry panel writes #gameMsg directly', text() || '(empty — it was wiped)');

  // ---- the two targets do not interfere -----------------------------------
  // #errorMsg is the pre-load target. A message on one must not cancel the
  // other's countdown, which a single shared timer would do.
  const err = doc.getElementById('errorMsg');
  if (err){
    h.evalIn("showMsg('gameMsg','Checks passed.','success')");
    h.evalIn("showMsg('errorMsg','No game specified.','error')");
    await wait(PAST);
    chk(text() === '' && /No game specified/.test((err.textContent || '').trim()),
        'the two message areas keep their own timers',
        'gameMsg=' + JSON.stringify(text()) + ' errorMsg=' + JSON.stringify((err.textContent||'').trim()));
  } else {
    chk(false, 'the #errorMsg target exists');
  }

  // ---- the markup is unchanged --------------------------------------------
  // The entry-panel marker is what lets Clear take down a panel message and
  // leave a game notice up. It rides on the same element this now clears.
  h.evalIn("showMsg('gameMsg','Pick a passer.','error',{ entry:true })");
  chk(/msg-entry/.test(html()),
      'the entry marker still rides on the message, so Clear can still tell ' +
      'a panel notice from a game notice', html().slice(0, 80));

  h.close();
  console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
  if (fail) process.exit(1);
})().catch(e => { console.error('THREW ' + (e && e.stack || e)); process.exit(2); });
