// Re-export of the shared engine for serverless functions.
//
// Vercel bundles each file in api/ with only what it requires, and a
// relative require reaching OUT of api/ to the repo root is fragile
// across build configurations. This one-line indirection keeps every
// function pointing at ../engine.js through a single place, so if the
// build ever needs a copy instead of a reference, only this file changes.
//
// engine.js is the SAME file the six HTML pages load. That is the whole
// point of the 12 Aug consolidation: the feed cannot drift from what the
// game page shows, because there is nothing to drift from.
module.exports = require('../engine.js');
