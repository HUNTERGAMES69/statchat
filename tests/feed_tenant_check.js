// The three overlay endpoints must be scoped by feed key — HAZARD 2
// =================================================================
// feed.js, gamedata.js and seasondata.js read with SUPABASE_SECRET_KEY.
// That is the service role, and 000_baseline.sql creates it with
// BYPASSRLS — so the policies added in 009 are NEVER CONSULTED here.
// 009 secured the whole application except these files.
//
// Two of them had NO AUTHENTICATION AT ALL before 24 Aug 2026:
// gamedata.js served the on-air game to anyone with the URL, and
// seasondata.js served a whole season. With one school that was a known
// position. With two it is a cross-tenant leak with nothing behind it.
//
// The key IS the tenant, so there is no request in which the key names
// one school and a tenant parameter names another.
//
// ONE MUTATION HERE IS UNCATCHABLE and that is not a gap: removing the
// `if (!key)` guard in _tenant.js changes no behaviour, because an empty
// key then fails the lookup and returns the same 401. The guard exists to
// avoid a pointless database round trip, not to change an answer.
//
//   node tests/feed_tenant_check.js

const Module = require('module'), path = require('path');
const API = path.join(__dirname, '..', 'api');

const T_A = 'tenant-neville', T_B = 'tenant-riverside';
const TENANTS = { 'key-neville': T_A, 'key-riverside': T_B };
const GAMES = [
  { id:'g-a1', tenant_id:T_A, is_broadcast:true,  season_year:2026, status:'final',
    designator:'2026-W1', home_team_name:'Neville', away_team_name:'X', our_team_is_home:true },
  { id:'g-b1', tenant_id:T_B, is_broadcast:true,  season_year:2026, status:'final',
    designator:'2026-W1', home_team_name:'Riverside', away_team_name:'Y', our_team_is_home:true },
];
const TEAMS = [
  { tenant_id:T_A, primary_color:'#ffc72c', secondary_color:'#000', logo_url:null, is_our_team:true },
  { tenant_id:T_B, primary_color:'#1f4f8f', secondary_color:'#fff', logo_url:null, is_our_team:true },
];

function makeDb(){
  const filt = (rows, f) => rows.filter(r => f.every(([c,v]) => r[c] === v));
  const q = (rows) => {
    const f = [];
    const api = {
      select(){ return api; },
      eq(c,v){ f.push([c,v]); return api; },
      in(){ return api; },
      order(){ return api; },
      limit(){ return Promise.resolve({ data: filt(rows,f) }).then(x=>x); },
      then(res){ return Promise.resolve({ data: filt(rows,f), error:null }).then(res); }
    };
    return api;
  };
  return { from(t){
    if (t==='tenants') return {
      select(){ return { eq:(c,v)=>({ limit: async () => ({
        data: TENANTS[v] ? [{ id:TENANTS[v], name:TENANTS[v], subscription:'active' }] : [] }) }) }; } };
    if (t==='games') return q(GAMES);
    if (t==='teams') return q(TEAMS);
    return q([]);
  } };
}
function load(name){
  const real = Module._resolveFilename;
  Module._resolveFilename = function(r,...a){
    if (r === '@supabase/supabase-js') return '@supabase/supabase-js';
    return real.call(this,r,...a); };
  const db = makeDb();
  require.cache['@supabase/supabase-js'] = { id:'@supabase/supabase-js', loaded:true,
    exports:{ createClient: () => db } };
  delete require.cache[require.resolve(path.join(API,'_tenant.js'))];
  delete require.cache[require.resolve(path.join(API,name))];
  const h = require(path.join(API,name));
  Module._resolveFilename = real;
  return h;
}
function res(){ const r={code:null,body:null,headers:{}};
  r.setHeader=(k,v)=>{r.headers[k]=v;}; r.status=c=>{r.code=c;return r;};
  r.json=b=>{r.body=b;return r;}; r.send=b=>{r.body=b;return r;}; r.end=b=>{if(b)r.body=b;return r;};
  return r; }

let fails=0; const chk=(o,m)=>{console.log((o?'  ok   ':'  FAIL ')+m); if(!o)fails++;};

(async()=>{
  process.env.SUPABASE_URL='https://x'; process.env.SUPABASE_SECRET_KEY='k';
  delete process.env.FEED_KEY;   // retired; must not resurrect the old path

  for (const [file, mkReq] of [
    ['feed.js',       k => ({ method:'GET', query:{ view:'score', format:'json', key:k } })],
    ['gamedata.js',   k => ({ method:'GET', query:{ key:k } })],
    ['seasondata.js', k => ({ method:'GET', query:{ season:'2026', key:k } })],
  ]) {
    const h = load(file);
    let r = res(); await h(mkReq(undefined), r);
    chk(r.code === 401, file + ': NO key is refused (' + r.code + ')');
    r = res(); await h(mkReq('not-a-real-key'), r);
    chk(r.code === 401, file + ': a WRONG key is refused (' + r.code + ')');
    r = res(); await h(mkReq(''), r);
    chk(r.code === 401, file + ': an EMPTY key is refused (' + r.code + ')');
    r = res(); await h(mkReq('key-neville'), r);
    chk(r.code === 200, file + ': a valid key is served (' + r.code + ')');
  }

  // THE ONE THAT MATTERS: two schools on air at once, each key gets its own.
  const feed = load('feed.js');
  let r = res();
  await feed({ method:'GET', query:{ view:'score', format:'json', key:'key-neville' } }, r);
  const a = JSON.stringify(r.body || '');
  r = res();
  await feed({ method:'GET', query:{ view:'score', format:'json', key:'key-riverside' } }, r);
  const b = JSON.stringify(r.body || '');
  chk(/Neville/.test(a) && !/Riverside/.test(a), "Neville's key serves Neville's game only");
  chk(/Riverside/.test(b) && !/Neville/.test(b), "Riverside's key serves Riverside's game only");

  // SEASONDATA MUST BE CHECKED ON ITS CONTENTS, not its status code.
  // A mutation removing its tenant filter passed a version of this file
  // that only asserted 200 — the third time today that "it was refused"
  // was checked without checking WHY, or "it succeeded" without checking
  // WHAT. A whole season of another school's data returns 200 quite
  // happily.
  const sd = load('seasondata.js');
  r = res();
  await sd({ method:'GET', query:{ season:'2026', key:'key-neville' } }, r);
  const sa = JSON.stringify(r.body || '');
  chk(/Neville/.test(sa) && !/Riverside/.test(sa),
      "seasondata: Neville's key returns only Neville's season");
  r = res();
  await sd({ method:'GET', query:{ season:'2026', key:'key-riverside' } }, r);
  const sb = JSON.stringify(r.body || '');
  chk(/Riverside/.test(sb) && !/Neville/.test(sb),
      "seasondata: Riverside's key returns only Riverside's season");

  // gamedata takes ?id= — a caller must not be able to name another school's game.
  const gd = load('gamedata.js');
  r = res();
  await gd({ method:'GET', query:{ key:'key-neville', id:'g-b1' } }, r);
  const leaked = /Riverside/.test(JSON.stringify(r.body || ''));
  chk(!leaked, "gamedata: Neville's key cannot fetch Riverside's game by id");

  console.log(fails?'\n'+fails+' FAILURES':'\nALL PASS'); process.exit(fails?1:0);
})();
