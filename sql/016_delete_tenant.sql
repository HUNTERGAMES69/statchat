-- =====================================================================
-- 016 — deleting a tenant, without destroying it
--
-- `tenants` cascades to teams, games, players, plays and game_rosters.
-- One DELETE on one row destroys everything a customer has ever entered,
-- irreversibly, and the button that does it would sit in a menu next to
-- Suspend.
--
-- Migration 012 gave a single GAME a soft delete for exactly this reason.
-- Doing the opposite one level up would be the same mistake at a hundred
-- times the scale — and the mistake is not hypothetical: the row this
-- deletes is chosen from a list, and lists are misclicked.
--
-- ---------------------------------------------------------------------
-- WHAT DELETED MEANS, AND HOW IT DIFFERS FROM SUSPENDED
-- ---------------------------------------------------------------------
--   SUSPENDED (014)  reads everything, writes nothing. Their overlay
--                    still works. A billing lever, reversible in seconds.
--   DELETED (here)   sees nothing at all. Their users sign in to an empty
--                    application. Public recap links stop resolving.
--
-- Both are reversible by the platform. Neither destroys a row. A
-- PERMANENT purge is deliberately not built: it is a different decision,
-- taken later, with a retention period behind it — and the moment it
-- exists it belongs behind a typed confirmation, not a menu item.
--
-- ---------------------------------------------------------------------
-- HOW IT IS ENFORCED, AND WHY IT IS ONE LINE
-- ---------------------------------------------------------------------
-- Every tenant-scoped policy already reads
--
--     tenant_id = current_tenant_id() or is_super_admin()
--
-- so making current_tenant_id() return NULL for a deleted tenant denies
-- every one of them at once. NULL never equals anything, so nothing has
-- to be rewritten and nothing can be forgotten.
--
-- A NOTE ON WHERE THIS SITS. MULTI_TENANT_PLAN.md says the super-admin
-- override rides BESIDE the tenant check, never inside the function,
-- because an invisible GRANT defeats an audit trail. This is the mirror
-- of that and the reasoning does not transfer: a revocation folded into
-- one place cannot be forgotten in one policy out of seventeen. Hiding
-- access is dangerous; hiding a denial is not.
-- =====================================================================

alter table public.tenants add column if not exists deleted_at timestamptz;

comment on column public.tenants.deleted_at is
  'Soft delete. Their users see nothing; the platform still sees the row and can restore it. Enforced through current_tenant_id() returning NULL, which denies every tenant-scoped policy at once. No data is destroyed - tenants cascades to five tables.';

create index if not exists tenants_live_idx on public.tenants (id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- The one line that does the work
-- ---------------------------------------------------------------------
create or replace function public.current_tenant_id()
 returns uuid language sql stable security definer set search_path to 'public'
as $function$
  select p.tenant_id
    from profiles p
    join tenants t on t.id = p.tenant_id
   where p.id = auth.uid()
     and t.deleted_at is null
   limit 1;
$function$;

-- ---------------------------------------------------------------------
-- The anon paths do NOT go through current_tenant_id()
--
-- Public recaps are scoped by publication state, not by tenant — which is
-- what makes them work for readers who have no account at all. So a
-- deleted tenant's shared links would keep resolving unless said
-- otherwise here.
--
-- They should stop. A deleted customer's data should not stay live on the
-- open internet because somebody still has the URL.
-- ---------------------------------------------------------------------
-- A FUNCTION, NOT A SUBQUERY, AND THIS IS NOT STYLE.
-- ---------------------------------------------------------------------
-- The first version had the games policy select from `tenants`, while the
-- tenants policy selects from `games`. Postgres evaluates the second
-- table's policies inside the first's subquery, so the two chase each
-- other:
--
--     ERROR: infinite recursion detected in policy for relation "games"
--
-- and every public recap returns an error instead of a page.
--
-- SECURITY DEFINER breaks the loop by not consulting RLS on the way in.
-- Any policy that reaches into a table which reaches back must go through
-- a function; a subquery between two RLS-protected tables that reference
-- each other cannot work.
create or replace function public.tenant_is_live(p_tenant uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (select 1 from public.tenants
                  where id = p_tenant and deleted_at is null);
$function$;

comment on function public.tenant_is_live(uuid) is
  'Reads tenants WITHOUT RLS, deliberately: the anon policies on games/plays/rosters/teams need to test the tenant, and the tenants policy tests games. A subquery either way recurses.';

grant execute on function public.tenant_is_live(uuid) to anon, authenticated;

drop policy if exists "anon reads shared games" on public.games;
create policy "anon reads shared games" on public.games for select to anon
  using (status = 'final' and is_public = true and deleted_at is null
         and public.tenant_is_live(games.tenant_id));

drop policy if exists "anon reads shared game plays" on public.plays;
create policy "anon reads shared game plays" on public.plays for select to anon
  using (exists (select 1 from public.games g
                  where g.id = plays.game_id and g.status = 'final'
                    and g.is_public = true and g.deleted_at is null
                    and public.tenant_is_live(g.tenant_id)));

drop policy if exists "anon reads shared game rosters" on public.game_rosters;
create policy "anon reads shared game rosters" on public.game_rosters for select to anon
  using (exists (select 1 from public.games g
                  where g.id = game_rosters.game_id and g.status = 'final'
                    and g.is_public = true and g.deleted_at is null
                    and public.tenant_is_live(g.tenant_id)));

drop policy if exists "anon reads team branding" on public.teams;
create policy "anon reads team branding" on public.teams for select to anon
  using (public.tenant_is_live(teams.tenant_id)
         and exists (select 1 from public.games g
                      where g.tenant_id = teams.tenant_id and g.status = 'final'
                        and g.is_public = true and g.deleted_at is null));

drop policy if exists "anon reads tenant branding" on public.tenants;
create policy "anon reads tenant branding" on public.tenants for select to anon
  using (deleted_at is null
         and exists (select 1 from public.games g
                      where g.tenant_id = tenants.id
                        and g.status = 'final' and g.is_public = true
                        and g.deleted_at is null));

-- The platform must still SEE a deleted tenant, or it could never restore
-- one. tenants_select already ends `or is_super_admin()`, so it does.

-- ---------------------------------------------------------------------
-- Platform controls
-- ---------------------------------------------------------------------
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

insert into public.schema_migrations (version, name)
values (16, '016_delete_tenant') on conflict (version) do nothing;
