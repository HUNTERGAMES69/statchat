// Vercel serverless function -- same admin-only pattern as invite-user.js:
// verify the caller's own session, verify their profile is genuinely
// flagged admin (checked with the secret key, bypassing RLS, so this
// can't be spoofed from the browser), and only then perform the
// requested action. All actions live in one file since they share the
// exact same verification step.

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    res.status(500).json({ error: 'Server is missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variables' });
    return;
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

  const { data: userData, error: userError } = await adminClient.auth.getUser(token);
  if (userError || !userData || !userData.user) {
    res.status(401).json({ error: 'Invalid or expired session -- please sign in again' });
    return;
  }
  const callerId = userData.user.id;

  const { data: profileRows, error: profileError } = await adminClient
    .from('profiles').select('is_admin').eq('id', callerId).limit(1);
  if (profileError) {
    res.status(500).json({ error: profileError.message });
    return;
  }
  if (!profileRows || profileRows.length === 0 || !profileRows[0].is_admin) {
    res.status(403).json({ error: 'Only an admin can manage users' });
    return;
  }

  const body = req.body || {};
  const action = body.action;

  if (action === 'list') {
    const { data, error } = await adminClient.auth.admin.listUsers();
    if (error) { res.status(400).json({ error: error.message }); return; }

    const ids = data.users.map(u => u.id);
    const { data: profiles, error: profilesErr } = await adminClient
      .from('profiles').select('id, display_name, is_admin').in('id', ids);
    if (profilesErr) { res.status(500).json({ error: profilesErr.message }); return; }
    const profileById = {};
    (profiles || []).forEach(p => { profileById[p.id] = p; });

    const users = data.users.map(u => ({
      id: u.id,
      email: u.email,
      displayName: (profileById[u.id] && profileById[u.id].display_name) || null,
      isAdmin: !!(profileById[u.id] && profileById[u.id].is_admin),
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at,
      emailConfirmedAt: u.email_confirmed_at
    }));
    res.status(200).json({ users });
    return;
  }

  if (action === 'setPassword') {
    const { userId, newPassword } = body;
    if (!userId || !newPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'A user id and a password of at least 6 characters are required' });
      return;
    }
    const { error } = await adminClient.auth.admin.updateUserById(userId, { password: newPassword });
    if (error) { res.status(400).json({ error: error.message }); return; }
    res.status(200).json({ success: true });
    return;
  }

  if (action === 'sendReset') {
    const { email } = body;
    if (!email) { res.status(400).json({ error: 'An email is required' }); return; }
    const { error } = await adminClient.auth.resetPasswordForEmail(email);
    if (error) { res.status(400).json({ error: error.message }); return; }
    res.status(200).json({ success: true });
    return;
  }

  if (action === 'resendInvite') {
    const { email } = body;
    if (!email) { res.status(400).json({ error: 'An email is required' }); return; }
    const { error } = await adminClient.auth.admin.inviteUserByEmail(email);
    if (error) { res.status(400).json({ error: error.message }); return; }
    res.status(200).json({ success: true });
    return;
  }

  if (action === 'delete') {
    const { userId } = body;
    if (!userId) { res.status(400).json({ error: 'A user id is required' }); return; }
    if (userId === callerId) {
      res.status(400).json({ error: "You can't delete your own account from here." });
      return;
    }
    const { error } = await adminClient.auth.admin.deleteUser(userId);
    if (error) { res.status(400).json({ error: error.message }); return; }
    res.status(200).json({ success: true });
    return;
  }

  res.status(400).json({ error: 'Unknown action: ' + action });
};
