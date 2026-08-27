// Play entry is not a phone job
// =============================
// The play panel is a ladder of buttons beside a card that assumes roughly
// 760px of width, worked under time pressure with a live game in front of
// the scorer. On a phone the ladder wraps into a column and the panel falls
// below the fold -- and a mis-tap there is a wrong statistic, not an
// inconvenience.
//
// A NOTICE, NOT A LOCK. This is a judgement about screen width, and a false
// positive on some tablet nobody has tested would strand a scorer mid-game,
// which is far worse than a cramped panel. So it is dismissible, and the
// notice says so.
//
//   node tests/phone_block_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Phone notice on the game page ===\n');

const doc = new JSDOM(src).window.document;
chk(!!doc.getElementById('phoneGate'), 'the warning exists');
chk(!!doc.getElementById('phoneGateGo'), 'and can be dismissed');

// A WARNING, NOT A WALL. First version made this a view that REPLACED the
// app. That is a block: the panel on a phone is bad, not impossible, and a
// scorer who has only a phone in front of them mid-game has to be able to
// work. It is now an overlay over a fully built page.
chk(!/\['loading','errorView','phoneView','mainView'\]/.test(src),
    'it is NOT a view in the loading/error/main rotation — replacing the app ' +
    'would be a block, and this is a warning');
chk(/enterMainView\(\);[\s\S]{0,900}?maybeWarnPhone\(\);/.test(src),
    'the app is built BEFORE the warning goes up, so dismissing it reveals a ' +
    'live page rather than starting a boot sequence');
chk(!doc.getElementById('phoneGate').classList.contains('show'),
    'and it starts hidden, so a laptop never sees a flash of it');

// ---- detection -----------------------------------------------------------
const fn = /function isPhone\(\)\{[\s\S]*?\n  \}/.exec(src);
chk(!!fn, 'isPhone() is defined');
if (fn) {
  const test = (w, h, coarse) => new Function('window',
    fn[0] + '; return isPhone();')({ innerWidth: w, innerHeight: h,
      matchMedia: () => ({ matches: coarse }) });

  chk(test(390, 844, true), 'an iPhone in portrait gets the notice');
  chk(test(844, 390, true),
      'and in LANDSCAPE too — a phone turned sideways is still a phone, ' +
      'unlike the rotate prompt on the report pages, which is portrait-only');
  chk(test(375, 667, true) && test(915, 412, true),
      'small and large phones alike');

  chk(!test(744, 1133, true), 'an iPad mini opens normally');
  chk(!test(1194, 834, true), 'and an iPad Pro in landscape');
  chk(!test(1440, 900, false), 'a laptop opens normally');
  chk(!test(480, 900, false),
      'and so does a NARROW DESKTOP WINDOW — a resized browser is still a ' +
      'desktop, which is why the pointer test is there as well as the width');
  chk(!test(1366, 768, true),
      'a touchscreen laptop opens normally: coarse pointer alone is not a phone');
}

chk(!/navigator\.userAgent/.test(fn ? fn[0] : ''),
    'and none of it reads the user-agent, which is wrong about every device ' +
    'released after it is written');

// ---- dismissal actually works -------------------------------------------
{
  const dom = new JSDOM(src);
  const d2 = dom.window.document, Ev = dom.window.Event;
  const isP = /function isPhone\(\)\{[\s\S]*?\n  \}/.exec(src)[0];
  const warn = /function maybeWarnPhone\(\)\{[\s\S]*?\n  \}/.exec(src)[0];
  const w = { innerWidth: 390, innerHeight: 844, matchMedia: () => ({ matches: true }) };
  new Function('window', 'document',
    isP + warn + '; var phoneOverride = false; maybeWarnPhone();')(w, d2);
  const g = d2.getElementById('phoneGate');
  chk(g.classList.contains('show'), 'on a phone the warning is raised');
  d2.getElementById('phoneGateGo').dispatchEvent(new Ev('click'));
  chk(!g.classList.contains('show'), 'and Continue anyway clears it');
}

// ---- THE GATE MUST ACTUALLY USE IT --------------------------------------
// Everything above tests isPhone() in isolation. Replacing the gate's
// condition with `if (false)` left all of it green: the detection was
// perfect and nothing consulted it.
{
  const warn = /function maybeWarnPhone\(\)\{[\s\S]*?\n  \}/.exec(src);
  chk(!!warn, 'maybeWarnPhone is defined');
  if (warn) {
    chk(/if \(!isPhone\(\) \|\| phoneOverride\) return;/.test(warn[0]),
        'and it consults isPhone() and the override — perfect detection that ' +
        'nothing calls is the mutation that slipped past the first version ' +
        'of this test');
    chk(/classList\.add\('show'\)/.test(warn[0]),
        'and actually raises the notice');
  }
  chk(/maybeWarnPhone\(\);/.test(src.replace(/function maybeWarnPhone[\s\S]*?\n  \}/, '')),
      'and something calls it');
}

// ---- it must not pre-empt a real error -----------------------------------
const gateAt = src.indexOf('maybeWarnPhone();');
const errAt = src.indexOf("showView('errorView')");
chk(gateAt > -1 && errAt > -1 && errAt < gateAt,
    'a genuine error still wins — a scorer told "use a laptop" for a game ' +
    'that does not exist has been sent to the wrong problem');

// ---- the escape hatch does the same thing as the normal path -------------
chk(/function enterMainView\(\)/.test(src),
    'opening the app is one function');
chk(/phoneOverride = true;\s*\n\s*g\.classList\.remove\('show'\);/.test(src),
    'dismissing only hides the notice — there is nothing to start up, so a ' +
    'scorer who taps through quickly cannot half-initialise anything');
chk(!/localStorage|sessionStorage/.test(
      /var phoneOverride[\s\S]{0,400}/.exec(src)[0]),
    'the override lasts for this page view only — the reason for the notice ' +
    'has not changed by the next visit');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
