// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.
// TEAM TAB ICON -- REMOVED 22 August 2026.
// ---------------------------------------------------------------------
// This used to read teams.icon_url and override the favicon, the iPhone
// home-screen icon and a splash image on every page it was included on.
// Andy's call: the browser tab should show the StatChat logo, not the
// school's.
//
// The reasoning is worth keeping, because it is a multi-tenant decision
// as much as a cosmetic one:
//
//   * The tab icon identifies the APPLICATION, not the customer. A crew
//     with four tabs open wants to find StatChat among them.
//   * It was a SECOND uploaded image per team, living at its own storage
//     path, with its own staleness. When the logo caching bug was fixed
//     on 22 Aug the icon had the identical fault, in a second copy of the
//     same function -- which is what a duplicate always costs.
//   * Every page should read the ONE logo set on the customize screen.
//     Two team images meant two sources of truth for "what does this
//     school look like", and multi-tenancy makes that worse, not better.
//
// NEUTERED RATHER THAN DELETED, deliberately. Twenty-one pages carry
// `<script src="team-icon.js">`, and removing the tag from all of them
// is twenty-one manual uploads for a cosmetic change. An empty file is
// one upload and behaves identically: every page already declares its
// own StatChat favicon in markup, and with nothing here to override it,
// that is what shows.
//
// The tags can come out whenever those files are next touched for other
// reasons. Tracked in TODO.md. Until then this file must stay present --
// deleting it would put a 404 in the console of every page in the app.
//
// RESTORED 24 August 2026. The live copy at the repo root was still the
// pre-22-August version: the neutering was written and never uploaded,
// so the feature carried on working and an iPhone home screen showed the
// school's logo. It was briefly re-fixed on 24 Aug as a favicon/home-icon
// SPLIT before this file was found, which would have reversed a decision
// already made and argued. Andy's call stands: StatChat everywhere.
//
// If a per-team icon is ever wanted again it belongs in the tenancy work,
// where `is_our_team` -- which picks exactly one row -- has to become a
// tenant lookup anyway.
//
// teams.icon_url is left in the database. Dropping a column is a
// migration, the value is harmless, and the schema is not yet versioned
// (see MULTI_TENANT_PLAN.md step 0).
