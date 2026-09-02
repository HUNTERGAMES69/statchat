// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// vercel.json — one hostname for pages, both for machines
// =======================================================
// statchat.co and www.statchat.co both served the site. Two consequences:
// Google had two hostnames for the same pages (the canonicals pointed at the
// apex, so it coped), and the web-filter vendors rated BOTH -- confirmed
// 2 Sep 2026, when FortiGuard returned Pornography / Suspicious for each.
// One hostname is one thing to index and one thing to defend.
//
// TWO PATHS ARE DELIBERATELY EXCLUDED, and the exclusions are the whole
// reason this file has a test.
//
//   /api/   the overlay and data feeds. vMix and OBS read these DURING A
//           GAME. A crew whose data source points at www would have to
//           follow a 308 mid-broadcast, and not every HTTP client in that
//           chain is guaranteed to. The feeds are not indexed and gain
//           nothing from consolidation, so the risk buys nothing.
//
//   /g/     share links already sent out. Every one of them is on www --
//           the recap page mints them from window.location.origin, and the
//           browser was on www. Redirecting adds a hop for every link-preview
//           scraper that fetches one. recap.html is noindex anyway (see
//           robots.txt), so there is no SEO reason to move them.
//
// Both exclusions cost nothing: neither path is a page anybody indexes or a
// vendor rates.
//
//   node tests/vercel_routing_check.js

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== vercel.json routing ===\n');

let cfg = null;
try {
  cfg = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  chk(true, 'vercel.json is valid JSON');
} catch (e) {
  chk(false, 'vercel.json is valid JSON — ' + e.message);
  console.log('\n1 FAILURES'); process.exit(1);
}

// ---- the share route still exists, untouched ----------------------------
{
  const rw = (cfg.rewrites || []).find(r => r.source === '/g/:token');
  chk(!!rw, 'the /g/:token share rewrite is still there');
  chk(rw && rw.destination === '/api/share?t=:token',
      'and still points at api/share, which builds the link preview');
}

// ---- the www redirect ---------------------------------------------------
const red = (cfg.redirects || [])[0];
chk(!!red, 'there is a redirect rule');
if (red) {
  chk(Array.isArray(red.has) && red.has.some(h => h.type === 'host' && h.value === 'www.statchat.co'),
      'it fires only on the www hostname — not on the apex, which would loop');
  chk(/^https:\/\/statchat\.co\//.test(red.destination),
      'it sends traffic to the apex, absolutely (a relative destination would not change host)');
  chk(red.permanent === true || red.statusCode === 301 || red.statusCode === 308,
      'it is a PERMANENT redirect — a temporary one tells Google to keep both');

  // No stray keys: vercel.json is strict, and a rejected deploy is a dead site.
  const allowed = ['source','destination','permanent','statusCode','has','missing'];
  const stray = Object.keys(red).filter(k => allowed.indexOf(k) === -1);
  chk(stray.length === 0,
      'no unrecognised keys in the redirect' + (stray.length ? ' — found: ' + stray.join(', ') : ''));
}

// ---- what actually redirects, simulated ---------------------------------
// Vercel path-to-regexp: /:path((?!api/|g/).*) means "any path not starting
// api/ or g/". Asserted by behaviour, not by matching the string, so the
// pattern can be rewritten as long as it keeps doing the same thing.
if (red) {
  const inner = /^\/:path\((.*)\)$/.exec(red.source);
  chk(!!inner, 'the source is a path pattern with an inline expression');
  if (inner) {
    const re = new RegExp('^/' + inner[1].replace(/^\(\?!/, '(?!') + '$');
    const wants = [
      ['/',                        true,  'the home page'],
      ['/help.html',               true,  'a guide page'],
      ['/broadcasting.html',       true,  'the broadcast page'],
      ['/sitemap.xml',             true,  'the sitemap'],
      ['/logo.png',                true,  'a static asset'],
      ['/g/d0E1EKk65NJCNwaHz6CGyQ', false, 'a share link ALREADY SENT — must not gain a hop'],
      ['/api/feed',                false, 'the vMix feed — must not redirect mid-broadcast'],
      ['/api/gamedata',            false, 'the overlay data endpoint'],
      ['/api/share',               false, 'the share handler itself'],
    ];
    wants.forEach(([p, expect, why]) => {
      const got = re.test(p);
      chk(got === expect,
          (expect ? 'redirects ' : 'does NOT redirect ') + p + '  — ' + why
          + (got === expect ? '' : '   (got the opposite)'));
    });
  }
}

// ---- the addresses handed to crews must not depend on the hostname ------
// broadcast_setup.html built every feed address from location.origin, so an
// admin who reached that page at www copied www URLs into vMix and mailed
// www URLs to their crew. A feed address goes into a switcher and into
// somebody's inbox and stays there for a season; it should not depend on
// which link the admin clicked. Pinned to the canonical host, which is also
// why the /api/ carve-out above can eventually be retired.
{
  const bs = fs.readFileSync(path.join(root, 'broadcast_setup.html'), 'utf8');
  const m = /const ORIGIN = '([^']+)';/.exec(bs);
  chk(!!m, 'broadcast_setup.html pins ORIGIN to a literal, not location.origin');
  chk(!/const ORIGIN = location\.origin/.test(bs),
      'and does not read it from the browser');

  // It has to be the SAME host the brochure pages call canonical, or the
  // feed sheet points somewhere Google is told is not the real address.
  const idx = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const can = /<link rel="canonical" href="(https:\/\/[^\/"]+)/.exec(idx);
  chk(!!can, 'index.html declares a canonical origin');
  if (m && can) {
    chk(m[1] === can[1],
        'and the two agree — ORIGIN=' + m[1] + '  canonical=' + can[1]);
  }
  // And it must be the apex, or the redirect would send crews in circles.
  if (m && red) {
    chk(red.destination.indexOf(m[1]) === 0,
        'the redirect sends traffic to the same host the feed sheet names');
  }
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
