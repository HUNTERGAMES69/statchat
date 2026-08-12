-- ============================================================
-- Broadcast flag  —  which game vMix is showing
-- ============================================================
-- Run this in the Supabase SQL editor BEFORE uploading the pages that
-- use it. Read-then-write; nothing here touches play data.
--
-- WHY A DATABASE FUNCTION RATHER THAN AN UPDATE FROM THE PAGE:
-- exactly one game may be flagged. If two laptops set the flag at the
-- same moment, a page doing "clear all, then set mine" can interleave
-- and leave two games flagged, or none. Inside a function it is one
-- statement and cannot interleave.
-- ============================================================


-- 1. The column ------------------------------------------------------
alter table games add column if not exists is_broadcast boolean not null default false;

-- Who changed it and when. There is no audit trail anywhere else in the
-- app, and when the wrong game is on air at 19:30 the first question is
-- who changed it.
alter table games add column if not exists broadcast_set_by uuid;
alter table games add column if not exists broadcast_set_at timestamptz;

-- Enforced by the database, not by good intentions: a partial unique
-- index means a second flagged game is rejected outright.
create unique index if not exists one_broadcast_game
  on games ((is_broadcast)) where is_broadcast;


-- 2. Setting it ------------------------------------------------------
-- Clears every other game and sets this one, atomically.
create or replace function public.set_broadcast_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  caller_role := coalesce(
    (select role from profiles where id = auth.uid() limit 1), 'view');
  -- Admin AND game_entry, decided 12 Aug: the crew sets up the day
  -- before and Andy may not be there.
  if caller_role not in ('admin','game_entry') then
    raise exception 'Only an admin or game entry user can set the broadcast game.';
  end if;

  -- Clear first, set second, one statement each, same transaction. The
  -- unique index above would reject the second write otherwise.
  update games set is_broadcast = false
   where is_broadcast and id <> p_game_id;

  update games
     set is_broadcast = true,
         broadcast_set_by = auth.uid(),
         broadcast_set_at = now()
   where id = p_game_id;
end $$;

grant execute on function public.set_broadcast_game(uuid) to authenticated;


-- 3. Clearing it -----------------------------------------------------
-- Separate function so the page can require different confirmation for
-- taking a game OFF air than for putting one on.
create or replace function public.clear_broadcast_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  caller_role := coalesce(
    (select role from profiles where id = auth.uid() limit 1), 'view');
  if caller_role not in ('admin','game_entry') then
    raise exception 'Only an admin or game entry user can change the broadcast game.';
  end if;

  update games
     set is_broadcast = false,
         broadcast_set_by = auth.uid(),
         broadcast_set_at = now()
   where id = p_game_id;
end $$;

grant execute on function public.clear_broadcast_game(uuid) to authenticated;


-- 4. RLS -------------------------------------------------------------
-- The functions are SECURITY DEFINER and do their own role check, so no
-- policy change is needed. The existing games_update policy already
-- allows admin and game_entry, and a `view` account cannot call these
-- because the functions refuse them.


-- 5. Check -----------------------------------------------------------
-- NOTE: there is no `opponent` column. The teams are `home_team_name`
-- and `away_team_name`. A first version of this file selected `opponent`
-- and the whole script FAILED — the Supabase SQL editor runs the script
-- in one transaction, so an error on the last line rolled back the
-- columns, the functions and the index too. Nothing landed, and it
-- looked like a partial success.
select id, designator, home_team_name, away_team_name,
       is_broadcast, broadcast_set_at
  from games where is_broadcast;
-- Expect zero rows until a game is flagged, and never more than one.

-- And confirm the pieces exist:
select column_name from information_schema.columns
 where table_name = 'games' and column_name in
       ('is_broadcast','broadcast_set_by','broadcast_set_at');
select proname from pg_proc
 where proname in ('set_broadcast_game','clear_broadcast_game');
select indexname from pg_indexes where indexname = 'one_broadcast_game';
-- Expect: 3 columns, 2 functions, 1 index.


-- ============================================================
-- UNDO
-- ============================================================
-- drop function if exists public.set_broadcast_game(uuid);
-- drop function if exists public.clear_broadcast_game(uuid);
-- drop index if exists one_broadcast_game;
-- alter table games drop column if exists is_broadcast;
-- alter table games drop column if exists broadcast_set_by;
-- alter table games drop column if exists broadcast_set_at;
