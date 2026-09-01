// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// The SEO foundation, asserted rather than eyeballed
// =================================================
// Every failure this file guards against is SILENT. A noindex on the wrong
// page, a canonical naming the Vercel domain, a Disallow one character too
// short — none of them show up on screen, in a console, or in a build. They
// show up as traffic that never arrives, months later.
//
// EIGHT PUBLIC PAGES: the brochure, the four split pages, and the three guides.
// Everything else in this repo is behind a login or composited into a live
// picture, and carries noindex plus a Disallow. Adding a public page means
// adding it to PUBLIC here, to the sitemap, and to the brochure's links —
// this file fails until all three are done, which is the point.
//
//   node tests/seo_check.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const chk = (l, ok, det) => { if (ok) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + (det ? '\n         ' + det : '')); } };

console.log('=== SEO foundation ===\n');

const PUBLIC = ['index.html', 'broadcasting.html', 'stats.html', 'pricing.html',
                'compare.html', 'help.html', 'tips.html', 'vmix.html'];
const all = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));

// ---- exactly five pages are indexable --------------------------------
const indexable = all.filter(f => !/name="robots"/.test(read(f)));
chk('exactly the eight public pages are indexable',
    indexable.length === PUBLIC.length && PUBLIC.every(p => indexable.includes(p)),
    JSON.stringify(indexable));
// THE PREMISE. "Five" is only a filter if there are many more files than
// that; in a repo of five pages this check would assert nothing.
chk('...out of a repo with many more pages than that', all.length > 20,
    all.length + ' html files');

// ---- canonicals ------------------------------------------------------
PUBLIC.forEach(f => {
  const m = read(f).match(/<link rel="canonical" href="([^"]+)"/);
  chk(f + ' has a canonical on statchat.co',
      !!m && /^https:\/\/statchat\.co\//.test(m[1]), m ? m[1] : 'none');
});
// Vercel serves the site on its own hostname too. A canonical pointing there
// hands the ranking to a domain nobody typed.
chk('no canonical anywhere points at the Vercel domain',
    !PUBLIC.some(f => /canonical[^>]*vercel\.app/.test(read(f))));

// ---- titles and descriptions ----------------------------------------
// Lengths are what a result actually shows: past roughly 60 and 160
// characters the rest is a truncation, not a sentence.
const titles = {};
PUBLIC.forEach(f => {
  const s = read(f);
  const t = (s.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  const d = (s.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  titles[f] = t;
  chk(f + ' has a title of a usable length', t.length >= 20 && t.length <= 65,
      t.length + ': ' + t);
  chk(f + ' has a description of a usable length', d.length >= 70 && d.length <= 160,
      d.length + ': ' + d);
});
// Two pages with the same title compete with each other for the same search.
chk('no two public pages share a title',
    new Set(Object.values(titles)).size === PUBLIC.length,
    JSON.stringify(titles));

// ---- the brochure links to every other public page -------------------
// A page nothing links to is a page a crawler cannot reach, whatever the
// sitemap says.
const home = read('index.html');
PUBLIC.filter(f => f !== 'index.html').forEach(f =>
  chk('the brochure links to ' + f, new RegExp('href="' + f + '"').test(home)));

// ---- robots.txt ------------------------------------------------------
const robots = read('robots.txt');
chk('robots.txt names the sitemap', /^Sitemap: https:\/\/statchat\.co\/sitemap\.xml$/m.test(robots));
chk('robots.txt does not disallow any public page',
    !PUBLIC.some(f => new RegExp('^Disallow: /' + f + '$', 'm').test(robots)));
['game.html', 'dashboard.html', 'platform.html', 'login.html'].forEach(p =>
  chk('robots.txt disallows /' + p, new RegExp('^Disallow: /' + p + '$', 'm').test(robots)));
chk('robots.txt disallows the api', /^Disallow: \/api\/$/m.test(robots));

// ---- THE PREFIX TRAP -------------------------------------------------
// robots.txt paths are PREFIX matches, and this repo has /broadcast.html
// (an overlay, correctly disallowed) sitting one character away from
// /broadcasting.html (the marketing page, which must be crawled). Written
// as "/broadcast" instead of "/broadcast.html", that one rule would
// deindex the new page and nothing would say so. This walks the real
// Disallow lines rather than trusting nobody ever widens one.
const disallows = [...robots.matchAll(/^Disallow: (\S+)$/gm)].map(m => m[1]);
const blockedBy = (url) => disallows.filter(d => {
  if (d.indexOf('*') === -1) return url.indexOf(d) === 0;
  const rx = new RegExp('^' + d.split('*')
    .map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'));
  return rx.test(url);
});
PUBLIC.forEach(f => chk('robots.txt does not block /' + f,
    blockedBy('/' + f).length === 0, JSON.stringify(blockedBy('/' + f))));
chk('...while still blocking the /broadcast.html overlay beside it',
    blockedBy('/broadcast.html').length > 0);
chk('...and the other overlays', ['/broadcast_drive.html', '/broadcast_leaders.html',
    '/broadcast_stats.html', '/broadcast_setup.html'].every(u => blockedBy(u).length > 0));

// ---- THE SHARE CARD --------------------------------------------------
// og:image was logo.png, a 512x512 square, on every page that had one. The
// platforms crop to 1.91:1, so a square is letterboxed or cut through the
// middle and some scrapers drop it entirely. Worse, recap.html and its mock
// pointed at https://nevillestatchat.vercel.app/logo.png -- one tenant's
// deployment serving the preview image for every other tenant's shared game
// recap, and a dead card for all of them the day that deployment moves.
// Both are asserted here because neither shows on the page itself: you find
// out when somebody posts a link and it looks broken.
const OG = 'https://statchat.co/og-image.png';
const withOg = all.filter(f => /<meta property="og:image"/.test(read(f)));
withOg.forEach(f => {
  const img = (read(f).match(/<meta property="og:image" content="([^"]*)"/) || [])[1];
  chk(f + ' points og:image at the shared card on statchat.co', img === OG, img);
  const tw = (read(f).match(/<meta name="twitter:image" content="([^"]*)"/) || [])[1];
  if (tw) chk('  ...and twitter:image with it', tw === OG, tw);
});
// NO TENANT DOMAIN ANYWHERE IN A SOCIAL TAG. Stated as its own check so a
// new page copied from an old one cannot reintroduce it quietly.
const leaks = all.filter(f =>
  (read(f).match(/<meta (?:property="og:|name="twitter:)[^>]*>/g) || [])
    .some(t => /vercel\.app/.test(t)));
chk('no og: or twitter: tag anywhere names a tenant Vercel domain',
    leaks.length === 0, JSON.stringify(leaks));

// The file has to exist, and be the shape the platforms crop to.
chk('og-image.png exists in the repo', fs.existsSync(path.join(ROOT, 'og-image.png')));
if (fs.existsSync(path.join(ROOT, 'og-image.png'))) {
  // PNG header: width and height are big-endian uint32 at bytes 16 and 20.
  const buf = fs.readFileSync(path.join(ROOT, 'og-image.png'));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  chk('og-image.png is 1200x630, the 1.91:1 the platforms crop to',
      w === 1200 && h === 630, w + 'x' + h);
  // Twitter drops images over 5MB; Facebook is slower above about 1MB.
  chk('og-image.png is small enough to be fetched quickly',
      buf.length < 1024 * 1024, Math.round(buf.length / 1024) + ' KB');
}

// ---- SHAREABLE PAGES MUST STAY CRAWLABLE -----------------------------
// A page carrying Open Graph tags was built to be posted somewhere: the
// game recap is the public link a school sends to local media. Facebook's
// and Twitter's preview crawlers honor robots.txt, so a Disallow on such a
// page does not hide it from people -- it stops the preview card being
// built, and the link renders as a bare URL on the school's own page.
// Nothing on screen says so, which is why this is asserted rather than
// remembered. Keeping it out of SEARCH is the noindex meta tag's job, and
// that tag only works if the crawler is let in to read it.
// Mocks excluded: a prototype has no sharing role. The mock files were
// deleted on 1 Sep 2026 so this currently excludes nothing, and it stays
// because the exclusion is the rule, not a workaround for one old file.
const shareable = all.filter(f => !/_?mock/.test(f) &&
  /<meta property="og:title"/.test(read(f)));
chk('some page carries Open Graph tags, so this check is testing something',
    shareable.length > 0, JSON.stringify(shareable));
shareable.forEach(f => {
  chk(f + ' carries og: tags, so robots.txt must not block its preview crawl',
      blockedBy('/' + f).length === 0, JSON.stringify(blockedBy('/' + f)));
  // Shareable is not the same as indexable. Everything outside PUBLIC still
  // has to carry noindex, or a recap turns up in search for a player name.
  if (!PUBLIC.includes(f))
    chk('  ...and it still carries noindex, so it stays out of search',
        /name="robots" content="noindex/.test(read(f)));
});

// ---- sitemap ---------------------------------------------------------
const sm = read('sitemap.xml');
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
chk('the sitemap lists the eight public pages and nothing else',
    locs.length === PUBLIC.length && locs.includes('https://statchat.co/') &&
    PUBLIC.filter(f => f !== 'index.html')
      .every(f => locs.includes('https://statchat.co/' + f)),
    JSON.stringify(locs));
chk('every sitemap URL is on statchat.co',
    locs.every(l => l.indexOf('https://statchat.co/') === 0), JSON.stringify(locs));
// XML forbids a double hyphen inside a comment. This file did not parse the
// first time it was written, for exactly that reason.
chk('no double hyphen inside a sitemap comment',
    !(sm.match(/<!--[\s\S]*?-->/g) || []).some(c => c.slice(4, -3).includes('--')));

console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
if (fail) console.log('\n' + fail + ' FAILURES');
process.exitCode = fail ? 1 : 0;
