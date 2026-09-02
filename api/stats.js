// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// HOW MUCH FOOTBALL HAS BEEN LOGGED ON STATCHAT
// =============================================
// Four numbers for the Numbers tab in platform.html: games and plays this
// week, games and plays ever.
//
// WHY AN ENDPOINT AND NOT A QUERY FROM THE PAGE. These are CROSS-TENANT
// totals. Every SELECT policy in the app is scoped to one school, correctly,
// so a browser query would count Andy's own tenant and stop. Only the service
// role sees everything, and the service key never leaves the server.
//
// The counting itself is in public.statchat_activity_totals()
// (sql/041_activity_totals.sql), not here. What counts as a real game is a
// rule about the data, and it belongs beside the data -- with one definition
// feeding all four numbers, so the weekly figure and the total can never
// drift apart. This file is transport and a permission check.

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) { res.status(401).json({ error: 'Missing authorization token' }); return; }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    res.status(500).json({ error: 'Server is missing SUPABASE_URL or SUPABASE_SECRET_KEY' });
    return;
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData || !userData.user) {
    res.status(401).json({ error: 'Invalid or expired session -- please sign in again' });
    return;
  }

  // PLATFORM ADMIN ONLY. Not because the numbers are secret -- they are
  // destined for the brochure site -- but because a total that spans every
  // school is not a customer's to read, and an endpoint that leaks the SHAPE
  // of the platform (how many schools, how much they use it) is worth
  // gating until the day the number is published deliberately.
  const { data: profileRows, error: profileError } = await admin
    .from('profiles').select('is_super_admin').eq('id', userData.user.id).limit(1);
  if (profileError) { res.status(500).json({ error: profileError.message }); return; }
  if (!((profileRows || [])[0] || {}).is_super_admin) {
    res.status(403).json({ error: 'Only a platform admin can read platform totals' });
    return;
  }

  // Supabase-js does NOT throw on a query error -- it returns { data, error }
  // -- so this is checked, not wrapped in a try/catch that would catch
  // nothing. A missing function here means sql/041 has not been run.
  const { data, error } = await admin.rpc('statchat_activity_totals');
  if (error) {
    const missing = /statchat_activity_totals/i.test(error.message || '')
                 && /(does not exist|schema cache|not find)/i.test(error.message || '');
    res.status(500).json({
      error: missing
        ? 'The totals function is not in the database yet -- run sql/041_activity_totals.sql.'
        : error.message
    });
    return;
  }

  // A set-returning function comes back as an array of one row.
  const row = (Array.isArray(data) ? data[0] : data) || {};
  res.status(200).json({
    weekStart:  row.week_start  || null,
    weekEnd:    row.week_end    || null,
    gamesWeek:  Number(row.games_week  || 0),
    playsWeek:  Number(row.plays_week  || 0),
    gamesTotal: Number(row.games_total || 0),
    playsTotal: Number(row.plays_total || 0)
  });
};
