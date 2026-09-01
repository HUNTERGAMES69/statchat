// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// The starter lineup READERS -- overlay card and XML/JSON feed
// ===========================================================
// tests/broadcast_starters_check.js proves the SETUP SECTION stores every
// man that was typed. This file proves the two things that read the column
// then publish every man that was stored. A lineup that saves correctly and
// draws eight of eleven is the same failure to a production crew.
//
// WHY THIS FILE EXISTS AT ALL, 1 Sep 2026:
// broadcast_starters shipped keyed by POSITION LABEL -- { "DE": {...} } --
// and position labels repeat in a real lineup. The default defensive set is
// DE DT DT DE WLB MLB SLB CB CB FS SS, so DE, DT and CB each overwrote the
// one before. Eleven in, eight out, no warning, eight-man defence on air.
// The column is an ORDERED ARRAY now. Every check below is a COUNT, because
// an assertion that named the eight survivors would have passed against the
// broken build.
//
// Both readers still accept the old object form: a reader that cannot open
// the shape it shipped with is a reader that loses data it was handed.
//
//   node tests/broadcast_starters_readers_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const REPO = path.join(__dirname, '..');

let pass = 0, fail = 0;
const chk = (l, ok, d) => { if (ok) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + (d ? '\n         ' + d : '')); } };

// Eleven men, with DE, DT and CB each appearing twice -- the exact shape
// that used to collapse.
const DEF = [['DE','91'],['DT','55'],['DT','77'],['DE','44'],['WLB','54'],
             ['MLB','52'],['SLB','56'],['CB','4'],['CB','24'],['FS','9'],['SS','31']]
            .map(([pos, num]) => ({ pos, num, name: 'Player ' + num }));
const LEGACY = { offense: { QB: { num:'7', name:'Devin Whitfield' }, RB: { num:'22' } } };

// ---------------------------------------------------------------------
// THE OVERLAY CARD
//
// broadcast_starters.html wraps its script in an IIFE, and its init() bails
// out WITHOUT starting the poll when the first fetch fails -- so a stub
// installed after load never runs. jsdom's beforeParse puts it in before the
// page parses, which means the page is exercised exactly as it ships, with
// no testability seam cut into a broadcast file.
// ---------------------------------------------------------------------
async function paintCard(unit, bs) {
  const html = fs.readFileSync(path.join(REPO, 'broadcast_starters.html'), 'utf8');
  const payload = {
    game: { id:'g1', our_team_is_home:true, home_team_name:'Us',
            away_team_name:'Northgate', broadcast_starters: bs },
    ourBranding: { primary_color:'#ffc72c', secondary_color:'#20180a' }
  };
  const errs = [];
  const dom = new JSDOM(html, {
    url: 'https://statchat.co/broadcast_starters.html?unit=' + unit,
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = () => Promise.resolve({ ok:true, json: () => Promise.resolve(payload) });
      win.addEventListener('error', e => errs.push(String(e.message || e)));
    }
  });
  await new Promise(r => setTimeout(r, 300));
  return { d: dom.window.document, errs, close: () => dom.window.close() };
}
const cellsOf = d => [...d.querySelectorAll('#rows .cell')];
const txt = (c, s) => c.querySelector(s).textContent;

// ---------------------------------------------------------------------
// THE FEED
// ---------------------------------------------------------------------
let GAME = null;
const BASE = { id:'g1', tenant_id:'t1', status:'in_progress', is_broadcast:true,
  our_team_is_home:true, home_team_name:'Us', away_team_name:'Northgate',
  season_year:2026, quarter_length_seconds:720 };

function loadFeed() {
  const Module = require('module');
  const orig = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === '@supabase/supabase-js') {
      const rowsFor = n => n === 'games' ? [GAME]
        : n === 'plays' ? []
        : n === 'game_rosters' ? []
        // The feed authenticates by key before it serves anything, so the
        // tenants row is not optional scaffolding -- without it every
        // assertion below tests a 401.
        : n === 'tenants' ? [{ id:'t1', name:'Neville', subscription:'active' }]
        : [{ primary_color:'#0f4d2e' }];
      const tbl = name => { const b = {
        select(){return b;}, eq(){return b;}, or(){return b;}, is(){return b;},
        order(){return b;}, limit: async () => ({ data: rowsFor(name) }),
        then: r => Promise.resolve({ data: rowsFor(name) }).then(r) }; return b; };
      return { createClient: () => ({ from: n => tbl(n) }) };
    }
    return orig.apply(this, arguments);
  };
  process.env.SUPABASE_URL = 'http://x';
  process.env.SUPABASE_SECRET_KEY = 'k';
  delete process.env.FEED_KEY;
  const p = path.join(REPO, 'api', 'feed.js');
  delete require.cache[require.resolve(p)];
  const h = require(p);
  Module.prototype.require = orig;
  return h;
}
function callFeed(handler, query) {
  return new Promise(resolve => {
    const res = { _h:{}, setHeader(k,v){ this._h[k]=v; },
      status(c){ this.code = c; return this; },
      json(o){ resolve({ code:this.code, body:o }); },
      send(s){ resolve({ code:this.code, body:s }); },
      end(){ resolve({ code:this.code }); } };
    handler({ method:'GET', query, headers:{} }, res);
  });
}
const rowsOf = b => Array.isArray(b) ? b : ((b && b.rows) || []);

(async () => {
  console.log('=== Starter lineup readers ===\n');

  // ---- the card ------------------------------------------------------
  {
    const r = await paintCard('defense', { defense: DEF });
    const cells = cellsOf(r.d);
    chk('eleven saved defenders draw eleven rows on the card',
        cells.length === 11, cells.length + ' rows');
    chk('...with both DEs and both DTs shown, not merged into one',
        cells.filter(c => txt(c,'.pos') === 'DE').length === 2 &&
        cells.filter(c => txt(c,'.pos') === 'DT').length === 2,
        cells.map(c => txt(c,'.pos')).join(' '));
    chk('...reading down in the order they were entered',
        cells.map(c => txt(c,'.num')).join(',') === DEF.map(x => x.num).join(','),
        cells.map(c => txt(c,'.num')).join(','));
    chk('...and the panel is actually on screen',
        r.d.getElementById('panel').style.display === 'block');
    chk('...with no uncaught errors', r.errs.length === 0, JSON.stringify(r.errs));
    r.close();
  }
  {
    const r = await paintCard('offense', LEGACY);
    const cells = cellsOf(r.d);
    chk('a LEGACY position-keyed lineup still draws', cells.length === 2, cells.length + ' rows');
    // Happens when a jersey is shared and nobody picked which player. The
    // number is what a viewer matches to the field, so it goes up anyway.
    chk('...and a number with no name still shows the number',
        !!cells[1] && txt(cells[1],'.num') === '22');
    r.close();
  }
  {
    // Most games will never have a lineup, and this input may sit in a
    // switcher bank all season. It draws nothing rather than an empty frame.
    const r = await paintCard('special', { defense: DEF });
    chk('a unit with nothing entered draws nothing at all',
        r.d.getElementById('panel').style.display === 'none',
        r.d.getElementById('panel').style.display);
    r.close();
    const r2 = await paintCard('offense', null);
    chk('no lineup at all draws nothing, and throws nothing',
        r2.d.getElementById('panel').style.display === 'none' && r2.errs.length === 0,
        JSON.stringify(r2.errs));
    r2.close();
  }

  // ---- the feed ------------------------------------------------------
  {
    GAME = Object.assign({}, BASE, { broadcast_starters: { defense: DEF } });
    const h = loadFeed();
    let r = await callFeed(h, { view:'starters', unit:'defense', format:'json', key:'K' });
    const arr = rowsOf(r.body);
    chk('JSON: the starters view answers 200', r.code === 200 || r.code === undefined, String(r.code));
    chk('JSON: eleven defenders publish as eleven rows', arr.length === 11,
        arr.length + ' rows');
    chk('JSON: both DEs and both DTs are present',
        arr.filter(x => x.position === 'DE').length === 2 &&
        arr.filter(x => x.position === 'DT').length === 2,
        arr.map(x => x.position).join(' '));
    chk('JSON: every number is distinct, none overwritten',
        new Set(arr.map(x => x.number)).size === 11, arr.map(x => x.number).join(','));
    chk('JSON: row order matches the card', 
        arr.map(x => x.number).join(',') === DEF.map(x => x.num).join(','),
        arr.map(x => x.number).join(','));

    r = await callFeed(h, { view:'starters', unit:'defense', format:'xml', key:'K' });
    const xml = String(r.body || '');
    chk('XML: eleven <starter> elements', (xml.match(/<starter/g) || []).length === 11,
        (xml.match(/<starter/g) || []).length + ' elements');
    // vMix binds ATTRIBUTES here, not child elements -- position="DT".
    chk('XML: both DTs are separate elements',
        (xml.match(/position="DT"/g) || []).length === 2,
        (xml.match(/position="[^"]*"/g) || []).join(' '));
    chk('XML: all eleven numbers survive serialisation',
        new Set(xml.match(/number="([^"]*)"/g) || []).size === 11,
        (xml.match(/number="[^"]*"/g) || []).join(' '));
  }
  {
    GAME = Object.assign({}, BASE, { broadcast_starters: LEGACY });
    const r = await callFeed(loadFeed(), { view:'starters', unit:'offense', format:'json', key:'K' });
    chk('a LEGACY position-keyed lineup still publishes', rowsOf(r.body).length === 2,
        JSON.stringify(r.body).slice(0,140));
  }
  {
    GAME = Object.assign({}, BASE, { broadcast_starters: null });
    const r = await callFeed(loadFeed(), { view:'starters', unit:'offense', format:'json', key:'K' });
    chk('no lineup publishes an empty list, not an error', rowsOf(r.body).length === 0,
        JSON.stringify(r.body).slice(0,120));
  }

  console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
  if (fail) console.log('\n' + fail + ' FAILURES');
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
