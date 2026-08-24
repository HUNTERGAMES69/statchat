// Applies the admin-set team icon as the browser TAB FAVICON only.
//
// IT DELIBERATELY NO LONGER TOUCHES THE HOME-SCREEN ICON (24 Aug 2026).
// The two icons answer different questions. A favicon answers "which of
// my open tabs is the game I am scoring", and the team's mark is the
// best possible answer to that. A home-screen icon answers "what is this
// app", and once StatChat is a product sold to more than one school the
// answer to that is StatChat, not whichever team happens to be flagged
// is_our_team. Adding the app to an iPhone home screen was showing the
// team's logo, which read as the school's app rather than as ours.
//
// It SETS `apple-touch-icon` to StatChat's own mark rather than merely
// leaving it alone. Not one of the eighteen pages that load this file
// declares a static apple-touch-icon, so removing the line without
// replacing it would leave iOS to guess -- and its next guess is the
// `icon` link, which this file sets to the team's logo. The bug would
// have survived the fix.
//
// Doing it here rather than in eighteen <head> blocks means one file to
// change if the mark changes, and no page can be missed.
// Self-contained -- creates its own lightweight Supabase client rather
// than depending on each page's own client instance/timing, so this can
// just be dropped in as a single <script src> with no other changes
// needed per page. Requires the Supabase JS SDK to already be loaded
// (this tag must come after that one).
(function(){
  const SUPABASE_URL = 'https://pboushzlcyfkssojpuut.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_VGnUYurlkoH1yi67jHO6iQ_C8Q0EM2d';

  function setLink(rel, href, sizes){
    let el = document.querySelector('link[rel="' + rel + '"]' + (sizes ? '[sizes="' + sizes + '"]' : ''));
    if (!el){
      el = document.createElement('link');
      el.rel = rel;
      if (sizes) el.sizes = sizes;
      document.head.appendChild(el);
    }
    el.href = href;
  }

  // FIRST, and outside the try: the home-screen icon must not depend on
  // a network call succeeding. If Supabase is unreachable the team icon
  // is simply absent, but StatChat's own mark is a static file that is
  // already on the page.
  setLink('apple-touch-icon', 'logo.png');

  async function applyTeamIcon(){
    try {
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
      const { data, error } = await client
        .from('teams').select('icon_url').eq('is_our_team', true).limit(1);
      if (error || !data || data.length === 0 || !data[0].icon_url) return;
      const iconUrl = data[0].icon_url;
      setLink('icon', iconUrl);
      // NOT apple-touch-icon. See the note at the top of this file: the
      // home screen belongs to StatChat. Re-adding this line is what
      // would put a school's logo back on somebody's phone.
      window.__teamIconUrl = iconUrl;
      const splashImg = document.getElementById('splashTeamIcon');
      if (splashImg){
        splashImg.src = iconUrl;
        splashImg.style.display = 'inline-block';
      }
    } catch (e){
      // Never let a failed icon fetch break the actual page -- this is
      // a nice-to-have, not core functionality.
    }
  }

  applyTeamIcon();
})();
