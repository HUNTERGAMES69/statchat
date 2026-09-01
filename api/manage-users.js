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
    const tenantDeletedById = {};
    if (isSuper) {
      const tIds = [...new Set((profiles || []).map(p => p.tenant_id).filter(Boolean))];
      if (tIds.length) {
        // deleted_at COMES BACK TOO. Without it a deleted school's staff
        // group under a heading that looks exactly like a live school's,
        // and the console has no way to tell the two apart -- it only ever
        // sees the name. The service key has BYPASSRLS, so nothing filters
        // this for us; it has to be asked for and passed on deliberately.
        const { data: tRows } = await adminClient
          .from('tenants').select('id, name, deleted_at').in('id', tIds);
        (tRows || []).forEach(t => {
          tenantNameById[t.id] = t.name;
          if (t.deleted_at) tenantDeletedById[t.id] = true;
        });
      }
    }

    // WHO ACTUALLY HAS TWO-FACTOR.
    // -------------------------------------------------------------------
    // Read from auth.mfa_factors through users_with_verified_mfa() (033),
    // not from `u.factors` on the listUsers() rows above. That field is
    // typed optional in supabase-js and the client only passes through
    // whatever GoTrue's /admin/users returns; it came back undefined on
    // every row, so `Array.isArray(undefined)` was false everywhere and the
    // console showed "No 2FA" against accounts that plainly had it.
    //
    // ONE call for the whole list, not one per user.
    //
    // A FAILURE HERE IS "NOT KNOWN", NOT "NOBODY HAS IT". Leaving mfaIds
    // null makes every mfaVerified false, and false renders as an amber
    // "No 2FA" against admins -- which is the exact false claim this whole
    // change exists to remove, and it would be indistinguishable from a
    // real finding. So the answer travels with the list: mfaKnown false
    // tells platform.html to render no pill at all and say why.
    let mfaIds = null;
    const { data: mfaRows, error: mfaErr } =
      await adminClient.rpc('users_with_verified_mfa');
    if (mfaErr) {
      // Not fatal. The rest of this page -- roles, invites, disable, reset --
      // is unrelated to MFA and must keep working if 033 has not been
      // applied yet, or if the grant is wrong.
      console.error('users_with_verified_mfa failed: ' + mfaErr.message);
    } else {
      mfaIds = new Set((mfaRows || []).map(r => r.user_id));
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
        // A TEMPORARY PASSWORD IS PENDING UNTIL IT IS USED.
        // Surfaced so the list can say so: an operator who set one and
        // read it out needs to know whether the person has actually been
        // in yet, and a flag still set weeks later means they never did.
        mustChangePassword: !!(u.user_metadata && u.user_metadata.must_change_password),
        passwordSetAt: (u.user_metadata && u.user_metadata.password_set_at) || null,
      // TWO-FACTOR. See the mfaIds lookup above -- NOT u.factors, which is
      // optional on this endpoint and was undefined on every row, reporting
      // the whole platform as having no second factor.
      mfaVerified: mfaIds ? mfaIds.has(u.id) : false,
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
      // IS THAT SCHOOL STILL A SCHOOL. Platform-only, same as tenantName.
      // Migration 018 locks these accounts out and 034 backfilled the ones
      // deleted before 018 existed, so they arrive already disabled -- but
      // "disabled" alone does not say WHY, and a deleted school's staff read
      // identically to a coach someone switched off last week.
      tenantDeleted: isSuper
        ? !!(profileById[u.id] && tenantDeletedById[profileById[u.id].tenant_id])
        : false,
      isSuperAdmin: !!(profileById[u.id] && profileById[u.id].is_super_admin)
    }));
    // mfaKnown travels with the list so the console can tell "nobody has 2FA"
    // apart from "the 2FA lookup did not answer". Rendering an amber "No 2FA"
    // in the second case is a false finding, and one indistinguishable from a
    // real one.
    res.status(200).json({ users, mfaKnown: mfaIds !== null });
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
    // A PASSWORD SET BY SOMEBODY ELSE IS TEMPORARY, ALWAYS.
    // --------------------------------------------------------------------
    // Andy's call, 25 August 2026. The reasoning is specific to this product
    // rather than general hygiene: an operator who can set a LASTING password
    // can sign in as a school's admin and enter or alter plays as them, and
    // the record would show that coach doing it. For an application whose
    // whole value is that the numbers are trustworthy, that is the hole worth
    // closing.
    //
    // So every admin-set password stamps must_change_password. login.html
    // refuses to let the session go anywhere until a new one is chosen, and
    // clears the flag at that point. The temporary password can be read out
    // over the phone and stops working the moment it is used.
    //
    // password_set_by / _at are kept because "who gave this account a
    // password, and when" is exactly the question asked after something looks
    // wrong. Merged into existing metadata rather than replacing it --
    // updateUserById overwrites user_metadata wholesale.
    const { data: existing } = await adminClient.auth.admin.getUserById(userId);
    const priorMeta = (existing && existing.user && existing.user.user_metadata) || {};
    const { error } = await adminClient.auth.admin.updateUserById(userId, {
      password: newPassword,
      user_metadata: Object.assign({}, priorMeta, {
        must_change_password: true,
        password_set_by: callerId,
        password_set_at: new Date().toISOString()
      })
    });
    if (error) { res.status(400).json({ error: error.message }); return; }
    res.status(200).json({ success: true, mustChange: true });
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

  // CHANGE THE ADDRESS ON AN INVITE THAT HAS NOT BEEN ACCEPTED.
  // ---------------------------------------------------------------------
  // Reported 31 Aug 2026: a tenant was created with a typo in its first
  // admin's address. Everything else was correct -- the school, the
  // profile row, the admin role -- and the only wrong thing was a string
  // in auth.users that no screen could reach. Resend invite just sent the
  // same invite to the same wrong inbox again.
  //
  // ONLY BEFORE THE INVITE IS ACCEPTED, which is not timidity: an
  // unconfirmed row is a pending invitation and its address is
  // administrative data. Once somebody has signed in, that address is
  // their identity and their password-reset route, and an operator
  // silently repointing it is account takeover with a friendly button on
  // it. The error below says what to do instead.
  //
  // `profiles` carries no email column -- the address lives only in
  // auth.users -- so this is the whole job. tenant_id and role sit on the
  // profile row and are untouched, which is why the invite does not need
  // re-stamping the way api/invite-user.js does for a new person.
  if (action === 'changeEmail') {
    const { userId } = body;
    const next = String(body.email || '').trim();
    if (!userId) { res.status(400).json({ error: 'A user id is required' }); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next)) {
      res.status(400).json({ error: 'That does not look like an email address.' });
      return;
    }
    const emailWrongTenant = await refuseIfOtherTenant(userId);
    if (emailWrongTenant) { res.status(403).json({ error: emailWrongTenant }); return; }

    const { data: targetData, error: targetErr } =
      await adminClient.auth.admin.getUserById(userId);
    if (targetErr || !targetData || !targetData.user) {
      res.status(404).json({ error: 'No such user.' });
      return;
    }
    const target = targetData.user;
    if (target.email_confirmed_at) {
      res.status(400).json({ error:
        'That invite has already been accepted, so the address cannot be changed here. ' +
        'It is now the account\'s identity and its password-reset route. Disable the ' +
        'account and invite the correct address as a new user instead.' });
      return;
    }
    if ((target.email || '').toLowerCase() === next.toLowerCase()) {
      res.status(400).json({ error:
        'That is already the address on this invite — use Resend invite to send it again.' });
      return;
    }
    // CHECKED BEFORE THE UPDATE, so a clash is a clean refusal rather
    // than a half-applied change plus a database error.
    const clash = await userIdForEmail(next);
    if (clash) {
      res.status(409).json({ error: 'Another account on this platform already uses ' + next + '.' });
      return;
    }

    const { error: updErr } = await adminClient.auth.admin.updateUserById(userId, {
      email: next,
      // Left UNCONFIRMED on purpose. Confirming it here would mark the
      // address verified without anybody having opened anything, and the
      // row would stop showing "Invited" while still being an unaccepted
      // invitation.
      email_confirm: false
    });
    if (updErr) { res.status(400).json({ error: updErr.message }); return; }

    // READ IT BACK rather than trusting the write. GoTrue has more than
    // one way to treat an email change -- applied at once, or parked as a
    // pending email_change -- and reporting "changed to X" when the row
    // still says Y would send an operator away believing a thing that is
    // not true.
    const { data: afterData } = await adminClient.auth.admin.getUserById(userId);
    const landed = afterData && afterData.user ? (afterData.user.email || '') : '';
    if (landed.toLowerCase() !== next.toLowerCase()) {
      res.status(500).json({ error:
        'The change did not stick: the account still reads ' + (landed || 'unknown') +
        '. Nothing was sent. This needs the Supabase dashboard.' });
      return;
    }

    // THE SAME CALL "Resend invite" MAKES, deliberately -- one way of
    // sending an invite, already proven against this project's GoTrue.
    const { error: invErr } = await adminClient.auth.admin.inviteUserByEmail(next);
    if (invErr) {
      // The address IS changed at this point, so this is a partial
      // success and has to be reported as one. Telling the operator it
      // failed would have them repeat a change that already happened.
      res.status(200).json({ success: true, email: next, invited: false,
        error: 'The address was changed to ' + next + ', but the invite did not send: ' +
               invErr.message + ' — use Resend invite on that row.' });
      return;
    }
    res.status(200).json({ success: true, email: next, invited: true });
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
