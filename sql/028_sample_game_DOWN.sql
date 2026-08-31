-- 028_sample_game_DOWN.sql
-- ============================================================================
-- Reverses 028.
--
-- THE SEEDED GAMES ARE NOT REMOVED, and that is deliberate. By the time this
-- is run a school may have opened its sample, looked at it, and decided to
-- keep it -- or may have deleted it already. Reaching into six tenants and
-- deleting rows to undo a migration is a bigger action than the migration
-- was, and it is not reversible in the other direction.
--
-- To take the sample game back out of a tenant, delete it the ordinary way:
--
--   update public.games set deleted_at = now()
--    where designator = 'SAMPLE' and tenant_id = '<tenant uuid>';
--
-- which is the same soft delete the school's own Delete button performs, and
-- which 012's policy already hides from every surface at once.
-- ============================================================================

drop function if exists public.seed_sample_game_into_demos(text);
drop function if exists public.apply_sample_game(uuid, text);
drop function if exists public.capture_sample_game(uuid, text);

drop table if exists public.sample_game;

-- THE COLUMN STAYS, for the same reason the seeded games do. Dropping
-- is_sample would silently turn every sample already in a school's dashboard
-- back into an ordinary game -- re-marking "create your first game" as done
-- on their behalf, and losing the only record of which game was handed to
-- them rather than scored by them. It is one nullable boolean.
--
--   alter table public.games drop column if exists is_sample;
--
-- if you genuinely want it gone.
drop index if exists public.games_sample_idx;

delete from public.schema_migrations where version = 28;
