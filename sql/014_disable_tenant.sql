-- =====================================================================
-- 014 — the platform can suspend a tenant
--
-- WHAT "DISABLED" MEANS HERE, because the choice matters more than the
-- mechanism: a disabled tenant can still READ everything and can write
-- nothing.
--
-- Cutting reads was the obvious reading of "disable" and it is the wrong
-- one. A tenant's overlay is a read, and a crew that loses its scoreboard
-- mid-broadcast loses it in front of an audience — over a billing
-- dispute or an administrative decision that could be reversed in
-- seconds. Stopping WRITES stops the thing that matters (new data
-- accumulating in an account that should not be accumulating it) without
-- taking anything off air.
--
-- It is also completely reversible: one column back to null.
--
-- ---------------------------------------------------------------------
-- WHY TRIGGERS AND NOT POLICIES
-- ---------------------------------------------------------------------
-- Folding this into RLS would mean rewriting nine write policies to AND
-- in a disabled check, and the failure would be silent: RLS does not
-- refuse, it makes rows invisible or updates match nothing. A coach
-- would see "0 rows updated" or a generic error and have no idea why.
--
-- A trigger RAISES, with a sentence written for a person. "This tenant is
-- disabled" is a support call that answers itself; a silent no-op is a
-- support call that starts with twenty minutes of confusion.
--
-- SUBSCRIPTION AND DISABLED ARE SEPARATE, deliberately. A lapsed
-- subscription is a billing state; disabled is a decision somebody made.
-- They share a mechanism and must not share a column, because the first
-- question in the support call is which one it is.
-- =====================================================================

alter table public.tenants add column if not exists disabled_at timestamptz;
alter table public.tenants add column if not exists disabled_reason text;

comment on column public.tenants.disabled_at is
  'Suspended by the platform. NULL means active. A disabled tenant can READ everything and write nothing - taking an overlay off air over an administrative decision would fail in front of an audience.';

create or replace function public.tenant_is_writable(p_tenant uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((select disabled_at is null from public.tenants where id = p_tenant), false);
$function$;

-- ---------------------------------------------------------------------
-- The guard. One function, attached to every table that carries a tenant.
-- ---------------------------------------------------------------------
create or replace function public.refuse_writes_when_disabled()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  t uuid := coalesce(new.tenant_id, old.tenant_id);
  why text;
begin
  -- THE PLATFORM IS NOT BLOCKED. Support has to be able to fix whatever
  -- caused the suspension, and a platform that cannot touch a disabled
  -- tenant can only ever delete it.
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

do $$
declare
  tbl text;
begin
  foreach tbl in array array['games','plays','players','game_rosters','teams'] loop
    execute format('drop trigger if exists %I on public.%I', tbl || '_disabled_guard', tbl);
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      'for each row execute function public.refuse_writes_when_disabled()',
      tbl || '_disabled_guard', tbl);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Platform controls
-- ---------------------------------------------------------------------
create or replace function public.set_tenant_disabled(
  p_tenant uuid, p_disabled boolean, p_reason text default null
) returns boolean language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'Only the platform can suspend or restore a tenant.';
  end if;
  update public.tenants
     set disabled_at = case when p_disabled then coalesce(disabled_at, now()) else null end,
         disabled_reason = case when p_disabled then nullif(trim(coalesce(p_reason,'')), '') else null end
   where id = p_tenant;
  return found;
end;
$function$;

revoke all on function public.set_tenant_disabled(uuid, boolean, text) from public, anon;
grant execute on function public.set_tenant_disabled(uuid, boolean, text) to authenticated;

insert into public.schema_migrations (version, name)
values (14, '014_disable_tenant') on conflict (version) do nothing;
