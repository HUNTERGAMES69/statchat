// Bad snap recovered by the defense says "fumble", and the change-of-
// possession clock prompt opens its own keypad
// -----------------------------------------------------------------------
// Both reported directly, 22 Aug 2026, and both apply to game.html and
// gametest3.html.
//
// 1. The log read "Neville — bad snap for no gain, recovered by Ruston".
//    Nothing in that says the ball was on the ground, so a line that is
//    in fact a lost fumble reads like a snap the other team simply ended
//    up with. Every other loose-ball play in the app says "fumble --";
//    this one now matches.
//
// 2. The clock card comes up on its own at a change of possession. The
//    scorer did not choose to go there and there is only one thing it
//    wants, so making them tap the box to raise the keypad is a tap that
//    carries no information -- at the one moment they are also watching
//    the field. Opened explicitly rather than by loosening the generic
//    tap rule, which deliberately opens on CLICK so a pad never appears
//    while tabbing between fields.

const { bootPage } = require('./harness');
const { click, setDrive, typeInto, radio } = require('./ui_driver');

const PAGES = ['game.html', 'gametest3.html'];

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  for (const page of PAGES) {
    // --- 1. Bad snap, defense recovers: the text must say fumble.
    {
      const h = await bootPage(page, {});
      const doc = h.window.document, win = h.window;
      setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
      click(win, doc.getElementById('badSnapUtilBtn'));
      typeInto(win, doc.getElementById('badsnap_yds'), '0');
      radio(win, doc, 'bs_rec', 'd');
      typeInto(win, doc.getElementById('bs_recoverer'), '52');
      typeInto(win, doc.getElementById('bs_spot_yardline'), '25');
      click(win, doc.getElementById('badsnap_review'));
      await new Promise(r => setTimeout(r, 80));
      click(win, doc.getElementById('saveBtn'));
      await new Promise(r => setTimeout(r, 120));
      const text = h.evalIn('plays[plays.length-1].text');
      if (!/fumble/i.test(text)) {
        fail(page + ':bad-snap-fumble', 'a bad snap recovered by the defense must say fumble, got: ' + text);
      }
      if (!/recovered by/i.test(text)) {
        fail(page + ':bad-snap-recovery', 'the recovery must still be named, got: ' + text);
      }
      // The turnover itself must be unaffected by the wording change.
      const eff = JSON.parse(h.evalIn('JSON.stringify(plays[plays.length-1].effect)'));
      if (!eff.flip) fail(page + ':bad-snap-flip', 'a bad snap recovered by the defense must still change hands: ' + JSON.stringify(eff));
      const roles = JSON.parse(h.evalIn('JSON.stringify(plays[plays.length-1].roles || null)'));
      if (!roles || !roles.carrier || roles.carrier.num !== 'TEAM') {
        fail(page + ':bad-snap-team-rush', 'the loss must still be charged as a TEAM rush: ' + JSON.stringify(roles));
      }
      h.close();
    }

    // --- 2. A bad snap the offense keeps is NOT a turnover and must not
    //     have gained the word: only the recovered-by-defense branch
    //     changed.
    {
      const h = await bootPage(page, {});
      const doc = h.window.document, win = h.window;
      setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
      click(win, doc.getElementById('badSnapUtilBtn'));
      typeInto(win, doc.getElementById('badsnap_yds'), '4');
      click(win, doc.getElementById('badsnap_review'));
      await new Promise(r => setTimeout(r, 80));
      click(win, doc.getElementById('saveBtn'));
      await new Promise(r => setTimeout(r, 120));
      const text = h.evalIn('plays[plays.length-1].text');
      if (/fumble/i.test(text)) {
        fail(page + ':own-snap-unchanged', 'a bad snap the offense keeps should read as it always did, got: ' + text);
      }
      h.close();
    }

    // --- 3. The clock prompt raises its keypad with no tap.
    {
      const h = await bootPage(page, {});
      const doc = h.window.document;
      h.evalIn('window.__pads = []; const _op = openPad; openPad = function(t,a,k){ window.__pads.push((t && t.id) + ":" + k); return _op.apply(this, arguments); };');
      h.evalIn("showClockPrompt({ mode:'transition', outgoingTeam:'teamA', incomingTeam:'teamB' }, function(){});");
      await new Promise(r => setTimeout(r, 150));
      if (doc.getElementById('clockPromptCard').style.display !== 'block') {
        fail(page + ':clock-card', 'the clock prompt did not open at a change of possession');
      }
      const pads = JSON.parse(h.evalIn('JSON.stringify(window.__pads)'));
      if (!pads.some(x => /^clockPromptInput:/.test(x))) {
        fail(page + ':clock-keypad', 'the keypad must open on the clock field without a tap, openPad calls: ' + JSON.stringify(pads));
      }
      h.close();
    }
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Bad-snap fumble wording, and clock prompt keypad ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  a bad snap recovered by the defense reads as the fumble it is and still changes hands as a team rush; the change-of-possession clock prompt raises its own keypad -- in both the live page and the prototype.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
