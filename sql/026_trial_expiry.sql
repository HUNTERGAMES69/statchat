-- =====================================================================
-- 026  A TRIAL ENDS 30 DAYS AFTER THE TENANT IS CREATED
-- =====================================================================
-- Andy's spec, 31 Aug 2026: a trial runs 30 days from the tenant's
-- create date; when it ends the school's admin can still sign in, but
-- can only pay.
--
-- Until now a trial had no end at all. `renews_on` is nullable with no
-- default, api/create-tenant.js never set it, and nothing but a recorded
-- payment ever wrote it -- so a school set up in August 2026 would still
-- be entering plays for free in 2029 unless somebody noticed and
-- suspended it by hand.
--
-- DERIVED, NOT STORED. The end of a trial is created_at + 30 days: a
-- function of a column that already exists, so there is no job to run at
-- 2am, nothing to backfill, and no second copy of the date to drift. The
-- one exception is `renews_on`, which OVERRIDES it -- that is how the
-- console extends a trial by two weeks without pretending a payment was
-- made.
--
-- WHY THE GUARD LIVES HERE. 014 put one function in front of every write
-- on every tenant-scoped table. Enforcing this anywhere else would mean
-- a second gate that the first one does not know about; enforcing it in
-- the browser would mean no enforcement at all.
--
-- THE IN-PROGRESS EXCEPTION IS DELIBERATE AND IS THE RISKY PART.
-- A trial that ends at midnight on day 30 can end on a Friday, and a
-- scorer halfway through a game would find the app refusing to save a
-- play in front of a live broadcast. That is the one failure this system
-- cannot have. So a tenant with a game actually in progress keeps
-- writing until that game is finalised; everything else is refused
-- immediately. The console shows the expiry, so a tenant sitting on a
-- permanently unfinished game to stay free is visible and can be
-- suspended by hand -- which is a business problem with an answer,
-- rather than a broadcast failure with none.
-- =====================================================================

-- The trial's own deadline, in one place, so the enforcement below and
-- any report written later cannot disagree about it. NULL for anything
-- that is not a trial: lifetime and paid accounts are not on a clock.
create or replace function public.tenant_trial_ends_on(p_tenant uuid)
 returns date language sql stable security definer set search_path to 'public'
as $function$
  select case
           -- A DEMO IS NOT ON A CLOCK. Demo tenants sit at
           -- subscription='trial' -- nothing ever moves them off it --
           -- so without this line every demo older than thirty days
           -- would have been locked out of its own writes, including
           -- the seeded one this console demonstrates the product with.
           -- Caught from a screenshot, not from reading the SQL.
           when t.is_demo then null
           when t.subscription <> 'trial' then null
           else coalesce(t.renews_on, (t.created_at + interval '30 days')::date)
         end
    from public.tenants t
   where t.id = p_tenant;
$function$;

comment on function public.tenant_trial_ends_on(uuid) is
  'When a tenant''s free trial runs out: renews_on if set (an extension granted from the console), otherwise created_at + 30 days. NULL for paid and lifetime accounts, which are not on a trial clock.';

create or replace function public.tenant_has_live_game(p_tenant uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (select 1 from public.games g
                  where g.tenant_id = p_tenant
                    and g.status = 'in_progress'
                    and g.deleted_at is null);
$function$;

comment on function public.tenant_has_live_game(uuid) is
  'True while a game is actually being scored. Used ONLY to hold off a trial lockout mid-game - refusing a play in front of a live broadcast is the one failure this product cannot have.';

-- THE GUARD ITSELF. Same signature, same call sites, one more reason to
-- refuse -- so every trigger 014 attached picks this up with no change.
create or replace function public.tenant_is_writable(p_tenant uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select case
           -- Suspension still outranks everything. It is a decision
           -- somebody made; a lapsed trial is a clock running out.
           when coalesce((select disabled_at is not null
                            from public.tenants where id = p_tenant), true) then false
           -- Not a trial, or the trial has not run out yet.
           when coalesce(public.tenant_trial_ends_on(p_tenant), 'infinity'::date)
                >= current_date then true
           -- Out of trial, but mid-game. See the note above: this is the
           -- deliberate hole, and it closes the moment the game is final.
           when public.tenant_has_live_game(p_tenant) then true
           else false
         end;
$function$;

comment on function public.tenant_is_writable(uuid) is
  'The one gate in front of every tenant-scoped write (see 014). False when the tenant is suspended, or when its free trial has run out and no game is currently in progress.';

-- THE MESSAGE A PERSON READS. 014's trigger raises the suspension text
-- for every refusal, which for an expired trial would say "This account
-- is currently suspended" to somebody who was never suspended -- an
-- answer that sends them to support instead of to the payment link.
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
  if (select disabled_at is null from public.tenants where id = t) then
    raise exception 'Your free trial ended on %. Everything you have entered is still here and still readable - open Account to start a season and carry on.',
      to_char(public.tenant_trial_ends_on(t), 'FMMonth FMDD, YYYY');
  end if;
  select disabled_reason into why from public.tenants where id = t;
  raise exception 'This account is currently suspended and cannot be changed.%',
    case when why is null or why = '' then '' else ' Reason: ' || why end;
end;
$function$;

insert into public.schema_migrations (version, name)
values (26, '026_trial_expiry') on conflict (version) do nothing;
