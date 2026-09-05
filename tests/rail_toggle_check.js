// The rail's selected highlight, for buttons that own their own card
// ------------------------------------------------------------------
// Reported 5 September 2026: pressing Roster lit the button, which was
// right; pressing it again collapsed the card and left the button lit,
// which was not.
//
// The cause was two listeners deciding the same thing. The button's own
// handler runs in the target phase and closes the card; the rail's
// delegated handler runs after, in the bubble phase, sweeps every
// highlight off the rail and re-lights the button that was clicked. It
// already knew this could happen — the play types ask __ladderOpen()
// precisely so a second press does not re-light them — but the check was
// `!isPlayType || stillOpen`, so everything that was NOT a play type took
// the shortcut and was treated as permanently open.
//
// The fix makes a button carrying aria-expanded self-describing: its
// highlight is read off the attribute, once, after the sweep. So this
// file asserts BOTH halves of that, because each is a separate bug:
//
//   * a second press turns the highlight off, and
//   * a press somewhere ELSE on the rail does not turn it off while the
//     card is still open — clearActive() sweeps the whole rail, and
//     before the re-assert only the clicked button was ever re-lit.
//
// The ladder's own behaviour is re-checked here too. It is the thing the
// change could most easily have broken, and "the roster button works now"
// is not worth a scorer losing the highlight on Rush.
//
//   node tests/rail_toggle_check.js

const { bootGamePage } = require('./harness');
const { click } = require('./ui_driver');

async function run(){
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  const h = await bootGamePage({});
  const doc = h.document, win = h.window;

  const lit  = id => doc.getElementById(id).classList.contains('rail-active');
  const open = () => !doc.getElementById('rosterCard').classList.contains('hidden');
  const aria = () => doc.getElementById('rosterViewBtn').getAttribute('aria-expanded');

  const rosterBtn = doc.getElementById('rosterViewBtn');
  const rushBtn   = doc.querySelector('#typeRail .ptypeBtn[data-type="rush"]');

  if (!rosterBtn) fail('setup', 'no #rosterViewBtn in the rail');
  if (!rushBtn)   fail('setup', 'no rush button in the rail');

  if (rosterBtn && rushBtn) {
    // --- closed to open -------------------------------------------------
    if (lit('rosterViewBtn')) fail('start', 'the Roster button starts lit');
    if (open())               fail('start', 'the roster card starts open');

    click(win, rosterBtn);
    if (!open())                   fail('open', 'the card did not open');
    if (!lit('rosterViewBtn'))     fail('open', 'the button did not light');
    if (aria() !== 'true')         fail('open', 'aria-expanded is ' + aria() + ', not true');

    // --- open to closed: THE REPORTED BUG -------------------------------
    click(win, rosterBtn);
    if (open())                    fail('close', 'the card did not collapse');
    if (aria() !== 'false')        fail('close', 'aria-expanded is ' + aria() + ', not false');
    if (lit('rosterViewBtn'))
      fail('close', 'the button is STILL lit after the press that closed its ' +
                    'card — this is the reported bug: the rail listener ' +
                    're-added the class the button had just given up');

    // --- a press elsewhere on the rail, card still open ------------------
    click(win, rosterBtn);                 // open it again
    click(win, rushBtn);                   // and go press something else
    if (!open())
      fail('elsewhere', 'pressing Rush closed the roster card — it is not part ' +
                        'of the ladder stage and has no business collapsing with it');
    if (!lit('rosterViewBtn'))
      fail('elsewhere', 'the Roster button went dark while its card was still ' +
                        'open — clearActive() sweeps the whole rail, so the ' +
                        'highlight has to be re-asserted from aria-expanded');
    if (!rushBtn.classList.contains('rail-active'))
      fail('elsewhere', 'the Rush button did not light');

    // Close it so the ladder checks below start from a clean rail.
    click(win, rosterBtn);
    if (lit('rosterViewBtn')) fail('elsewhere', 'the button stayed lit on the closing press');
  }

  // --- THE LADDER IS UNCHANGED ------------------------------------------
  // The rule the fix rewrote is the one the play types depend on. A second
  // press on a play type collapses its tree and must take the highlight
  // with it, exactly as before.
  if (rushBtn) {
    // START FROM A CLOSED LADDER. The block above pressed Rush once to
    // prove the roster highlight survives it, so `currentLadderType` is
    // already 'rush' — and a test that begins by toggling something shut
    // measures the opposite of what it says. Asked, not assumed.
    if (h.evalIn("typeof __ladderOpen === 'function' ? __ladderOpen() : null") === 'rush'){
      click(win, rushBtn);
    }
    click(win, rushBtn);
    if (!rushBtn.classList.contains('rail-active'))
      fail('ladder', 'Rush did not light on the first press');
    click(win, rushBtn);
    if (rushBtn.classList.contains('rail-active'))
      fail('ladder', 'Rush stayed lit after the press that collapsed its tree — ' +
                     'the __ladderOpen() rule was lost in the rewrite');
  }

  // A utility with no card of its own and no aria-expanded still lights,
  // and is still cleared by the next press. Nothing about those changed,
  // and this is the assertion that would catch it if they had.
  {
    const pen = doc.getElementById('penUtilBtn');
    if (pen) {
      click(win, pen);
      if (!pen.classList.contains('rail-active'))
        fail('utility', 'Penalty did not light — a plain utility still highlights');
      if (rushBtn) {
        click(win, rushBtn);
        if (pen.classList.contains('rail-active'))
          fail('utility', 'Penalty stayed lit after another rail press');
      }
    }
  }

  console.log('=== Rail highlight: toggles that own a card ===\n');
  if (!failures.length) {
    console.log('  the Roster button lights when its card opens, goes dark when it\n' +
                '  closes, survives a press elsewhere on the rail while the card is\n' +
                '  still open, and the ladder highlights exactly as it did before.\n');
  } else {
    failures.forEach(f => console.log('  FAIL [' + f.area + '] ' + f.detail));
    console.log('\nFailures: ' + failures.length);
  }
  process.exit(failures.length ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
