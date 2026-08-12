# RLS hardening — step by step

**Read this one. `rls_hardening.sql` is the reference; this is the
walkthrough.**

Written for someone who has not used the Supabase SQL editor before.
Roughly 45 minutes, most of it checking rather than typing.

**You cannot permanently break this.** The SQL editor ignores the rules
you are about to create, so you can always get back in and undo them.
There is a section at the end that puts everything back exactly as it is
now.

---

## PART A — Set up before you touch anything  (10 min)

### A1. Open three browser windows

You need to be signed in as three different people at once, because you
cannot test a rule without someone to test it on.

| Window | Who | How |
|---|---|---|
| 1 | **You** (admin) | Your normal browser, signed in as usual |
| 2 | A **view** account | Ctrl-Shift-N (Chrome) → private window → sign in |
| 3 | A **game_entry** account | A *different browser* — Edge or Firefox |

Two private windows in the same browser **share a login**, which is why
window 3 needs a different browser.

If you do not know which of your six accounts are `view` and
`game_entry`: open **account.html** in window 1. Each user's role is on
the badge beside their name.

Leave all three open and signed in. You will come back to them.

### A2. Open the Supabase SQL editor

1. Go to **supabase.com** and sign in
2. Click your **statchat** project
3. In the left sidebar, click **SQL Editor** (icon looks like a database)
4. Click **+ New query**

You now have a big empty text box with a **Run** button (bottom right,
or press Ctrl-Enter).

### A3. The one mechanic that matters

**If you highlight some text and press Run, it runs ONLY the highlighted
text. If you highlight nothing, it runs EVERYTHING in the box.**

That is how you will do one step at a time. Paste the whole file in, then
highlight just the step you want and run that.

Get this wrong and you run all six steps at once, which is exactly what
we are trying to avoid.

### A4. Open a second tab for the undo

1. Click **+ New query** again — you now have two query tabs
2. In the new one, paste this and **do not run it**:

```sql
drop policy if exists "profiles_select" on profiles;
drop policy if exists "profiles_update" on profiles;
drop policy if exists "profiles_update_self" on profiles;
drop policy if exists "profiles_update_admin" on profiles;
create policy "profiles_open" on profiles for all
  to authenticated using (true) with check (true);
```

This is the emergency undo for the most dangerous step. Leaving it ready
means that if something goes wrong you highlight it and press Run,
rather than scrambling to find it.

### A5. Load the main file

Go back to the first query tab. Open `sql/rls_hardening.sql` from the
repo, copy **the whole thing**, and paste it in.

Nothing runs until you highlight and press Run.

---

## PART B — The steps  (25 min)

For each one: **highlight only that step's SQL, press Run, then do the
check.** Do not move on until the check passes.

### STEP 0 — Look at what you have

Highlight the two `select` statements under `STEP 0` and Run.

You get two result tables below.

**Copy both into a text file and save it.** This is your record of what
things looked like before. You will probably never need it, and it costs
ten seconds.

> **Check:** the first table shows your six accounts. Exactly two should
> say `admin` — you and the second one you just made.

**If that is not what you see, stop and tell me.**

### STEP 1 — The role helper

Highlight from `create or replace function` down to and including the
line `$$;`, plus the `grant execute` line. Run.

You should see **Success. No rows returned**.

Now highlight just this line and Run it:

```sql
select public.current_user_role() as my_role, auth.uid() as my_id;
```

> **Check:** `my_role` says `admin`.

**If it says `view` or is empty, STOP.** It means the SQL editor is not
running as your user account, and the rest will not behave as expected.
Tell me before going on.

### STEP 2 — Plays  (the important one)

Highlight everything under `STEP 2` — the four `drop policy` lines and
the four `create policy` blocks. Run.

Success, no rows returned.

Now **go to your browser windows** and test. This is the real check; the
SQL editor cannot tell you whether the app works.

**Window 2 — the `view` account:**
- Open a test game, try to enter a rush
- **It must FAIL.** An error, or the play does not appear.
- That failing is the whole point — that account could delete your game
  data an hour ago.

**Window 3 — the `game_entry` account:**
- Enter a rush. **It must work.**
- Press **Undo last**. **It must work.**
- Undo is a delete. If Undo fails here, stop and tell me — a scorer
  cannot run a game without it.

**Window 1 — you:**
- Enter a rush, undo it. Both work.

Back in the SQL editor, highlight and run:

```sql
select count(*) from profiles;
```

> **Check:** returns 6.

That proves the SQL editor still sees everything even with rules
tightening — which is your way back in if anything goes wrong later.

### STEP 3 — Games

Highlight everything under `STEP 3`. Run.

**Window 1 (you):** create a test game from the dashboard, then delete
it. Both work.

**Window 2 (`view`):** the New Game button must fail or be absent.

**Window 3 (`game_entry`):** open an existing game and press
**Start game**. It must work — starting and ending a game is an update,
not a create.

### STEP 4 — Rosters, teams, players

Highlight the whole `do $$ ... end $$;` block under `STEP 4`. Run.

**Window 1:** open Team Roster, change something, save. Works.

**Window 2 (`view`):** try to save a roster change. Must fail.

### STEP 5 — Profiles  (slowest, most dangerous)

**Before running this**, glance at your second SQL tab and confirm the
emergency undo from A4 is still sitting there.

Highlight everything under `STEP 5` — the four `drop policy` lines and
the three `create policy` blocks. Run.

**Now check immediately, in this order:**

1. In the SQL editor: `select public.current_user_role();` → `admin`
2. **Window 1:** reload the dashboard. Admin controls still there?
3. **Window 1:** open the account page. Can you still see all six users?
4. **Window 1:** change your own display name and save. Does it stick?
5. **Window 1:** change another user's role. Does that work?
6. **Window 2 (`view`):** open the account page. It should NOT offer
   user management.

**If any of 1 to 5 fails:** switch to your second SQL tab, highlight the
emergency undo, press Run. You are back to a working state within
seconds. Then tell me what failed.

### STEP 6 — Confirm

Highlight the `select` under `STEP 6` and Run.

> **Check:** read the `kind` column. Every row says `role-aware` or
> `read-open`. Nothing says `CHECK THIS`.

---

## PART C — Afterwards  (10 min)

### C1. A proper run-through

As **yourself**, on a test game:

1. Enter a rush, a pass, a punt
2. Undo the punt
3. Open **view.html** — numbers match?
4. End the game, open **recap.html** — box score correct?

### C2. Tell me the results

Specifically:
- Did every check pass?
- Anything unexpected, even if it seemed minor?

### C3. What the automated tests will NOT tell you

The 18 suites use a fake database, so **they pass no matter what you did
to RLS.** They are not a check on this work. Part C1 is.

---

## IF IT ALL GOES WRONG

Open the SQL editor, paste this in, run it. It puts everything back to
"any signed-in user can do anything" — not secure, but exactly what you
have today, and the app will work.

```sql
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
            where schemaname='public'
              and tablename in ('plays','games','game_rosters',
                                'teams','players','profiles') loop
    execute format('drop policy if exists %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "plays_open"        on plays        for all to authenticated using (true) with check (true);
create policy "games_open"        on games        for all to authenticated using (true) with check (true);
create policy "game_rosters_open" on game_rosters for all to authenticated using (true) with check (true);
create policy "teams_open"        on teams        for all to authenticated using (true) with check (true);
create policy "players_open"      on players      for all to authenticated using (true) with check (true);
create policy "profiles_open"     on profiles     for all to authenticated using (true) with check (true);
```

Then tell me what happened and we will work out why before trying again.

**Nothing you do in the SQL editor can lose game data.** Policies control
who may read and write; they do not delete anything.
