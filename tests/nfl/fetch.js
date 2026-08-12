// nflverse data fetch, cached
// ---------------------------
// Downloads play-by-play and player-stats releases once and keeps them in
// /tmp. The play-by-play file is ~19 MB, so re-downloading per run would
// dominate the runtime and make the harness annoying enough not to use.
//
// These URLs are nflverse-data GitHub releases, which are reachable from
// this sandbox (release-assets.githubusercontent.com is allowlisted).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CACHE = '/tmp/nflcache';

function ensureCache() {
  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });
}

function fetchAsset(url, filename) {
  ensureCache();
  const dest = path.join(CACHE, filename);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return dest;
  execFileSync('curl', ['-sL', '--max-time', '600', url, '-o', dest], { stdio: 'inherit' });
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 1000) {
    throw new Error('download failed or suspiciously small: ' + url);
  }
  return dest;
}

function playByPlay(year) {
  return fetchAsset(
    'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_' + year + '.csv.gz',
    'pbp' + year + '.csv.gz');
}

function playerStats(year) {
  return fetchAsset(
    'https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_' + year + '.csv.gz',
    'player_stats' + year + '.csv.gz');
}

// Streams one game's rows out of the gzipped CSV without holding the whole
// file in memory -- the 2023 play-by-play is around 50k rows.
function readGame(gzPath, gameId) {
  const out = execFileSync('python3', ['-c', `
import gzip, csv, json, sys
want = sys.argv[2] if len(sys.argv) > 2 else None
rows = []
with gzip.open(sys.argv[1], 'rt', encoding='utf-8', errors='replace') as f:
    for row in csv.DictReader(f):
        if want is None:
            want = row['game_id']
        if row['game_id'] == want:
            rows.append(row)
        elif rows:
            break
print(json.dumps(rows))
`, gzPath, gameId || ''], { maxBuffer: 200 * 1024 * 1024 });
  return JSON.parse(out.toString());
}

// Game ids for one week. nflverse game_ids look like 2023_01_ARI_WAS, so
// the week is the middle field -- no need to parse dates.
function listWeekGameIds(gzPath, week) {
  const out = execFileSync('python3', ['-c', `
import gzip, csv, json, sys
want = '_%02d_' % int(sys.argv[2])
seen, ids = set(), []
with gzip.open(sys.argv[1], 'rt', encoding='utf-8', errors='replace') as f:
    for row in csv.DictReader(f):
        g = row['game_id']
        if want in g and g not in seen:
            seen.add(g); ids.append(g)
print(json.dumps(ids))
`, gzPath, String(week)], { maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(out.toString());
}

function listGameIds(gzPath, limit) {
  const out = execFileSync('python3', ['-c', `
import gzip, csv, json, sys
seen, ids = set(), []
with gzip.open(sys.argv[1], 'rt', encoding='utf-8', errors='replace') as f:
    for row in csv.DictReader(f):
        g = row['game_id']
        if g not in seen:
            seen.add(g); ids.append(g)
            if len(ids) >= int(sys.argv[2]): break
print(json.dumps(ids))
`, gzPath, String(limit || 10)], { maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(out.toString());
}

module.exports = { playByPlay, playerStats, readGame, listGameIds, listWeekGameIds, CACHE };
