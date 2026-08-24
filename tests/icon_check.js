// team-icon.js must stay neutered — and be present
// ================================================
// This file guards a decision that has already been lost once.
//
// On 22 Aug 2026 the team tab icon was removed: the tab identifies the
// APPLICATION, not the customer, and `is_our_team` picks exactly one row,
// which multi-tenancy makes worse rather than better. team-icon.js was
// NEUTERED rather than deleted, because twenty-one pages carry
// `<script src="team-icon.js">` and an empty file is one upload where
// removing the tags is twenty-one. Deleting it would 404 on every page.
//
// THAT UPLOAD NEVER LANDED. The root copy stayed the working pre-22-Aug
// version, the feature carried on, and on 24 Aug an iPhone home screen
// showing a school's logo was reported as a bug. It was nearly "fixed"
// by SPLITTING the icons — team on the tab, StatChat on the home screen
// — which would have reversed the 22 Aug decision without anyone
// noticing, because the only record of it was a comment in a test file.
//
// So this check asserts two things that sound trivial and are not:
//   1. the file exists (deleting it 404s twenty-one pages)
//   2. it contains no executable statement (any code here overrides
//      every page's own StatChat favicon)
//
// If a per-team icon is ever wanted again it belongs in the tenancy work,
// where is_our_team has to become a tenant lookup anyway.
//
//   node tests/icon_check.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function run() {
  const fails = [];
  const bad = (area, detail) => fails.push({ area, detail });

  const p = path.join(ROOT, 'team-icon.js');
  if (!fs.existsSync(p)) {
    bad('presence', 'team-icon.js is missing. Twenty-one pages load it; deleting the file ' +
        'puts a 404 in the console of every page. Neuter it, do not remove it.');
    return fails;
  }

  const src = fs.readFileSync(p, 'utf8');
  const code = src.split('\n')
    .filter(l => !/^\s*(\/\/|$)/.test(l))
    .join('\n').trim();
  if (code.length) {
    bad('neutered', 'team-icon.js contains executable code:\n      ' +
        code.split('\n').slice(0, 3).join('\n      ') +
        '\n      Anything here overrides each page\'s own StatChat favicon. The team icon ' +
        'was removed on 22 Aug 2026 and the removal has already failed to upload once.');
  }
  if (/setLink|apple-touch-icon|icon_url/.test(code)) {
    bad('neutered', 'team-icon.js still references icon wiring — the pre-22-Aug version is back');
  }

  // The pages have to be able to fall back to something.
  const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
  const loaders = pages.filter(f =>
    fs.readFileSync(path.join(ROOT, f), 'utf8').includes('team-icon.js'));
  const noFavicon = loaders.filter(f =>
    !/rel="(shortcut )?icon"/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  // broadcast_leaders.html is a vMix browser input; no tab ever shows it.
  const real = noFavicon.filter(f => f !== 'broadcast_leaders.html');
  if (real.length) {
    bad('fallback', 'pages load team-icon.js but declare no favicon of their own, so a ' +
        'neutered file leaves them with nothing: ' + real.join(', '));
  }

  return fails;
}

if (require.main === module) {
  const f = run();
  console.log('=== Team icon removal ===\n');
  console.log('Failures: ' + f.length);
  f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
  if (!f.length) console.log('  team-icon.js is present and inert; every page shows StatChat.');
  process.exitCode = f.length ? 1 : 0;
}

module.exports = { run };
