-- DOWN for 016_delete_tenant.sql
--
-- **THIS UN-DELETES EVERY DELETED TENANT**, because current_tenant_id()
-- stops consulting deleted_at and the anon policies stop testing it. Any
-- tenant that was soft-deleted becomes fully live again — its users can
-- read and write, its public recaps resolve.
--
-- The COLUMN is kept, so the record of what was deleted and when survives
-- and re-applying 016 restores the previous state exactly. Dropping it
-- would silently discard that.
create or replace function public.current_tenant_id()
 returns uuid language sql stable security definer set search_path to 'public'
as $function$
  select tenant_id from profiles where id = auth.uid() limit 1;
$function$;

drop policy if exists "anon reads shared games" on public.games;
create policy "anon reads shared games" on public.games for select to anon
  using (status = 'final' and is_public = true and deleted_at is null);

drop policy if exists "anon reads shared game plays" on public.plays;
create policy "anon reads shared game plays" on public.plays for select to anon
  using (exists (select 1 from public.games g
                  where g.id = plays.game_id and g.status = 'final'
                    and g.is_public = true and g.deleted_at is null));

drop policy if exists "anon reads shared game rosters" on public.game_rosters;
create policy "anon reads shared game rosters" on public.game_rosters for select to anon
  using (exists (select 1 from public.games g
                  where g.id = game_rosters.game_id and g.status = 'final'
                    and g.is_public = true and g.deleted_at is null));

drop policy if exists "anon reads team branding" on public.teams;
create policy "anon reads team branding" on public.teams for select to anon
  using (exists (select 1 from public.games g
                  where g.tenant_id = teams.tenant_id and g.status = 'final'
                    and g.is_public = true and g.deleted_at is null));

drop policy if exists "anon reads tenant branding" on public.tenants;
create policy "anon reads tenant branding" on public.tenants for select to anon
  using (exists (select 1 from public.games g
                  where g.tenant_id = tenants.id
                    and g.status = 'final' and g.is_public = true));

drop function if exists public.set_tenant_deleted(uuid, boolean);
drop function if exists public.tenant_is_live(uuid);
drop index if exists public.tenants_live_idx;

delete from public.schema_migrations where version = 16;
