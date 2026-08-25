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
    .from('profiles').select('role, tenant_id, is_super_admin').eq('id', callerId).limit(1);
  if (profileError) {
    res.status(500).json({ error: profileError.message });
    return;
  }
  const caller = (profileRows || [])[0];
  const isSuper = !!(caller && caller.is_super_admin);
  if (!caller || (caller.role !== 'admin' && !isSuper)) {
    res.status(403).json({ error: 'Only an admin can manage users' });
    return;
  }

  // TENANT SCOPING — the whole point of this block.
  // ---------------------------------------------------------------------
  // Until 24 Aug 2026 this endpoint asked "is the caller an admin?" and
  // never "an admin of WHAT". Any admin of any school passed, and then
  // `list` returned every user in the system with `setPassword`
  // available on all of them. With one tenant that was harmless, because
  // "any admin" and "our admin" described the same people. It fails open
  // the instant that stops being true, and RLS cannot catch it because
  // this file holds the service key.
  //
  // The super admin passes every check. That is deliberate and decided:
  // the platform owner has no restrictions, because an owner who cannot
  // reset a locked-out coach's password cannot support anybody.
  //
  // A caller with NO tenant who is not the super admin is refused
  // outright rather than treated as unscoped. That is the state a user
  // is in between being created and being assigned a school, and it must
  // deny rather than default to everything.
  if (!isSuper && !caller.tenant_id) {
    res.status(403).json({ error: 'Your account is not attached to a school yet.' });
    return;
  }

  // Resolves a target and refuses it if it belongs to somebody else.
  // Returns null when the caller may proceed, or a message when not.
  // Every mutating action calls this -- the list filter below is the
  // interface, this is the control, and this endpoint is callable
  // directly.
  async function refuseIfOtherTenant(targetUserId) {
    if (isSuper) return null;
    const { data, error } = await adminClient
      .from('profiles').select('tenant_id').eq('id', targetUserId).limit(1);
    if (error) return 'Could not check that user: ' + error.message;
    const target = (data || [])[0];
    // No profile row, or no tenant on it, means the user is not visibly
    // anybody's. Refusing is the safe reading: a tenant admin has no
    // business acting on a user they cannot account for.
    //
    // The `!target.tenant_id` half is DELIBERATE REDUNDANCY and cannot be
    // caught by a mutation test — with it removed the comparison below
    // still refuses, because null !== the caller's tenant, and the caller
    // can never have a null tenant here (the guard above returns first).
    // It is kept because it states the intent at the point of the check:
    // if the guard above is ever relaxed, this is what stops "unassigned"
    // reading as "unprotected".
    if (!target || !target.tenant_id) return 'That user is not in your school.';
    if (target.tenant_id !== caller.tenant_id) return 'That user is not in your school.';
    return null;
  }

  // sendReset and resendInvite identify their target by EMAIL rather
  // than id, so they need a lookup before the same check can run.
  async function userIdForEmail(email) {
    const { data, error } = await adminClient.auth.admin.listUsers();
    if (error) return null;
    const hit = (data.users || []).find(u =>
      (u.email || '').toLowerCase() === String(email || '').toLowerCase());
    return hit ? hit.id : null;
  }

  const body = req.body || {};
  const action = body.action;

  if (action === 'list') {
    const { data, error } = await adminClient.auth.admin.listUsers();
    if (error) { res.status(400).json({ error: error.message }); return; }

    const ids = data.users.map(u => u.id);
    const { data: profiles, error: profilesErr } = await adminClient
      .from('profiles').select('id, display_name, role, tenant_id, is_super_admin').in('id', ids);
    if (profilesErr) { res.status(500).json({ error: profilesErr.message }); return; }
    const profileById = {};
    (profiles || []).forEach(p => { profileById[p.id] = p; });

    // `listUsers()` is every user on the whole platform. Cutting it to
    // the caller's tenant here removes most of the attack surface before
    // any action runs -- an admin cannot act on somebody they cannot see
    // -- but it is NOT the control. Each mutating action checks its own
    // target, because this endpoint can be called directly.
    const visible = isSuper ? data.users : data.users.filter(u => {
      const p = profileById[u.id];
      return p && p.tenant_id === caller.tenant_id;
    });

    // Resolved in ONE query rather than one per user. Only for the
    // platform: a tenant admin's list is a single school by construction.
    let tenantNameById = {};
    if (isSuper) {
      const tIds = [...new Set((profiles || []).map(p => p.tenant_id).filter(Boolean))];
      if (tIds.length) {
        const { data: tRows } = await adminClient
          .from('tenants').select('id, name').in('id', tIds);
        (tRows || []).forEach(t => { tenantNameById[t.id] = t.name; });
      }
    }

    const users = visible.map(u => ({
      id: u.id,
      email: u.email,
      displayName: (profileById[u.id] && profileById[u.id].display_name) || null,
      role: (profileById[u.id] && profileById[u.id].role) || 'view',
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at,
      emailConfirmedAt: u.email_confirmed_at,
      // banned_until comes back as a timestamp when set. Anything in the
      // future means the account is locked out.
      disabled: !!(u.banned_until && new Date(u.banned_until) > new Date()),
      // WHICH SCHOOL EACH USER BELONGS TO.
      // ------------------------------------------------------------------
      // A tenant admin never needs this: everyone they can see is in their
      // own school by definition, so it comes back null for them.
      //
      // The PLATFORM does need it. Without it the list is a flat roll of
      // every user on the system with no way to tell whose staff is whose
      // -- the same fault the schools list exists to prevent.
      tenantId: (profileById[u.id] && profileById[u.id].tenant_id) || null,
      tenantName: isSuper
        ? ((profileById[u.id] && tenantNameById[profileById[u.id].tenant_id]) || null)
        : null,
      isSuperAdmin: !!(profileById[u.id] && profileById[u.id].is_super_admin)
    }));
    res.status(200).json({ users });
    return;
  }

  if (action === 'setRole') {
    const { userId, role } = body;
    const validRoles = ['view', 'game_entry', 'admin'];
    if (!userId || !validRoles.includes(role)) {
      res.status(400).json({ error: 'A user id and a valid role (view, game_entry, or admin) are required' });
      return;
    }
    if (userId === callerId) {
      res.status(400).json({ error: "You can't change your own role from here." });
      return;
    }
    const wrongTenant = await refuseIfOtherTenant(userId);
    if (wrongTenant) { res.status(403).json({ error: wrongTenant }); return; }
    const { error } = await adminClient.from('profiles').update({ role }).eq('id', userId);
    if (error) { res.status(400).json({ error: error.message }); return; }
    res.status(200).json({ success: true });
    return;
  }

  if (action === 'setPassword') {
    const { userId, newPassword } = body;
    if (!userId || !newPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'A user id and a password of at least 6 characters are required' });
      return;
    }
    const wrongTenant = await refuseIfOtherTenant(userId);
    if (wrongTenant) { res.status(403).json({ error: wrongTenant }); return; }
    const { error } = await adminClient.auth.admin.updateUserById(userId, { password: newPassword });
    if (error) { res.status(400).json({ error: error.message }); return; }
    res.status(200).json({ success: true });
    return;
  }

  if (action === 'sendReset') {
    const { email } = body;
    if (!email) { res.status(400).json({ error: 'An email is required' }); return; }
    // IDENTIFIED BY EMAIL, so the target must be resolved before it can
    // be checked. Without this a school admin could fire a password
    // reset at any address on the platform — not takeover on its own,
    // but it confirms whether an address has an account here and puts a
    // live reset link in somebody else's inbox.
    const resetTargetId = await userIdForEmail(email);
    if (!resetTargetId) { res.status(404).json({ error: 'No user with that email.' }); return; }
    const resetWrongTenant = await refuseIfOtherTenant(resetTargetId);
    if (resetWrongTenant) { res.status(403).json({ error: resetWrongTenant }); return; }
    const { error } = await adminClient.auth.resetPasswordForEmail(email);
    if (error) { res.status(400).json({ error: error.message }); return; }
    res.status(200).json({ success: true });
    return;
  }

  if (action === 'resendInvite') {
    const { email } = body;
    if (!email) { res.status(400).json({ error: 'An email is required' }); return; }
    // A RESEND goes to somebody already in this school. Inviting a NEW
    // person is api/invite-user.js, which stamps the tenant; resending
    // here to an unknown address would create a user with no school.
    const inviteTargetId = await userIdForEmail(email);
    if (!inviteTargetId) { res.status(404).json({ error: 'No pending user with that email — use Invite to add somebody new.' }); return; }
    const inviteWrongTenant = await refuseIfOtherTenant(inviteTargetId);
    if (inviteWrongTenant) { res.status(403).json({ error: inviteWrongTenant }); return; }
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
    const wrongTenant = await refuseIfOtherTenant(userId);
    if (wrongTenant) { res.status(403).json({ error: wrongTenant }); return; }
    const { error } = await adminClient.auth.admin.deleteUser(userId);
    if (error) { res.status(400).json({ error: error.message }); return; }
    res.status(200).json({ success: true });
    return;
  }

  if (action === 'setDisabled') {
    const { userId, disabled } = body;
    if (!userId) { res.status(400).json({ error: 'A user id is required' }); return; }
    // The same guard as delete, and for the same reason: an admin who
    // disables himself is locked out of the only page that could undo it.
    // Enforced HERE rather than only in the UI -- the button being greyed
    // out stops a mis-tap, not someone calling the API directly.
    if (userId === callerId) {
      res.status(400).json({ error: "You can't disable your own account." });
      return;
    }
    // Supabase has no "disabled" flag; the supported way to lock an
    // account out is a ban duration. A very long one is indefinite in
    // practice, and 'none' lifts it.
    const wrongTenant = await refuseIfOtherTenant(userId);
    if (wrongTenant) { res.status(403).json({ error: wrongTenant }); return; }
    const { error } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: disabled ? '876000h' : 'none'
    });
    if (error) { res.status(400).json({ error: error.message }); return; }
    res.status(200).json({ success: true });
    return;
  }

  res.status(400).json({ error: 'Unknown action: ' + action });
};
