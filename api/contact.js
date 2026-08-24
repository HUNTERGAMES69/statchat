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
// The defences below are deliberately cheap ones that cost a real person
// nothing; anything stronger (a captcha) taxes the human to stop the
// robot, and this form gets a handful of genuine submissions a month.
//
// NOTE: nothing here EMAILS anyone. Supabase's built-in mail is
// development-only and custom SMTP is still an open item (see TODO).
// Until that is done, leads are read from the SQL editor:
//
//     select created_at, name, email, organization, message
//       from leads where not handled order by created_at desc;

const { createClient } = require('@supabase/supabase-js');

const MAX = { name: 120, email: 254, organization: 160, message: 4000 };

function clean(v, cap) {
  if (typeof v !== 'string') return '';
  // Strip control characters, collapse runs of whitespace, then cap.
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, cap);
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

  const name = clean(body.name, MAX.name);
  const email = clean(body.email, MAX.email).toLowerCase();
  const organization = clean(body.organization, MAX.organization);
  const message = clean(body.message, MAX.message);

  if (!name || !email) {
    res.status(400).json({ ok: false, error: 'Please give your name and email.' });
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
    res.status(500).json({ ok: false, error: 'Could not send that just now. Please email signup@statchat.co.' });
    return;
  }

  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { error } = await supabase.from('leads').insert({
      name, email, organization: organization || null, message: message || null,
      source: clean(req.headers['referer'] || req.headers['referrer'] || '', 300) || null,
      user_agent: clean(req.headers['user-agent'] || '', 300) || null,
      flagged: trapped
    });
    if (error) {
      console.error('contact: insert failed:', error.message);
      res.status(500).json({ ok: false, error: 'Could not send that just now. Please email signup@statchat.co.' });
      return;
    }
  } catch (e) {
    console.error('contact: unexpected:', e && e.message);
    res.status(500).json({ ok: false, error: 'Could not send that just now. Please email signup@statchat.co.' });
    return;
  }

  res.status(200).json({ ok: true });
};
