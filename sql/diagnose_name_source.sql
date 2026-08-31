-- D. WHERE EACH SPELLING ACTUALLY LIVES.
-- Read only. Answers the one question the last query could not: is the
-- ALL-CAPS version coming from a roster, or from a name typed onto a play --
-- and from which game.
with names as (
  select t.name as school, 'roster' as source, r.player_name as spelling,
         g.designator, g.status, (g.deleted_at is not null) as deleted
    from public.game_rosters r
    join public.games g   on g.id = r.game_id
    join public.tenants t on t.id = g.tenant_id
  union all
  select t.name, 'play role',
         coalesce(p.roles->'passer'->>'name', p.roles->'carrier'->>'name',
                  p.roles->'receiver'->>'name', p.roles->'kicker'->>'name',
                  p.roles->'punter'->>'name'),
         g.designator, g.status, (g.deleted_at is not null)
    from public.plays p
    join public.games g   on g.id = p.game_id
    join public.tenants t on t.id = g.tenant_id
   where p.roles is not null
)
select school, source, designator, status, deleted,
       count(distinct spelling)                                   as spellings_here,
       count(*) filter (where spelling = upper(spelling))          as all_caps_rows,
       count(*) filter (where spelling <> upper(spelling))         as mixed_case_rows,
       (array_agg(distinct spelling order by spelling))[1:4]       as examples
from names
where spelling is not null and btrim(spelling) <> ''
group by school, source, designator, status, deleted
order by school, deleted, designator, source;
