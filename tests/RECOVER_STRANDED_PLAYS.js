(async () => {
  const { data, error } = await supabaseClient
    .from('plays').select('sequence_number').eq('game_id', currentGameId);
  if (error) { console.log('Could not reach the server: ' + error.message); return; }
  const onServer = new Set((data || []).map(r => r.sequence_number));
  const missing = plays.filter(p => !onServer.has(p._seq));
  console.log(missing.length + ' play(s) missing from the server');
  let ok = 0, bad = 0;
  for (const p of missing) {
    const seq = p._seq;
    const { error: e } = await supabaseClient.from('plays').insert({
      game_id: currentGameId, quarter: p.quarter || 1, sequence_number: seq,
      team_side: p.team || null, text: p.text, effect: p.effect || {},
      roles: p.roles || null, unresolved: !!p.unresolved,
      is_divider: !!p.isDivider, is_override: !!p.isOverride
    });
    if (e) { bad++; console.log('STILL FAILED: ' + p.text + ' -- ' + e.message); }
    else { ok++; console.log('saved: ' + p.text); }
  }
  console.log(bad === 0
    ? 'All plays are on the server. Safe to reload.'
    : bad + ' play(s) still not saved -- do NOT reload yet.');
})();
