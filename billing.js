// SEASON STATE — ONE DEFINITION, USED BY BOTH SCREENS.
// =====================================================================
// The platform console and a school's own Account page both have to
// answer "is this season paid up, and for how much longer". If they ever
// disagree, the support call starts with the operator and the customer
// reading different answers off the same row, which is the worst place a
// duplicated rule can surface. So it lives here and both pages load it,
// for the same reason engine.js exists.
//
// Loaded as a plain <script> before each page's own script, so it defines
// globals rather than exporting. The Node shim at the foot is for tests.
//
// NOTHING HERE ENFORCES ANYTHING. Expiry is a label; the only thing that
// actually stops a school writing is `disabled_at`, through
// tenant_is_writable() in 014. That is deliberate -- Andy's call, 31 Aug
// 2026 -- because an automatic lockout has one catastrophic failure mode
// (a scorer shut out on a Friday night, in front of a broadcast) and no
// upside at this size that chasing by hand does not also give.

// A `date` COLUMN IS NOT A TIMESTAMP, and must not be parsed as one.
// ---------------------------------------------------------------------
// new Date('2027-07-31') is parsed as UTC midnight. Everywhere west of
// Greenwich -- which is all of Louisiana -- that renders and compares as
// 30 July. A renewal date that reads one day early on every screen is the
// kind of bug nobody reports and everybody notices.
function seasonDateFromISO(s){
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);   // local midnight, on purpose
}

// Midnight today, local, so a comparison is date-to-date and a renewal
// does not quietly expire at whatever time of day the page was opened.
function seasonToday(now){
  const d = now ? new Date(now) : new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// WHEN A SEASON BOUGHT TODAY SHOULD END.
// ---------------------------------------------------------------------
// 31 July of NEXT year, always. Football runs August to December, so 31
// July is the one date in the calendar when no game is in progress
// anywhere -- which makes it the only safe day for a renewal to land.
//
// It falls out simply because a purchase in Aug-Dec buys the season now
// under way, and one in Jan-Jul buys the season about to start, and both
// of those seasons are the CURRENT calendar year's. So both expire the
// following July.
//
//   bought Sept 2026  ->  31 Jul 2027   (the 2026 season, then out)
//   bought Mar  2027  ->  31 Jul 2028   (the 2027 season)
//
// The alternative -- 365 days from the payment -- expires a September
// buyer in week three of the next season, which is precisely when nobody
// can deal with it.
function nextSeasonEnd(now){
  const t = seasonToday(now);
  return new Date(t.getFullYear() + 1, 6, 31);   // month 6 = July
}

function toISODate(d){
  if (!d) return null;
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

// THE STATE OF ONE TENANT'S SEASON.
// ---------------------------------------------------------------------
// Ordered by what a person needs to know first. Suspended outranks
// everything: a suspended tenant cannot write whatever its dates say, and
// showing 'Active' beside an account that is locked is the status line
// lying about the one thing it is being read to find out. Same rule the
// tenants table already applies to the subscription pill.
//
// `days` is signed: positive means days remaining, negative means days
// since it lapsed. Null when there is no date to count to.
// `key` and `kind` answer DIFFERENT QUESTIONS, and conflating them is
// what made the console and the Account page disagree.
//
//   kind  what sort of account is this -- trial, paid, lifetime. It comes
//         from the `subscription` column and does not change with the
//         calendar. The console's status column wants this.
//   key   how urgent is it right now -- active, expiring, expired. It
//         comes from the date. The Account card wants this, because
//         "ends in 3 days" is the whole reason that card exists.
//
// Until 31 Aug 2026 there was only `key`, and the console patched around
// it by consulting `t.subscription` directly for its last two rungs. That
// worked only because no trial ever had a date: give one a date and the
// console said TRIAL while the school's own page said ACTIVE. Two screens
// disagreeing about one row is exactly what this file exists to prevent,
// so the missing concept is added here rather than patched there again.
// WHEN A TRIAL RUNS OUT.
// ---------------------------------------------------------------------
// created_at + 30 days, unless renews_on overrides it -- that override is
// how the console grants an extension without pretending a payment was
// made. Andy's spec, 31 Aug 2026.
//
// THE DATABASE IS THE AUTHORITY, not this. public.tenant_trial_ends_on()
// in 026 computes the same thing and is what actually refuses a write;
// this exists so the screens can say what is about to happen before it
// happens. If the two ever disagree the SQL wins, and this is the copy
// that is wrong -- which is why the rule is one line in both.
const TRIAL_DAYS = 30;
function trialEndsOn(tenant, now){
  const t = tenant || {};
  // A DEMO IS NOT ON A CLOCK. Demo tenants sit at subscription='trial'
  // and nothing moves them off it, so without this every demo older than
  // thirty days reads as an expired trial -- and, in 026, would actually
  // have been refused its own writes.
  if (t.is_demo) return null;
  if (t.subscription !== 'trial' && t.subscription !== undefined &&
      t.subscription !== null && t.subscription !== '') return null;
  if (t.renews_on) return seasonDateFromISO(t.renews_on);
  const created = seasonDateFromISO(t.created_at);
  if (!created) return null;
  return new Date(created.getFullYear(), created.getMonth(),
                  created.getDate() + TRIAL_DAYS);
}

function seasonState(tenant, now){
  const t = tenant || {};
  const today = seasonToday(now);
  const kind = t.subscription === 'lifetime' ? 'lifetime'
             : t.subscription === 'active'   ? 'paid'
             : t.subscription === 'lapsed'   ? 'paid'
             : 'trial';
  // A TRIAL ALWAYS HAS AN END NOW, whether or not anybody typed one --
  // which is what removes the "no season paid for yet" limbo a trial used
  // to sit in forever.
  const end = kind === 'trial' ? trialEndsOn(t, now) : seasonDateFromISO(t.renews_on);
  // AFTER `end`, not before it. Declared above with the other consts on
  // the first pass, which put a const TDZ read of `end` one line ahead of
  // its own initialiser -- seasonState threw on every call and every page
  // that loads this file died at boot.
  const days = end ? Math.round((end - today) / 86400000) : null;

  if (t.disabled_at){
    return { kind:kind, key:'suspended', label:'Suspended', days:days, endsOn:end,
             blurb:'This account has been suspended. It can read everything and change nothing.' };
  }
  // LIFETIME, added 31 Aug 2026 for StatChat's own tenant and the school
  // whose people helped design it. Never billed, never chased, no date to
  // count towards -- so it short-circuits before any of the arithmetic
  // below, and `days` is deliberately null rather than some large number
  // that a caller might one day render.
  //
  // BELOW suspended and above everything else. A suspended lifetime
  // tenant is suspended: it cannot write, whatever its billing says, and
  // the status line has to lead with that.
  if (t.subscription === 'lifetime'){
    return { kind:'lifetime', key:'lifetime', label:'Lifetime', days:null, endsOn:null,
             blurb:'This account does not expire and is never billed.' };
  }
  if (!end){
    // A trial with no date is the ordinary state of a tenant nobody has
    // billed yet -- not an error, and not something to nag about.
    return { kind:kind, key: kind === 'paid' ? 'active' : 'trial',
             label: kind === 'paid' ? 'Active' : 'Trial',
             days:null, endsOn:null,
             blurb:'No season has been paid for yet.' };
  }
  // THE LABEL FOLLOWS THE KIND, THE URGENCY FOLLOWS THE DATE.
  // -------------------------------------------------------------------
  // A trial that runs to a date is still a TRIAL, and calling it "Active"
  // on the school's own page reads as "you have paid" to somebody who has
  // not. So `label` is kind-aware while `key` stays the urgency, and the
  // two screens use whichever they need: the console shows the kind, the
  // Account card colours its pill by the urgency and puts the date in
  // words underneath.
  const noun = kind === 'trial' ? 'trial' : 'season';
  if (days < 0){
    return { kind:kind, key:'expired', label:'Expired', days:days, endsOn:end,
             blurb:'This ' + noun + ' ended on ' + toISODate(end) + '.' };
  }
  // THE WARNING WINDOW DEPENDS ON THE LENGTH OF THE THING.
  // -------------------------------------------------------------------
  // Thirty days for a paid season: the renewal lands on 31 July and what
  // has to happen first is somebody remembering during their preseason.
  //
  // Seven for a trial, because a trial IS thirty days -- a thirty-day
  // window on a thirty-day trial means the amber warning is on from the
  // moment they sign up, which teaches people to ignore it well before
  // the week it starts mattering.
  if (days <= (kind === 'trial' ? 7 : 30)){
    return { kind:kind, key:'expiring', label: kind === 'trial' ? 'Trial' : 'Expiring',
             days:days, endsOn:end,
             blurb: days === 0 ? 'This ' + noun + ' ends today.'
                  : 'This ' + noun + ' ends in ' + days + ' day' + (days === 1 ? '' : 's') + '.' };
  }
  return { kind:kind, key:'active', label: kind === 'trial' ? 'Trial' : 'Active',
           days:days, endsOn:end,
           blurb: kind === 'trial' ? 'Trial through ' + toISODate(end) + '.'
                                   : 'Paid through ' + toISODate(end) + '.' };
}

// Node consumers. A top-level `function` declaration in CommonJS is
// module-scoped and NOT on globalThis, so each one is assigned rather
// than assumed -- the exact trap that left engine.js's isAdminMarker
// shim installing a stale copy of the rule it was meant to share.
if (typeof module !== 'undefined' && module.exports){
  module.exports = { seasonState, nextSeasonEnd, seasonDateFromISO, seasonToday,
                     toISODate, trialEndsOn, TRIAL_DAYS };
}
