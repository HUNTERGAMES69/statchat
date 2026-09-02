// The public contact form and its endpoint — index.html, api/contact.js
// =====================================================================
// The brochure's form is the only way a stranger reaches Andy, and until
// 24 Aug 2026 nothing checked it. It is also the only public,
// unauthenticated write path in the whole product: anything that reaches
// /api/contact was sent by someone with no account, which means most of
// what reaches it will eventually be a bot.
//
// THE RULE THIS FILE MOSTLY EXISTS TO DEFEND: the database write is the
// record and the notification email is best-effort on top. A Resend
// outage, a missing key or a 4xx must still leave the lead saved AND
// still tell the visitor it worked — because telling a potential
// customer their message failed when it is sitting safely in the
// database is the worse error. A DATABASE failure is different and must
// be reported.
//
// The honeypot deserves a note. `website` is a field hidden from people
// and filled in by anything that fills every field it finds. A hit is
// FLAGGED, not rejected, and still gets a normal success: telling a bot
// it was caught teaches whoever wrote it to stop filling that field, and
// if the trap ever catches a real person the row is still there.
//
// One assertion here was strengthened after a mutation slipped through:
// checking that the honeypot KEY is sent passes even when the value is
// blanked, which defeats the trap silently. It now checks the value.
//
//   node tests/contact_check.js

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

// ---- endpoint -----------------------------------------------------------
// The handler requires @supabase/supabase-js. Rather than install it, the
// resolver is patched for this one specifier so the check runs anywhere.
function loadHandler(state) {
  const realResolve = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) {
    if (req === '@supabase/supabase-js') return '@supabase/supabase-js';
    return realResolve.call(this, req, ...rest);
  };
  require.cache['@supabase/supabase-js'] = { id: '@supabase/supabase-js', loaded: true,
    exports: { createClient: () => ({ from: () => ({ insert: async row => {
      if (state.insertFails) return { error: { message: 'db down' } };
      state.inserted.push(row); return {};
    } }) }) } };
  delete require.cache[require.resolve(path.join(ROOT, 'api', 'contact.js'))];
  const h = require(path.join(ROOT, 'api', 'contact.js'));
  Module._resolveFilename = realResolve;
  return h;
}

function res() {
  const r = { code: null, body: null };
  r.setHeader = () => {}; r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; return r; }; r.end = () => r;
  return r;
}

async function endpointChecks(bad) {
  const state = { inserted: [], mails: [], insertFails: false, mailMode: 'ok' };
  const handler = loadHandler(state);
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    state.mails.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    if (state.mailMode === 'throw') throw new Error('resend unreachable');
    if (state.mailMode === 'fail') return { ok: false, status: 422, text: async () => 'bad from' };
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const H = { 'user-agent': 'check/1.0', referer: 'https://www.statchat.co/' };
  const good = { name: 'Coach Reed', email: 'coach@school.edu',
                 organization: 'Riverside HS', message: 'Three cameras.\nvMix.' };
  process.env.SUPABASE_URL = 'https://x';
  process.env.SUPABASE_SECRET_KEY = 'k';
  process.env.RESEND_API_KEY = 're_test';
  const ok = (c, d) => { if (!c) bad('endpoint', d); };

  let r = res(); await handler({ method: 'GET', headers: H, body: {} }, r);
  ok(r.code === 405, 'GET is not rejected');

  r = res(); await handler({ method: 'POST', headers: H, body: { name: '', email: 'a@b.co' } }, r);
  ok(r.code === 400, 'a missing name is accepted');
  r = res(); await handler({ method: 'POST', headers: H, body: { name: 'A', email: 'nope' } }, r);
  ok(r.code === 400, 'a malformed email is accepted');

  r = res(); await handler({ method: 'POST', headers: H, body: { ...good } }, r);
  ok(r.code === 200 && r.body.ok, 'a good submission does not return ok');
  const row = state.inserted[state.inserted.length - 1];
  ok(row && row.name === 'Coach Reed', 'whitespace is not collapsed in a name');
  ok(row && row.email === 'coach@school.edu', 'the email is not lowercased');
  ok(row && row.flagged === false, 'a normal submission is flagged');
  ok(/\n/.test(row.message), 'paragraph breaks are collapsed out of the message — someone ' +
     'who writes three paragraphs arrives as one run-on block');
  const mail = state.mails[state.mails.length - 1];
  ok(mail && mail.body.reply_to === 'coach@school.edu',
     'reply-to is not the lead — hitting reply would answer no-reply');
  ok(mail && !/<script>/.test(mail.body.html || ''), 'submitted HTML is not escaped in the email');

  r = res(); await handler({ method: 'POST', headers: H,
    body: { ...good, name: '<script>x</script>' } }, r);
  ok(!/<script>/.test(state.mails[state.mails.length - 1].body.html), 'HTML in a name is not escaped');

  r = res(); await handler({ method: 'POST', headers: H, body: { ...good, website: 'http://spam' } }, r);
  ok(r.code === 200 && r.body.ok, 'a honeypot hit is told it was caught');
  ok(state.inserted[state.inserted.length - 1].flagged === true, 'a honeypot hit is not flagged');
  ok(/\[flagged\]/.test(state.mails[state.mails.length - 1].body.subject),
     'a flagged submission is not marked in the subject, so it cannot be triaged from the inbox');

  // THE IMPORTANT ONES
  state.mailMode = 'fail'; state.inserted = [];
  r = res(); await handler({ method: 'POST', headers: H, body: { ...good } }, r);
  ok(r.code === 200 && r.body.ok, 'a Resend 4xx is reported to the visitor as a failure');
  ok(state.inserted.length === 1, 'a Resend 4xx loses the lead');

  state.mailMode = 'throw'; state.inserted = [];
  r = res(); await handler({ method: 'POST', headers: H, body: { ...good } }, r);
  ok(r.code === 200 && r.body.ok, 'Resend being unreachable is reported as a failure');
  ok(state.inserted.length === 1, 'Resend being unreachable loses the lead');
  state.mailMode = 'ok';

  delete process.env.RESEND_API_KEY;
  state.inserted = []; state.mails = [];
  r = res(); await handler({ method: 'POST', headers: H, body: { ...good } }, r);
  ok(r.code === 200 && state.inserted.length === 1 && state.mails.length === 0,
     'a missing RESEND_API_KEY does not still save the lead quietly');
  process.env.RESEND_API_KEY = 're_test';

  state.insertFails = true; state.mails = [];
  r = res(); await handler({ method: 'POST', headers: H, body: { ...good } }, r);
  ok(r.code === 500, 'a DATABASE failure is reported as success');
  ok(state.mails.length === 0, 'an email is sent for a lead that was never saved');
  state.insertFails = false;

  global.fetch = realFetch;
}

// ---- the form -----------------------------------------------------------
function bootForm(reply) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace(/<link[^>]*fonts[^>]*>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://www.statchat.co/' });
  const w = dom.window; const sent = [];
  w.fetch = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) });
    if (reply.throws) throw new Error('offline');
    return { ok: reply.ok, json: async () => reply.body }; };
  w.matchMedia = () => ({ matches: true });   // reduced motion: no interval left running
  // EXECUTABLE SCRIPTS ONLY. This took every <script> on the page and
  // evaluated the lot as JavaScript -- including the two
  // <script type="application/ld+json"> blocks of SEO structured data. JSON
  // is not JavaScript, so {"@context": ...} threw `Unexpected token ':'`
  // and bootForm() died before the form was ever wired.
  //
  // Everything ABOVE this line still ran, which is why the suite looked
  // half-alive: the endpoint checks all reported, and every check of the
  // form itself had been silently unreachable since the structured data
  // was added.
  //
  // A tag with a src and no body contributes an empty string, which is
  // harmless, so the filter is on TYPE alone.
  w.eval([...w.document.querySelectorAll('script')]
    .filter(s => !s.type || /javascript/i.test(s.type))
    .map(s => s.textContent).join('\n;\n'));
  return { w, sent };
}
const set = (w, id, v) => { w.document.getElementById(id).value = v; };
const click = (w, id) => w.document.getElementById(id)
  .dispatchEvent(new w.Event('click', { bubbles: true }));
const pause = () => new Promise(r => setTimeout(r, 30));

async function formChecks(bad) {
  const ok = (c, d) => { if (!c) bad('form', d); };

  let { w, sent } = bootForm({ ok: true, body: { ok: true } });
  click(w, 'sendBtn'); await pause();
  ok(sent.length === 0, 'an empty form still posts');
  // NAMES THE FIRST MISSING FIELD, since 2 Sep 2026. It used to say
  // "please give your name and email" whatever was actually blank, which
  // over an already-filled name reads as a form arguing with you.
  ok(/give your name/i.test(w.document.getElementById('formMsg').textContent),
     'an empty form does not say what is missing');

  ({ w, sent } = bootForm({ ok: true, body: { ok: true } }));
  set(w, 'fName', 'Coach Reed'); set(w, 'fEmail', 'coach@school.edu');
  set(w, 'fOrg', 'Riverside HS'); set(w, 'fMsg', 'Three cameras.');
  set(w, 'fTrap', 'http://spam.example');
  click(w, 'sendBtn'); await pause();
  ok(sent.length === 1 && sent[0].url === '/api/contact', 'a valid form does not post once to /api/contact');
  // strengthened: the VALUE, not just the key. A mutation that always
  // sent '' kept the key and defeated the trap silently.
  ok(sent[0].body.website === 'http://spam.example',
     'the honeypot VALUE is not transmitted — the trap is defeated silently');
  ok(w.document.getElementById('fName').value === '', 'fields are not cleared on success');
  ok(w.document.getElementById('sendBtn').disabled, 'the button is usable again after a send');

  ({ w, sent } = bootForm({ ok: false, body: { ok: false, error: 'Could not send that just now.' } }));
  set(w, 'fName', 'Coach Reed'); set(w, 'fEmail', 'coach@school.edu');
  set(w, 'fOrg', 'Riverside HS'); set(w, 'fMsg', 'Three cameras.');
  click(w, 'sendBtn'); await pause();
  ok(/Could not send/i.test(w.document.getElementById('formMsg').textContent),
     'a failure is swallowed and reported as success');
  ok(w.document.getElementById('fMsg').value === 'Three cameras.',
     'the typing is discarded on a failure — asking someone to write it again is how a lead is lost');

  ({ w } = bootForm({ throws: true, ok: true, body: {} }));
  set(w, 'fName', 'A'); set(w, 'fEmail', 'a@b.co'); set(w, 'fOrg', 'A School');
  click(w, 'sendBtn'); await pause();
  ok(/signup@statchat\.co/.test(w.document.getElementById('formMsg').textContent),
     'an unreachable server does not fall back to the email address');

  // ORGANIZATION IS REQUIRED, 2 Sep 2026 -- and this is the check that did
  // not exist, on a change that shipped two days before twelve schools went
  // live. The form gated on it from the moment it shipped; nothing asserted
  // that it did, because bootForm could not parse the page.
  ({ w, sent } = bootForm({ ok: true, body: { ok: true } }));
  set(w, 'fName', 'Coach Reed'); set(w, 'fEmail', 'coach@school.edu');
  click(w, 'sendBtn'); await pause();
  ok(sent.length === 0, 'a lead with no school, team or company is posted anyway');
  ok(/school, team or production/i.test(w.document.getElementById('formMsg').textContent),
     'the refusal does not name the field that is missing');
  ok(w.document.getElementById('fOrg').classList.contains('bad'),
     'the organization field is not flagged when it is what is missing');

  ({ w } = bootForm({ ok: true, body: { ok: true } }));
  ok(w.document.querySelectorAll('form').length === 0,
     'a native <form> is back — submitting would navigate away and lose the typing');
  ok(!!w.document.querySelector('.trap #fTrap'), 'the honeypot field is gone');
  ok(w.document.getElementById('formMsg').getAttribute('aria-live') === 'polite',
     'the status region is not announced');
}

async function run() {
  const fails = [];
  const bad = (area, detail) => fails.push({ area, detail });
  await endpointChecks(bad);
  await formChecks(bad);
  return fails;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Contact form and endpoint ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) console.log('  a lead reaches the database, and a broken notifier never loses one.');
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
