-- =====================================================================
-- 009 — RLS actually isolates one school from another
--
-- THIS IS THE DANGEROUS ONE, and the reason 006-008 were kept separate.
-- A wrong policy does not error. It returns fewer rows, or more. A report
-- that shows nothing is obvious; one showing slightly fewer plays is not,
-- and you find out when a coach mentions the numbers look off.
--
-- FOURTEEN policies gain a tenant clause. FIVE are deliberately left
-- alone. Getting the second list right matters more than the first.
--
-- ---------------------------------------------------------------------
-- WHAT IS *NOT* TOUCHED, AND WHY
-- ---------------------------------------------------------------------
--
-- THE FOUR `anon` POLICIES. "anon reads shared games", "...game plays",
-- "...game rosters", "anon reads our branding". These are scoped by
-- PUBLICATION STATE -- status = 'final' and is_public = true -- not by
-- tenant. An anonymous reader has no auth.uid(), so current_tenant_id()
-- returns null for them, and **adding a tenant check to these denies
-- every row and breaks every public recap link.**
--
-- They are already correctly scoped: a share token identifies one game,
-- and a published game is published to everybody by definition. Scoping
-- a public thing to a tenant is a category error that reads like
-- diligence. This is the single easiest mistake to make while doing a
-- mechanical pass over nineteen policies.
--
-- THE TWO `profiles` POLICIES are own-row: `auth.uid() = id`. A tenant
-- clause would add nothing -- you are already only yourself -- and would
-- break `current_tenant_id()`, which reads profiles to find out what your
-- tenant IS. That is a circular dependency, and the reason the function
-- is SECURITY DEFINER in the first place.
--
-- ---------------------------------------------------------------------
-- WHAT THIS DOES *NOT* PROTECT
-- ---------------------------------------------------------------------
--
-- The five service-key endpoints -- feed.js, gamedata.js, seasondata.js,
-- og.js, share.js -- read as `service_role`, which 000_baseline creates
-- with **BYPASSRLS**. Policies are not consulted for them at all.
--
-- So this migration secures the entire application EXCEPT those five
-- files, and they must be tenant-scoped by hand against
-- `tenants.feed_key`. Nothing here changes their behaviour: the overlay
-- will work exactly as it does today, which is both the good news and
-- the problem.
--
-- ---------------------------------------------------------------------
-- THE SHAPE
-- ---------------------------------------------------------------------
--
--     using (tenant_id = current_tenant_id() or is_super_admin())
--
-- Super admin BESIDE the tenant check, in the policy text, never inside
-- current_tenant_id(). An override that cannot be seen in the rule is one
-- nobody thinks to log.
--
-- `plays` and `game_rosters` compare their OWN tenant_id rather than
-- joining to `games`. The column is denormalised precisely so the join is
-- not part of the security boundary -- correctness would otherwise depend
-- on that join being right on the busiest table in the application.
--
-- EVERY WRITE POLICY GETS THE CHECK ON BOTH SIDES. `using` decides which
-- existing rows you may touch; `with check` decides what the row may look
-- like afterwards. Without the second, a user could move a row into
-- another tenant, or insert one already belonging to somebody else --
-- 007's default supplies a tenant, but a hand-built request can still
-- name one.
-- =====================================================================

-- ---------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
  using (tenant_id = public.current_tenant_id() or public.is_super_admin());

drop policy if exists teams_write on public.teams;
create policy teams_write on public.teams for all to authenticated
  using      (public.current_user_role() = 'admin'
              and (tenant_id = public.current_tenant_id() or public.is_super_admin()))
  with check (public.current_user_role() = 'admin'
              and (tenant_id = public.current_tenant_id() or public.is_super_admin()));

-- ---------------------------------------------------------------------
-- players
-- ---------------------------------------------------------------------
drop policy if exists players_select on public.players;
create policy players_select on public.players for select to authenticated
  using (tenant_id = public.current_tenant_id() or public.is_super_admin());

drop policy if exists players_write on public.players;
create policy players_write on public.players for all to authenticated
  using      (public.current_user_role() = 'admin'
              and (tenant_id = public.current_tenant_id() or public.is_super_admin()))
  with check (public.current_user_role() = 'admin'
              and (tenant_id = public.current_tenant_id() or public.is_super_admin()));

-- ---------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------
drop policy if exists games_select on public.games;
create policy games_select on public.games for select to authenticated
  using (tenant_id = public.current_tenant_id() or public.is_super_admin());

drop policy if exists games_insert on public.games;
create policy games_insert on public.games for insert to authenticated
  with check (public.current_user_role() = 'admin'
              and (tenant_id = public.current_tenant_id() or public.is_super_admin()));

drop policy if exists games_update on public.games;
create policy games_update on public.games for update to authenticated
  using      (public.current_user_role() = any (array['admin','game_entry'])
              and (tenant_id = public.current_tenant_id() or public.is_super_admin()))
  with check (public.current_user_role() = any (array['admin','game_entry'])
              and (tenant_id = public.current_tenant_id() or public.is_super_admin()));

drop policy if exists games_delete on public.games;
create policy games_delete on public.games for delete to authenticated
  using (public.current_user_role() = 'admin'
         and (tenant_id = public.current_tenant_id() or public.is_super_admin()));

-- ---------------------------------------------------------------------
-- plays
-- ---------------------------------------------------------------------
drop policy if exists plays_select on public.plays;
create policy plays_select on public.plays for select to authenticated
  using (tenant_id = public.current_tenant_id() or public.is_super_admin());

drop policy if exists plays_insert on public.plays;
create policy plays_insert on public.plays for insert to authenticated
  with check (public.current_user_role() = any (array['admin','game_entry'])
              and (tenant_id = public.current_tenant_id() or public.is_super_admin()));

drop policy if exists plays_update on public.plays;
create policy plays_update on public.plays for update to authenticated
  using      (public.current_user_role() = any (array['admin','game_entry'])
              and (tenant_id = public.current_tenant_id() or public.is_super_admin()))
  with check (public.current_user_role() = any (array['admin','game_entry'])
              and (tenant_id = public.current_tenant_id() or public.is_super_admin()));

drop policy if exists plays_delete on public.plays;
create policy plays_delete on public.plays for delete to authenticated
  using (public.current_user_role() = any (array['admin','game_entry'])
         and (tenant_id = public.current_tenant_id() or public.is_super_admin()));

-- ---------------------------------------------------------------------
-- game_rosters
-- ---------------------------------------------------------------------
drop policy if exists game_rosters_select on public.game_rosters;
create policy game_rosters_select on public.game_rosters for select to authenticated
  using (tenant_id = public.current_tenant_id() or public.is_super_admin());

drop policy if exists game_rosters_write on public.game_rosters;
create policy game_rosters_write on public.game_rosters for all to authenticated
  using      (public.current_user_role() = 'admin'
              and (tenant_id = public.current_tenant_id() or public.is_super_admin()))
  with check (public.current_user_role() = 'admin'
              and (tenant_id = public.current_tenant_id() or public.is_super_admin()));

-- ---------------------------------------------------------------------
-- tenants — a new table, and it needs policies of its own
-- ---------------------------------------------------------------------
alter table public.tenants enable row level security;

drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants for select to authenticated
  using (id = public.current_tenant_id() or public.is_super_admin());

-- A school's own admin may edit its branding. It may NOT edit
-- subscription state, renewal date or its feed key from here -- those are
-- the platform's, and a customer able to set their own subscription to
-- 'active' is not a business.
--
-- Postgres has no column-level WITH CHECK, so this is enforced by trigger
-- below rather than by policy. The policy grants the row; the trigger
-- guards the columns.
drop policy if exists tenants_update on public.tenants;
create policy tenants_update on public.tenants for update to authenticated
  using      (public.current_user_role() = 'admin'
              and (id = public.current_tenant_id() or public.is_super_admin()))
  with check (public.current_user_role() = 'admin'
              and (id = public.current_tenant_id() or public.is_super_admin()));

create or replace function public.protect_tenant_billing_columns()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if public.is_super_admin() then return new; end if;
  if (new.subscription is distinct from old.subscription)
     or (new.renews_on is distinct from old.renews_on)
     or (new.feed_key  is distinct from old.feed_key) then
    raise exception 'Only the platform can change subscription state or the feed key.';
  end if;
  return new;
end;
$function$;

comment on function public.protect_tenant_billing_columns() is
  'LOAD-BEARING. tenants_update lets a school edit its own row; this stops that reaching subscription, renews_on or feed_key. Postgres has no column-level WITH CHECK.';

drop trigger if exists tenants_billing_guard on public.tenants;
create trigger tenants_billing_guard
  before update on public.tenants
  for each row execute function public.protect_tenant_billing_columns();

-- Anonymous readers need a published game's branding. Colours and a logo
-- are not secrets -- they are on the school's website -- and a recap link
-- is useless without them.
drop policy if exists "anon reads tenant branding" on public.tenants;
create policy "anon reads tenant branding" on public.tenants for select to anon
  using (exists (select 1 from public.games g
                  where g.tenant_id = tenants.id
                    and g.status = 'final' and g.is_public = true));

grant select on public.tenants to anon, authenticated;
grant update on public.tenants to authenticated;

insert into public.schema_migrations (version, name)
values (9, '009_tenant_rls') on conflict (version) do nothing;
