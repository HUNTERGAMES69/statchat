// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// The two-factor step stops nagging after ten days
// ================================================
// Andy, 2 Sep 2026: "Doesn't look like any of the admins are going to setup
// 2FA, and we can't force it. Is there a way to suppress the 2FA notice on
// their dashboard after 10 days of ignoring it?"
//
// The getting-started card hides itself once every step is done. Two-factor
// is the one step an admin can decline indefinitely, so for a school that has
// set colours, a roster and a game it becomes a permanent one-item reminder
// that can never be satisfied and never dismissed -- which is a notice
// nobody reads.
//
// A TIMESTAMP, NOT A DISMISSAL. This is the pattern the project settled on
// after `is_broadcast` and `status='in_progress'` each gated a feature on
// something meaning "until somebody acts": prefer a condition that EXPIRES
// ON ITS OWN. There is nothing to press and nothing to forget.
//
// WHAT MUST STAY TRUE, and is checked here:
//   - the clock starts when the step is first SHOWN, not at signup
//   - it never starts for an admin who already has two-factor
//   - the stamp is written once, ever
//   - a failed write never breaks the dashboard
//   - account.html can still set up two-factor, for ever
//
// Behaviour verified in a browser 2 Sep 2026 against the real render path:
// never-shown / 3 days / 9.9 days show the step; 10.1 days / 60 days do not;
// an admin WITH two-factor sees it ticked; an unreadable stamp shows it. And
// with the other three steps done, an expired prompt removes the whole card.
//
//   node tests/mfa_prompt_expiry_check.js

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Two-factor prompt expiry ===\n');

// ---- the migration -------------------------------------------------------
{
  const sql = read('sql/042_mfa_prompt_expiry.sql');
  chk(/add column if not exists mfa_prompt_first_shown_at timestamptz/i.test(sql),
      '042: adds profiles.mfa_prompt_first_shown_at');
  chk(/timestamptz/i.test(sql) && !/boolean/i.test(sql.replace(/--[^\n]*/g, '')),
      '042: it is a TIMESTAMP, not a boolean — the condition expires on its own');
  const exec = sql.replace(/--[^\n]*/g, '');
  chk(/\bselect\b[\s\S]*\bcommit;/i.test(exec),
      '042: verifies itself with a select that returns a row');
}

const code = strip(read('dashboard.html'));

// ---- ten days, and it is readable ---------------------------------------
chk(/const MFA_PROMPT_DAYS = 10;/.test(code),
    'the window is a named constant set to 10 days');
chk(/MFA_PROMPT_DAYS \* 86400000/.test(code),
    'and the comparison uses it rather than a second hardcoded number');

// ---- the rule ------------------------------------------------------------
{
  const fn = /function mfaPromptExpired\(\)\{[\s\S]*?\n  \}/.exec(code);
  chk(!!fn, 'mfaPromptExpired exists');
  if (fn) {
    chk(/if \(!first\) return false;/.test(fn[0]),
        'a null stamp is NOT expired — the clock has not started, so the step shows');
    chk(/Number\.isFinite\(t\)/.test(fn[0]),
        'an unparseable stamp shows the step rather than hiding it — failing toward the visible');
  }
}

// ---- the clock starts on first sight, once, and never for the wrong person
{
  const fn = /async function stampMfaPromptShown\(\)\{[\s\S]*?\n  \}/.exec(code);
  chk(!!fn, 'stampMfaPromptShown exists');
  if (fn) {
    chk(/if \(!bootProfile \|\| bootProfile\.mfa_prompt_first_shown_at \|\| !currentUserId\) return;/
        .test(fn[0]),
        'it writes ONCE — an existing stamp is never overwritten, so the clock cannot restart');
    chk(/bootProfile\.mfa_prompt_first_shown_at = now;[\s\S]*?await supabaseClient/.test(fn[0]),
        'and the cache is set before the write, so one page load cannot write twice');
    chk(/catch \(e\) \{[^}]*\}/.test(fn[0]),
        'a failed write is swallowed — a dashboard that will not load is worse than a notice that overstays');
  }

  const caller = /function drawGettingStartedWhenReady\(\)\{[\s\S]*?\n  \}/.exec(code);
  chk(!!caller, 'the caller decides whether the step is live');
  if (caller) {
    chk(/const showMfaStep = gsHasMfa \|\| !mfaPromptExpired\(\);/.test(caller[0]),
        'showMfaStep is computed once, in the caller');
    chk(/if \(gsState\.isAdmin && !gsHasMfa && showMfaStep\) stampMfaPromptShown\(\);/.test(caller[0]),
        'the clock starts ONLY for an admin who is actually being shown the prompt — '
        + 'somebody who already has two-factor is never given it and must not have a clock run against them');
  }
}

// ---- the step is dropped, not merely greyed ------------------------------
// It has to leave the `steps` array entirely: `left === 0` is what hides the
// whole card, and that is the outcome Andy asked for.
{
  const fn = /function renderGettingStarted\(state\)\{[\s\S]*?\n  \}/.exec(code);
  chk(!!fn, 'renderGettingStarted is present');
  if (fn) {
    chk(/if \(state\.isAdmin && state\.showMfaStep !== false\)\{/.test(fn[0]),
        'the two-factor step is not pushed at all once the prompt has expired');
    chk(/const left = steps\.filter\(s => !s\.done\)\.length;/.test(fn[0]) &&
        /if \(left === 0\)\{[\s\S]{0,60}display = 'none'/.test(fn[0]),
        'so when it was the last one outstanding the whole card goes');
  }
}

// ---- the path to two-factor is NOT removed -------------------------------
// Suppressing a security prompt is only defensible because setting it up
// stays one click away, for ever, on a page that is always reachable.
{
  const acct = read('account.html');
  chk(/Two-factor authentication/.test(acct),
      'account.html still has its Two-factor section');
  chk(/id="mfaStartBtn"/.test(acct),
      'and the Set up two-factor button is still there');
  chk(/href:\s+'account\.html'/.test(code),
      'and the step, while shown, still points at it');
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
