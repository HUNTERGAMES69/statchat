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
const { enterPlay, setDrive, click } = require('./ui_driver');

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
    // BROADCAST is hidden until the role check reveals it, and that check
    // runs during load rather than from a function a test can call. What
    // matters is the VALUE it sets: an inline display beats the
    // stylesheet, so setting 'block' there cost this one button the flex
    // centring the other two keep -- its label sat against the top of a
    // banner-height box. Asserted against the file, since revealing the
    // button by hand here would paper over exactly that.
    {
      const src = require('fs').readFileSync(__dirname + '/../game.html', 'utf8');
      if (/bcFab\.style\.display\s*=\s*'(?!flex')/.test(src)) {
        fail('toprow:broadcast-display', "the role check must reveal BROADCAST as 'flex' -- any other inline display overrides the stylesheet and breaks its centring");
      }
    }
    h.evalIn("var b=document.getElementById('broadcastFab'); if (b) b.style.display='flex';");
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
    // Each label centred inside its own block. A stretched button whose
    // display is not flex puts its text at the top of a banner-height box.
    ['broadcastFab', 'helpFab', 'launchViewLink'].forEach(id => {
      const c = win.getComputedStyle(doc.getElementById(id));
      if (c.display !== 'flex' || c.alignItems !== 'center') {
        fail('toprow:centred', id + ' is not centring its label: display=' + c.display + ' align=' + c.alignItems);
      }
    });
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

  // THE TOP ROW MUST NOT DRIFT WITH SCROLL.
  // ---------------------------------------------------------------------
  // ON AIR and the three links are absolutely positioned in the document
  // and given a top measured from the banner. The banner is
  // position:sticky, so once the page scrolls past it its rect.top
  // freezes at the sticky offset while pageYOffset keeps climbing --
  // rect.top + pageYOffset therefore walked them further down the
  // document on every recompute. Scroll a screen, enter a play that
  // resizes the banner, and they land a screenful low on top of the
  // right-hand panels. Reported from a real game.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    const banner = doc.querySelector('.banner');
    const ta = doc.getElementById('topActions'), air = doc.getElementById('onAirBanner');
    if (!banner || !ta) { fail('drift:missing', 'banner or top row absent'); h.close(); return failures; }
    // Sticky is the precondition for the bug -- if it ever stops being
    // sticky this test is measuring something that cannot happen.
    if (win.getComputedStyle(banner).position !== 'sticky') {
      fail('drift:precondition', 'the banner is no longer sticky; revisit why this test exists');
    }
    Object.defineProperty(win, 'innerWidth', { value: 1600, configurable: true });
    Object.defineProperty(banner, 'offsetTop', { value: 120, configurable: true });
    const at = (scroll) => {
      // A sticky banner pins its rect at the sticky offset once passed.
      banner.getBoundingClientRect = () => ({ top: scroll > 112 ? 8 : 120 - scroll, height: 64, bottom: 0 });
      Object.defineProperty(win, 'pageYOffset', { value: scroll, configurable: true });
      win.dispatchEvent(new win.Event('resize'));
      return { ta: ta.style.top, air: air ? air.style.top : null };
    };
    const base = at(0).ta;
    [200, 600, 1200].forEach(scroll => {
      const got = at(scroll);
      if (got.ta !== base) {
        fail('drift:toprow', 'the top row moved after scrolling ' + scroll + 'px: ' + base + ' -> ' + got.ta);
      }
      if (air && got.air !== base) {
        fail('drift:onair', 'the ON AIR tile moved after scrolling ' + scroll + 'px: ' + base + ' -> ' + got.air);
      }
    });
    h.close();
  }

  // ON AIR IS A TOGGLE, WITH THE DASHBOARD'S WARNINGS.
  // ---------------------------------------------------------------------
  // It was a read-only badge, so a scorer who noticed at kickoff that the
  // game was not on air had to leave the game to fix it. The warnings are
  // the dashboard's word for word -- softening them here would mean the
  // same action carried different protection depending which page you
  // were on, and this is the page you are on while people are watching.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    const el = doc.getElementById('onAirBanner');
    if (!el) { fail('air:missing', 'no ON AIR control'); h.close(); return failures; }

    // OFF AIR: light grey, and it says what pressing it will do.
    if (win.getComputedStyle(el).display === 'none') fail('air:hidden', 'the control should always show');
    if (!el.classList.contains('air-off')) fail('air:offclass', 'off air should carry the off-air class');
    // WHITE WITH A DARK OUTLINE, not light grey. Light grey on a light
    // page is this app's vocabulary for DISABLED, so the button read as a
    // label rather than something to press. Reported directly.
    const off = win.getComputedStyle(el);
    if (off.backgroundColor === 'rgb(232, 232, 230)') {
      fail('air:offgrey', 'the off-air button is back to the grey that read as disabled');
    }
    if (parseFloat(off.borderTopWidth) < 2) {
      fail('air:offborder', 'off air needs its outline to read as a control, got ' + off.borderTopWidth);
    }
    // The red DOT, checked in the stylesheet -- jsdom cannot compute
    // ::before. It is the only red on the control: a solid red fill must
    // keep meaning exactly one thing, which is live.
    {
      const src = require('fs').readFileSync(__dirname + '/../game.html', 'utf8');
      if (!/#onAirBanner\.air-off::before[^}]*background:#b00020/.test(src)) {
        fail('air:offdot', 'the off-air button should carry the red dot that says what it turns on');
      }
      if (/#onAirBanner\.air-off\s*{[^}]*background:#b00020/.test(src)) {
        fail('air:offfill', 'off air must not be filled red -- a red fill means live');
      }
    }
    if (!/SET AS ON AIR/.test(el.textContent)) {
      fail('air:offlabel', 'off air should read SET AS ON AIR, got ' + JSON.stringify(el.textContent.trim()));
    }

    // A game in progress asks twice before going on.
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '6' });
    h.evalIn('window.__asked=[]; window.confirm=(m)=>{window.__asked.push(m.split(String.fromCharCode(10))[0]); return true;};');
    click(win, el);
    await new Promise(r => setTimeout(r, 250));
    const asked = JSON.parse(h.evalIn('JSON.stringify(window.__asked)'));
    if (!asked.some(m => /Put this game ON AIR/.test(m))) fail('air:onconfirm', 'no named confirm: ' + asked.join(' | '));
    if (!asked.some(m => /IN PROGRESS/.test(m))) fail('air:onlive', 'a live game should warn a second time: ' + asked.join(' | '));
    if (el.classList.contains('air-off') || !/ON AIR/.test(el.textContent)) {
      fail('air:onstate', 'it should now read ON AIR, got ' + JSON.stringify(el.textContent.trim()));
    }

    // Taking a LIVE game off needs the word typed -- not a click.
    h.evalIn('window.__asked=[]; window.prompt=()=>"nope";');
    click(win, el);
    await new Promise(r => setTimeout(r, 250));
    if (/SET AS ON AIR/.test(el.textContent)) {
      fail('air:offbywrongword', 'the wrong word should not take a live game off air');
    }
    h.evalIn('window.prompt = () => "off air";');
    click(win, el);
    await new Promise(r => setTimeout(r, 250));
    if (!el.classList.contains('air-off') || !/SET AS ON AIR/.test(el.textContent)) {
      fail('air:offstate', 'typing the word should take it off air, got ' + JSON.stringify(el.textContent.trim()));
    }
    h.close();
  }

  // THE HEADER BLOCK IS ASSEMBLED BELOW 1220, and taken apart again above.
  //
  // #metaRow was deleted on 23 Aug -- it held Timeouts (already in the
  // Live totals tile, on screen the whole time) and Last entered (moved
  // into the Checks tile, where a scorer looks when something needs
  // attention anyway). Dashboard moved up beside ON AIR into #headerLeft.
  // On a landscape iPad the header was three rows deep before any
  // football happened; it is now one.
  // ---------------------------------------------------------------------
  // #onAirBanner is a child of #mainView and #topActions is a child of
  // <body>, written at the FOOT of the file. On desktop both are
  // position:absolute so their source position is invisible -- but below
  // 1220 they drop to static and flow where they are written, which put
  // the Broadcast/Help/Crew view links at the very bottom of the page and
  // gave ON AIR a whole row of its own. On a landscape iPad, about 700px
  // of usable height, neither is affordable.
  //
  // Moved physically rather than with CSS `order`, which only sorts
  // SIBLINGS -- these live in three different parents.
  //
  // (The collapsible rails that used to be tested here were reverted on
  // 23 Aug; see TODO.md. Portrait stacks and is good enough, and the
  // landscape work needs a fresh start.)
  {
    for (const w of [900, 1180, 1600]) {
      const h = await bootGamePage();
      const doc = h.window.document, win = h.window;
      Object.defineProperty(win, 'innerWidth', { value: w, configurable: true });
      win.dispatchEvent(new win.Event('resize'));
      await new Promise(r => setTimeout(r, 200));
      const parentOf = id => {
        const e = doc.getElementById(id);
        return e ? (e.parentElement.id || e.parentElement.tagName) : 'absent';
      };
      if (w <= 1219) {
        if (parentOf('topActions') !== 'headerLeft') {
          fail('header:' + w, 'the action links belong in the header row, found in ' + parentOf('topActions'));
        }
        if (parentOf('onAirBanner') !== 'headerLeft') {
          fail('header:' + w, 'ON AIR should share the header row rather than taking one of its own');
        }
      } else {
        if (parentOf('topActions') === 'headerLeft') {
          fail('header:' + w, 'desktop should keep the action links pinned, not in the header row');
        }
        // ON AIR now lives in #headerLeft in the MARKUP, at every width --
        // it shares the top-left block with Dashboard rather than taking a
        // row of its own. Only #topActions moves in and out.
        if (parentOf('onAirBanner') !== 'headerLeft') {
          fail('header:' + w, 'ON AIR should sit beside Dashboard, found in ' + parentOf('onAirBanner'));
        }
      }
      // NOTHING from the reverted rail work may survive at any width.
      if (doc.querySelectorAll('.rail-strip').length) {
        fail('rails:' + w, 'a rail strip is still being created — the revert is incomplete');
      }
      // The deleted row stays deleted. #topText in particular: it was
      // written to on every render, and a hidden element still being
      // written to looks alive in the source and is not.
      if (doc.getElementById('metaRow')) fail('meta:' + w, '#metaRow should be gone');
      if (doc.getElementById('topText')) fail('meta:' + w, '#topText should be gone');
      // Last entered has to have somewhere to render, or the hint writes
      // into nothing and the scorer silently loses it.
      const lc = doc.getElementById('lastClockText');
      if (!lc) fail('clock:' + w, 'no last-entered element at all');
      else if (!doc.getElementById('validationCard').contains(lc)) {
        fail('clock:' + w, 'last entered should live in the Checks tile');
      }
      h.close();
    }
  }

  // THE RAILS MUST TRACK THE CARD WIDTH.
  // ---------------------------------------------------------------------
  // The rails sit at `50% + half the card + a gutter`. That half used to
  // be written out as a literal 380 in three separate rules, so widening
  // the card meant finding all three and halving by hand -- and missing
  // one would lay a rail over the card. It is now a single variable.
  //
  // Asserted as arithmetic, not as a fixed string: the point is that the
  // two numbers AGREE, not that either has a particular value. Widening
  // the card in future should not fail this test; only decoupling them
  // should.
  {
    const src = require('fs').readFileSync(__dirname + '/../game.html', 'utf8');
    const half = src.match(/--sc-card-half:\s*(\d+)px/);
    const full = src.match(/--sc-card-w:\s*(\d+)px/);
    if (!half || !full) {
      fail('cardw:vars', 'the card width and its half should both be declared as variables');
    } else if (parseInt(full[1], 10) !== parseInt(half[1], 10) * 2) {
      fail('cardw:half', '--sc-card-half must be exactly half of --sc-card-w, got ' +
        half[1] + ' and ' + full[1]);
    }
    // And nothing may still be hardcoding the old half-width.
    const stale = (src.match(/calc\(50% \+ 380px/g) || []).length;
    if (stale) fail('cardw:stale', stale + ' rule(s) still use a literal 380px instead of the variable');

    // The rails resolve against it at desktop width.
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    Object.defineProperty(win, 'innerWidth', { value: 1600, configurable: true });
    win.dispatchEvent(new win.Event('resize'));
    await new Promise(r => setTimeout(r, 200));
    const want = 'calc(50% + ' + (parseInt(half[1], 10) + 18) + 'px)';
    const got = win.getComputedStyle(doc.getElementById('rightRail')).left;
    if (got !== want) {
      fail('cardw:rail', 'the rail should sit at ' + want + ', got ' + got);
    }
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
