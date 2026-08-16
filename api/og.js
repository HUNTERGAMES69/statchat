// Per-game link preview image
// =====================================================================
// Renders the scoreboard card that iMessage, Slack and the rest show
// above a shared recap link. Same share token as api/share.js, which
// points og:image here.
//
// Runs on the EDGE runtime because that is what @vercel/og needs — it
// rasterises with Satori/resvg in a WASM sandbox. That is also why this
// file is ESM while api/share.js is CommonJS: they run on different
// runtimes, and mixing module systems within one file is what breaks.
//
// Supabase is queried with plain fetch rather than @supabase/supabase-js.
// The client works on the edge, but bundling it here to run one filtered
// select would add weight to a function whose whole job is to return an
// image quickly.
//
// LAYOUT — option C, chosen 15 Aug 2026:
//   Two columns on one dark field. Team colours appear only as the round
//   marks and as a rule under the winner's score, so no pair of school
//   colours can wreck the card the way two coloured halves could.
//
//   The winner is marked THREE ways: white type against the loser's grey,
//   the coloured rule, and the score itself. At full size any one would
//   do; shrunk to a Slack thumbnail it needs more than one.

import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const W = 1200, H = 630;

// Satori accepts plain {type, props} objects — this is what JSX compiles
// to. A three-line helper beats adding React and a build step to draw
// eleven boxes.
const h = (type, style, children) => ({
  type,
  props: children === undefined ? { style } : { style, children }
});

function normalizeHex(hex) {
  if (typeof hex !== 'string') return null;
  let v = hex.trim();
  if (v[0] !== '#') v = '#' + v;
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  }
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
}

// WCAG relative luminance, the same measure engine.js uses. A pale team
// colour needs dark text on its mark and a dark one needs white; guessing
// produces a mark nobody can read at thumbnail size.
function relLuminance(hex) {
  const v = normalizeHex(hex) || '#000000';
  const ch = [v.slice(1, 3), v.slice(3, 5), v.slice(5, 7)].map(x => {
    const n = parseInt(x, 16) / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const ratio = (a, b) => {
  const x = relLuminance(a), y = relLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const textOn = bg => (ratio(bg, '#000000') >= ratio(bg, '#ffffff') ? '#000000' : '#ffffff');

// A team's colour is used AS GIVEN. The first version lightened a dark
// one until it separated from the background, which turned Ruston's
// #8a1420 into #a44953 — a school's maroon rendered as pink, on a card
// meant to represent them.
//
// So the fill is never altered. When it is too close to the field to read
// as a shape, a RING is drawn round it instead: the circle gains an edge,
// the colour stays true, and the letter inside was always going to be
// legible because textOn() picks it against the fill.
function markColour(hex) {
  return normalizeHex(hex) || '#8a8a8a';
}

// A lightened version of the colour, for the ring only. Returns null when
// the mark already separates on its own and no ring is wanted.
function markRing(hex) {
  const base = markColour(hex);
  if (ratio(base, FIELD) >= 2.2) return null;
  let c = base, guard = 0;
  while (ratio(c, FIELD) < 3.5 && guard++ < 24) {
    const n = normalizeHex(c);
    const mix = i => {
      const from = parseInt(n.slice(1 + i * 2, 3 + i * 2), 16);
      return Math.round(from + (255 - from) * 0.14).toString(16).padStart(2, '0');
    };
    c = '#' + mix(0) + mix(1) + mix(2);
  }
  return c;
}

const FIELD = '#12161c';
const DIM = '#98a2af';
const RULE = '#252c36';
const META = '#6c7683';

function initial(name) {
  const s = String(name || '').trim();
  return s ? s[0].toUpperCase() : '?';
}

function prettyDate(d) {
  if (!d) return '';
  const dt = new Date(String(d) + 'T12:00:00Z');
  if (isNaN(dt)) return '';
  return dt.toLocaleDateString('en-US',
    { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .toUpperCase();
}

// One team's column. `won` drives every difference between the two:
// there is no second code path for the loser, so they cannot drift apart.
function column(name, score, colour, won) {
  const mark = markColour(colour);
  const ring = markRing(colour);
  return h('div', {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', flex: 1, gap: 20
  }, [
    h('div', {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: 132, height: 132, borderRadius: 66,
      background: mark, color: textOn(mark),
      fontSize: 72, fontWeight: 700,
      // Only when the fill alone would disappear into the field.
      border: ring ? ('4px solid ' + ring) : 'none'
    }, initial(name)),
    h('div', {
      fontSize: 41, fontWeight: 700, letterSpacing: 2,
      color: won ? '#ffffff' : DIM,
      // Long school names must not wrap into the score.
      maxWidth: 520, overflow: 'hidden', whiteSpace: 'nowrap'
    }, String(name || '').toUpperCase()),
    h('div', {
      fontSize: 168, fontWeight: 600, lineHeight: 1,
      color: won ? '#ffffff' : DIM
    }, String(score)),
    // The rule under the winner. An empty box of the same height for the
    // loser, so both columns stay vertically aligned.
    // The winner's rule uses the RING colour when there is one: a rule is
    // a bare shape with nothing inside it, so unlike the mark it has no
    // letter to carry the meaning if the colour vanishes.
    h('div', {
      width: 168, height: 9, borderRadius: 5,
      background: won ? (ring || mark) : 'transparent'
    })
  ]);
}

export default async function handler(req) {
  const url = new URL(req.url);
  const token = String(url.searchParams.get('t') || '').trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    return new Response('Not found', { status: 404 });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return new Response('Not configured', { status: 500 });
  }

  let game = null, ourColour = '#ffc72c';
  try {
    // The service key bypasses RLS, so the same pair of conditions the
    // policy enforces is written out here. An unshared game must not
    // render a card.
    const q = SUPABASE_URL + '/rest/v1/games' +
      '?select=home_team_name,away_team_name,our_team_is_home,game_date,' +
      'final_score_us,final_score_opp,opponent_primary_color' +
      '&share_token=eq.' + encodeURIComponent(token) +
      '&status=eq.final&is_public=is.true&limit=1';
    const r = await fetch(q, {
      headers: { apikey: SUPABASE_SECRET_KEY,
                 Authorization: 'Bearer ' + SUPABASE_SECRET_KEY }
    });
    const rows = r.ok ? await r.json() : [];
    game = rows && rows[0];

    const t = await fetch(SUPABASE_URL +
      '/rest/v1/teams?select=primary_color&is_our_team=is.true&limit=1', {
      headers: { apikey: SUPABASE_SECRET_KEY,
                 Authorization: 'Bearer ' + SUPABASE_SECRET_KEY }
    });
    const tr = t.ok ? await t.json() : [];
    if (tr && tr[0] && tr[0].primary_color) ourColour = tr[0].primary_color;
  } catch (e) {
    game = null;
  }
  if (!game) return new Response('Not found', { status: 404 });

  const ourName = game.our_team_is_home ? game.home_team_name : game.away_team_name;
  const oppName = game.our_team_is_home ? game.away_team_name : game.home_team_name;
  const ourScore = game.final_score_us == null ? 0 : game.final_score_us;
  const oppScore = game.final_score_opp == null ? 0 : game.final_score_opp;
  // A draw dims neither: nobody won, and marking one side would be wrong.
  const weWon = ourScore > oppScore, theyWon = oppScore > ourScore;
  const drawn = ourScore === oppScore;

  const dateStr = prettyDate(game.game_date);

  const card = h('div', {
    display: 'flex', width: '100%', height: '100%', background: FIELD,
    position: 'relative', fontFamily: 'sans-serif'
  }, [
    h('div', {
      position: 'absolute', top: 46, left: 0, right: 0,
      display: 'flex', justifyContent: 'center',
      fontSize: 27, fontWeight: 700, letterSpacing: 4, color: META
    }, 'FINAL' + (dateStr ? '  ·  ' + dateStr : '')),
    h('div', {
      display: 'flex', width: '100%', height: '100%', alignItems: 'center'
    }, [
      column(ourName, ourScore, ourColour, drawn || weWon),
      h('div', { width: 1, background: RULE, height: 300 }),
      column(oppName, oppScore, game.opponent_primary_color, drawn || theyWon)
    ]),
    h('div', {
      position: 'absolute', right: 58, bottom: 38, display: 'flex',
      fontSize: 27, fontWeight: 700, letterSpacing: 3, color: '#5d6875'
    }, 'STATCHAT')
  ]);

  return new ImageResponse(card, {
    width: W, height: H,
    // A finished game's score never changes, so this is cached hard.
    // Sharing a game again mints a NEW token, so a new url — an old
    // cached image can never be served for different data.
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Robots-Tag': 'noindex, nofollow'
    }
  });
}
