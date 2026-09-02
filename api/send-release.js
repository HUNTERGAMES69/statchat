// Publish a release note, and send it.
// =====================================================================
// The in-app card on dashboard.html is the system of record: it reaches
// everyone who opens StatChat, cannot land in a spam folder, and needs no
// unsubscribe. This is the megaphone -- the only way to reach an admin who
// has not signed in since August, which before a season starts is exactly
// who you want back.
//
// Same admin-only pattern as manage-users.js: verify the caller's own
// session, verify their profile with the SECRET key (bypassing RLS, so it
// cannot be spoofed from the browser), and only then act. PLATFORM ADMIN
// ONLY -- this writes to every school at once, which is not a school
// admin's decision to make.
//
// TWO SEPARATE DECISIONS, BOTH DELIBERATE.
//   publish  -- the note goes live on dashboards. Reversible.
//   send     -- the note is emailed. Once, ever.
// Uploading releases.js does NEITHER. That was the point Andy made on
// 2 Sep 2026: uploading is how the app gets deployed, for bug fixes and
// stylesheet tweaks and everything else, and an act that routine must not
// also be the act that speaks to every customer.
//
// ---------------------------------------------------------------------
// THE SERVICE ROLE HAS BYPASSRLS.
// Every filter RLS would have applied has to be written by hand here. In
// this file that means three of them, and all three are load-bearing:
//   * role -- the release's own audience list, never everyone
//   * deleted schools -- their staff are not customers any more
//   * opt-outs -- CAN-SPAM, and the person asked
// ---------------------------------------------------------------------

const { createClient } = require('@supabase/supabase-js');

// Content lives in releases.js in the repo, and the browser is what reads
// it -- so the entry travels in the request. VALIDATED HERE ANYWAY: a
// browser-supplied subject and body reaching an email sender is exactly
// the shape of an open relay if it is taken on trust.
function cleanEntry(raw) {
  const e = raw && typeof raw === 'object' ? raw : {};
  const str = (v, max) => String(v == null ? '' : v).slice(0, max);
  const id = str(e.id, 120).trim();
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;
  const audience = Array.isArray(e.audience)
    ? e.audience.filter(r => r === 'admin' || r === 'game_entry')
    : [];
  if (!audience.length) return null;
  const title = str(e.title, 200).trim();
  if (!title) return null;
  return {
    id, audience, title,
    body:  str(e.body, 2000).trim(),
    where: str(e.where, 200).trim(),
    // Same rule the dashboard card uses: a page in this app, never an
    // absolute URL. A link field is the shape that becomes an open
    // redirect the first time somebody pastes one in.
    link: /^[a-z0-9_-]+\.html$/i.test(str(e.link, 80)) ? str(e.link, 80) : ''
  };
}

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// ONE MESSAGE, HOWEVER MANY NOTES. Four things shipping together must not
// be four emails to the same people -- that is how a product-news address
// gets filtered, and the second message is the one that does it.
function emailHtml(entries, origin) {
  const items = entries.map(entry => {
    const link = entry.link ? origin + '/' + entry.link : '';
    return '<div style="margin:0 0 26px;">' +
      '<h2 style="font-size:18px; line-height:1.3; margin:0 0 8px;">' + esc(entry.title) + '</h2>' +
      '<p style="font-size:15px; line-height:1.6; margin:0 0 10px;">' + esc(entry.body) + '</p>' +
      (entry.where
        ? '<p style="font-size:14px; line-height:1.6; margin:0 0 10px; color:#444;">Where: <strong>' +
          esc(entry.where) + '</strong></p>' : '') +
      (link
        ? '<p style="margin:0;"><a href="' + esc(link) +
          '" style="color:#1a7a4c; font-weight:700; font-size:14px;">Take me there &rarr;</a></p>'
        : '') +
    '</div>';
  }).join('');
  const first = entries[0] || {};
  const cta = first.link ? origin + '/' + first.link : origin + '/dashboard.html';
  return '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif; max-width:560px; margin:0 auto; padding:24px; color:#1a1a1a;">' +
    '<div style="font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:#7a7a7a; font-weight:700; margin-bottom:16px;">' +
      (entries.length === 1 ? 'New in StatChat' : entries.length + ' new things in StatChat') + '</div>' +
    items +
    '<p style="margin:0 0 20px;"><a href="' + esc(cta) +
      '" style="background:#1a7a4c; color:#ffffff; text-decoration:none; font-weight:700; ' +
      'font-size:15px; padding:10px 18px; border-radius:6px; display:inline-block;">Open StatChat</a></p>' +
    // CAN-SPAM. Product news is marketing, not transactional: it needs a
    // way out and a real postal address. The opt-out is a reply rather
    // than a link because a one-click unsubscribe endpoint is its own
    // build, and an address nobody reads would be worse than none.
    '<hr style="border:0; border-top:1px solid #e6e6e6; margin:24px 0 12px;">' +
    '<p style="font-size:12px; line-height:1.6; color:#7a7a7a; margin:0;">' +
    'You are getting this because you are listed as an admin on a StatChat account. ' +
    'Use the Unsubscribe link above, or reply with &ldquo;unsubscribe&rdquo;, and we will stop ' +
    'sending product news to this address; you will still see what is new inside the app.<br>' +
    'StatChat &middot; Monroe, Louisiana' +
    '</p></div>';
}

function emailText(entries, origin) {
  const head = entries.length === 1
    ? 'NEW IN STATCHAT\n\n'
    : entries.length + ' NEW THINGS IN STATCHAT\n\n';
  const items = entries.map(entry => {
    const link = entry.link ? origin + '/' + entry.link : '';
    return entry.title + '\n\n' + entry.body + '\n' +
      (entry.where ? '\nWhere: ' + entry.where + '\n' : '') +
      (link ? link + '\n' : '');
  }).join('\n----------\n\n');
  return head + items +
    '\n---\nYou are getting this because you are listed as an admin on a StatChat ' +
    'account. Reply with "unsubscribe" and we will stop sending product news to ' +
    'this address; you will still see what is new inside the app.\n' +
    'StatChat, Monroe, Louisiana\n';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) { res.status(401).json({ error: 'Missing authorization token' }); return; }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    res.status(500).json({ error: 'Server is missing SUPABASE_URL or SUPABASE_SECRET_KEY' });
    return;
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData || !userData.user) {
    res.status(401).json({ error: 'Invalid or expired session -- please sign in again' });
    return;
  }
  const callerId = userData.user.id;

  const { data: profileRows, error: profileError } = await admin
    .from('profiles').select('is_super_admin').eq('id', callerId).limit(1);
  if (profileError) { res.status(500).json({ error: profileError.message }); return; }
  if (!((profileRows || [])[0] || {}).is_super_admin) {
    res.status(403).json({ error: 'Only a platform admin can send a release email' });
    return;
  }

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const action = String(body.action || 'send');

  // ---- what is published, and what has gone out ------------------------
  if (action === 'status') {
    const { data, error } = await admin
      .from('release_state')
      .select('release_id, published_at, emailed_at, recipient_count');
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ state: data || [] });
    return;
  }

  // publish/unpublish act on ONE note; send and preview take a LIST, so a
  // batch of notes published together goes out as a single message.
  const rawList = Array.isArray(body.entries) ? body.entries
                : (body.entry ? [body.entry] : []);
  const entries = rawList.map(cleanEntry).filter(Boolean);
  if (!entries.length) {
    res.status(400).json({ error: 'A release id, title and audience are required.' });
    return;
  }
  if (entries.length !== rawList.length) {
    res.status(400).json({ error: 'One of those notes is missing an id, a title or an audience.' });
    return;
  }
  {
    const ids = entries.map(e => e.id);
    if (new Set(ids).size !== ids.length) {
      res.status(400).json({ error: 'The same note is in that batch twice.' });
      return;
    }
  }
  const entry = entries[0];

  // ---- PUBLISH / UNPUBLISH ---------------------------------------------
  // The switch between "written" and "live on every dashboard". Reversible
  // both ways: a note pulled back down disappears from dashboards on the
  // next load, which is the whole reason this is a row and not a file flag.
  //
  // Unpublishing does NOT un-email anything, and does not reset who has
  // dismissed what -- a person who read it read it.
  if (action === 'publish' || action === 'unpublish') {
    if (entries.length !== 1) {
      res.status(400).json({ error: 'Publish and take down act on one note at a time.' });
      return;
    }
    const { data: existing } = await admin
      .from('release_state').select('release_id, emailed_at')
      .eq('release_id', entry.id).limit(1);
    const row = (existing || [])[0];
    const fields = action === 'publish'
      ? { published_at: new Date().toISOString(), published_by: callerId }
      : { published_at: null, published_by: null };
    let error;
    if (row) {
      ({ error } = await admin.from('release_state')
        .update(fields).eq('release_id', entry.id));
    } else {
      ({ error } = await admin.from('release_state')
        .insert(Object.assign({ release_id: entry.id }, fields)));
    }
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({
      published: action === 'publish',
      message: action === 'publish'
        ? 'Live now. It will appear on the dashboard of every ' +
          entry.audience.join(' and ') + ' who has not already dismissed it.'
        : 'Taken down. It will stop appearing on the next dashboard load. ' +
          'Anyone who already read it has still read it.'
    });
    return;
  }

  // ---- A NOTE CANNOT BE EMAILED BEFORE IT IS PUBLISHED ------------------
  // The email links people INTO the app. Mailing a note that is not live
  // sends them to a dashboard that says nothing about it.
  const { data: allState } = await admin
    .from('release_state').select('release_id, published_at, emailed_at, recipient_count');
  const stateById = {};
  (allState || []).forEach(r => { stateById[r.release_id] = r; });

  // EVERY NOTE IN THE BATCH MUST BE LIVE. The email links people into the
  // app; a note that is not published sends them to a dashboard that says
  // nothing about it.
  const notLive = entries.filter(e => !(stateById[e.id] && stateById[e.id].published_at));
  if (notLive.length) {
    res.status(400).json({
      error: 'Publish ' + (notLive.length === 1 ? 'this note' : 'these notes') +
        ' first, or leave ' + (notLive.length === 1 ? 'it' : 'them') +
        ' out of the batch: ' + notLive.map(e => e.id).join(', ') +
        '. An email points people at a note that is not live yet.'
    });
    return;
  }

  // AND NONE OF THEM CAN HAVE GONE ALREADY. Refused as a whole rather than
  // quietly dropping the ones already sent -- "I sent four" must mean four.
  const already = entries.filter(e => stateById[e.id] && stateById[e.id].emailed_at);
  if (already.length && action === 'send') {
    res.status(200).json({
      alreadySent: true,
      message: (already.length === 1 ? 'That note was' : 'Some of those notes were') +
        ' already emailed (' + already.map(e => e.id).join(', ') +
        '). Nothing was sent. Clear ' + (already.length === 1 ? 'it' : 'them') +
        ' from the selection and send the rest.'
    });
    return;
  }

  // ---- ALREADY SENT IS A NO-OP, NOT AN ERROR TO WORK AROUND ------------
  // A duplicate announcement to every school cannot be taken back, and the
  // second press of a button is far more likely to be a double-click than
  // a decision.


  // ---- who it goes to --------------------------------------------------
  // THE BATCH'S AUDIENCE IS THE UNION; EACH PERSON'S MESSAGE IS NOT.
  // A batch can mix an admin-only note with one a scorer should also see.
  // Mailing the union to everybody would put the admin-only note in a
  // scorer's inbox, which is the same leak as showing it on their
  // dashboard. So recipients are grouped by ROLE and each group is sent
  // only the notes its role is an audience for.
  const ROLES = ['admin', 'game_entry'];
  const audience = ROLES.filter(r => entries.some(e => e.audience.indexOf(r) > -1));

  const { data: people, error: peopleError } = await admin
    .from('profiles').select('id, role, tenant_id, release_email_opt_out')
    .in('role', audience);
  if (peopleError) { res.status(500).json({ error: peopleError.message }); return; }

  // A DELETED SCHOOL IS NOT A CUSTOMER. Its staff rows survive deletion --
  // the same fault manage-users.js had to fix on its own list, and the
  // reason that endpoint carries a tenantDeletedById map.
  const tenantIds = [...new Set((people || []).map(p => p.tenant_id).filter(Boolean))];
  const deleted = {};
  if (tenantIds.length) {
    const { data: tenants } = await admin
      .from('tenants').select('id, deleted_at').in('id', tenantIds);
    (tenants || []).forEach(t => { if (t.deleted_at) deleted[t.id] = true; });
  }

  const wanted = (people || []).filter(p =>
    !p.release_email_opt_out && p.tenant_id && !deleted[p.tenant_id]);
  const roleById = {};
  wanted.forEach(p => { roleById[p.id] = p.role; });
  const wantedIds = new Set(wanted.map(p => p.id));

  // Addresses live in auth.users, not profiles. listUsers() is paginated
  // and defaults to 50 -- taking the first page only would silently email
  // some of the platform and report success.
  const byRole = {};                       // role -> [address]
  const seen = new Set();
  ROLES.forEach(r => { byRole[r] = []; });
  for (let page = 1; page <= 40; page++) {
    const { data: list, error: listError } =
      await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listError) { res.status(500).json({ error: listError.message }); return; }
    const users = (list && list.users) || [];
    users.forEach(u => {
      if (!wantedIds.has(u.id)) return;
      const addr = String(u.email || '').trim().toLowerCase();
      // ONE ADDRESS, ONE MESSAGE. A person who is somehow in both groups
      // gets the wider one, never two emails.
      if (!addr || seen.has(addr)) return;
      // A DISABLED ACCOUNT IS NOT A RECIPIENT. Same test manage-users.js
      // uses to draw its "disabled" badge.
      if (u.banned_until && new Date(u.banned_until) > new Date()) return;
      seen.add(addr);
      (byRole[roleById[u.id]] || []).push(addr);
    });
    if (users.length < 200) break;
  }

  // What each group actually gets, in file order.
  const groups = ROLES
    .map(role => ({
      role: role,
      emails: byRole[role] || [],
      notes: entries.filter(e => e.audience.indexOf(role) > -1)
    }))
    .filter(g => g.emails.length && g.notes.length);

  const totalRecipients = groups.reduce((n, g) => n + g.emails.length, 0);
  if (!totalRecipients) {
    res.status(200).json({ sent: 0, message: 'Nobody matched that audience, so nothing was sent.' });
    return;
  }

  // ---- dry run ---------------------------------------------------------
  // WHO WOULD GET THIS, before anybody does. Counts only -- the addresses
  // are not this screen's business and putting them in a response is how
  // a customer list ends up in a browser cache.
  if (action === 'preview') {
    res.status(200).json({
      preview: true,
      recipientCount: totalRecipients,
      // Per group, so a batch that mixes audiences says what each will
      // actually receive rather than one number that hides the split.
      groups: groups.map(g => ({
        role: g.role, recipients: g.emails.length, notes: g.notes.length
      }))
    });
    return;
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    res.status(500).json({ error: 'RESEND_API_KEY is not set, so no email can be sent. The in-app card is unaffected.' });
    return;
  }
  const from = process.env.RELEASE_NOTIFY_FROM || 'StatChat <noreply@statchat.co>';
  const origin = 'https://statchat.co';
  // The bare address out of "Name <addr>", for the unsubscribe header and
  // for the to: field below.
  const fromAddr = (from.match(/<([^>]+)>/) || [null, from])[1].trim();
  // Confirmed 2 Sep 2026: noreply@statchat.co is a real mailbox in the
  // Microsoft 365 tenant (statchat.co MX -> outlook.com), so a reply
  // actually arrives. CAN-SPAM wants a WORKING opt-out for 30 days, and a
  // reply address that bounces is worse than none -- it is the thing you
  // would be relying on.
  const unsubTo = process.env.RELEASE_UNSUBSCRIBE_TO || fromAddr;

  // BCC, NOT TO. A single message addressed to every admin on the platform
  // would publish one school's staff address to every other school.
  // Batched because Resend caps recipients per message; each batch is sent
  // to the from-address with the real recipients in bcc.
  let delivered = 0;
  const failures = [];
  for (const group of groups) {
   const subject = group.notes.length === 1
     ? 'New in StatChat: ' + group.notes[0].title
     : group.notes.length + ' new things in StatChat';
   for (let i = 0; i < group.emails.length; i += 40) {
    const batch = group.emails.slice(i, i + 40);
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: [fromAddr], bcc: batch,
          reply_to: unsubTo,
          subject: subject,
          // LIST-UNSUBSCRIBE. Gmail and Outlook render this as a native
          // Unsubscribe link beside the sender, which is both easier than
          // replying and materially better for placement -- a reader who
          // cannot find the way out presses Spam instead, and that is the
          // signal that costs you the next send.
          //
          // mailto form, not the one-click POST form: one-click requires
          // an endpoint that unsubscribes with NO confirmation step, and
          // a URL that mutates on an unauthenticated GET is exactly what
          // mail scanners follow by accident. At this volume the mailto is
          // both compliant and safer.
          headers: {
            'List-Unsubscribe': '<mailto:' + unsubTo + '?subject=unsubscribe>'
          },
          html: emailHtml(group.notes, origin),
          text: emailText(group.notes, origin)
        })
      });
      if (r.ok) delivered += batch.length;
      else failures.push(group.role + ' batch ' + (i / 40 + 1) + ': HTTP ' + r.status);
    } catch (e) {
      failures.push(group.role + ' batch ' + (i / 40 + 1) + ': ' +
                    (e && e.message ? e.message : String(e)));
    }
   }
  }

  // RECORDED ONLY IF SOMETHING ACTUALLY WENT. Writing this row after a
  // total failure would mark the release sent and make it unsendable --
  // the announcement lost permanently, with the button reporting success.
  // EVERY NOTE IN THE BATCH IS MARKED, not just the first. Leaving one
  // unmarked would let it be emailed again on its own, to people who have
  // already read it in the message that went out today.
  //
  // The rows already exist -- a send cannot happen before a publish.
  if (delivered > 0) {
    const stamp = new Date().toISOString();
    for (const e of entries) {
      await admin.from('release_state').update({
        emailed_at: stamp, emailed_by: callerId, recipient_count: delivered
      }).eq('release_id', e.id);
    }
  }

  const noteCount = entries.length;
  res.status(200).json({
    sent: delivered,
    attempted: totalRecipients,
    notes: noteCount,
    failures: failures.length ? failures : undefined,
    message: delivered === totalRecipients
      ? 'Sent ' + noteCount + ' note' + (noteCount === 1 ? '' : 's') +
        ' to ' + delivered + ' recipient(s)' +
        (groups.length > 1
          ? ' (' + groups.map(g => g.emails.length + ' ' +
              (g.role === 'admin' ? 'admin' : 'scorer') + (g.emails.length === 1 ? '' : 's') +
              ', ' + g.notes.length + ' note' + (g.notes.length === 1 ? '' : 's')).join('; ') + ')'
          : '') + '.'
      : 'Sent to ' + delivered + ' of ' + totalRecipients + ' recipient(s). ' +
        'Nothing was recorded as sent unless at least one went, so this can be retried.'
  });
};
