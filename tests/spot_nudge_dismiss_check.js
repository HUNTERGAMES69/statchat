// The drive-start spot nudge clears on every ladder press
// -------------------------------------------------------
// Reported 31 Aug 2026 with a screenshot: QB kneel opened its panel with the
// "New drive spotted at" card still sitting above it. Two symptoms, one
// cause -- the card overlapped the open panel, and its height sat between
// the rail and the panel, so fitPanel() measured a panel pushed down and
// scrolled to chase it.
//
// The rule was hidden inside the .ptypeBtn click handler, which covers Rush,
// Pass, Kickoff, Punt, Field goal, PAT, 2PT, Fumble and Safety -- and none of
// the NINE utilities beside them on the same ladder. Bad snap, QB kneel,
// Penalty, Timeout, Adjust Down/Distance, Flip possession, Set clock, Quarter
// marker and Start overtime every one of them left it up.
//
// WHY THIS FILE DRIVES EVERY BUTTON rather than asserting on the source:
// the fault was not a wrong rule, it was a right rule attached to nine of
// seventeen buttons. A source-level check would have had to know which nine,
// which is the same knowledge that went missing in the first place. Pressing
// all of them cannot be fooled that way, and a button added later is one line
// in the list below rather than a rule somebody has to remember.
const { bootGamePage } = require('./harness');
const { click, setDrive } = require('./ui_driver');

// Every button on the ladder, in the order a scorer sees them.
const LADDER = [
  ['.ptypeBtn[data-type="rush"]',    'Rush'],
  ['.ptypeBtn[data-type="pass"]',    'Pass'],
  ['#badSnapUtilBtn',                'Bad snap'],
  ['#kneelUtilBtn',                  'QB kneel'],
  ['.ptypeBtn[data-type="kickoff"]', 'Kickoff'],
  ['.ptypeBtn[data-type="punt"]',    'Punt'],
  ['.ptypeBtn[data-type="fg"]',      'Field goal'],
  ['.ptypeBtn[data-type="pat"]',     'PAT'],
  ['.ptypeBtn[data-type="twopt"]',   '2PT'],
  ['#penUtilBtn',                    'Penalty'],
  ['#timeoutUtilBtn',                'Timeout'],
  ['.ptypeBtn[data-type="fumble"]',  'Fumble'],
  ['.ptypeBtn[data-type="safety"]',  'Safety'],
  ['#driveUtilBtn',                  'Adjust Down/Distance'],
  ['#flipBtn',                       'Flip possession'],
  ['#setClockUtilBtn',               'Set clock'],
  ['#quarterUtilBtn',                'Quarter marker'],
];

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  for (const [sel, label] of LADDER) {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 20 });
    // Put the card up the way a change of possession does. Calling
    // showSpotNudge directly rather than engineering a turnover keeps this
    // about the DISMISSAL -- when it appears is findDriveStarts' business
    // and has its own coverage.
    h.evalIn('showSpotNudge()');
    const nudge = () => h.document.getElementById('spotNudge').style.display;
    if (nudge() === 'none') {
      fail(label, 'the fixture could not raise the nudge, so this button was ' +
                  'never actually tested — fix the fixture, not the page');
      h.close();
      continue;
    }
    const el = h.document.querySelector(sel);
    if (!el) { fail(label, 'no such button on the ladder: ' + sel); h.close(); continue; }
    try { click(h.window, el); } catch (e) {
      fail(label, 'clicking it threw: ' + e.message.split('\n')[0].slice(0, 60));
      h.close(); continue;
    }
    await new Promise(r => setTimeout(r, 60));
    if (nudge() !== 'none') {
      fail(label, 'the nudge is STILL SHOWING after pressing it — it overlaps ' +
                  'whatever panel just opened and pushes it down the page');
    }
    h.close();
  }

  // CLEAR IS THE EXCEPTION, and must stay one. Every other control is the
  // scorer doing something, which is the moment "starting the next play
  // accepts this spot" applies. Clear ABANDONS an entry: the pending spot is
  // still the right spot and still needs deciding, so taking the card away
  // would lose something the scorer has not acted on.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 20 });
    h.evalIn('showSpotNudge()');
    const btn = h.document.getElementById('phaseClearBtn');
    if (!btn) {
      fail('Clear', 'no phaseClearBtn — if it was renamed, this exception needs re-pointing');
    } else {
      click(h.window, btn);
      await new Promise(r => setTimeout(r, 60));
      if (h.document.getElementById('spotNudge').style.display === 'none') {
        fail('Clear', 'Clear dismissed the nudge. It abandons an entry rather ' +
                      'than making one, so the pending spot still needs deciding');
      }
    }
    h.close();
  }

  // ONE AUTHORITY. The rule lives on the rail's delegated listener, which
  // fires for every button in it -- so a button added later inherits it. A
  // copy back inside the .ptypeBtn handler would work and would also be the
  // start of the next drift, which is what put nine buttons out of step.
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');
  const ptype = /\.ptypeBtn'\)\.forEach\(b => b\.addEventListener\('click'[\s\S]{0,1400}?\n  \}\)\);/.exec(src);
  // COMMENTS STRIPPED FIRST. The note left behind in that handler explains
  // that the call MOVED, and naming the function in the explanation was
  // enough to trip this check on its own documentation -- the same loose
  // text-matching false positive that has cost this suite three times
  // already. Strip the prose, then look for a real call.
  const codeOnly = ptype ? ptype[0].replace(/\/\/[^\n]*/g, '') : '';
  if (/hideSpotNudge\s*\(/.test(codeOnly)) {
    fail('one authority', 'hideSpotNudge is back inside the .ptypeBtn handler. ' +
         'It belongs on the rail listener only — two copies is how the ' +
         'utilities came to be missed');
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Drive-spot nudge clears on every ladder press ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  all ' + LADDER.length + ' ladder buttons dismiss it; Clear keeps it.');
    }
    process.exitCode = failures.length ? 1 : 0;
  });
}
module.exports = { run };
