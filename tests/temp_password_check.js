// A password set by an admin is temporary, and cannot strand its owner
// ====================================================================
// Andy's call, 25 August 2026. A platform operator can set a password for a
// user who cannot reach their email -- but a LASTING one would let that
// operator sign in as a school's admin and enter or alter plays as them,
// with the record showing that coach doing it. For an application whose
// value is that the numbers are trustworthy, that is the hole worth closing.
//
// So an admin-set password stamps must_change_password, and the login page
// refuses to let the session go anywhere until a new one is chosen.
//
// TWO WAYS THIS GOES WRONG, and both are worse than the problem it solves:
//
//   1. The flag never clears -> the user is locked in a loop forever, with
//      a working password and no way past the change screen.
//   2. The flag is checked somewhere a reload can skip -> the temporary
//      password quietly becomes permanent, which is the original hole.
//
//   node tests/temp_password_check.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

const api = fs.readFileSync(path.join(ROOT, 'api_manage_users.js'), 'utf8');
const login = fs.readFileSync(path.join(ROOT, 'login.html'), 'utf8');

console.log('=== Admin-set passwords are temporary ===\n');

// ---- the endpoint --------------------------------------------------------
const setPw = /if \(action === 'setPassword'\)[\s\S]*?\n  \}/.exec(api)[0];
chk(/must_change_password: true/.test(setPw),
    'setPassword stamps must_change_password — an admin-set password is never lasting');
chk(/getUserById\(userId\)/.test(setPw) && /Object\.assign\(\{\}, priorMeta/.test(setPw),
    'and MERGES into existing metadata — updateUserById replaces user_metadata ' +
    'wholesale, so writing the flag alone would erase whatever else is on the account');
chk(/password_set_by/.test(setPw) && /password_set_at/.test(setPw),
    'it records who set it and when — the question asked after something looks wrong');
chk(/refuseIfOtherTenant\(userId\)/.test(setPw),
    'and is still refused across tenants');

// ---- the login gate ------------------------------------------------------
const gateIdx = login.indexOf('must_change_password');
const routeIdx = login.indexOf('WHERE A SESSION LANDS DEPENDS');
chk(gateIdx > -1 && routeIdx > -1 && gateIdx < routeIdx,
    'login.html checks the flag BEFORE deciding where to send the session — ' +
    'a check after routing would let the dashboard load first');
chk(/async function showLoggedIn[\s\S]*?must_change_password/.test(login),
    'the check lives in showLoggedIn, which every route in passes through ' +
    '(fresh sign-in, restored session, anything added later) — a check in the ' +
    'sign-in handler alone would be skipped by a reload');

// A failure to READ the flag must not wave the session through.
const gateBlock = /A TEMPORARY PASSWORD MUST BE CHANGED[\s\S]*?\n    \}\n/.exec(login)[0];
const catchBlock = /catch \(e\) \{[\s\S]*?\}/.exec(gateBlock)[0];
chk(/showView\('setPasswordView'\)/.test(catchBlock),
    'if the flag cannot be READ, it asks for a new password anyway — the cost is ' +
    'one extra change; the cost of the other choice is a shared password that stays live');

// ---- the loop risk -------------------------------------------------------
chk(/updateUser\(\{[\s\S]{0,120}?must_change_password: false/.test(login),
    'setting a new password CLEARS the flag');
const setHandler = /setPasswordBtn'\)\.addEventListener[\s\S]*?\n  \}\);/.exec(login)[0];
const updateCalls = (setHandler.match(/supabaseClient\.auth\.updateUser\(/g) || []).length;
chk(updateCalls === 1,
    'in the SAME call that sets the password (' + updateCalls + ' call) — two calls ' +
    'means the second can fail, leaving a working password and a user stuck on the ' +
    'change screen forever');

// ---- the list surfaces it ------------------------------------------------
chk(/mustChangePassword: !!\(u\.user_metadata/.test(api),
    'the user list reports a pending temporary password, so an operator can see ' +
    'whether the person has actually signed in yet');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
