-- =====================================================================
-- 026 DOWN  -- trials stop expiring again
-- =====================================================================
-- Puts 014's versions back. The two helper functions are dropped after
-- the guard stops calling them, not before, or the drop fails on the
-- dependency.
-- =====================================================================

create or replace function public.tenant_is_writable(p_tenant uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((select disabled_at is null from public.tenants where id = p_tenant), false);
$function$;

create or replace function public.refuse_writes_when_disabled()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  t uuid := coalesce(new.tenant_id, old.tenant_id);
  why text;
begin
  if public.is_super_admin() then
    return coalesce(new, old);
  end if;
  if t is null or public.tenant_is_writable(t) then
    return coalesce(new, old);
  end if;
  select disabled_reason into why from public.tenants where id = t;
  raise exception 'This account is currently suspended and cannot be changed.%',
    case when why is null or why = '' then '' else ' Reason: ' || why end;
end;
$function$;

drop function if exists public.tenant_has_live_game(uuid);
drop function if exists public.tenant_trial_ends_on(uuid);

comment on function public.tenant_is_writable(uuid) is null;

delete from public.schema_migrations where version = 26;
