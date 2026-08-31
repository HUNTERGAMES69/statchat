-- 030_sample_game_scope.sql
-- ============================================================================
-- WHO GETS THE SAMPLE GAME -- CHOSEN, AND SEEN FIRST.
--
-- 028 shipped one sweep, seed_sample_game_into_demos(), which loops tenants
-- where is_demo. That was written from "there are 6 schools with demo
-- accounts already" and it is the wrong filter for what those schools
-- actually are.
--
-- DEMO AND TRIAL ARE NOT THE SAME THING, and the platform's own status
-- ladder says so:
--
--   DEMO   is_demo = true. Sits at subscription='trial' for ever, is never
--          on a clock, and 026 exempts it from trial expiry.
--   TRIAL  is_demo = false, subscription='trial'. A real school on a 30-day
--          clock counted from created_at.
--
-- Both read 'trial' in the subscription column; is_demo is the only thing
-- between them. So a school that signed itself up is a TRIAL, and running
-- the 028 sweep against it seeds nothing at all -- silently, returning 0,
-- which reads exactly like "already done".
--
-- Worse: set_tenant_demo() has been throwing since 021 (repaired in 029), so
-- for as long as that has been broken it has not been POSSIBLE to mark a
-- school as a demo. Any school signed up in that window is a trial whether
-- or not anyone meant it to be.
--
-- ============================================================================
-- THE DRY RUN IS THE POINT OF THIS FILE
--
-- Everything below could have been one more sweep with a different WHERE
-- clause. The reason it is two functions is that a bulk write across every
-- school on the platform should be READ FIRST -- by a person, naming the
-- schools, before anything is written. sample_game_candidates() answers
-- "who exactly, and what do they have now" and writes nothing at all.
--
-- PAID AND LIFETIME SCHOOLS ARE NEVER IN SCOPE. A school in week three of a
-- paid season does not want an example game appearing in its list, and there
-- is no scope string that includes them. Seeding one is still possible, but
-- only by naming it: apply_sample_game('<tenant>'), one school, deliberately.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- THE DRY RUN. Writes nothing. Run this first, every time:
--
--   select * from public.sample_game_candidates('trial');
--
-- Scopes: 'demo', 'trial', 'both'.
-- ---------------------------------------------------------------------------
create or replace function public.sample_game_candidates(
  p_scope      text default 'trial',
  p_designator text default 'SAMPLE'
) returns table (
  tenant_id      uuid,
  tenant_name    text,
  status         text,
  created        date,
  their_own_games bigint,
  would_seed     boolean,
  reason         text
) language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_source uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only the platform can look at this.';
  end if;
  if p_scope not in ('demo','trial','both') then
    raise exception 'Scope must be demo, trial or both. Got "%".', p_scope;
  end if;

  -- The tenant the sample was captured from, so it can be named as skipped
  -- rather than silently absent.
  select g.tenant_id into v_source
    from public.sample_game s join public.games g on g.id = s.captured_from
   where s.only_row;

  return query
  select
    t.id,
    t.name,
    case when t.is_demo                     then 'DEMO'
         when t.disabled_at is not null     then 'SUSPENDED'
         when t.subscription = 'lifetime'   then 'LIFETIME'
         when t.subscription in ('active','lapsed') then 'PAID'
         else 'TRIAL' end,
    t.created_at::date,
    (select count(*) from public.games g
      where g.tenant_id = t.id and g.deleted_at is null
        and g.is_sample is not true),
    -- WOULD IT ACTUALLY BE SEEDED. Every condition the sweep applies,
    -- evaluated here so the two can never drift into disagreeing about who
    -- is in scope -- which is the failure this whole file exists to stop.
    (
      case when t.is_demo then p_scope in ('demo','both')
           when t.disabled_at is null
            and t.subscription is not distinct from 'trial' then p_scope in ('trial','both')
           else false end
      and t.id is distinct from v_source
      and not exists (select 1 from public.games g
                       where g.tenant_id = t.id and g.designator = p_designator)
      and exists (select 1 from public.teams tm
                   where tm.tenant_id = t.id and tm.is_our_team)
    ),
    case
      when t.id = v_source then 'skipped: the sample was captured from this tenant'
      when exists (select 1 from public.games g
                    where g.tenant_id = t.id and g.designator = p_designator
                      and g.deleted_at is not null)
        then 'skipped: had it and deleted it'
      when exists (select 1 from public.games g
                    where g.tenant_id = t.id and g.designator = p_designator)
        then 'skipped: already has it'
      when not exists (select 1 from public.teams tm
                        where tm.tenant_id = t.id and tm.is_our_team)
        then 'SKIPPED: no team row - this tenant is broken, look at it'
      when t.is_demo and p_scope not in ('demo','both') then 'out of scope (demo)'
      when not t.is_demo and t.subscription is not distinct from 'trial'
           and t.disabled_at is null and p_scope not in ('trial','both')
        then 'out of scope (trial)'
      when t.disabled_at is not null then 'out of scope (suspended)'
      when t.subscription = 'lifetime' then 'out of scope (lifetime)'
      when t.subscription in ('active','lapsed') then 'out of scope (paid)'
      else 'would be seeded'
    end
  from public.tenants t
  where t.deleted_at is null
  order by t.is_demo desc, t.created_at;
end;
$function$;

-- ---------------------------------------------------------------------------
-- THE SWEEP, scoped. Run the dry run above first and read it.
--
--   select public.seed_sample_game_into('trial');
--
-- Returns the number newly seeded. Re-running returns 0, which is correct.
-- ---------------------------------------------------------------------------
create or replace function public.seed_sample_game_into(
  p_scope      text default 'trial',
  p_designator text default 'SAMPLE'
) returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  r         record;
  v_added   integer := 0;
  v_skipped integer := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Only the platform can seed sample games.';
  end if;
  if not exists (select 1 from public.sample_game where only_row) then
    raise exception 'There is no sample game yet. Run capture_sample_game() once first.';
  end if;

  -- DRIVEN BY THE DRY RUN'S OWN ANSWER. The sweep does not re-derive who is
  -- in scope; it seeds exactly the rows sample_game_candidates() marked
  -- would_seed. Two copies of that logic would eventually disagree, and the
  -- disagreement would show up as "the preview said five and it did six".
  for r in select * from public.sample_game_candidates(p_scope, p_designator)
            where would_seed
  loop
    -- Still guarded per tenant: one malformed school must not roll back the
    -- others. Same reasoning as 028's sweep, and the same reason it is not
    -- simply `perform` in a bare loop.
    begin
      perform public.apply_sample_game(r.tenant_id, p_designator);
      v_added := v_added + 1;
    exception when others then
      v_skipped := v_skipped + 1;
      raise notice 'Skipped %: %', r.tenant_name, sqlerrm;
    end;
  end loop;

  if v_skipped > 0 then
    raise notice '% school(s) seeded, % skipped (see above).', v_added, v_skipped;
  end if;
  return v_added;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 028's demos-only sweep is KEPT and becomes a wrapper, so anything already
-- written against it keeps working and cannot start meaning something else.
-- ---------------------------------------------------------------------------
create or replace function public.seed_sample_game_into_demos(
  p_designator text default 'SAMPLE'
) returns integer language plpgsql security definer set search_path to 'public'
as $function$
begin
  return public.seed_sample_game_into('demo', p_designator);
end;
$function$;

comment on function public.sample_game_candidates(text, text) is
  'DRY RUN. Lists every live tenant, its status, and whether the sample game '
  'would be seeded into it - with a reason for each. Writes nothing. Run this '
  'before the sweep, and read it.';
comment on function public.seed_sample_game_into(text, text) is
  'Seeds the sample game into every tenant sample_game_candidates(scope) marks '
  'would_seed. Scopes: demo, trial, both. Paid and lifetime schools are never '
  'in scope - name one with apply_sample_game() if you really want it.';
comment on function public.seed_sample_game_into_demos(text) is
  'Kept from 028; now a wrapper for seed_sample_game_into(''demo'').';

revoke all on function public.sample_game_candidates(text, text) from public, anon;
revoke all on function public.seed_sample_game_into(text, text)  from public, anon;
grant execute on function public.sample_game_candidates(text, text) to authenticated;
grant execute on function public.seed_sample_game_into(text, text)  to authenticated;

insert into public.schema_migrations (version, name)
values (30, '030_sample_game_scope') on conflict (version) do nothing;
