-- DOWN for 011_storage_scoping.sql
--
-- Restores the original policies verbatim from 000_baseline.sql. Note
-- what that means: it puts back a bucket where ANY authenticated user
-- can upload ANY file of ANY size, and where nothing can be deleted at
-- all. Only run this if 011 itself is breaking uploads.
--
-- The size limit and MIME allowlist are cleared too. They were never in
-- the baseline — they are the fixes that were always worth making
-- independently of tenancy — so leaving them would make this an
-- incomplete reversal rather than a clean one.
do $$
begin
  if to_regclass('storage.objects') is null then return; end if;

  update storage.buckets
     set file_size_limit = null, allowed_mime_types = null
   where id = 'team-logos';

  drop policy if exists "tenant scoped logo write" on storage.objects;
  drop policy if exists "tenant scoped logo delete" on storage.objects;
  drop policy if exists "anyone can view team logos" on storage.objects;
  drop policy if exists "authenticated users can update team logos" on storage.objects;

  create policy "anyone can view team logos" on storage.objects
    for select using (bucket_id = 'team-logos'::text);
  create policy "authenticated users can upload team logos" on storage.objects
    for insert with check ((bucket_id = 'team-logos'::text) and (auth.role() = 'authenticated'::text));
  create policy "authenticated users can update team logos" on storage.objects
    for update using ((bucket_id = 'team-logos'::text) and (auth.role() = 'authenticated'::text));
end $$;

drop function if exists public.storage_path_is_mine(text);
delete from public.schema_migrations where version = 11;
