// Contact form — enquiries from the public brochure
// =================================================
// POST /api/contact  { name, email, organization, message, website }
//
// Writes to public.leads with the service key. There is no third-party
// form service in the path: no extra account, no vendor holding names
// and email addresses, nothing to renew.
//
// THIS ENDPOINT IS PUBLIC AND UNAUTHENTICATED, by necessity — the people
// using it do not have accounts, which is the entire point. So it is
// written on the assumption that most of what reaches it will be bots.
// The defenses below are deliberately cheap ones that cost a real person
// nothing; anything stronger (a captcha) taxes the human to stop the
// robot, and this form gets a handful of genuine submissions a month.
//
// TWO THINGS HAPPEN, IN ORDER OF IMPORTANCE. The row is written first
// and is the record; the notification email is best-effort on top. If
// Resend is down, or the key is missing, or the send just fails, the
// lead is still saved and the visitor still gets a success — because
// the alternative is telling a potential customer their message failed
// when it is sitting safely in the database.
//
// Whatever happens, the leads table is the source of truth:
//
//     select created_at, name, email, organization, message
//       from leads where not handled order by created_at desc;

const { createClient } = require('@supabase/supabase-js');

const MAX = { name: 120, email: 254, organization: 160, message: 4000 };

// keepBreaks matters for the message field and nothing else. Collapsing
// every run of whitespace is right for a name or an organization, and
// wrong for a paragraph: someone who writes three of them should not
// arrive as one block of run-on text. So line breaks survive here, runs
// of blank lines are capped at one, and control characters still go.
function clean(v, cap, keepBreaks) {
  if (typeof v !== 'string') return '';
  var out = keepBreaks
    ? v.replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')  // all controls EXCEPT \n
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]*\n[ \t]*/g, '\n')
    : v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ');
  return out.trim().slice(0, cap);
}

// Deliberately loose. The only thing worth rejecting here is input that
// cannot be an address at all; anything tighter starts refusing valid
// addresses, and a bounced reply is a cheaper failure than a form that
// turns away a real customer.
function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(s);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Use POST.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  // HONEYPOT. The form carries a field named `website` that is hidden
  // from people and left empty by them. Anything that fills it in is
  // filling in every field it can find, which people do not do.
  //
  // Flagged rather than rejected, and the response is a normal success.
  // Telling a bot it was caught teaches whoever wrote it to stop filling
  // that field; saying "thanks" teaches them nothing. And if the trap
  // ever catches a real person -- a password manager, an odd browser --
  // the row is still there to be found rather than silently discarded.
  const trapped = clean(body.website, 200).length > 0;

  // TWO KINDS OF SUBMISSION THROUGH ONE ENDPOINT, added 3 September 2026.
  //
  // 'support' comes from support.html and asks for an email address and a
  // description, nothing else. A customer whose password has stopped
  // working at 7pm on a Friday should not be made to fill in a sales form
  // to say so, and their school is not what we need to help them -- being
  // able to write back is.
  //
  // Anything else is the brochure enquiry, unchanged: name, email and
  // organization all required, exactly as before. Read from the body but
  // never trusted from it -- the routing and the required-field rules are
  // both decided here.
  const isSupport = body.topic === 'support';

  const name = clean(body.name, MAX.name);
  const email = clean(body.email, MAX.email).toLowerCase();
  const organization = clean(body.organization, MAX.organization);
  const message = clean(body.message, MAX.message, true);

  // ORGANIZATION IS REQUIRED TOO, since 2 Sep 2026.
  //
  // The form gates on it as well. Both ends check for the same reason the
  // email rule is duplicated here rather than trusted from the page: two
  // different definitions of a valid submission is how a form accepts
  // something the server then refuses -- or, worse, how a direct POST that
  // never saw the form writes a lead nobody can qualify.
  //
  // A SUPPORT REQUEST NEEDS TWO THINGS: somewhere to reply, and something
  // to reply about. Name and organization stay optional on that path.
  if (isSupport) {
    if (!email || !message) {
      res.status(400).json({ ok: false, error: !email
        ? 'Please give an email address so we can reply.'
        : 'Please describe what is happening.' });
      return;
    }
  } else if (!name || !email || !organization) {
    res.status(400).json({ ok: false, error: !organization && name && email
      ? 'Please tell us your school, team or production company.'
      : 'Please give your name and email.' });
    return;
  }
  if (!looksLikeEmail(email)) {
    res.status(400).json({ ok: false, error: 'That email address does not look right.' });
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    // Configuration failure, not the sender's fault. Say so plainly and
    // log it, rather than reporting a fake success and losing the lead.
    console.error('contact: SUPABASE_URL or SUPABASE_SECRET_KEY missing');
    res.status(500).json({ ok: false, error: 'Could not send that just now. Please email ' + (isSupport ? 'support' : 'signup') + '@statchat.co.' });
    return;
  }

  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { error } = await supabase.from('leads').insert({
      // leads.name is NOT NULL and a support request does not ask for one,
      // so the email stands in. It is the only identifier we have and it
      // is the one that matters, rather than an invented placeholder that
      // reads like a real name in a list.
      name: name || email,
      email, organization: organization || null, message: message || null,
      // SUPPORT ROWS ARE FINDABLE, which is the whole reason for putting
      // them in the same table rather than a new one:
      //   select * from leads where source = 'support' and not handled;
      // The enquiry path keeps writing the referer, unchanged.
      source: isSupport ? 'support'
        : (clean(req.headers['referer'] || req.headers['referrer'] || '', 300) || null),
      user_agent: clean(req.headers['user-agent'] || '', 300) || null,
      flagged: trapped
    });
    if (error) {
      console.error('contact: insert failed:', error.message);
      res.status(500).json({ ok: false, error: 'Could not send that just now. Please email ' + (isSupport ? 'support' : 'signup') + '@statchat.co.' });
      return;
    }
  } catch (e) {
    console.error('contact: unexpected:', e && e.message);
    res.status(500).json({ ok: false, error: 'Could not send that just now. Please email ' + (isSupport ? 'support' : 'signup') + '@statchat.co.' });
    return;
  }

  // ---- notify, best-effort -----------------------------------------
  // Deliberately AFTER the insert and deliberately not awaited into the
  // response path's success/failure. A notification that fails must not
  // turn a saved lead into a reported error.
  //
  // Addresses come from the environment rather than the source: the
  // sending domain has to be one Resend has verified, and hardcoding it
  // here means a change of address is a code deploy.
  try {
    const resendKey = process.env.RESEND_API_KEY;
    // WHERE IT LANDS, decided by the kind of submission. Both still come
    // from the environment first, for the reason the comment above gives:
    // the sending domain has to be one Resend has verified, and an address
    // hardcoded here makes a change of address a code deploy.
    const to   = isSupport
      ? (process.env.SUPPORT_NOTIFY_TO || 'support@statchat.co')
      : (process.env.LEAD_NOTIFY_TO    || 'signup@statchat.co');
    const from = process.env.LEAD_NOTIFY_FROM || 'StatChat <noreply@statchat.co>';
    if (resendKey) {
      const esc = (v) => String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: [to],
          // REPLY-TO IS THE LEAD. Hitting reply in a mail client should
          // answer the person who filled the form, not bounce off the
          // no-reply address this was sent from.
          reply_to: email,
          subject: (isSupport ? 'StatChat support — ' + email
                              : 'StatChat enquiry — ' + (organization || name))
                   + (trapped ? ' [flagged]' : ''),
          html:
            (trapped ? '<p><strong>Flagged by the spam trap.</strong> Filled the hidden field. ' +
                       'Saved and shown here anyway in case it is a real person.</p>' : '') +
            // A support request has no name to lead with, so the address
            // is the heading. Repeating the email as a fake name would
            // read like a person and look wrong in a mail client.
            (isSupport ? '<p><strong>' + esc(email) + '</strong></p>'
                       : '<p><strong>' + esc(name) + '</strong> &lt;' + esc(email) + '&gt;</p>') +
            (organization ? '<p>' + esc(organization) + '</p>' : '') +
            (message ? '<p>' + esc(message).replace(/\n/g, '<br>') + '</p>' : '<p><em>No message.</em></p>') +
            '<hr><p style="color:#888;font-size:12px">From ' + esc(req.headers['referer'] || 'the site') + '</p>'
        })
      });
      if (!r.ok) console.error('contact: resend returned', r.status, await r.text().catch(() => ''));
    } else {
      console.warn('contact: RESEND_API_KEY not set — row saved, nobody notified');
    }
  } catch (e) {
    console.error('contact: notify failed (lead IS saved):', e && e.message);
  }

  res.status(200).json({ ok: true });
};
