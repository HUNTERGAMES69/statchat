-- =====================================================================
-- 027 DOWN
-- =====================================================================
-- Going back is only possible if nothing has USED the new freedom: two
-- seasons sharing a designator, or a live game reusing a deleted one's
-- name, both violate the old constraint. Reported rather than silently
-- failing halfway.
-- =====================================================================

do $$
declare
  bad text;
begin
  select string_agg(format('tenant %s / "%s" (%s rows)', tenant_id, designator, n), '; ')
    into bad
    from (select tenant_id, designator, count(*) n
            from public.games
           group by 1, 2
          having count(*) > 1) d;
  if bad is not null then
    raise exception 'Cannot revert 027: these would violate the old global-per-tenant constraint -- %', bad;
  end if;
end $$;

drop index if exists public.games_tenant_season_designator_idx;

alter table public.games
  add constraint games_tenant_designator_key unique (tenant_id, designator);

delete from public.schema_migrations where version = 27;
