// Resolving a tenant from a feed key — shared by the three overlay endpoints
// =========================================================================
// feed.js, gamedata.js and seasondata.js are read by broadcast software
// that cannot sign in. They hold SUPABASE_SECRET_KEY, which is the
// service role, and 000_baseline.sql creates that role with BYPASSRLS —
// so the policies added in 009 are NEVER CONSULTED for them.
//
// That is worth stating plainly: 009 secured the entire application
// except these files. Tenant isolation here is written by hand or it
// does not exist.
//
// THE KEY IS THE IDENTITY. There is no separate tenant parameter, so
// there is no request in which the key says one thing and a tenant id
// says another. A caller cannot ask for a school they do not hold the
// key to, because holding the key is the only way to name one.
//
// NO MASTER KEY. The environment FEED_KEY is retired: a key that opens
// every school is exactly what per-tenant keys exist to abolish, and
// keeping one "for support" would reintroduce it under a friendlier
// name. Support reads another school's data through the audited
// super-admin path, not through a shared secret in an environment
// variable.
//
// WHY THE OLD CHECK COULD NOT SIMPLY BE DELETED. feed.js read:
//
//     if (FEED_KEY && String(q.key) !== FEED_KEY) { 401 }
//
// The key was only checked IF the variable was set — so unsetting
// FEED_KEY did not retire it, it disabled the check and opened the feed
// to everyone. Removing the variable had to be paired with replacing the
// branch, which is what this does.

const { createClient } = require('@supabase/supabase-js');

// Resolves ?key=... to a tenant id.
// Returns { tenantId } or { error, status }.
async function tenantFromKey(db, rawKey) {
  const key = String(rawKey || '').trim();
  // A missing key is refused the same way a wrong one is. Saying which
  // would tell a prober whether they had found a real key.
  if (!key) return { error: 'Invalid or missing key', status: 401 };

  const { data, error } = await db
    .from('tenants').select('id, name, subscription').eq('feed_key', key).limit(1);
  if (error) return { error: 'Could not verify the key', status: 500 };

  const tenant = (data || [])[0];
  if (!tenant) return { error: 'Invalid or missing key', status: 401 };

  // A LAPSED SUBSCRIPTION STILL SERVES THE FEED. The decision recorded in
  // MULTI_TENANT_PLAN.md is that a lapse goes READ-ONLY, not dark, and an
  // overlay is a read. Cutting a broadcast off mid-game over billing is
  // how a lapse becomes a cancellation, and it happens in front of an
  // audience.
  return { tenantId: tenant.id, tenantName: tenant.name, subscription: tenant.subscription };
}

function serviceClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

module.exports = { tenantFromKey, serviceClient };
