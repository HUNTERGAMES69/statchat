// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// Every page and file carries a notice
// ====================================
// Copyright attaches automatically the moment code is written, so this
// notice creates nothing. What it does is put anyone who copies the source
// on notice, which matters if the question ever reaches a lawyer.
//
// TWO FORMS, on purpose. Visible pages carry a line at the foot. The three
// transparent broadcast overlays carry only a source comment: those are
// composited live into a picture, and a notice burnt into a broadcast is
// worse than no notice at all.
//
//   node tests/copyright_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Copyright notices ===\n');

// The live overlays. Source comment only.
// broadcast_drive.html added 31 Aug 2026 with the overlay itself. This list
// is the reason the check has to be edited whenever an overlay is added: an
// overlay carries its notice in a source comment, because a visible one would
// be burnt into the picture.
const OVERLAYS = ['broadcast.html', 'broadcast_stats.html', 'broadcast_leaders.html',
                  'broadcast_drive.html'];

const pages = fs.readdirSync(root)
  .filter(f => f.endsWith('.html'))
  .filter(f => !/_?mock/.test(f));

let visible = 0, sourceOnly = 0;
pages.forEach(f => {
  const s = fs.readFileSync(path.join(root, f), 'utf8');
  const hasVisible = /class="sc-copyright"/.test(s) || /&copy; 2026 StatChat/.test(s);
  const hasSource = /Copyright 2026 StatChat/.test(s);
  if (OVERLAYS.includes(f)) {
    chk(hasSource && !hasVisible,
        f + ': source comment only — it is composited live, and a notice ' +
        'burnt into a broadcast cannot be removed');
    sourceOnly++;
  } else if (/legacy/.test(f)) {
    chk(hasSource, f + ': superseded, source comment is enough');
  } else {
    chk(hasVisible, f + ': carries a visible notice');
    visible++;
  }
});

// ---- it must not disturb the page ----------------------------------------
// The brief was "everywhere possible, but it should not interfere with any
// layout, spacing, or usability".
// PAGES WHOSE BODY CENTRES WITH FLEX ARE EXCLUDED, and derived rather than
// listed: view.html was excluded by name and login.html was not, so the
// standard rule was checked against a page that is deliberately different.
// Those pages have their own block below.
['login.html', 'view.html', 'dashboard.html', 'game.html', 'help.html',
 'customize.html', 'platform.html']
  .filter(f => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const bodyRule = (src.match(/body\s*\{[^}]*\}/g) || []).join(' ');
    return !(/display:\s*flex/.test(bodyRule) && /justify-content:\s*center/.test(bodyRule));
  })
  .forEach(f => {
  const s = fs.readFileSync(path.join(root, f), 'utf8');
  const d = new JSDOM(s).window.document;
  const el = d.querySelector('p.sc-copyright');
  if (!el) { chk(false, f + ': no notice element'); return; }

  // OUTSIDE ANY SWITCHABLE VIEW. customize.html taught this: its .wrap was
  // never closed, so the parser adopted the footer into #mainView and it
  // would have vanished whenever that view was hidden.
  chk(!el.closest('[id$=View]'),
      f + ': sits outside any view container, so it cannot be hidden with one');

  const rule = /\.sc-copyright \{[^}]*\}/.exec(s);
  {
    const m = /margin:\s*26px\s+([^;]*);/.exec(rule[0]);
    const parts = m ? m[1].trim().split(/\s+/) : [];
    // margin: top right bottom [left] -- with 26px consumed as top, a third
    // part is the bottom. Two parts (e.g. "auto 0") means bottom mirrors top
    // only if that second value is 0.
    const bottom = parts.length >= 2 ? parts[1] : parts[0];
    chk(!!m && (bottom === '0' || bottom === '0px'),
        f + ': the bottom margin is zero — anything else changes the scroll ' +
        'height of a page that previously ended flush (got "' +
        (m ? m[1].trim() : 'no match') + '")');
  }
  chk(!!rule && /font-size:12px/.test(rule[0]),
      f + ': small enough to read as a colophon rather than as content');
});

// ---- THE NOTICE MUST NOT JOIN A CENTRING FLEX BODY ----------------------
// view.html has `body { display:flex; justify-content:center }` holding one
// child: the 1920x1080 .wrap that gets scaled to the viewport. The notice
// became a SECOND flex item, so the pair was centred together and the whole
// crew view slid left off the edge of the screen. Reported from a live page.
//
// Any page whose body centres with flex needs the notice out of the flow.
fs.readdirSync(root)
  .filter(f => f.endsWith('.html') && !/_?mock/.test(f))
  .forEach(f => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    if (!/class="sc-copyright"/.test(src)) return;
    const bodyRule = (src.match(/body\s*\{[^}]*\}/g) || []).join(' ');
    const centres = /display:\s*flex/.test(bodyRule) &&
                    /justify-content:\s*center/.test(bodyRule);
    if (!centres) return;
    const rule = /\.sc-copyright \{[^}]*\}/.exec(src);
    chk(!!rule && /position:absolute/.test(rule[0]),
        f + ': its body centres with flex, so the notice must be out of the ' +
        'flow — in it, it becomes a second flex item and sits BESIDE the ' +
        'content instead of under it');
  });

// ---- THE CREW VIEW USES THE SHORT FORM ----------------------------------
// The full sentence ran 605px along the foot of the screen and sat directly
// over quadBR, the bottom-right stats panel -- where a long special-teams or
// defensive table reaches on a busy night. This page goes to air, so the
// notice gives way to the numbers: 67px instead of 605.
{
  const v = fs.readFileSync(path.join(root, 'view.html'), 'utf8');
  chk(/<p class="sc-copyright">&copy; 2026 StatChat<\/p>/.test(v),
      'view.html carries the short form only');
  chk(!/Unauthorized copying[\s\S]{0,120}<\/p>/.test(v.slice(v.indexOf('sc-copyright">'))),
      'and not the full sentence, which would overlay a stat tile');
  chk(/white-space:nowrap/.test(/\.sc-copyright \{[^}]*\}/.exec(v)[0]),
      'kept on one line, so it cannot wrap up into the panel above it');
}

// EVERY OTHER PAGE KEEPS THE FULL WORDING. Nothing sits underneath there,
// and the short form on a printed report says less than it should.
['help.html', 'dashboard.html', 'game.html', 'platform.html'].forEach(f => {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  if (!/class="sc-copyright"/.test(src)) return;
  chk(/Unauthorized copying/.test(src),
      f + ': keeps the full wording');
});

// ---- and no undefined colour tokens --------------------------------------
// A var() naming a token the page does not define resolves to the fallback,
// and a light-theme fallback on a dark page is exactly what contrast_check
// exists to catch. It caught this one.
['view.html', 'platform.html', 'game.html', 'dashboard.html'].forEach(f => {
  const s = fs.readFileSync(path.join(root, f), 'utf8');
  const rule = /\.sc-copyright \{[^}]*\}/.exec(s);
  if (!rule) return;
  const tok = /var\(--([a-z-]+)/.exec(rule[0]);
  chk(!tok || new RegExp('--' + tok[1] + '\\s*:').test(s),
      f + ': the notice uses no colour token the page leaves undefined');
});

// ---- documents and shared code -------------------------------------------
['PROJECT_NOTES.md', 'TODO.md', 'HANDOFF.md', 'engine.js', 'statchat.css',
 'team-icon.js'].forEach(f => {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) return;
  chk(/Copyright 2026 StatChat/.test(fs.readFileSync(p, 'utf8')), f + ': carries a notice');
});

{
  const sql = fs.readdirSync(path.join(root, 'sql')).filter(f => f.endsWith('.sql'));
  const missing = sql.filter(f =>
    !/Copyright 2026 StatChat/.test(fs.readFileSync(path.join(root, 'sql', f), 'utf8')));
  chk(missing.length === 0,
      'every SQL file carries one' + (missing.length ? ' — missing: ' + missing.join(', ') : ''));
}

console.log('\n  ' + visible + ' visible, ' + sourceOnly + ' source-only');
console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
