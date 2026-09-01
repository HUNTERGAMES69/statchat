-- 036_broadcast_starters_DOWN.sql
-- ============================================================================
-- DROPS THE COLUMN AND EVERY LINEUP IN IT. There is nowhere else this data
-- lives -- it is not derived from the roster or from seed_starters -- so a
-- coach who filled in three units loses all three and has to type them again.
-- Not destructive to anything else: no other column, no play, no stat reads
-- it, and the three starter overlays simply draw nothing.
-- ============================================================================

begin;

alter table public.games drop column if exists broadcast_starters;

delete from public.schema_migrations where version = 36;

commit;
