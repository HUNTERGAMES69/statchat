// The feed key, for signed-in staff
// ================================
// WHY THIS EXISTS: broadcast_setup.html originally took the key from its
// own URL (`?key=...`), which meant the page only worked if you arrived
// via a bookmark carrying the secret. Clicking the Broadcast button in
// the dashboard header produced a page of keyless addresses, every one
// of which returned {"error":"Invalid or missing key"}.
//
// Requiring a human to carry a secret in a URL to reach a page that
// exists to hand out that secret was circular. The page now asks the
// server, which checks who is asking.
//
// The KEY ITSELF is still a shared secret in a URL once it reaches the
// broadcast software -- that is unavoidable, because broadcast software
// cannot sign in. What this fixes is the STAFF path: only an admin or a
// scorer with a real session can read the key out of the app.
//
//   GET /api/feedkey        with Authorization: Bearer <session token>

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' });
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    res.status(500).json({ error: 'Server is missing Supabase configuration' });
    return;
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData || !userData.user) {
      res.status(401).json({ error: 'Sign in required' });
      return;
    }

    // Admin and game_entry only. A `view` account views -- and this hands
    // out a credential, however weak.
    const { data: profile } = await admin
      .from('profiles').select('role, tenant_id').eq('id', userData.user.id).limit(1);
    const role = ((profile || [])[0] || {}).role || 'view';
    if (role !== 'admin' && role !== 'game_entry') {
      res.status(403).json({ error: 'Not permitted' });
      return;
    }

    // THE CALLER'S OWN TENANT KEY, not an environment variable.
    // ------------------------------------------------------------------
    // This used to return process.env.FEED_KEY — one secret shared by
    // every installation. Since 010 each school has its own, stored on
    // its tenants row, and a school may only ever be handed its own.
    //
    // The super admin has no tenant of its own and therefore no key to
    // fetch. That is correct rather than an oversight: there is
    // deliberately NO MASTER KEY, so the platform reads another school's
    // feed through the audited path, not by holding a secret.
    // NAMES MATTER, and getting them wrong here failed almost silently.
    // The first version of this block used `adminClient` and
    // `profileRows` — the names used in manage-users.js, copied without
    // reading THIS file, where the client is `admin` and the profile
    // result is `profile`. The ReferenceError was swallowed by the catch
    // below into a 500, the page fell back to keyless addresses, and the
    // only symptom was a feed URL with no key on it.
    const tenantId = ((profile || [])[0] || {}).tenant_id || null;
    // A caller with no tenant is the super admin, who has no key of its
    // own by design. Not an error — there is deliberately no master key.
    let tenantKey = null;
    if (tenantId) {
      const { data: tenantRows, error: tenantErr } = await admin
        .from('tenants').select('feed_key').eq('id', tenantId).limit(1);
      if (tenantErr) { res.status(500).json({ error: tenantErr.message }); return; }
      tenantKey = ((tenantRows || [])[0] || {}).feed_key || null;
    }

    res.status(200).json({
      key: tenantKey,
      configured: !!tenantKey
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
};
