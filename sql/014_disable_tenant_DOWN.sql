-- DOWN for 014_disable_tenant.sql
-- Removes the guard, so a suspended tenant can write again. The COLUMNS
-- are kept: dropping them would silently un-suspend and lose the record
-- of why, and a down script should not decide that for you.
do $$
declare tbl text;
begin
  foreach tbl in array array['games','plays','players','game_rosters','teams'] loop
    execute format('drop trigger if exists %I on public.%I', tbl || '_disabled_guard', tbl);
  end loop;
end $$;
drop function if exists public.refuse_writes_when_disabled();
drop function if exists public.set_tenant_disabled(uuid, boolean, text);
drop function if exists public.tenant_is_writable(uuid);
delete from public.schema_migrations where version = 14;
