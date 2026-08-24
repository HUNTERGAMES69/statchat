-- =====================================================================
-- 011 — the storage bucket stops being a free-for-all
--
-- Hazard 5, and the last one open. What `team-logos` allowed until now:
--
--     for insert with check (bucket_id = 'team-logos'
--                            and auth.role() = 'authenticated')
--
-- ANY authenticated user could upload ANY file, of ANY type, at ANY
-- size, into one shared namespace. No size limit, no MIME allowlist, no
-- path scoping, and NO DELETE POLICY AT ALL — so nothing could ever be
-- removed once written.
--
-- The cross-tenant READ is the least of it: a school crest is public by
-- nature and appears on a public recap. The real exposure is that a
-- `view`-role account at any school could fill the storage quota, or
-- upload something that is not an image.
--
-- ---------------------------------------------------------------------
-- NO TENANT PREFIX, AND NO FILE MIGRATION
-- ---------------------------------------------------------------------
-- The obvious design is to prefix every path with a tenant id. That
-- means moving every existing object, rewriting every stored logo_url,
-- and changing three upload sites — a lot of moving parts for a rule
-- that can be expressed against the paths that already exist:
--
--     opponent/<gameId>/logo.ext   -> that game must be mine
--     avatars/<userId>/avatar.ext  -> that user must be me
--     <teamId>/<kind>.ext          -> that team must be mine
--
-- Each path already names something owned. Deriving the tenant from the
-- thing named is exact, needs no migration, and cannot drift from the
-- data the way a duplicated prefix could.
--
-- READS STAY PUBLIC. Logos are fetched by anonymous recap viewers and by
-- vMix browser sources that hold no session. Locking reads down would
-- break both, and would be protecting something that is on the school's
-- website anyway.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Does this storage path belong to the caller?
--
-- Declared BEFORE the policies that call it: Postgres validates a
-- `language sql` body at CREATE time, which is the same ordering trap
-- that stopped current_user_role() being created before profiles
-- existed (see 000_baseline.sql). plpgsql is used here so the body is
-- not validated until it runs, because storage.objects may not exist on
-- a scratch database at all.
--
-- SECURITY DEFINER because it reads games and teams, which are behind
-- the RLS added in 009 — a plain function would be scoped by the very
-- policies it is trying to inform.
-- ---------------------------------------------------------------------
create or replace function public.storage_path_is_mine(object_name text)
 returns boolean language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  parts text[] := string_to_array(object_name, '/');
begin
  if parts is null or array_length(parts, 1) < 2 then
    return false;               -- a bare filename at the root owns nothing
  end if;

  -- avatars/<userId>/avatar.ext — your own, and only your own
  if parts[1] = 'avatars' then
    return parts[2] = auth.uid()::text;
  end if;

  -- opponent/<gameId>/logo.ext — the game must be in my school
  if parts[1] = 'opponent' then
    return exists (
      select 1 from public.games g
       where g.id::text = parts[2]
         and (g.tenant_id = public.current_tenant_id() or public.is_super_admin()));
  end if;

  -- <teamId>/<kind>.ext — the team must be in my school
  return exists (
    select 1 from public.teams t
     where t.id::text = parts[1]
       and (t.tenant_id = public.current_tenant_id() or public.is_super_admin()));
exception when others then
  -- A malformed uuid in a path must DENY, not error. An exception here
  -- would surface as a failed upload with a database message attached.
  return false;
end;
$function$;

comment on function public.storage_path_is_mine(text) is
  'Derives ownership from what a storage path already names - no tenant prefix, so no file migration. Used by the team-logos policies.';

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'no storage schema; skipping (expected on a scratch rebuild)';
    return;
  end if;

  -- -------------------------------------------------------------------
  -- A size cap and a MIME allowlist. These are bucket columns, not
  -- policies, and they are the two fixes that were always worth doing
  -- independently of tenancy.
  --
  -- 2 MB: a school crest that will not render larger than 512px. Ten
  -- times what any real logo needs, and small enough that a mistake
  -- cannot fill a quota.
  -- -------------------------------------------------------------------
  update storage.buckets
     set file_size_limit = 2097152,
         allowed_mime_types = array['image/png','image/jpeg','image/webp','image/svg+xml']
   where id = 'team-logos';

  drop policy if exists "anyone can view team logos" on storage.objects;
  drop policy if exists "authenticated users can upload team logos" on storage.objects;
  drop policy if exists "authenticated users can update team logos" on storage.objects;
  drop policy if exists "tenant scoped logo write" on storage.objects;
  drop policy if exists "tenant scoped logo delete" on storage.objects;

  -- READ: unchanged and deliberately so. See the note above.
  create policy "anyone can view team logos" on storage.objects
    for select using (bucket_id = 'team-logos');

  -- WRITE: the path must name something the caller owns.
  create policy "tenant scoped logo write" on storage.objects
    for insert with check (
      bucket_id = 'team-logos' and public.storage_path_is_mine(name)
    );

  create policy "authenticated users can update team logos" on storage.objects
    for update using (
      bucket_id = 'team-logos' and public.storage_path_is_mine(name)
    ) with check (
      bucket_id = 'team-logos' and public.storage_path_is_mine(name)
    );

  -- DELETE: there was NO delete policy, which means RLS denied every
  -- delete and the bucket only ever grew. Replacing a logo with `upsert`
  -- worked, but nothing could be cleared out — including a file uploaded
  -- by mistake.
  create policy "tenant scoped logo delete" on storage.objects
    for delete using (
      bucket_id = 'team-logos' and public.storage_path_is_mine(name)
    );
end $$;

insert into public.schema_migrations (version, name)
values (11, '011_storage_scoping') on conflict (version) do nothing;
