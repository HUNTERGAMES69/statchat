-- 018_suspend_users_with_tenant.sql
-- ============================================================================
-- DELETING A TENANT MUST LOCK OUT ITS PEOPLE.
--
-- Until now `set_tenant_deleted` did exactly one thing: stamp
-- `tenants.deleted_at`. That makes current_tenant_id() return NULL for the
-- tenant, so RLS denies every row -- but the ACCOUNTS were untouched. They
-- still authenticated, still held a valid session, and still had a working
-- password. A deleted school's admin could sign in to a dashboard that
-- showed nothing, indefinitely, and nothing on the platform said they
-- existed.
--
-- "Sees no data" is not the same as "has no access". Anything added later
-- that reads without going through current_tenant_id() -- a new anon path,
-- a service-key endpoint, a function written in a hurry -- is reachable by
-- an account nobody remembers is live.
--
-- ============================================================================
-- WHY THIS IS IN THE SAME FUNCTION, AND NOT AN API CALL AFTER IT
--
-- The obvious alternative is for the platform console to call the RPC and
-- then a service-key endpoint that bans the users. That is two steps, and
-- the failure mode is the precise hole being closed: the tenant is deleted,
-- the ban call fails or the tab is closed, and the accounts stay live on a
-- school that no longer exists. Nothing would report it.
--
-- Inside the function, both happen in one transaction. Either the tenant is
-- deleted and its people are locked out, or neither is true.
--
-- The function is SECURITY DEFINER and owned by the role that can write
-- auth.users, which is what makes the direct update possible. banned_until
-- is the same column Supabase's own admin API sets -- api/manage-users.js
-- writes it through `ban_duration: '876000h'` for a single user, and the
-- interval below is the same hundred years.
--
-- ============================================================================
-- RESTORE HAS TO PUT BACK EXACTLY WHAT DELETE TOOK
--
-- Delete is reversible -- Recovery tools offers Restore, and the console
-- already promises "their users get full access back immediately". A fix
-- that locks users out and cannot unlock them replaces a security hole with
-- a data-loss one.
--
-- The trap: a coach disabled FOR CAUSE before the tenant was deleted must
-- stay disabled after it is restored. Blanket-unbanning everyone on restore
-- would silently reinstate them.
--
-- So the suspension is recorded. `profiles.suspended_with_tenant_at` marks
-- the accounts THIS function locked out, and restore lifts the ban only for
-- those. Someone already banned when the tenant was deleted has no stamp,
-- is skipped on the way in, and stays banned on the way out.
-- ============================================================================

alter table public.profiles
  add column if not exists suspended_with_tenant_at timestamptz;

comment on column public.profiles.suspended_with_tenant_at is
  'Set when set_tenant_deleted() locked this account out because its tenant '
  'was deleted. Restore lifts the ban only for accounts carrying this stamp, '
  'so a user who was already disabled for cause stays disabled.';

-- Only ever read by the function below, and only for one tenant at a time.
create index if not exists profiles_suspended_with_tenant_idx
  on public.profiles (tenant_id)
  where suspended_with_tenant_at is not null;

create or replace function public.set_tenant_deleted(
  p_tenant uuid, p_deleted boolean
) returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare
  -- INTEGER, not boolean. `get diagnostics ... = row_count` yields a count,
  -- and comparing a boolean to 0 raises at runtime -- which rolled the whole
  -- function back, so the tenant was not deleted either. Caught by running
  -- it rather than reading it.
  v_rows integer;
begin
  if not public.is_super_admin() then
    raise exception 'Only the platform can delete or restore a tenant.';
  end if;

  update public.tenants
     set deleted_at = case when p_deleted then coalesce(deleted_at, now()) else null end
   where id = p_tenant;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return false;
  end if;

  if p_deleted then
    -- LOCK OUT EVERY ACCOUNT IN THIS TENANT THAT IS NOT ALREADY LOCKED OUT.
    -- The `not exists` half is what preserves an existing suspension: a user
    -- banned for cause is skipped here, gets no stamp, and is therefore not
    -- unbanned by the restore branch below.
    with targets as (
      select p.id
        from public.profiles p
        join auth.users u on u.id = p.id
       where p.tenant_id = p_tenant
         and (u.banned_until is null or u.banned_until <= now())
    )
    update public.profiles p
       set suspended_with_tenant_at = now()
      from targets t
     where p.id = t.id;

    update auth.users u
       set banned_until = now() + interval '876000 hours'
      from public.profiles p
     where p.id = u.id
       and p.tenant_id = p_tenant
       and p.suspended_with_tenant_at is not null;

  else
    -- RESTORE: lift the ban ONLY where this function put it.
    update auth.users u
       set banned_until = null
      from public.profiles p
     where p.id = u.id
       and p.tenant_id = p_tenant
       and p.suspended_with_tenant_at is not null;

    update public.profiles p
       set suspended_with_tenant_at = null
     where p.tenant_id = p_tenant
       and p.suspended_with_tenant_at is not null;
  end if;

  return true;
end;
$function$;

revoke all on function public.set_tenant_deleted(uuid, boolean) from public, anon;
grant execute on function public.set_tenant_deleted(uuid, boolean) to authenticated;

-- The column is written only by the function above, which is SECURITY
-- DEFINER, so no role needs direct write access to it.
revoke update (suspended_with_tenant_at) on public.profiles from authenticated, anon;

insert into public.schema_migrations (version, name)
values (18, '018_suspend_users_with_tenant') on conflict (version) do nothing;
