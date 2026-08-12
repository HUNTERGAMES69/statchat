// RETIRED 10 August 2026 — kept as a tombstone, not a test.
//
// This suite existed for one reason: the engine was duplicated inline in
// five HTML files, and it checked that the copies had not drifted apart.
// It earned its place — drift produced two documented bugs where
// different pages showed different numbers for the same game.
//
// The engine now lives in ONE file, `engine.js`, loaded by every page.
// There are no copies left to compare, so this check cannot fail and
// proves nothing.
//
// Deliberately left as a passing no-op rather than deleted, so that
// anyone running the suite by name gets an explanation instead of a
// missing-file error. Delete it once nobody is looking for it.
//
// What replaced it: the engine is covered by every suite in tests/, the
// property fuzzer, and the NFL replay harness (48 games, 6,977 plays).

if (require.main === module) {
  console.log('=== Engine parity (RETIRED) ===\n');
  console.log('  The engine is no longer duplicated — see engine.js.');
  console.log('  Nothing to compare. This check is a no-op.');
  process.exitCode = 0;
}

module.exports = { run: async () => [] };
