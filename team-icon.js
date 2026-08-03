// Applies the admin-set team icon as the browser tab favicon and the
// iPhone home-screen icon, on whichever page this is included on.
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

  async function applyTeamIcon(){
    try {
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
      const { data, error } = await client
        .from('teams').select('icon_url').eq('is_our_team', true).limit(1);
      if (error || !data || data.length === 0 || !data[0].icon_url) return;
      const iconUrl = data[0].icon_url;
      setLink('icon', iconUrl);
      setLink('apple-touch-icon', iconUrl);
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
