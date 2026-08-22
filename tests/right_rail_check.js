// The right-margin rail: live totals and live validation
// -----------------------------------------------------------------------
// Two things a scorer would otherwise leave the entry screen to see, put
// in the viewport space outside the 760px card that .floating-actions has
// always used -- the mirror of the drive dock on the left.
//
// The validation half is the one that earns its place: validateGame() has
// only ever run at finalize time, and an error found in the second
// quarter is a ten-second fix where the same error found after the
// whistle is an unlock and a re-entry.

const { bootGamePage } = require('./harness');
const { enterPlay, setDrive } = require('./ui_driver');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1. Live totals carry both teams and reconcile with the engine.
  {
    const h = await bootGamePage();
    const doc = h.window.document;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '12' });
    await new Promise(r => setTimeout(r, 700));
    const t = doc.getElementById('liveBoxBody').textContent.replace(/\s+/g, '');
    if (!/8rushyds/.test(t)) fail('totals:rush', 'expected 8 rushing yards, got: ' + t);
    if (!/12passyds/.test(t)) fail('totals:pass', 'expected 12 passing yards, got: ' + t);
    if (!/20totalyds/.test(t)) fail('totals:total', 'expected 20 total yards, got: ' + t);
    if (!/timeouts/.test(t)) fail('totals:timeouts', 'expected timeouts, got: ' + t);
    h.close();
  }

  // --- 1b. LEADERS, per team, ranked on YARDS rather than attempts.
  //     The totals say how the game is going; these say who is doing it,
  //     which is the question asked from the booth and the one that
  //     otherwise means opening a report mid-game.
  {
    const h = await bootGamePage();
    const doc = h.window.document;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '12' });
    // More carries, fewer yards -- must NOT lead. #7 is Neville's own
    // quarterback: #30 belongs to the OPPONENT, so using him here put
    // these carries on the other team's sheet and quietly gave that team
    // a leaders block of its own.
    enterPlay(h, { type: 'rush', carrier: '7', yards: '1' });
    enterPlay(h, { type: 'rush', carrier: '7', yards: '1' });
    enterPlay(h, { type: 'rush', carrier: '7', yards: '1' });
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '22' });
    enterPlay(h, { type: 'pass', passer: '7', receiver: '84', yards: '5' });
    await new Promise(r => setTimeout(r, 700));
    const rows = [...doc.querySelectorAll('#liveBoxBody .ld-row')]
      .map(e => e.textContent.replace(/\s+/g, ' ').trim());
    const rush = rows.find(r => /^RUSH/.test(r));
    const pass = rows.find(r => /^PASS/.test(r));
    const rec = rows.find(r => /^REC/.test(r));
    if (!rush || !/20 yds/.test(rush)) fail('leaders:rush', 'expected the 20-yard rusher to lead, got: ' + rush);
    if (rush && /3 att/.test(rush)) fail('leaders:rush-attempts', 'leaders rank on yards, not carries: ' + rush);
    if (!pass || !/2\/2, 27 yds/.test(pass)) fail('leaders:pass', 'expected 2/2 for 27, got: ' + pass);
    if (!rec || !/22 yds/.test(rec)) fail('leaders:rec', 'expected the 22-yard receiver to lead, got: ' + rec);
    // No touchdowns in this drive, so no TD suffix. A trailing "0 TD" on
    // every line would double the width of the busiest column to say
    // nothing, and in a rail this narrow the name is what gets squeezed.
    if (rows.some(r => /TD/.test(r))) fail('leaders:td-noise', 'no touchdowns were scored, so none should be listed: ' + rows.join(' | '));
    // Only one team has done anything, so only one block -- a name
    // against 0 yds reads as a stat when it is not one.
    if (doc.querySelectorAll('#liveBoxBody .ld-block').length !== 1) {
      fail('leaders:empty-team', 'the team with no stats should have no leaders block, blocks: ' +
        doc.querySelectorAll('#liveBoxBody .ld-block').length);
    }
    h.close();
  }

  // --- 1b2. Touchdowns ARE shown once there are any.
  {
    const h = await bootGamePage();
    const doc = h.window.document;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 20 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '20', td: true });
    await new Promise(r => setTimeout(r, 700));
    const rush = [...doc.querySelectorAll('#liveBoxBody .ld-row')]
      .map(e => e.textContent.replace(/\s+/g, ' ').trim()).find(r => /^RUSH/.test(r));
    if (!rush || !/1 TD/.test(rush)) fail('leaders:td', 'expected the touchdown on the rushing leader, got: ' + rush);
    if (!/28 yds/.test(rush || '')) fail('leaders:td-yards', 'yards should still be there beside the TD, got: ' + rush);
    h.close();
  }

  // --- 1b3. Passing leads the block, interceptions thrown are shown, and
  //     each team gets a defence line counted from the PLAY LOG rather
  //     than by summing the per-player bucket -- naming a tackler is
  //     optional, so a sack with nobody credited belongs to the team
  //     total even though it is in nobody's line.
  {
    const h = await bootGamePage();
    const doc = h.window.document;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'pass', passer: '7', receiver: '80', yards: '22' });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    enterPlay(h, { type: 'int', passer: '7', credit: '52', spot: { side: 'own', yardline: 40 } });
    enterPlay(h, { type: 'sack', passer: '30', yards: '7', credit: '45' });
    await new Promise(r => setTimeout(r, 700));
    const rows = [...doc.querySelectorAll('#liveBoxBody .ld-row')]
      .map(e => e.textContent.replace(/\s+/g, ' ').trim());
    if (!/^PASS/.test(rows[0] || '')) fail('leaders:order', 'passing should lead the block, got: ' + rows[0]);
    const pass = rows.find(r => /^PASS/.test(r));
    if (!pass || !/1 INT/.test(pass)) fail('leaders:int', 'an interception thrown should be shown, got: ' + pass);
    const defs = rows.filter(r => /^DEF/.test(r));
    if (defs.length !== 2) fail('leaders:def-both', 'both teams should have a defence line, got ' + defs.length + ': ' + rows.join(' | '));
    if (!defs.some(d => /1 sack/.test(d))) fail('leaders:def-sack', 'the sack is missing from the defence line: ' + defs.join(' | '));
    if (!defs.some(d => /1 TFL/.test(d))) fail('leaders:def-tfl', 'a sack is also a tackle for loss: ' + defs.join(' | '));
    if (!defs.some(d => /1 INT/.test(d))) fail('leaders:def-int', 'the interception is missing from the defence line: ' + defs.join(' | '));
    // EVERY row the same three-part shape, so the figures line up in one
    // column. The defence row was built differently -- its numbers pushed
    // left into the name's slot -- so the one row without a player was
    // also the one whose numbers did not align with the rows above it.
    [...doc.querySelectorAll('#liveBoxBody .ld-row')].forEach(r => {
      const shape = [...r.children].map(c => c.className).join(',');
      if (shape !== 'ld-tag,ld-name,ld-stat') {
        fail('leaders:row-shape', 'a leaders row does not match the others: ' + shape + ' -- ' + r.textContent.trim());
      }
    });
    // BOTH teams have a block here, and should: each has a defence line.
    // A defence can have done something before anyone on that side's
    // offence has -- a three-and-out with a sack in it.
    if (doc.querySelectorAll('#liveBoxBody .ld-block').length !== 2) {
      fail('leaders:both-blocks', 'both teams have defensive stats, so both should have a block');
    }
    h.close();
  }

  // --- 1c. The top row is ONE set of controls, not three sizes. All
  //     three links take the header button's own metrics.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    h.evalIn("document.getElementById('broadcastFab').style.display='inline-block';");
    // Measured against ON AIR, not against the small header pill. All five
    // blocks across the top of the page -- ON AIR, the banner, and these
    // three -- are the same height because they are all sized from the
    // banner; matching the pill left the links floating inside a row that
    // was already the right height.
    h.evalIn("document.getElementById('onAirBanner').style.display='flex';");
    const ref = win.getComputedStyle(doc.getElementById('onAirBanner'));
    ['broadcastFab', 'helpFab', 'launchViewLink'].forEach(id => {
      const c = win.getComputedStyle(doc.getElementById(id));
      if (c.fontSize !== ref.fontSize || c.fontWeight !== ref.fontWeight ||
          c.letterSpacing !== ref.letterSpacing) {
        fail('toprow:uniform', id + ' does not match ON AIR: ' +
          c.fontSize + '/' + c.fontWeight + '/' + c.letterSpacing + ' vs ' +
          ref.fontSize + '/' + ref.fontWeight + '/' + ref.letterSpacing);
      }
      if (!doc.getElementById('topActions').contains(doc.getElementById(id))) {
        fail('toprow:placement', id + ' is not in the top row');
      }
    });
    // Stretched, so they fill the row's height rather than sitting in it.
    if (win.getComputedStyle(doc.getElementById('topActions')).alignItems !== 'stretch') {
      fail('toprow:stretch', 'the links should fill the row height, not be centred inside it');
    }
    // And the row rides the banner's own line, like ON AIR.
    h.evalIn('Object.defineProperty(window,"innerWidth",{value:1600,configurable:true}); document.querySelector(".banner").getBoundingClientRect=()=>({top:24,height:64,bottom:88}); window.__syncAir && window.__syncAir();');
    const ta = doc.getElementById('topActions'), oa = doc.getElementById('onAirBanner');
    if (ta.style.top !== oa.style.top || ta.style.height !== oa.style.height) {
      fail('toprow:level', 'the top row and ON AIR should sit on the same line at the same height: ' +
        ta.style.top + '/' + ta.style.height + ' vs ' + oa.style.top + '/' + oa.style.height);
    }
    h.close();
  }

  // --- 2. A clean game reads clear, and says so rather than sitting empty.
  {
    const h = await bootGamePage();
    const doc = h.window.document;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    await new Promise(r => setTimeout(r, 700));
    if (doc.getElementById('validationCount').textContent !== 'clear') {
      fail('checks:clean', 'a clean game should read clear, got: ' + doc.getElementById('validationCount').textContent);
    }
    if (!doc.getElementById('validationBody').textContent.trim()) {
      fail('checks:clean-body', 'the panel should say nothing is wrong rather than render empty');
    }
    h.close();
  }

  // --- 3. A real fault is surfaced, counted, and flagged red.
  {
    const h = await bootGamePage();
    const doc = h.window.document;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    // A gain past the goal line -- one of the checks validateGame makes.
    h.evalIn("pushAndPersist({ id: nextId++, text: 'N Runningback (Neville) rush for 90 — 2nd & 2', effect: { isStat:true, statYds:90, fieldDelta:90 }, roles:{ carrier:{team:'teamA',num:'22',yards:90}, playType:'rush' }, quarter:1 }); renderAll();");
    await new Promise(r => setTimeout(r, 700));
    const count = doc.getElementById('validationCount');
    if (count.className !== 'vc-bad') fail('checks:flag', 'a game with faults should flag red, got class: ' + count.className);
    const issues = doc.querySelectorAll('#validationBody .v-issue');
    if (!issues.length) fail('checks:issues', 'the impossible gain was not surfaced');
    const txt = doc.getElementById('validationBody').textContent;
    if (!/goal line/.test(txt)) fail('checks:text', 'expected the goal-line check, got: ' + txt.slice(0, 120));
    h.close();
  }

  // --- 4. THROTTLED. validateGame() calls computeState() once per play
  //     over a slice of the log, so it is quadratic; running it inside
  //     renderAll would put a growing pause into play entry, which is the
  //     one thing this page cannot afford.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    h.evalIn('window.__vg = 0; const _v = validateGame; validateGame = function(){ window.__vg++; return _v.apply(this, arguments); };');
    for (let i = 0; i < 3; i++) enterPlay(h, { type: 'rush', carrier: '22', yards: '3' });
    if (h.evalIn('window.__vg') !== 0) {
      fail('checks:throttle', 'validation ran during entry -- it must wait until the page is quiet, calls: ' + h.evalIn('window.__vg'));
    }
    await new Promise(r => setTimeout(r, 700));
    if (h.evalIn('window.__vg') !== 1) {
      fail('checks:throttle-once', 'three plays should collapse into one validation run, got: ' + h.evalIn('window.__vg'));
    }
    h.close();
  }

  // --- 5. Broadcast health inside the ON AIR tile. What matters for a
  //     feed is not that the game is flagged for broadcast -- the red
  //     block says that -- but whether what the overlay reads is CURRENT.
  {
    const h = await bootGamePage();
    const doc = h.window.document;
    h.evalIn("document.getElementById('onAirBanner').style.display='flex'; renderAirHealth();");
    if (!/feed current/.test(doc.getElementById('onAirBanner').textContent)) {
      fail('air:current', 'expected a healthy feed line, got: ' + doc.getElementById('onAirBanner').textContent);
    }
    h.evalIn("pendingQueue.push({sequence_number:99}); renderAirHealth();");
    const t = doc.getElementById('onAirBanner').textContent;
    if (!/1 play unsent/.test(t)) fail('air:unsent', 'unsent plays mean the feed is behind the field and should say so, got: ' + t);
    if (!/ON AIR/.test(t)) fail('air:label', 'the ON AIR label must survive, got: ' + t);
    h.close();
  }

  // --- 6. THE TOP ROW. BROADCAST and HELP were pinned bottom-right and
  //     CREW VIEW top-right: three links away from the entry screen, in
  //     two corners, at two sizes. They now share one row, one gap and
  //     one shape, on the banner's own line.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    const ta = doc.getElementById('topActions');
    if (!ta) { fail('toprow:missing', 'the top action row is gone'); h.close(); return failures; }
    const ids = [...ta.children].map(c => c.id);
    ['broadcastFab', 'helpFab', 'launchViewLink'].forEach(id => {
      if (ids.indexOf(id) === -1) fail('toprow:member', id + ' is not in the top row');
    });
    // Uniform: one rule for all three, so a later inline style on any one
    // of them shows up here rather than as a row that looks slightly off.
    const boxes = [...ta.children].map(c => {
      const cs = win.getComputedStyle(c);
      return cs.padding + '|' + cs.fontSize + '|' + cs.borderRadius;
    });
    if (new Set(boxes).size !== 1) {
      fail('topow:uniform', 'the three links should be identically sized: ' + boxes.join(' , '));
    }
    // Level with the ON AIR tile, both measured from the banner rather
    // than pinned at a fixed inset that only matches by luck.
    h.evalIn("Object.defineProperty(window,'innerWidth',{value:1500,configurable:true}); window.pageYOffset=0; document.querySelector('.banner').getBoundingClientRect=()=>({top:30,height:56,bottom:86}); window.__syncAir();");
    const air = doc.getElementById('onAirBanner');
    if (ta.style.top !== air.style.top || ta.style.height !== air.style.height) {
      fail('topow:aligned', 'the top row and the ON AIR tile should sit on the same line: ' +
        ta.style.top + '/' + ta.style.height + ' vs ' + air.style.top + '/' + air.style.height);
    }
    h.close();
  }

  // --- 1d. Team logos sit ABOVE the name in the live totals. The mark is
  //     what the eye lands on; the name confirms it.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '8' });
    h.evalIn("TEAMS.teamA.logo='https://example.test/a.png'; TEAMS.teamB.logo='https://example.test/b.png'; renderAll();");
    await new Promise(r => setTimeout(r, 700));
    const wraps = [...doc.querySelectorAll('#liveBoxBody .lb-teamwrap')];
    if (wraps.length !== 2) fail('logo:wrappers', 'expected exactly two logo headings -- the totals only -- got ' + wraps.length);
    // NOT in the leaders block. The crest is already at the top of the
    // panel; repeating it a few rows down labels the same two teams twice
    // and costs space in the section with the most to say.
    if (doc.querySelectorAll('#liveBoxBody .ld-block .lb-logo').length) {
      fail('logo:leaders', 'the leaders headings should carry the name only, not a second copy of the crest');
    }
    wraps.forEach(w => {
      const img = w.querySelector('.lb-logo');
      if (!img) { fail('logo:missing', 'a team heading has no logo when one is set'); return; }
      // ABOVE, not beside: the image must precede the label in the DOM and
      // the wrapper must stack.
      if (w.firstElementChild !== img) fail('logo:order', 'the logo should come before the name');
      if (win.getComputedStyle(w).flexDirection !== 'column') fail('logo:stack', 'the heading should stack, not sit in a row');
    });

    // A team with no logo -- the opponent, usually, early in a season --
    // must still read as a complete heading rather than a caption with a
    // missing picture.
    h.evalIn("TEAMS.teamB.logo = null; renderAll();");
    await new Promise(r => setTimeout(r, 700));
    const labels = [...doc.querySelectorAll('#liveBoxBody .lb-team')].map(e => e.textContent);
    if (!labels.some(l => /TEST OPP/.test(l))) fail('logo:fallback', 'the name must survive when there is no logo: ' + labels.join(' | '));
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Right rail: live totals and validation ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  both teams\' totals reconcile with the engine, validation runs live but only once the page is quiet, and the ON AIR tile reports whether the feed is current.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
