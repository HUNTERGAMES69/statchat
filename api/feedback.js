// Bug reports and feature requests from inside the app
// ====================================================
// POST /api/feedback  { kind: 'bug'|'feature', title, body, source }
// Authorization: Bearer <the caller's own session token>
//
// Writes public.feedback with the service key, then emails support@ or
// features@ depending on kind. Same shape as /api/contact, and the same
// order of importance: THE ROW IS THE RECORD, the email is a notification
// on top of it.
//
// WHY THAT ORDER MATTERS HERE. The send can fail for reasons nobody in
// the building will notice -- a rotated Resend key, an outage, a rate
// limit, DKIM lapsing on statchat.co, a cold-start timeout. The person
// who has just typed three paragraphs cannot be told "that failed, type
// it again", and must not be told it worked when it did not. So the
// insert happens first and decides the response; the email is attempted
// after, and its outcome is recorded in `notified` rather than shown.
//
// UNLIKE /api/contact, THIS ENDPOINT IS AUTHENTICATED. The form is behind
// a login, so there is no bot problem, no spam trap and no captcha
// question -- and, more usefully, the identity does not have to be asked
// for. Who they are, which school they belong to and what their email is
// all come from the verified session, never from the request body. That
// is the same rule /api/invite-user follows for the tenant: a browser
// cannot claim to be somebody else.
//
//     select created_at, kind, tenant_name, user_email, title, body
//       from feedback where not handled order by created_at desc;
//     select * from feedback where not notified and not handled;

const { createClient } = require('@supabase/supabase-js');

const MAX = { title: 140, body: 4000 };

// Two inboxes, and the routing lives HERE rather than in the browser. A
// kind arriving from the client picks between these; it cannot supply an
// address, so no request can aim this endpoint at a third party.
const INBOX = {
  bug:     'support@statchat.co',
  feature: 'features@statchat.co'
};
const LABEL = { bug: 'Bug report', feature: 'Feature request' };

// A person can file five in ten minutes. That is far more than anyone
// reporting a real problem needs, and it caps the damage if a page ever
// loops on submit -- which is the realistic failure here, not abuse.
const RATE = { count: 5, minutes: 10 };

// keepBreaks for the description and nothing else: someone who writes
// three paragraphs should not arrive as one block of run-on text. Same
// helper as /api/contact, deliberately -- two cleaners that differ by a
// character is how one of them ends up wrong.
function clean(v, cap, keepBreaks) {
  if (typeof v !== 'string') return '';
  const out = keepBreaks
    ? v.replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')  // controls EXCEPT \n
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]*\n[ \t]*/g, '\n')
    : v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ');
  return out.trim().slice(0, cap);
}

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Use POST.' });
    return;
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    res.status(401).json({ ok: false, error: 'Missing authorization token' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const kind  = body.kind === 'feature' ? 'feature' : (body.kind === 'bug' ? 'bug' : null);
  const title = clean(body.title, MAX.title, false);
  const text  = clean(body.body,  MAX.body,  true);

  if (!kind) {
    res.status(400).json({ ok: false, error: 'Choose whether this is a bug or a feature request.' });
    return;
  }
  if (!title) { res.status(400).json({ ok: false, error: 'A title is required.' }); return; }
  if (!text)  { res.status(400).json({ ok: false, error: 'A description is required.' }); return; }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    res.status(500).json({ ok: false, error: 'Server is missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variables' });
    return;
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

  // The token has to belong to a real, currently-valid session.
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData || !userData.user) {
    res.status(401).json({ ok: false, error: 'Invalid or expired session — please sign in again' });
    return;
  }
  const user = userData.user;

  // IDENTITY FROM THE DATABASE, NOT THE BODY. Read with the secret key so
  // it bypasses RLS and cannot be tricked by anything the browser sends.
  let profile = null;
  try {
    const { data } = await admin.from('profiles')
      .select('full_name, tenant_id').eq('id', user.id).limit(1);
    profile = (data || [])[0] || null;
  } catch (e) {
    // A missing profile is not a reason to lose the report. The platform
    // account has no tenant at all, and a brand-new invite may arrive
    // here before its row is fully populated.
    console.warn('feedback: profile lookup failed', e && e.message);
  }

  let tenantName = null;
  if (profile && profile.tenant_id) {
    try {
      const { data } = await admin.from('tenants')
        .select('name, full_name').eq('id', profile.tenant_id).limit(1);
      const t = (data || [])[0];
      if (t) tenantName = t.full_name || t.name || null;
    } catch (e) {
      console.warn('feedback: tenant lookup failed', e && e.message);
    }
  }

  // RATE LIMIT, read from the table we now have. Cheap, and it only ever
  // stops a runaway page: five in ten minutes is far past what a person
  // filing a real report will do.
  try {
    const since = new Date(Date.now() - RATE.minutes * 60 * 1000).toISOString();
    const { count } = await admin.from('feedback')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', since);
    if (typeof count === 'number' && count >= RATE.count) {
      res.status(429).json({ ok: false,
        error: 'That is a lot of requests in a few minutes. Give it ten minutes and try again — nothing you already sent has been lost.' });
      return;
    }
  } catch (e) {
    // A failed rate-limit read must not refuse a legitimate report.
    console.warn('feedback: rate check failed, allowing', e && e.message);
  }

  // ---- THE RECORD -------------------------------------------------------
  const row = {
    kind,
    title,
    body: text,
    user_id: user.id,
    tenant_id: (profile && profile.tenant_id) || null,
    user_email: user.email || null,
    user_name: (profile && profile.full_name) || null,
    tenant_name: tenantName,
    user_agent: clean(req.headers['user-agent'], 400, false) || null,
    source: clean(body.source || req.headers['referer'], 300, false) || null
  };

  const { data: inserted, error: insertError } = await admin
    .from('feedback').insert(row).select('id').limit(1);

  if (insertError) {
    // THE ONE FAILURE THE USER IS TOLD ABOUT, because it is the only one
    // where nothing was kept. Everything after this point is best-effort.
    console.error('feedback: insert failed', insertError.message);
    res.status(500).json({ ok: false,
      error: 'Could not save that. Nothing was sent — please try again, or email support@statchat.co directly.' });
    return;
  }
  const id = ((inserted || [])[0] || {}).id || null;

  // ---- THE NOTIFICATION, best-effort ------------------------------------
  const to = INBOX[kind];
  let notified = false;
  try {
    const resendKey = process.env.RESEND_API_KEY;
    const from = process.env.LEAD_NOTIFY_FROM || 'StatChat <noreply@statchat.co>';
    if (resendKey) {
      const who = [row.user_name, row.user_email].filter(Boolean).join(' ');
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: [to],
          // REPLY-TO IS THE PERSON WHO FILED IT. Hitting reply should
          // answer the coach, not bounce off the no-reply address.
          reply_to: row.user_email || undefined,
          subject: LABEL[kind] + ' — ' + (tenantName ? tenantName + ' — ' : '') + title,
          html:
            '<p><strong>' + esc(LABEL[kind]) + '</strong></p>' +
            '<h2 style="margin:6px 0 12px">' + esc(title) + '</h2>' +
            '<p>' + esc(text).replace(/\n/g, '<br>') + '</p>' +
            '<hr>' +
            '<p style="color:#888;font-size:12px">' +
              esc(who || 'unknown user') +
              (tenantName ? '<br>' + esc(tenantName) : '') +
              (row.source ? '<br>from ' + esc(row.source) : '') +
              (row.user_agent ? '<br>' + esc(row.user_agent) : '') +
              (id ? '<br>feedback id ' + esc(id) : '') +
            '</p>'
        })
      });
      if (r.ok) notified = true;
      else console.error('feedback: resend returned', r.status, await r.text().catch(() => ''));
    } else {
      console.warn('feedback: RESEND_API_KEY not set — request saved, nobody notified');
    }
  } catch (e) {
    console.error('feedback: notify failed (request IS saved):', e && e.message);
  }

  // Recorded, not shown. `notified = false` with a row present is exactly
  // the state this table exists to preserve, and it is worth being able
  // to find afterwards.
  if (notified && id) {
    try { await admin.from('feedback').update({ notified: true }).eq('id', id); }
    catch (e) { console.warn('feedback: could not flag notified', e && e.message); }
  }

  // The user is told it arrived, because it did. Whether the email left
  // is our problem, not theirs.
  res.status(200).json({ ok: true, kind, to });
};
