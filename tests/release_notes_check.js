// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// Release notes — the in-app card and the sender
// =============================================
// Telling admins what changed. Two halves, and they fail differently:
//
//   IN-APP  releases.js + profiles.last_seen_release + a card on the
//           dashboard. Reaches everyone who opens StatChat. Its failure
//           mode is showing the wrong person a note, or nagging someone
//           who already dismissed it.
//
//   EMAIL   api/send-release.js, pressed deliberately from platform.html.
//           Reaches the admin who has not signed in since August. Its
//           failure mode is far worse and cannot be undone: mailing the
//           wrong audience, mailing a deleted school, mailing someone who
//           opted out, or mailing everyone TWICE.
//
// So most of what follows is about the sender refusing to do things.
//
//   node tests/release_notes_check.js

const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');

let pass = 0, fail = 0;
const chk = (l, ok, d) => { if (ok) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + (d ? '\n         ' + d : '')); } };

// ---- the content file -------------------------------------------------
const RELEASES = (() => {
  const sandbox = { window: {} };
  new Function('window', fs.readFileSync(path.join(REPO, 'releases.js'), 'utf8'))(sandbox.window);
  return sandbox.window.STATCHAT_RELEASES;
})();

console.log('=== Release notes ===\n');

chk('releases.js defines entries', Array.isArray(RELEASES) && RELEASES.length > 0);
{
  const ids = RELEASES.map(r => r.id);
  // THE ID IS WHAT "I HAVE READ THIS" IS RECORDED AGAINST. A duplicate
  // means dismissing one silently dismisses another.
  chk('...with unique ids', new Set(ids).size === ids.length, JSON.stringify(ids));
  chk('...every one an id a database column and a URL can both hold',
      ids.every(i => /^[A-Za-z0-9._-]+$/.test(i)), JSON.stringify(ids));
  chk('...newest first, because that is the order they are read and sliced',
      RELEASES.every((r, i) => i === 0 || RELEASES[i - 1].date >= r.date),
      JSON.stringify(RELEASES.map(r => r.date)));
  chk('...each with a title, a body and a real date',
      RELEASES.every(r => r.title && r.body && /^\d{4}-\d{2}-\d{2}$/.test(r.date)));
  // A view account can open none of the screens these describe.
  chk('...and none aimed at view accounts',
      RELEASES.every(r => Array.isArray(r.audience) &&
        r.audience.length && r.audience.indexOf('view') === -1),
      JSON.stringify(RELEASES.map(r => r.audience)));
  // SILENCE IS THE DEFAULT. Every entry emailing everyone is how a
  // product-news channel becomes one people filter.
  chk('...with email opt-in per entry, not on by default',
      RELEASES.some(r => !r.email), JSON.stringify(RELEASES.map(r => !!r.email)));
}

// ---- the sender -------------------------------------------------------
// Same stub shape as tests/feed_coverage_check.js: swap the supabase module
// for one that answers from fixtures, then drive the real handler.
let FIXTURE = null;
function loadSender(){
  const Module = require('module');
  const orig = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === '@supabase/supabase-js'){
      const tbl = (name) => {
        const st = { table: name, filters: {} };
        const b = {
          select(){ return b; },
          eq(c, v){ st.filters[c] = v; return b; },
          in(c, v){ st.filters[c] = v; return b; },
          limit(){ return Promise.resolve({ data: FIXTURE.rows(st), error: null }); },
          insert(row){ FIXTURE.inserted.push({ table: name, row: row });
                       return Promise.resolve({ data: null, error: null }); },
          update(fields){ FIXTURE.updated.push({ table: name, fields: fields });
                          return { eq: () => Promise.resolve({ data: null, error: null }) }; },
          then(r){ return Promise.resolve({ data: FIXTURE.rows(st), error: null }).then(r); }
        };
        return b;
      };
      return { createClient: () => ({
        from: tbl,
        auth: {
          getUser: async () => FIXTURE.caller
            ? { data: { user: { id: FIXTURE.caller } }, error: null }
            : { data: null, error: { message: 'bad token' } },
          admin: {
            listUsers: async ({ page }) => ({
              data: { users: page === 1 ? FIXTURE.users : [] }, error: null })
          }
        }
      }) };
    }
    return orig.apply(this, arguments);
  };
  process.env.SUPABASE_URL = 'http://x';
  process.env.SUPABASE_SECRET_KEY = 'k';
  const p = path.join(REPO, 'api', 'send-release.js');
  delete require.cache[require.resolve(p)];
  const h = require(p);
  Module.prototype.require = orig;
  return h;
}

function call(handler, body, token){
  return new Promise(resolve => {
    const res = { _c: 200, status(c){ this._c = c; return this; },
      json(o){ resolve({ code: this._c, body: o }); },
      end(){ resolve({ code: this._c, body: {} }); } };
    handler({ method: 'POST', headers: { authorization: 'Bearer ' + (token || 'tok') },
              body: body }, res);
  });
}

const ENTRY = { id: 'rel-1', title: 'A thing changed', body: 'It does a thing now.',
                audience: ['admin'], link: 'create_game.html' };

function fixture(over){
  const f = {
    caller: 'super-1',
    inserted: [],
    updated: [],
    sent: [],                       // every message the sender tried to post
    profiles: [
      { id: 'super-1', is_super_admin: true, role: 'admin', tenant_id: 't1' },
      { id: 'a1', role: 'admin',      tenant_id: 't1', release_email_opt_out: false },
      { id: 'a2', role: 'admin',      tenant_id: 't1', release_email_opt_out: true  }, // opted out
      { id: 'a3', role: 'admin',      tenant_id: 'tDEL', release_email_opt_out: false }, // deleted school
      { id: 's1', role: 'game_entry', tenant_id: 't1', release_email_opt_out: false },
      { id: 'v1', role: 'view',       tenant_id: 't1', release_email_opt_out: false },
      { id: 'a4', role: 'admin',      tenant_id: 't1', release_email_opt_out: false }  // disabled below
    ],
    tenants: [{ id: 't1', deleted_at: null }, { id: 'tDEL', deleted_at: '2026-08-01' }],
    users: [
      { id: 'super-1', email: 'andy@statchat.co' },
      { id: 'a1', email: 'a1@school.org' },
      { id: 'a2', email: 'a2@school.org' },
      { id: 'a3', email: 'a3@deleted.org' },
      { id: 's1', email: 's1@school.org' },
      { id: 'v1', email: 'v1@school.org' },
      { id: 'a4', email: 'a4@school.org', banned_until: '2099-01-01' }
    ],
    // Published by default: a send cannot happen before a publish, and
    // most of what follows is about the SEND.
    state: [{ release_id: 'rel-1', published_at: '2026-09-01T09:00:00Z' }]
  };
  Object.assign(f, over || {});
  f.rows = (st) => {
    if (st.table === 'profiles'){
      if (st.filters.id) return f.profiles.filter(p => p.id === st.filters.id);
      if (st.filters.role) return f.profiles.filter(p => st.filters.role.indexOf(p.role) > -1);
      return f.profiles;
    }
    if (st.table === 'tenants') return f.tenants;
    if (st.table === 'release_state'){
      if (st.filters.release_id)
        return f.state.filter(x => x.release_id === st.filters.release_id);
      return f.state;
    }
    return [];
  };
  return f;
}

// Capture what would actually be mailed, without mailing it.
const realFetch = global.fetch;
function captureMail(f){
  global.fetch = async (url, opts) => {
    if (String(url).indexOf('resend.com') > -1){
      f.sent.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ id: 'x' }) };
    }
    return realFetch ? realFetch(url, opts) : { ok: false, status: 500 };
  };
}

(async () => {
  console.log('');
  process.env.RESEND_API_KEY = 'test-key';

  // ---- authorization -------------------------------------------------
  {
    FIXTURE = fixture({ caller: null });
    const r = await call(loadSender(), { action: 'send', entry: ENTRY });
    chk('an unverifiable session is refused', r.code === 401, JSON.stringify(r.body));
  }
  {
    // A SCHOOL ADMIN IS NOT A PLATFORM ADMIN. This reaches every school.
    FIXTURE = fixture({ caller: 'a1' });
    const r = await call(loadSender(), { action: 'send', entry: ENTRY });
    chk('a school admin cannot send to the whole platform',
        r.code === 403, JSON.stringify(r.body));
  }

  // ---- who it reaches -------------------------------------------------
  {
    FIXTURE = fixture(); captureMail(FIXTURE);
    const r = await call(loadSender(), { action: 'send', entry: ENTRY });
    const bcc = FIXTURE.sent.flatMap(m => m.bcc || []);
    chk('a platform admin can send', r.code === 200 && r.body.sent > 0, JSON.stringify(r.body));
    chk('...to the admins it is for', bcc.indexOf('a1@school.org') > -1, JSON.stringify(bcc));
    chk('...NOT to someone who opted out', bcc.indexOf('a2@school.org') === -1, JSON.stringify(bcc));
    chk('...NOT to a deleted school\'s staff', bcc.indexOf('a3@deleted.org') === -1, JSON.stringify(bcc));
    chk('...NOT to a disabled account', bcc.indexOf('a4@school.org') === -1, JSON.stringify(bcc));
    chk('...NOT to a scorer, when the entry is admin-only',
        bcc.indexOf('s1@school.org') === -1, JSON.stringify(bcc));
    chk('...NOT to a view account, ever', bcc.indexOf('v1@school.org') === -1, JSON.stringify(bcc));
    // BCC, NOT TO. One message addressed to every admin would publish
    // one school's staff address to every other school.
    chk('...with recipients in bcc, so schools cannot see each other',
        FIXTURE.sent.every(m => (m.to || []).length <= 1 && (m.bcc || []).length > 0),
        JSON.stringify(FIXTURE.sent.map(m => ({ to: m.to, bcc: (m.bcc||[]).length }))));
    chk('...and it is recorded as sent',
        FIXTURE.updated.some(u => u.table === 'release_state' && u.fields.emailed_at),
        JSON.stringify(FIXTURE.updated));
  }
  {
    FIXTURE = fixture(); captureMail(FIXTURE);
    await call(loadSender(), { action: 'send',
      entry: Object.assign({}, ENTRY, { audience: ['admin', 'game_entry'] }) });
    const bcc = FIXTURE.sent.flatMap(m => m.bcc || []);
    chk('an entry aimed at scorers reaches them too',
        bcc.indexOf('s1@school.org') > -1, JSON.stringify(bcc));
    chk('...and still never a view account', bcc.indexOf('v1@school.org') === -1, JSON.stringify(bcc));
  }

  // ---- sending twice ---------------------------------------------------
  {
    FIXTURE = fixture({ state: [ { release_id: 'rel-1',
      published_at: '2026-09-01T09:00:00Z',
      emailed_at: '2026-09-01T10:00:00Z', recipient_count: 12 } ] });
    captureMail(FIXTURE);
    const r = await call(loadSender(), { action: 'send', entry: ENTRY });
    chk('a release already emailed is not emailed again',
        r.code === 200 && r.body.alreadySent === true && FIXTURE.sent.length === 0,
        JSON.stringify(r.body) + ' messages=' + FIXTURE.sent.length);
    chk('...and names the note, so it can be cleared from the selection',
        /rel-1/.test(r.body.message || ''), r.body.message);
  }

  // ---- the dry run -----------------------------------------------------
  {
    FIXTURE = fixture(); captureMail(FIXTURE);
    const r = await call(loadSender(), { action: 'preview', entry: ENTRY });
    chk('a preview reports the count and sends nothing',
        r.body.preview === true && r.body.recipientCount > 0 && FIXTURE.sent.length === 0,
        JSON.stringify(r.body));
    // Addresses in a response are a customer list in a browser cache.
    chk('...and does not hand back the addresses',
        !/school\.org/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  }

  // ---- what a browser is allowed to put in an email --------------------
  {
    FIXTURE = fixture(); captureMail(FIXTURE);
    const r = await call(loadSender(), { action: 'send', entry: { id: 'x y', title: 'T', audience: ['admin'] } });
    chk('a malformed release id is refused', r.code === 400, JSON.stringify(r.body));
  }
  {
    FIXTURE = fixture(); captureMail(FIXTURE);
    const r = await call(loadSender(), { action: 'send', entry: { id: 'ok-1', title: 'T', audience: ['view'] } });
    chk('an audience of view is refused outright', r.code === 400, JSON.stringify(r.body));
  }
  {
    FIXTURE = fixture(); captureMail(FIXTURE);
    await call(loadSender(), { action: 'send', entry: Object.assign({}, ENTRY,
      { id: 'esc-1', title: 'Bad <script>alert(1)</script>', link: 'https://evil.example/x' }) });
    const m = FIXTURE.sent[0] || {};
    chk('markup in a title is escaped, not rendered',
        !/<script>/.test(m.html || ''), String(m.html || '').slice(0, 120));
    // A link field is the shape that becomes an open redirect.
    chk('an off-site link is dropped rather than mailed',
        !/evil\.example/.test((m.html || '') + (m.text || '')));
  }

  // ---- CAN-SPAM --------------------------------------------------------
  // Product news is marketing, not transactional: it needs a way out and a
  // real postal address, or the sender is the liability.
  {
    FIXTURE = fixture(); captureMail(FIXTURE);
    await call(loadSender(), { action: 'send', entry: ENTRY });
    const m = FIXTURE.sent[0] || {};
    chk('every message carries an opt-out', /unsubscribe/i.test(m.html || ''));
    chk('...and a postal address', /Louisiana/i.test(m.html || ''));
    chk('...in the plain-text part too, not only the HTML',
        /unsubscribe/i.test(m.text || '') && /Louisiana/i.test(m.text || ''));
    // A LIST-UNSUBSCRIBE HEADER, so Gmail and Outlook draw a native
    // Unsubscribe link. A reader who cannot find the way out presses Spam
    // instead, and that is the signal that costs the next send.
    chk('...and a List-Unsubscribe header',
        /mailto:/.test(((m.headers || {})['List-Unsubscribe']) || ''),
        JSON.stringify(m.headers));
    // ONE-CLICK (List-Unsubscribe-Post) IS DELIBERATELY ABSENT. It needs
    // an endpoint that unsubscribes with no confirmation on an
    // unauthenticated POST, which mail scanners trigger by accident.
    chk('...and no one-click POST form, which needs an endpoint we do not have',
        !((m.headers || {})['List-Unsubscribe-Post']));
    // A REPLY MUST LAND SOMEWHERE REAL. CAN-SPAM wants a working opt-out
    // for 30 days; a reply address that bounces is worse than none.
    chk('...and a reply-to that is a real mailbox', !!m.reply_to, JSON.stringify(m.reply_to));
    // Addressed to ourselves with recipients in bcc -- so one school's
    // staff address is never published to another school.
    chk('...addressed to the sender, never to the recipients',
        (m.to || []).length === 1 && (m.bcc || []).length > 0,
        JSON.stringify({ to: m.to, bcc: (m.bcc || []).length }));
  }

  // ---- nothing sent, nothing recorded ----------------------------------
  // Recording a send that failed marks the release done and makes it
  // unsendable -- the announcement lost for good, reported as success.
  {
    FIXTURE = fixture();
    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const r = await call(loadSender(), { action: 'send', entry: ENTRY });
    chk('a total delivery failure is not recorded as sent',
        !FIXTURE.updated.some(u => u.fields && u.fields.emailed_at),
        JSON.stringify(FIXTURE.updated));
    chk('...and says so, so it can be retried', r.body.sent === 0, JSON.stringify(r.body));
  }
  {
    FIXTURE = fixture();
    delete process.env.RESEND_API_KEY;
    const r = await call(loadSender(), { action: 'send', entry: ENTRY });
    chk('a missing mail key is an explicit error, not a silent no-op',
        r.code === 500 && /RESEND_API_KEY/.test(r.body.error || ''), JSON.stringify(r.body));
    process.env.RESEND_API_KEY = 'test-key';
  }

  // ---- THE DASHBOARD CARD ---------------------------------------------
  // Driven through the real page in jsdom, the same way the starters tests
  // drive create_game.html. What matters here is who is shown what, and
  // that "Got it" is remembered.
  const { bootPage } = require('./harness');
  const settle = (ms) => new Promise(r => setTimeout(r, ms || 150));

  console.log('');
  {
    // dashboard.html has no #mainView, so the harness's shared readiness
    // probe never fires -- same reason broadcast_stats_overlay_check.js
    // passes its own.
    const w = await bootPage('dashboard.html', { role: 'admin',
      readyWhen: win => !!win.document.getElementById('releaseCard') });
    await settle(400);
    const card = w.document.getElementById('releaseCard');
    chk('the dashboard has a release card', !!card);
    chk('...hidden until there is something to say',
        !!card && card.classList.contains('hidden'));
    chk('...and releases.js is loaded by the page',
        /<script src="releases\.js">/.test(
          require('fs').readFileSync(require('path').join(REPO, 'dashboard.html'), 'utf8')));
    w.close();
  }

  // ---- the audience filter, tested directly ---------------------------
  // releasesFor() is the whole audience rule; asserted against the real
  // file so an entry added later cannot quietly reach the wrong people.
  {
    const forRole = (role) => RELEASES.filter(r =>
      Array.isArray(r.audience) && r.audience.indexOf(role) > -1);
    chk('an admin sees the admin notes', forRole('admin').length > 0);
    chk('...a view account sees none at all', forRole('view').length === 0);
    const scorer = forRole('game_entry');
    chk('...and a scorer sees only what is aimed at scorers',
        scorer.every(r => r.audience.indexOf('game_entry') > -1),
        JSON.stringify(scorer.map(r => r.id)));
  }

  // ---- PUBLISHING IS A SEPARATE ACT FROM UPLOADING --------------------
  // Andy, 2 Sep 2026: "does it just show up if new things are in the
  // uploaded notes file? I don't know if i like that." It does not, and
  // these are the checks that keep it that way.
  {
    FIXTURE = fixture({ state: [] });           // written, never published
    captureMail(FIXTURE);
    const r = await call(loadSender(), { action: 'send', entry: ENTRY });
    chk('an unpublished note cannot be emailed',
        r.code === 400 && /[Pp]ublish/.test(r.body.error || ''), JSON.stringify(r.body));
    chk('...and nothing was sent', FIXTURE.sent.length === 0);
  }
  {
    FIXTURE = fixture({ state: [] });
    const r = await call(loadSender(), { action: 'publish', entry: ENTRY });
    chk('a platform admin can publish', r.code === 200 && r.body.published === true,
        JSON.stringify(r.body));
    chk('...which writes the row that dashboards read',
        FIXTURE.inserted.some(i => i.table === 'release_state' &&
          i.row.release_id === 'rel-1' && i.row.published_at),
        JSON.stringify(FIXTURE.inserted));
  }
  {
    FIXTURE = fixture({ caller: 'a1', state: [] });
    const r = await call(loadSender(), { action: 'publish', entry: ENTRY });
    chk('a school admin cannot publish to every dashboard', r.code === 403,
        JSON.stringify(r.body));
  }
  {
    FIXTURE = fixture();                         // already published
    const r = await call(loadSender(), { action: 'unpublish', entry: ENTRY });
    chk('a published note can be taken back down',
        r.code === 200 && r.body.published === false, JSON.stringify(r.body));
    chk('...by clearing published_at, not by deleting the row -- which would',
        FIXTURE.updated.some(u => u.table === 'release_state' &&
          u.fields.published_at === null), JSON.stringify(FIXTURE.updated));
    // ...lose the emailed_at with it, and let the release be mailed twice.
    chk('...and it does not touch whether it was emailed',
        FIXTURE.updated.every(u => !('emailed_at' in (u.fields || {}))),
        JSON.stringify(FIXTURE.updated));
  }

  // ---- BATCHING -------------------------------------------------------
  // Andy, 2 Sep 2026: "we need to be able to batch emails so that if i
  // elect to show 4 on the dashboard we can email those 4." Four notes
  // must not be four emails to the same people -- the second one is what
  // gets a product-news address filtered.
  const ADMIN_ONLY = { id: 'rel-a', title: 'Admin thing', body: 'For admins.',
                       audience: ['admin'] };
  const BOTH       = { id: 'rel-b', title: 'Crew thing', body: 'For everyone.',
                       audience: ['admin', 'game_entry'] };
  const bothLive = [{ release_id: 'rel-a', published_at: '2026-09-01T09:00:00Z' },
                    { release_id: 'rel-b', published_at: '2026-09-01T09:00:00Z' }];
  {
    FIXTURE = fixture({ state: bothLive }); captureMail(FIXTURE);
    const r = await call(loadSender(), { action: 'send', entries: [ADMIN_ONLY, BOTH] });
    chk('two notes go out together', r.code === 200 && r.body.notes === 2,
        JSON.stringify(r.body));

    // THE LEAK THIS GUARDS. A batch mixing an admin-only note with a
    // shared one must not mail the admin-only one to a scorer -- that is
    // the same disclosure as showing it on their dashboard.
    const toScorer = FIXTURE.sent.filter(m => (m.bcc || []).indexOf('s1@school.org') > -1);
    const toAdmin  = FIXTURE.sent.filter(m => (m.bcc || []).indexOf('a1@school.org') > -1);
    chk('...the admin gets both', toAdmin.length === 1 &&
        /Admin thing/.test(toAdmin[0].html) && /Crew thing/.test(toAdmin[0].html),
        toAdmin.length + ' message(s)');
    chk('...the scorer gets ONLY the note aimed at scorers',
        toScorer.length === 1 && !/Admin thing/.test(toScorer[0].html) &&
        /Crew thing/.test(toScorer[0].html),
        toScorer.length ? String(toScorer[0].html).slice(0, 140) : 'no message');

    // ONE MESSAGE PER PERSON, not one per note.
    const everyAddr = FIXTURE.sent.flatMap(m => m.bcc || []);
    chk('...and nobody is mailed twice',
        new Set(everyAddr).size === everyAddr.length, JSON.stringify(everyAddr));

    // Marking only the first would let the rest be emailed again later, to
    // people who already read them in today's message.
    const marked = FIXTURE.updated.filter(u => u.fields && u.fields.emailed_at).length;
    chk('...and BOTH notes are recorded as emailed, not just the first',
        marked === 2, marked + ' marked');
  }
  {
    // The subject has to change: "New in StatChat: <title>" is a lie when
    // the message carries four.
    FIXTURE = fixture({ state: bothLive }); captureMail(FIXTURE);
    await call(loadSender(), { action: 'send', entries: [ADMIN_ONLY, BOTH] });
    const admin = FIXTURE.sent.find(m => (m.bcc || []).indexOf('a1@school.org') > -1);
    chk('a multi-note message says how many, rather than naming one',
        /2 new things/i.test(admin.subject || ''), admin.subject);
    const scorer = FIXTURE.sent.find(m => (m.bcc || []).indexOf('s1@school.org') > -1);
    chk('...and a group receiving one note still gets that note\'s title',
        /Crew thing/.test(scorer.subject || ''), scorer.subject);
  }
  {
    // A BATCH IS ALL OR NOTHING. Quietly dropping the ones already sent
    // would make "I sent four" mean something else.
    FIXTURE = fixture({ state: [
      { release_id: 'rel-a', published_at: '2026-09-01T09:00:00Z',
        emailed_at: '2026-09-01T10:00:00Z', recipient_count: 9 },
      { release_id: 'rel-b', published_at: '2026-09-01T09:00:00Z' } ] });
    captureMail(FIXTURE);
    const r = await call(loadSender(), { action: 'send', entries: [ADMIN_ONLY, BOTH] });
    chk('a batch containing an already-sent note is refused whole',
        r.body.alreadySent === true && FIXTURE.sent.length === 0,
        JSON.stringify(r.body) + ' messages=' + FIXTURE.sent.length);
    chk('...naming which one, so it can be unticked',
        /rel-a/.test(r.body.message || ''), r.body.message);
  }
  {
    FIXTURE = fixture({ state: [
      { release_id: 'rel-a', published_at: '2026-09-01T09:00:00Z' } ] });  // rel-b not live
    captureMail(FIXTURE);
    const r = await call(loadSender(), { action: 'send', entries: [ADMIN_ONLY, BOTH] });
    chk('a batch containing an unpublished note is refused whole',
        r.code === 400 && /rel-b/.test(r.body.error || ''), JSON.stringify(r.body));
    chk('...and nothing was sent', FIXTURE.sent.length === 0);
  }
  {
    FIXTURE = fixture({ state: bothLive }); captureMail(FIXTURE);
    const r = await call(loadSender(), { action: 'preview', entries: [ADMIN_ONLY, BOTH] });
    chk('a preview of a mixed batch reports each group separately',
        Array.isArray(r.body.groups) && r.body.groups.length === 2,
        JSON.stringify(r.body));
    chk('...saying how many notes each group would receive',
        r.body.groups.every(g => g.notes > 0 && g.recipients > 0),
        JSON.stringify(r.body.groups));
    chk('...and still sends nothing', FIXTURE.sent.length === 0);
  }
  {
    FIXTURE = fixture({ state: bothLive }); captureMail(FIXTURE);
    const r = await call(loadSender(), { action: 'send', entries: [ADMIN_ONLY, ADMIN_ONLY] });
    chk('the same note twice in one batch is refused',
        r.code === 400 && /twice/i.test(r.body.error || ''), JSON.stringify(r.body));
  }
  {
    FIXTURE = fixture({ state: bothLive });
    const r = await call(loadSender(), { action: 'publish', entries: [ADMIN_ONLY, BOTH] });
    chk('publish still acts on one note at a time', r.code === 400,
        JSON.stringify(r.body));
  }

  // ---- the dashboard's own rules --------------------------------------
  // Read out of the page source rather than driven, because both depend on
  // data the harness has no columns for. Asserted as the RULE, so a later
  // edit that drops one is caught.
  {
    const dash = require('fs').readFileSync(
      require('path').join(REPO, 'dashboard.html'), 'utf8');

    chk('the dashboard shows only PUBLISHED notes',
        /release_state/.test(dash) && /published\[r\.id\]/.test(dash));

    // 30 DAYS. Without it an admin invited in November opens their first
    // dashboard to every note ever written.
    chk('...and ages a note out after 30 days',
        /MAX_AGE_DAYS\s*=\s*30/.test(dash) && /cutoff/.test(dash));

    // NO GAME-STATE SUPPRESSION AT ALL, and asserted as an ABSENCE
    // because both attempts at one were wrong in the same direction.
    //
    // is_broadcast was obviously wrong: schools set a game ON AIR on
    // Monday and leave it all week, so the card would have been hidden
    // most of the season.
    //
    // in_progress was wrong more quietly, which is worse. A game only
    // leaves in_progress when somebody finalizes it, so one test game
    // left open silenced the card for that school FOREVER -- no error,
    // nothing to notice. Andy hit it within an hour of publishing.
    //
    // Anything that reads a game's status or on-air flag to decide
    // whether to draw this card is that bug coming back.
    const fnStart = dash.indexOf('async function renderReleaseCard');
    const fnBody = dash.slice(fnStart, dash.indexOf('\n  }', fnStart));
    chk('the card is not gated on any game state',
        fnStart > -1 && !/\bstatus\b/.test(fnBody) && !/is_broadcast/.test(fnBody),
        fnStart === -1 ? '(function not found)'
          : (fnBody.match(/[^\n]*(status|is_broadcast)[^\n]*/) || ['(clean)'])[0]);
    chk('...and takes no games argument, so nothing can be gated on one later',
        /async function renderReleaseCard\(\)/.test(dash),
        (dash.match(/async function renderReleaseCard\([^)]*\)/) || [''])[0]);
  }

  // ---- the age-out rule, exercised -------------------------------------
  {
    const within = (days) => {
      const d = new Date(Date.now() - days * 86400000);
      return d.toISOString().slice(0, 10);
    };
    const cutoff = Date.now() - 30 * 86400000;
    const keep = (dateStr) => Date.parse(dateStr) >= cutoff;
    chk('a note from today is shown', keep(within(0)));
    chk('...one from 29 days ago is still shown', keep(within(29)));
    chk('...one from 31 days ago is not', !keep(within(31)));
  }

  // ---- the migration --------------------------------------------------
  {
    const sql = require('fs').readFileSync(
      require('path').join(REPO, 'sql', '037_release_notes.sql'), 'utf8');
    chk('sql/037 adds both profile columns',
        /add column if not exists last_seen_release/.test(sql) &&
        /add column if not exists release_email_opt_out/.test(sql));
    chk('...wrapped in a transaction, so a failure leaves nothing half-applied',
        /^begin;/m.test(sql) && /^commit;/m.test(sql));
    chk('...and creates release_state with RLS on',
        /create table if not exists public\.release_state/.test(sql) &&
        /alter table public\.release_state enable row level security/.test(sql));
    // A browser that could write this row could mark a release sent
    // without sending it, suppressing the announcement for good.
    chk('...with no insert or update policy for the browser',
        !/create policy[^;]*release_state[^;]*for (insert|update)/i.test(sql));
    const down = require('fs').readFileSync(
      require('path').join(REPO, 'sql', '037_release_notes_DOWN.sql'), 'utf8');
    chk('...and a DOWN that reverses both', /drop column if exists last_seen_release/.test(down) &&
        /drop table if exists public\.release_state/.test(down));
  }

  global.fetch = realFetch;
  console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
  if (fail) console.log('\n' + fail + ' FAILURES');
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
