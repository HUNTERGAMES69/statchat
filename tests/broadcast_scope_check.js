// One game on air PER SCHOOL, and the clear must not reach past it
// ================================================================
// `set_broadcast_game` clears the flag before setting it, so only one game
// is ever on air. That clear had no tenant filter:
//
//     update games set is_broadcast = false
//      where is_broadcast and id <> p_game_id;
//
// Every game, every school. It was written when the constraint WAS global --
// migration 010 replaced `one_broadcast_game` with
// `one_broadcast_game_per_tenant` and updated the INDEX without revisiting
// the function that exists to satisfy it.
//
// SECURITY DEFINER, so RLS does not narrow it. Demonstrated against a real
// Postgres before the fix: Neville putting its second game on air took Red
// Stick off. The symptom on a Friday night would be another school's overlay
// going blank with nothing in their own tenant to explain it.
//
//   node tests/broadcast_scope_check.js

const fs = require('fs');
const path = require('path');
const sqlDir = path.join(__dirname, '..', 'sql');
const read = f => fs.readFileSync(path.join(sqlDir, f), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Broadcast flag is scoped to one school ===\n');

// ---- the index -----------------------------------------------------------
{
  const m010 = read('010_per_tenant_uniqueness.sql');
  chk(/create unique index if not exists one_broadcast_game_per_tenant\s*\n\s*on public\.games \(tenant_id\) where is_broadcast;/.test(m010),
      'the index is per tenant, so two schools can broadcast at once');
  chk(/drop index if exists public\.one_broadcast_game;/.test(m010),
      'and the old global one is dropped, so it cannot silently win');
}

// ---- the function --------------------------------------------------------
{
  const raw = fs.existsSync(path.join(sqlDir, '024_broadcast_clear_scoped_to_tenant.sql'))
    ? read('024_broadcast_clear_scoped_to_tenant.sql') : null;
  const f = raw && raw.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  chk(!!f, 'migration 024 exists');
  if (f) {
    chk(/select tenant_id into target_tenant from games where id = p_game_id;/.test(f),
        'it reads the owning tenant BEFORE clearing anything');
    chk(/and tenant_id = target_tenant/.test(f),
        'and the clear is limited to that tenant — this is the whole fix');
    chk(/if target_tenant is null then\s*\n\s*raise exception/.test(f),
        'a game id that does not exist raises rather than clearing the world ' +
        'and setting nothing');

    // ORDER MATTERS. Clearing before knowing whose game it is would be the
    // same bug with extra steps.
    const readAt = f.indexOf('select tenant_id into target_tenant');
    const clearAt = f.indexOf('update games set is_broadcast = false');
    chk(readAt > -1 && clearAt > readAt,
        'and the read comes first');

    chk(/caller_role not in \('admin','game_entry'\)/.test(f),
        'the role check is preserved — admin AND game_entry, because the crew ' +
        'sets up the day before');
    chk(/broadcast_set_by = auth\.uid\(\)/.test(f),
        'and so is the record of who set it');
  }
}

// ---- nothing else clears it unscoped -------------------------------------
// A second unscoped clear anywhere would reintroduce the fault.
{
  const offenders = fs.readdirSync(sqlDir)
    .filter(n => n.endsWith('.sql') && !/_DOWN|^000_baseline/.test(n))
    .filter(n => {
      const t = read(n).split('\n')
        .filter(l => !l.trim().startsWith('--')).join('\n');
      const m = /update games set is_broadcast = false[\s\S]{0,160}?;/.exec(t);
      return m && !/tenant_id/.test(m[0]);
    });
  chk(offenders.length === 0,
      'no migration clears the flag without a tenant filter' +
      (offenders.length ? ' — found in ' + offenders.join(', ') : ''));
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
