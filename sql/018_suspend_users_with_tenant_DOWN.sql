-- 018_suspend_users_with_tenant_DOWN.sql
-- ============================================================================
-- Reverses 018.
--
-- READ THIS BEFORE RUNNING IT. Reverting restores the previous behaviour --
-- deleting a tenant stamps `deleted_at` and leaves every one of its accounts
-- able to authenticate. That is the security gap 018 exists to close, so
-- this is only for backing out a broken deploy, not for routine use.
--
-- ORDER MATTERS AND IS NOT OBVIOUS. The users are unbanned FIRST, while the
-- stamp still says which ones this feature locked out. Dropping the column
-- first would leave anybody suspended by a tenant delete banned for a
-- hundred years, with nothing left recording why or which accounts they
-- were -- a data-loss bug created by the rollback itself.
--
-- A user banned FOR CAUSE has no stamp and is deliberately left banned.
-- ============================================================================

-- 1. lift only the bans this feature applied, while we can still tell.
update auth.users u
   set banned_until = null
  from public.profiles p
 where p.id = u.id
   and p.suspended_with_tenant_at is not null;

-- 2. put the original function back: tenant flag only, accounts untouched.
create or replace function public.set_tenant_deleted(
  p_tenant uuid, p_deleted boolean
) returns boolean language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'Only the platform can delete or restore a tenant.';
  end if;
  update public.tenants
     set deleted_at = case when p_deleted then coalesce(deleted_at, now()) else null end
   where id = p_tenant;
  return found;
end;
$function$;

revoke all on function public.set_tenant_deleted(uuid, boolean) from public, anon;
grant execute on function public.set_tenant_deleted(uuid, boolean) to authenticated;

-- 3. and only now drop the record of what was suspended.
drop index if exists public.profiles_suspended_with_tenant_idx;
alter table public.profiles drop column if exists suspended_with_tenant_at;

delete from public.schema_migrations where version = 18;
