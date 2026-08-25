// Create a school, and invite its first admin
// =====================================================================
// PLATFORM ONLY. This is the one endpoint that brings a new customer
// into existence, so it is also the one place where getting the identity
// check wrong creates a tenant nobody asked for.
//
// TWO STEPS, AND THEY CANNOT BE ONE TRANSACTION.
//
//   1. create_tenant() makes the `tenants` row AND the `teams` row
//      atomically (migration 013). A school with no team is invisibly
//      broken: thirteen pages read the team to find out who "we" are and
//      every one comes back empty.
//   2. inviteUserByEmail() sends the first admin their link. This talks
//      to Supabase Auth, which is not part of the database transaction
//      above and cannot be rolled into it.
//
// So a failure at step 2 leaves a real school with no users. That is
// RECOVERABLE and is reported as exactly that -- the school exists, use
// Invite to try the address again -- rather than being hidden behind a
// generic error, or "cleaned up" by deleting a tenant that may already
// have been half set up.
//
// Deleting on failure would be the worse choice: it turns a typo in an
// email address into the destruction of a record, and the delete could
// fail too.

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
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
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData || !userData.user) {
    res.status(401).json({ error: 'Invalid or expired session — please sign in again' });
    return;
  }

  // THE ONLY CHECK THAT MATTERS. Read from the database with the service
  // key, so it cannot be influenced by anything the browser sent.
  const { data: profileRows, error: profileError } = await admin
    .from('profiles').select('is_super_admin').eq('id', userData.user.id).limit(1);
  if (profileError) {
    res.status(500).json({ error: profileError.message });
    return;
  }
  if (!profileRows || !profileRows[0] || !profileRows[0].is_super_admin) {
    res.status(403).json({ error: 'Only the platform can create a school' });
    return;
  }

  const body = req.body || {};
  const name = String(body.name || '').trim();
  const fullName = String(body.fullName || '').trim();
  const adminEmail = String(body.adminEmail || '').trim();
  const adminName = String(body.adminName || '').trim();

  if (!name) { res.status(400).json({ error: 'A school name is required' }); return; }
  // The email is checked BEFORE the school is created. Creating a tenant
  // and then discovering the address is malformed leaves exactly the
  // orphan this endpoint is trying not to produce.
  if (adminEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
    res.status(400).json({ error: 'That email address does not look right.' });
    return;
  }

  // ---- step 1: the school itself ------------------------------------
  const { data: tenantId, error: createError } = await admin
    .rpc('create_tenant', {
      p_name: name,
      p_full_name: fullName || null,
      p_season: body.season ? parseInt(body.season, 10) : null
    });
  if (createError) {
    // create_tenant raises with messages written for a person to read --
    // a duplicate name, a blank name. Passed through rather than replaced
    // with something generic.
    res.status(400).json({ error: createError.message });
    return;
  }

  // ---- step 2: the first admin --------------------------------------
  // Optional. A school can be created now and staffed later, and forcing
  // an email address at creation time would mean inventing one.
  if (!adminEmail) {
    res.status(200).json({
      tenantId,
      invited: false,
      message: 'School created. Nobody has been invited yet — use Invite when you have an address.'
    });
    return;
  }

  // THE TENANT TRAVELS IN THE INVITE, exactly as in api/invite-user.js:
  // `create_profile_for_new_user` reads it when the profile row is built,
  // so the user has a school from the instant they exist rather than
  // being patched afterwards.
  const { data: inviteData, error: inviteError } = await admin.auth.admin
    .inviteUserByEmail(adminEmail, {
      data: Object.assign({ tenant_id: tenantId },
                          adminName ? { display_name: adminName } : {})
    });

  if (inviteError) {
    res.status(207).json({
      tenantId,
      invited: false,
      error: 'The school was created, but the invite to ' + adminEmail +
             ' failed: ' + inviteError.message +
             ' — the school is in the list; invite them again from there.'
    });
    return;
  }

  // THE ROLE IS SET AFTER THE INVITE, not in the metadata. `profiles.role`
  // is not read from user metadata by the signup trigger, and it should
  // not be: metadata is client-supplied on other paths, and a role that
  // could be self-assigned is not a role.
  const newUserId = inviteData && inviteData.user ? inviteData.user.id : null;
  if (newUserId) {
    const { error: roleError } = await admin
      .from('profiles').update({ role: 'admin' }).eq('id', newUserId);
    if (roleError) {
      res.status(207).json({
        tenantId,
        invited: true,
        error: 'School created and ' + adminEmail + ' invited, but they could not be made ' +
               'an admin: ' + roleError.message + ' — set their role from the school\'s ' +
               'own account page once they have signed in.'
      });
      return;
    }
  }

  res.status(200).json({
    tenantId,
    invited: true,
    message: 'School created and ' + adminEmail + ' invited as its admin.'
  });
};
