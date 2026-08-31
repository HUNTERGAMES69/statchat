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
function seasonState(tenant, now){
  const t = tenant || {};
  const end = seasonDateFromISO(t.renews_on);
  const today = seasonToday(now);
  const days = end ? Math.round((end - today) / 86400000) : null;

  if (t.disabled_at){
    return { key:'suspended', label:'Suspended', days:days, endsOn:end,
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
    return { key:'lifetime', label:'Lifetime', days:null, endsOn:null,
             blurb:'This account does not expire and is never billed.' };
  }
  if (!end){
    // A trial with no date is the ordinary state of a tenant nobody has
    // billed yet -- not an error, and not something to nag about.
    return { key: t.subscription === 'active' ? 'active' : 'trial',
             label: t.subscription === 'active' ? 'Active' : 'Trial',
             days:null, endsOn:null,
             blurb:'No season has been paid for yet.' };
  }
  if (days < 0){
    return { key:'expired', label:'Expired', days:days, endsOn:end,
             blurb:'This season ended on ' + toISODate(end) + '.' };
  }
  // THIRTY DAYS, because the renewal lands on 31 July and the thing that
  // has to happen before it matters is somebody remembering during their
  // preseason. A week's notice in late July reaches a coach who is not
  // reading email.
  if (days <= 30){
    return { key:'expiring', label:'Expiring', days:days, endsOn:end,
             blurb:'This season ends in ' + days + ' day' + (days === 1 ? '' : 's') + '.' };
  }
  return { key:'active', label:'Active', days:days, endsOn:end,
           blurb:'Paid through ' + toISODate(end) + '.' };
}

// Node consumers. A top-level `function` declaration in CommonJS is
// module-scoped and NOT on globalThis, so each one is assigned rather
// than assumed -- the exact trap that left engine.js's isAdminMarker
// shim installing a stale copy of the rule it was meant to share.
if (typeof module !== 'undefined' && module.exports){
  module.exports = { seasonState, nextSeasonEnd, seasonDateFromISO, seasonToday, toISODate };
}
