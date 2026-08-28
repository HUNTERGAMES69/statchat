// The keypad does not come up over an answer that is already there
// ================================================================
// A touchback prefills the clock from the last value entered, and the pad
// was still opening over it -- one extra dismissal on every touchback, which
// on a kickoff-heavy game is most of them.
//
// TWO HALVES, because the timing is a race. prefillTouchbackClock is
// deferred on setTimeout(0); raiseClockPad fires on requestAnimationFrame
// and retries at 60ms and 250ms. Which of the first two wins is not
// something to rely on, so the raise refuses a field that already has a
// value AND the prefill closes a pad that beat it there.
//
//   node tests/clock_pad_touchback_check.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Clock keypad on a touchback ===\n');

// ---- half one: the raise refuses a filled field ---------------------------
{
  const fn = /function raiseClockPad\(fieldId, rowId\)\{[\s\S]*?\n  \}/.exec(src);
  chk(!!fn, 'raiseClockPad is present');
  if (fn) {
    chk(/if \(fld\.value && fld\.value\.trim\(\)\) return;/.test(fn[0]),
        'and refuses a field that already holds a value — this pad exists to ' +
        'enter a number, and a field with one does not need it');
    const guardAt = fn[0].indexOf('fld.value && fld.value.trim()');
    const openAt = fn[0].indexOf('openPad(fld, fld,');
    chk(guardAt > -1 && openAt > guardAt,
        'checked BEFORE the pad opens, not after');
  }
}

// GUARDED ON THE VALUE, not on the touchback flag. The rule is the same
// however the value got there, and a flag would need setting at every future
// prefill site to keep working.
chk(!/fromTouchback[\s\S]{0,80}return;/.test(src),
    'the guard reads the value rather than a touchback marker, so it holds ' +
    'for any future prefill without being told about it');

// ---- half two: the prefill closes a pad that won the race -----------------
{
  const fn = /function prefillTouchbackClock\(inputId\)\{[\s\S]*?\n\}/.exec(src);
  chk(!!fn, 'prefillTouchbackClock is present');
  if (fn) {
    chk(/padEl && padEl\.style\.display !== 'none' && padTargetId === inputId\) closePad\(\)/.test(fn[0]),
        'and closes the pad if it is already up on this field — the raise is ' +
        'on requestAnimationFrame and this is on setTimeout(0), so either can ' +
        'run first');
    const setAt = fn[0].indexOf('el.value = last.text');
    const closeAt = fn[0].indexOf('closePad()');
    chk(setAt > -1 && closeAt > setAt,
        'after the value is set, so there is something for the pad to be ' +
        'redundant about');
  }
}

// ---- the three callers must still get their pad ---------------------------
// Only the touchback prefill leaves a value behind. If any other caller
// arrived pre-filled, this guard would suppress a pad that IS wanted.
chk(/const cpi = document\.getElementById\('clockPromptInput'\);\s*\n\s*cpi\.value = '';/.test(src),
    'the mid-drive clock prompt clears its field first, so it still opens');
chk(/if \(needsClock\) document\.getElementById\('confirmClockInput'\)\.value = '';/.test(src),
    'the confirm card clears its field on every play, so a NON-touchback ' +
    'still opens');
{
  const decl = /id="setclock_val"[^>]*/.exec(src);
  chk(!!decl && !/\bvalue=/.test(decl[0]),
      'and Set clock builds its field with no value attribute');
}

// ---- behaviour ------------------------------------------------------------
{
  const opens = v => !(v && v.trim());
  chk(opens(''), 'an empty field opens the pad');
  chk(opens('   '), 'and so does one holding only whitespace');
  chk(!opens('8:42'), 'a prefilled clock does not');
  chk(!opens('0:00'),
      'and neither does a legitimate 0:00 — a zero is a value, not an absence');
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
