// The sponsor bar belongs to one tenant, and the server decides
// ==============================================================
// broadcast_stats.html carries a black banner with a sponsor's domain, logo
// and phone number hardcoded into it. It was built during development for
// one school and was shipping to every tenant -- another school's broadcast
// should not be carrying somebody else's sponsor.
//
// WHY THIS IS NOT A URL PARAMETER. The obvious fix is to default it off and
// switch it on with ?sponsor=nettech. That HIDES it rather than restricting
// it: anyone who saw the parameter could put that sponsor on their own
// overlay. api/gamedata.js resolves the tenant FROM THE OVERLAY KEY -- the
// only identity a vMix browser source has -- so that is the one place the
// question can be answered honestly.
//
//   node tests/sponsor_bar_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Sponsor bar is per-tenant and server-decided ===\n');

const overlay = R('broadcast_stats.html');
const api = R('api_gamedata.js');
const mig = R('sql/023_tenant_sponsor_bar.sql');

// ---- the migration -------------------------------------------------------
chk(/add column if not exists sponsor_bar boolean not null default false/.test(mig),
    'the column defaults to FALSE, so a new tenant never inherits another ' +
    "school's sponsor");
chk(/update public\.tenants set sponsor_bar = true where name = 'Neville'/.test(mig),
    'and exactly one tenant is switched on');

// ---- the API decides -----------------------------------------------------
chk(/from\('tenants'\)\.select\('sponsor_bar'\)\.eq\('id', tenantId\)/.test(api),
    'the flag is read for the tenant the KEY resolved to, not one named in ' +
    'the request');
chk(/sponsorBar: !!\(/.test(api),
    'and returned as a real boolean, never undefined');

// ---- the overlay obeys, and fails safe -----------------------------------
chk(!/get\('sponsor'\)/.test(overlay),
    'the ?sponsor URL parameter is gone — it could be typed by anyone');
chk(/document\.body\.classList\.add\('sponsor-none'\)/.test(overlay),
    'the bar starts HIDDEN, so it cannot flash up on a tenant that should ' +
    'never see it while the fetch is in flight');
chk(/d\.sponsorBar !== true/.test(overlay),
    'and only a literal true reveals it');

// ---- run the actual decision ---------------------------------------------
{
  const dom = new JSDOM('<body></body>');
  const doc = dom.window.document;
  const initial = "document.body.classList.add('sponsor-none');";
  const apply = "document.body.classList.toggle('sponsor-none', d.sponsorBar !== true);";
  const decide = (resp) => {
    doc.body.className = '';
    new Function('document', initial)(doc);
    if (resp !== null) new Function('document', 'd', apply)(doc, resp);
    return !doc.body.classList.contains('sponsor-none');
  };
  chk(decide({ sponsorBar: true }) === true,
      'the tenant it belongs to sees the bar');
  chk(decide({ sponsorBar: false }) === false,
      'another tenant does not');
  chk(decide({}) === false,
      'an API that does not send the field reads as OFF — a missing answer ' +
      "must not reveal another school's sponsor");
  chk(decide(null) === false,
      'and a failed request leaves it hidden');
}

// ---- the bar is still only in one place ---------------------------------
for (const f of ['broadcast.html', 'broadcast_leaders.html']) {
  if (!fs.existsSync(path.join(__dirname, '..', f))) continue;
  chk(!/sponsor|nettech/i.test(R(f)),
      f + ' carries no sponsor markup — if the bar spreads, this gate does not ' +
      'travel with it');
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
