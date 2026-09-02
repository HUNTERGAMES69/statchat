// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// RELEASE NOTES — what changed, in the words of the person it changed for.
// =======================================================================
// Loaded by dashboard.html (the card a coach sees) and platform.html (the
// list Andy sends from). Plain script, one global, no build step -- the same
// shape as engine.js and billing.js.
//
// WHY THIS IS A FILE AND NOT A TABLE
// Every feature ships as a file upload. The note describing it rides in the
// same batch, so the note and the thing it describes go live together or not
// at all. A table would let them separate, and the failure mode is a coach
// reading about a feature that is not deployed yet.
//
// NEWEST FIRST. The dashboard shows everything above a person's
// last_seen_release, so order here is the order they read.
//
// ---------------------------------------------------------------------
// WRITING ONE
//
//   id        Stable and unique, and it never changes once shipped: it is
//             what "I have read this" is recorded against. Date-slug form
//             sorts naturally and reads in a database column.
//   date      ISO. Drives the "NEW" pip's own expiry, so it must be real.
//   title     A short sentence in the coach's words. Not a version number.
//   body      One or two sentences: what it does, and why they would care.
//             Not a changelog line, and never a file name.
//   where     Optional. The trail to the thing itself -- "Game setup →
//             Specify all game starters". This is the part people actually
//             use; a note without it makes them hunt.
//   link      Optional page to open. Same-origin paths only.
//   audience  Which roles it is for. 'admin' alone for anything only an
//             admin can reach; add 'game_entry' when it changes what a
//             scorer meets on a Friday. Never include 'view'.
//   email     TRUE ONLY FOR SOMETHING WORTH INTERRUPTING PEOPLE OVER.
//             The default is silence. A contrast fix does not earn an email;
//             a feature nobody knows exists does. The in-app card shows
//             regardless -- this flag governs the megaphone, not the record.
// ---------------------------------------------------------------------

window.STATCHAT_RELEASES = [
  {
    id: '2026-09-02-opponent-overlays',
    date: '2026-09-02',
    title: "Six more overlay addresses for the opponent's lineup cards",
    body: "The opponent's offense, defense and special teams each have their own " +
          'overlay address in one column or two, sitting alongside the six for your ' +
          "own lineups. Each card draws in the opponent's colours and reads their " +
          'name first. They publish through the feeds too — add team=opp to a ' +
          'starters address — and an address already saved in vMix needs no edit, ' +
          'because leaving the parameter off still returns your own starters. ' +
          'Nothing draws until an opponent lineup is entered, so they are safe to ' +
          'leave in a switcher bank all season.',
    where: 'Broadcast setup → Overlays, and Feeds',
    link: 'broadcast_setup.html',
    audience: ['admin', 'game_entry'],
    email: false
  },
  {
    id: '2026-09-02-fill-message-placement',
    date: '2026-09-02',
    title: 'The "Fill from likely starters" result now sits under offense',
    body: 'It used to print at the bottom of the whole lineup section, below defense ' +
          'and special teams, so a message about four offensive slots read as though ' +
          'it were about the defense you were filling in. It now appears directly ' +
          'under the button that produced it, and says which unit it filled.',
    where: 'Game setup → Specify all game starters → Offense',
    link: 'create_game.html',
    audience: ['admin'],
    email: false
  },
  {
    id: '2026-09-02-opponent-starters',
    date: '2026-09-02',
    title: "Put the opponent's starting lineups on the broadcast too",
    body: 'The starters section now has a twin in the opponent roster card, and it ' +
          'works exactly the same way. Six more overlay addresses draw the ' +
          "visitors' offense, defense and special teams in their own colours, with " +
          'their name on the card. Broadcast only, same as yours: nothing entered ' +
          'there touches play entry, the pickers, or a statistic.',
    where: 'Game setup → Opponent roster → Specify all opponent starters',
    link: 'create_game.html',
    audience: ['admin'],
    email: true
  },
  {
    id: '2026-09-01-broadcast-starters',
    date: '2026-09-01',
    title: 'Put your full starting lineups on the broadcast',
    body: 'Enter your offensive, defensive and special-teams starters once on the ' +
          'game setup screen and they drive three new lineup-card overlays. It is ' +
          'broadcast only: nothing you type there touches play entry, the player ' +
          'pickers, or a single statistic.',
    where: 'Game setup → Specify all game starters',
    link: 'create_game.html',
    audience: ['admin'],
    email: true
  },
  {
    id: '2026-09-01-starter-overlays',
    date: '2026-09-01',
    title: 'Starting lineup overlays — six addresses, one and two columns',
    body: 'Each unit — offense, defense, special teams — has its own overlay ' +
          'address in one column or two, so a lineup card fits a lower third or a ' +
          'tall side slot without rebuilding it. The same lineups publish through ' +
          'the feeds as a starters view, one row per position, if you build your ' +
          'own graphics. An overlay draws nothing at all until a lineup is entered, ' +
          'so it is safe to leave in a switcher bank all season.',
    where: 'Broadcast setup → Overlays, and Feeds',
    link: 'broadcast_setup.html',
    audience: ['admin', 'game_entry'],
    email: false
  },
  {
    id: '2026-09-01-drive-overlays',
    date: '2026-09-01',
    title: 'Current drive overlay, in three layouts',
    body: 'A live panel showing the drive in progress — plays, yards, where it ' +
          'started and the down and distance. It hides itself between possessions ' +
          'and before kickoff rather than sitting there reading 0 and 0, so it can ' +
          'stay in a switcher bank all night. Two shorter versions drop the down ' +
          'and distance, or the field position entirely, for a bank whose score bug ' +
          'already carries the situation.',
    where: 'Broadcast setup → Overlays → Current drive',
    link: 'broadcast_setup.html',
    audience: ['admin', 'game_entry'],
    email: false
  },
  {
    id: '2026-09-01-game-stat-overlays',
    date: '2026-09-01',
    title: 'Team stats and leaders for the game on air',
    body: 'The team-versus-team comparison with each side\u2019s leaders underneath — ' +
          'the graphic to hold between drives. It reads the game that is ON AIR and ' +
          'keeps polling, so it is current whenever the director cuts to it, unlike ' +
          'the season panels beside it. There is a portrait version for a tall side ' +
          'slot as well as the wide one.',
    where: 'Broadcast setup → Overlays → Team stats + leaders',
    link: 'broadcast_setup.html',
    audience: ['admin', 'game_entry'],
    email: false
  },
  {
    id: '2026-09-01-kicking-punting-feeds',
    date: '2026-09-01',
    title: 'Kicking and punting numbers are in the feeds now',
    body: 'The kicking and punting leader overlays have been on the setup page for ' +
          'months, but the numbers behind them were not available to anyone building ' +
          'their own graphics. Both are feeds now, game or season, alongside rushing, ' +
          'passing, receiving and defense. Each lists only players who actually ' +
          'attempted that thing, so a punter never shows up on the kicking board at ' +
          '0 for 0.',
    where: 'Broadcast setup → Feeds',
    link: 'broadcast_setup.html',
    audience: ['admin', 'game_entry'],
    email: false
  },
  {
    id: '2026-09-01-feed-xpath',
    date: '2026-09-01',
    title: 'The vMix XPath is now printed next to every feed address',
    body: 'Each feed on the broadcast setup page shows the address and the XPath ' +
          'together, numbered in the order vMix asks for them, each with its own ' +
          'copy button. The XPath is not the same for every feed, which is what ' +
          'made it easy to get wrong.',
    where: 'Broadcast setup → Feeds',
    link: 'broadcast_setup.html',
    audience: ['admin', 'game_entry'],
    email: false
  }
];
