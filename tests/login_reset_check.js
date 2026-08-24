// Password reset, and the sign-in page's brand lockup — login.html
// ================================================================
// login.html was index.html until 23 Aug 2026, when the root of the
// domain became the public brochure. It is now the only door into the
// app, and until 24 Aug it had NO WAY TO RESET A PASSWORD. Half the
// flow was already built: the page has recognised `type=recovery` in the
// URL hash since the invite flow, and offered a set-password screen.
// Nothing could ever reach it, because nothing sent the email.
//
// An unreachable feature and an absent one look identical from outside.
// That is the same trap already recorded for the interception receiver
// field, and this file exists so the sending half cannot go missing
// again without something noticing.
//
// WHAT IT GUARDS, and why each one matters more than it looks:
//
//   * redirectTo is built from window.location.origin. The app answers
//     on three hostnames — the apex, www, and the vercel.app deploy URL.
//     A hardcoded value bounces anyone who started on the other two.
//   * The reply never says whether the account exists. Otherwise the box
//     is an oracle for who has an account, and a school's staff list is
//     not ours to confirm to a stranger.
//   * The send button stays disabled afterwards. Only the newest link
//     works, so five taps make four dead links and no way to tell which.
//   * The set-password screen must not claim "you're accepting an
//     invite" when the arrival was a recovery.
//
//   node tests/login_reset_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const LOGIN = path.join(__dirname, '..', 'login.html');

function boot(hash) {
  const html = fs.readFileSync(LOGIN, 'utf8')
    .replace(/<script src="https:\/\/cdn[^"]*"><\/script>/g, '')
    .replace(/<script src="team-icon\.js"><\/script>/g, '');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://www.statchat.co/login.html' + (hash || '')
  });
  const w = dom.window;
  const calls = { reset: [] };
  let authCb = null;
  w.supabase = { createClient: () => ({ auth: {
    onAuthStateChange: cb => { authCb = cb; },
    resetPasswordForEmail: async (email, opts) => { calls.reset.push({ email, opts }); return {}; },
    updateUser: async () => ({ data: { user: { email: 'a@b.c' } } }),
    signInWithPassword: async () => ({ data: {}, error: { message: 'x' } }),
    verifyOtp: async () => ({ data: {}, error: null }),
    mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: null }),
           listFactors: async () => ({ data: null }) }
  } }) };
  const src = [...w.document.querySelectorAll('script')].map(s => s.textContent).join('\n;\n');
  w.eval(src);
  return { w, calls, fire: (e, s) => authCb && authCb(e, s) };
}

const visible = (w, id) => !w.document.getElementById(id).classList.contains('hidden');
const wait = () => new Promise(r => setTimeout(r, 30));

async function run() {
  const fails = [];
  const bad = (area, detail) => fails.push({ area, detail });
  const ok = (cond, area, detail) => { if (!cond) bad(area, detail); };

  // ---- the link exists at all ------------------------------------------
  let { w, calls } = boot();
  ok(!!w.document.getElementById('forgotLink'), 'sending',
     'no "Forgot your password?" link — the receiving half is unreachable again');
  if (!w.document.getElementById('forgotLink')) return fails;

  w.document.getElementById('loginEmail').value = '  andy@statchat.co ';
  w.document.getElementById('forgotLink').dispatchEvent(new w.Event('click', { bubbles: true }));
  ok(visible(w, 'resetRequestView'), 'sending', 'the link does not open the request view');
  ok(w.document.getElementById('resetEmailInput').value === 'andy@statchat.co', 'sending',
     'the address already typed is not carried across, trimmed');

  // ---- sending ---------------------------------------------------------
  w.document.getElementById('sendResetBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
  await wait();
  ok(calls.reset.length === 1, 'sending', 'resetPasswordForEmail not called exactly once');
  if (calls.reset.length) {
    ok(calls.reset[0].email === 'andy@statchat.co', 'sending', 'called with an untrimmed address');
    ok(calls.reset[0].opts && calls.reset[0].opts.redirectTo === 'https://www.statchat.co/login.html',
       'sending', 'redirectTo is not built from the current origin — a hardcoded value ' +
       'bounces anyone who started on one of the other two hostnames');
  }
  const msg = w.document.getElementById('resetRequestMsg').textContent;
  ok(/If there is an account/i.test(msg), 'privacy',
     'the reply reveals whether the account exists — that turns the box into a way to ' +
     'enumerate who has an account');
  ok(w.document.getElementById('sendResetBtn').disabled, 'sending',
     'the button is usable again after a send; only the newest link works');

  // ---- an empty address must not reach the network ---------------------
  const b = boot();
  b.w.document.getElementById('forgotLink').dispatchEvent(new b.w.Event('click', { bubbles: true }));
  b.w.document.getElementById('sendResetBtn').dispatchEvent(new b.w.Event('click', { bubbles: true }));
  await wait();
  ok(b.calls.reset.length === 0, 'sending', 'an empty address still makes a network call');

  // ---- arriving back on a recovery link --------------------------------
  const r = boot('#access_token=x&type=recovery');
  r.fire('INITIAL_SESSION', { user: { email: 'a@b.c' } });
  ok(visible(r.w, 'setPasswordView'), 'receiving', 'a recovery link does not open set-password');
  ok(/Choose a new password/i.test(r.w.document.getElementById('setPasswordTitle').textContent),
     'receiving', 'the recovery arrival is not titled for a recovery');
  ok(!/accepting an invite/i.test(r.w.document.getElementById('setPasswordSub').textContent),
     'receiving', 'a returning user is told they are accepting an invite');

  // ---- and an invite link keeps its own wording ------------------------
  const i = boot('#access_token=x&type=invite');
  i.fire('INITIAL_SESSION', { user: { email: 'a@b.c' } });
  ok(visible(i.w, 'setPasswordView'), 'receiving', 'an invite link does not open set-password');
  ok(/accepting an invite/i.test(i.w.document.getElementById('setPasswordSub').textContent),
     'receiving', 'the invite wording was lost when recovery was added');

  // ---- an ordinary visit is unaffected ---------------------------------
  const n = boot();
  n.fire('INITIAL_SESSION', null);
  ok(visible(n.w, 'loginView'), 'regression', 'a plain visit no longer shows the sign-in form');
  ok(!visible(n.w, 'resetRequestView'), 'regression', 'a plain visit opens the reset view');

  // ---- the brand lockup ------------------------------------------------
  // Structure only where structure is enough; the one visual property
  // that matters is read from the RULE, because a structural check let a
  // `display:none` mutation through on 24 Aug.
  const d = boot().w.document;
  const brand = d.querySelector('.brand');
  ok(!!brand, 'brand', 'the sign-in card has no brand lockup');
  if (brand) {
    ok(brand.parentElement.classList.contains('card'), 'brand',
       'the lockup is inside a view — it must sit in the card so every state shows it');
    ok([...brand.children].map(e => e.tagName).join(',') === 'IMG,SPAN', 'brand',
       'the lockup is not mark-then-wordmark');
    const css = [...d.querySelectorAll('style')].map(s => s.textContent)
                  .join('').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (css.match(/\.brand\s*\{[^}]*\}/) || [''])[0];
    ok(/display:flex/.test(rule) && !/display:none/.test(rule), 'brand',
       'the lockup rule does not lay out as a visible flex row');
    ok([...d.querySelectorAll('h1')].every(h => h.textContent.trim() !== 'StatChat'), 'brand',
       'a visible heading repeats the wordmark');
    const sr = d.querySelector('#loginView h1');
    ok(sr && sr.classList.contains('sr-only'), 'brand',
       'the sign-in view has no heading for a screen reader');
  }

  return fails;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Password reset and sign-in lockup ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) console.log('  a password can be reset, and the page says who it belongs to.');
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
