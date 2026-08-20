// Punt / field goal outcome-toggle checks
// -----------------------------------------
// Three items reported together, 19 Aug 2026:
//
//   1. On a muffed punt, Touchdown must not be selectable once "recovered
//      by the kicking team" is chosen -- that outcome has no flip and no
//      return in this app's own model, so there is nothing to return for
//      a score. updatePuntTdVisibility already did exactly this for a
//      BLOCKED punt recovered by the kicking team; the identical case for
//      a MUFFED one was simply never checked.
//   2. Muffed and Blocked, on both the punt and field goal panels, must be
//      mutually exclusive. Verified here rather than assumed: both were
//      already correctly wired (clearOther, both directions, both
//      panels) when checked directly -- these tests hold that in place
//      rather than fix anything.
//   3. A field goal's own spot-value bug (return yards entered on a
//      muffed hold silently discarded) is covered in
//      tests/takeover_spot_check.js, alongside the identical, working
//      case for a blocked kick -- not duplicated here.

const { bootGamePage } = require('./harness');
const { click, setDrive } = require('./ui_driver');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1a. Punt, muffed, kicking team recovers (the default radio
  // selection) -- Touchdown must be hidden.
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('punt')");
    click(h.window, h.document.querySelector('.pp_punter_pick'));
    click(h.window, h.document.getElementById('pp_muffed_toggle'));
    if (h.document.getElementById('pp_punt_td_wrap').style.display !== 'none') {
      fail('punt-muff-kicking-td', 'Touchdown is still selectable on a muffed punt with the kicking ' +
        'team recovering -- the same outcome the blocked branch already hides it for');
    }
    h.close();
  }

  // --- 1b. Same punt, switched to receiving team recovers -- Touchdown
  // must reappear, since a real return is now possible.
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('punt')");
    click(h.window, h.document.querySelector('.pp_punter_pick'));
    click(h.window, h.document.getElementById('pp_muffed_toggle'));
    click(h.window, h.document.querySelector('input[name=pp_punt_muffrec][value="r"]'));
    if (h.document.getElementById('pp_punt_td_wrap').style.display === 'none') {
      fail('punt-muff-receiving-td', 'Touchdown stayed hidden once the receiving team was selected to recover');
    }
    h.close();
  }

  // --- 1c. Touchdown checked while receiving team recovers, then
  // switched to kicking team recovers -- must reset, not leak into a
  // submission where it would be meaningless.
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('punt')");
    click(h.window, h.document.querySelector('.pp_punter_pick'));
    click(h.window, h.document.getElementById('pp_muffed_toggle'));
    click(h.window, h.document.querySelector('input[name=pp_punt_muffrec][value="r"]'));
    click(h.window, h.document.getElementById('pp_td_toggle'));
    click(h.window, h.document.querySelector('input[name=pp_punt_muffrec][value="k"]'));
    if (h.document.getElementById('pp_td').checked) {
      fail('punt-muff-td-reset', 'Touchdown stayed checked (hidden) after switching to a kicking-team ' +
        'recovery -- a stale value that could reach a submission it was never meant for');
    }
    h.close();
  }

  // --- 2a. Punt: Blocked and Muffed are mutually exclusive, both
  // directions.
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('punt')");
    click(h.window, h.document.querySelector('.pp_punter_pick'));
    click(h.window, h.document.getElementById('pp_blocked_toggle'));
    if (h.document.getElementById('pp_muffed').checked) fail('punt-mutex', 'checking Blocked left Muffed also checked');
    click(h.window, h.document.getElementById('pp_muffed_toggle'));
    if (h.document.getElementById('pp_blocked').checked) fail('punt-mutex', 'checking Muffed left Blocked also checked');
    h.close();
  }

  // --- 2b. Field goal: Blocked and Muffed hold are mutually exclusive,
  // both directions.
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('fg')");
    click(h.window, h.document.querySelector('.pp_kicker_pick'));
    click(h.window, h.document.getElementById('pp_fg_blocked_cb_toggle'));
    if (h.document.getElementById('pp_fg_muffhold').checked) fail('fg-mutex', 'checking Blocked left Muffed hold also checked');
    click(h.window, h.document.getElementById('pp_fg_muffhold_toggle'));
    if (h.document.getElementById('pp_fg_blocked_cb').checked) fail('fg-mutex', 'checking Muffed hold left Blocked also checked');
    h.close();
  }

  // --- Sanity: the pre-existing Blocked+own-team-recovers case for punt
  // must still hide Touchdown after the fix above.
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('punt')");
    click(h.window, h.document.querySelector('.pp_punter_pick'));
    click(h.window, h.document.getElementById('pp_blocked_toggle'));
    click(h.window, h.document.querySelector('input[name=pp_punt_blockrec][value="own"]'));
    if (h.document.getElementById('pp_punt_td_wrap').style.display !== 'none') {
      fail('punt-block-own-td', 'the pre-existing blocked+own-team case no longer hides Touchdown');
    }
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Punt / field goal outcome-toggle checks ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  Touchdown is hidden exactly when there is nothing to return for one, and Blocked/Muffed stay mutually exclusive on both panels.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
