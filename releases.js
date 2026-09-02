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
    id: '2026-09-01-broadcast-starters',
    date: '2026-09-01',
    title: 'Put your full starting lineups on the broadcast',
    body: 'Three new overlays — offensive, defensive and special-teams starters — ' +
          'built from a lineup you enter once on the game setup screen. It is ' +
          'broadcast only: nothing you type there touches play entry, the player ' +
          'pickers, or a single statistic.',
    where: 'Game setup → Specify all game starters',
    link: 'create_game.html',
    audience: ['admin'],
    email: true
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
