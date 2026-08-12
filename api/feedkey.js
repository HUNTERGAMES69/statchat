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
      .from('profiles').select('role').eq('id', userData.user.id).limit(1);
    const role = ((profile || [])[0] || {}).role || 'view';
    if (role !== 'admin' && role !== 'game_entry') {
      res.status(403).json({ error: 'Not permitted' });
      return;
    }

    // No FEED_KEY configured means the feed is ungated, so there is
    // nothing to hand out and the addresses work without one. Say so
    // rather than returning an empty string that looks like a failure.
    res.status(200).json({
      key: process.env.FEED_KEY || null,
      configured: !!process.env.FEED_KEY
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
};
