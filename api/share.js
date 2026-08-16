// Share route — the recap, served with a link preview that names the game
// =====================================================================
// A link preview is built by a scraper that DOES NOT RUN JAVASCRIPT.
// iMessage, Slack, Facebook and the rest fetch the URL, read the <head>,
// and leave — long before recap.html has asked Supabase anything. So a
// static file can only ever preview as "Game Recap", whatever the page
// later puts in document.title.
//
// This builds the <head> on the server instead. It looks the game up with
// the service key, and only when the game is BOTH final and shared does
// it return the recap with real tags injected:
//
//     Neville 28 — Sterlington 21
//     Final · August 29, 2026 · Full box score and player stats
//
// WHY IT SERVES THE PAGE RATHER THAN REDIRECTING. A redirect after the
// scraper has taken the tags is cloaking — showing a crawler one thing
// and a person another — and some scrapers follow redirects anyway and
// end up previewing the destination. Serving the same HTML to both is
// simpler and honest.
//
// The recap HTML is fetched from this same deployment rather than read
// off disk: Vercel bundles each function with only what it requires, so
// reaching for a file at the repo root needs build configuration that
// then has to stay correct. One HTTP call to our own origin needs none.

const { createClient } = require('@supabase/supabase-js');

// Everything interpolated below comes from the database — a team name
// with an apostrophe in it is ordinary, and one with a quote would break
// out of the attribute.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function prettyDate(d) {
  if (!d) return '';
  // Parsed as UTC on purpose. A date-only column read in the server's
  // local zone can land on the previous day.
  const dt = new Date(String(d) + 'T12:00:00Z');
  if (isNaN(dt)) return '';
  return dt.toLocaleDateString('en-US',
    { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// A page for anything we will not serve: not shared, not final, not
// found. Deliberately says the same thing in every case — whether a
// particular game EXISTS is not something an unshared link should
// reveal, and a visitor cannot act on the difference anyway.
function notSharedPage(origin) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<meta name="robots" content="noindex, nofollow">' +
    '<title>StatChat</title>' +
    '<meta property="og:site_name" content="StatChat">' +
    '<meta property="og:title" content="StatChat">' +
    '<meta property="og:description" content="High school football statistics.">' +
    '<meta property="og:image" content="' + esc(origin) + '/logo.png">' +
    '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
    'background:#f4f4f2;color:#333;display:flex;align-items:center;justify-content:center;' +
    'min-height:100vh;margin:0;padding:24px;}' +
    'div{background:#fff;border:1px solid #ddd;border-radius:10px;padding:24px;max-width:420px;}' +
    'h1{font-size:18px;margin:0 0 10px;}p{font-size:14px;line-height:1.5;margin:0;color:#666;}' +
    '</style></head><body><div>' +
    '<h1>This recap is not shared</h1>' +
    '<p>The link may have been turned off, or it may never have been shared. ' +
    'If you have a StatChat account, sign in and open the game from your dashboard.</p>' +
    '</div></body></html>';
}

module.exports = async (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  // Short, but not zero: a scraper and the person who was sent the link
  // often arrive within seconds of each other, and the recap of a
  // finished game does not change.
  res.setHeader('Cache-Control', 'public, max-age=300');

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const origin = proto + '://' + host;

  // A SHARE TOKEN, not the game id. The url a coach sends should not
  // carry the row's primary key: the token can be revoked on its own,
  // and minting a new one when a game is shared again leaves every old
  // link permanently dead. Turning `is_public` off and on would revive
  // them.
  //
  // Validated by shape before it goes anywhere near the page. Tokens are
  // url-safe base64 from the browser's crypto source.
  const token = String((req.query && req.query.t) || '').trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(notSharedPage(origin));
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }
  const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let game = null;
  try {
    // The same pair of conditions the RLS policy uses. This runs with the
    // service key, which bypasses RLS entirely, so the check has to be
    // written out here rather than relied upon.
    const { data, error } = await db
      .from('games')
      .select('id, designator, game_date, home_team_name, away_team_name, ' +
              'our_team_is_home, status, is_public, final_score_us, final_score_opp')
      .eq('share_token', token).eq('status', 'final').eq('is_public', true).limit(1);
    if (error) throw error;
    game = data && data[0];
  } catch (e) {
    game = null;
  }
  if (!game) {
    res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(notSharedPage(origin));
    return;
  }

  // Scores are stored from our point of view, so which name goes with
  // which number depends on whether we were at home.
  const ourName = game.our_team_is_home ? game.home_team_name : game.away_team_name;
  const oppName = game.our_team_is_home ? game.away_team_name : game.home_team_name;
  const ourScore = game.final_score_us == null ? '' : game.final_score_us;
  const oppScore = game.final_score_opp == null ? '' : game.final_score_opp;

  const title = (ourScore === '' || oppScore === '')
    ? ourName + ' vs ' + oppName
    : ourName + ' ' + ourScore + ' — ' + oppName + ' ' + oppScore;
  const dateStr = prettyDate(game.game_date);
  const description = 'Final' + (dateStr ? ' · ' + dateStr : '') +
    ' · Full box score, team stats and player numbers.';

  let html;
  try {
    const r = await fetch(origin + '/recap.html');
    if (!r.ok) throw new Error('recap fetch ' + r.status);
    html = await r.text();
  } catch (e) {
    // Falling back to a redirect rather than a blank page: the recap
    // still works at its own URL, it just previews generically.
    res.status(302).setHeader('Location', '/recap.html?id=' + encodeURIComponent(game.id));
    res.end();
    return;
  }

  // Two things have to be injected besides the tags:
  //
  //   <base>  — the recap loads engine.js, team-icon.js and logo.png by
  //             relative path. Served at /g/<id> those would resolve to
  //             /g/engine.js and 404. This is the difference between a
  //             working page and a blank one.
  //
  //   the id  — the page reads it from ?id=, and this URL has no query
  //             string. recap.html falls back to window.__SHARE_ID.
  const injected =
    '<base href="' + esc(origin) + '/">' +
    // The real game id, which recap.html needs to query Supabase with
    // the anon key. Masking the URL does not hide it from view-source --
    // it is not a secret, and RLS is what actually guards the data.
    '<script>window.__SHARE_ID=' + JSON.stringify(game.id) + ';</script>' +
    '<meta property="og:site_name" content="StatChat">' +
    '<meta property="og:type" content="article">' +
    '<meta property="og:url" content="' + esc(origin) + '/g/' + esc(token) + '">' +
    '<meta property="og:title" content="' + esc(title) + '">' +
    '<meta property="og:description" content="' + esc(description) + '">' +
    // The per-game scoreboard card, rendered by api/og.js from this same
    // token. Dimensions are declared because several scrapers pick the
    // card LAYOUT from them without downloading the image first -- and
    // 1200x630 is what gets the wide card rather than the small square
    // one the logo was producing.
    '<meta property="og:image" content="' + esc(origin) + '/api/og?t=' + esc(token) + '">' +
    '<meta property="og:image:width" content="1200">' +
    '<meta property="og:image:height" content="630">' +
    '<meta property="og:image:alt" content="' + esc(title) + '">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta name="twitter:title" content="' + esc(title) + '">' +
    '<meta name="twitter:description" content="' + esc(description) + '">' +
    '<meta name="twitter:image" content="' + esc(origin) + '/api/og?t=' + esc(token) + '">';

  // The file's own og: tags are removed first. Two sets in one head is
  // undefined behaviour — some scrapers take the first, some the last —
  // and the whole point is to be sure which one is read.
  html = html.replace(/\s*<meta\s+(?:property|name)="(?:og|twitter):[^"]*"[^>]*>/g, '');
  html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>' + esc(title) + ' — StatChat</title>');
  html = html.replace('<head>', '<head>' + injected);

  res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
};
