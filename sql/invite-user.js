// Vercel serverless function -- the ONLY place in this whole app that
// ever touches the Supabase secret key. This must never be imported
// into, or copied into, any client-side .html file.
//
// Flow: verify the caller's own session token is valid, verify their
// profile is actually flagged as admin (checked with the secret key,
// which bypasses RLS -- so this check can't be spoofed by editing
// client-side code), and only then send the invite.

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

  const email = req.body && req.body.email;
  const fullName = req.body && req.body.fullName;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'A valid email address is required' });
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    res.status(500).json({ error: 'Server is missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variables' });
    return;
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

  // Confirm the token actually belongs to a real, currently-valid session.
  const { data: userData, error: userError } = await adminClient.auth.getUser(token);
  if (userError || !userData || !userData.user) {
    res.status(401).json({ error: 'Invalid or expired session -- please sign in again' });
    return;
  }

  // Confirm that user is an admin. Using the secret key here means this
  // check bypasses RLS entirely and cannot be tricked by anything sent
  // from the browser -- it only trusts what's actually in the database.
  const { data: profileRows, error: profileError } = await adminClient
    .from('profiles').select('role, tenant_id, is_super_admin').eq('id', userData.user.id).limit(1);
  if (profileError){
    res.status(500).json({ error: profileError.message });
    return;
  }
  const caller = (profileRows || [])[0];
  const isSuper = !!(caller && caller.is_super_admin);
  if (!caller || (caller.role !== 'admin' && !isSuper)) {
    res.status(403).json({ error: 'Only an admin can invite new users' });
    return;
  }

  // WHICH SCHOOL IS THIS AN INVITE TO?
  // ---------------------------------------------------------------------
  // A tenant admin can only invite into their OWN school -- the tenant is
  // taken from the CALLER and never from the request body, so there is no
  // field a browser could set to invite somebody into another customer.
  //
  // The super admin has no tenant of its own, so it must say which school
  // it is inviting into. That is the one case where a tenant arrives in
  // the body, and it is gated on is_super_admin above.
  const targetTenantId = isSuper ? (req.body && req.body.tenantId) || null : caller.tenant_id;
  if (!targetTenantId) {
    res.status(400).json({
      error: isSuper
        ? 'Choose which school this invite is for.'
        : 'Your account is not attached to a school yet.'
    });
    return;
  }

  // THE TENANT AND THE NAME TRAVEL WITH THE INVITE, in user metadata.
  // `create_profile_for_new_user` reads both when it builds the profile
  // row, so the school is attached from the instant the row exists
  // rather than patched afterwards -- there is no window in which a
  // user has a profile and no tenant.
  //
  // It also fixes something that was already wrong: display_name was set
  // to the email address, so every user in the system displayed as an
  // email, including on the screen an admin reads to decide who to
  // remove.
  const { data: inviteData, error: inviteError } = await adminClient.auth.admin
    .inviteUserByEmail(email, {
      data: {
        tenant_id: targetTenantId,
        ...(fullName ? { display_name: fullName } : {})
      }
    });
  if (inviteError) {
    res.status(400).json({ error: inviteError.message });
    return;
  }

  const newUserId = inviteData && inviteData.user ? inviteData.user.id : null;
  if (newUserId && fullName) {
    const { error: nameError } = await adminClient
      .from('profiles').update({ display_name: fullName }).eq('id', newUserId);
    if (nameError) {
      // The invite itself succeeded -- don't fail the whole request over
      // the name not saving, just let the admin know.
      res.status(200).json({ success: true, userId: newUserId, nameWarning: nameError.message });
      return;
    }
  }

  res.status(200).json({ success: true, userId: newUserId });
};
