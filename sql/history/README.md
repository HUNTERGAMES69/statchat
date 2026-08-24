# Database changes — the rule

**Every change to the Supabase schema is committed here before the session
ends. No exceptions, including "it was only one column".**

This is not bookkeeping. `sql/000_baseline.sql` is the only copy of the schema
that exists outside a hosted dashboard. It is what a second instance is
built from, what a restore is checked against, and the only version of
the database anybody can actually read.

A schema that lives in one place, and that place is somebody else's web
app, is a backup with extra steps.

---

## What goes in this folder

    000_baseline.sql  the whole schema as of 23 Aug 2026. The state.
    NNN_name.sql      one migration per change, numbered, never edited
    capture/          seven read-only queries that dump the live schema
    history/          scripts that ran BEFORE the baseline was captured

**`schema.sql` was never created.** The rule above described it for weeks
and the file did not exist — the first `CREATE TABLE` statement in this
repo is `000_baseline.sql`, written 23 Aug 2026. The baseline now does
the job `schema.sql` was meant to: it is the state, the migrations are
the history. Neither is derivable from the other in practice — a
baseline cannot tell you why a column exists, and a stack of migrations
takes an hour to read.

The baseline is REGENERATED, not hand-edited, and only when there is a
reason to re-baseline. Day to day it stays still and migrations
accumulate on top.

### Numbers are never reused and never reordered

Even when a file moves. `001` is `public_recap_sharing`; `002` is
`schema_migrations`; the next is `003` whatever happens to the others. A
number identifies a change that ran somewhere, and reusing it makes two
instances disagree while both claiming to be version 2.

`history/` holds scripts with NO number: they ran before the baseline was
captured, so their effects are already inside `000`. Numbering them would
make an instance built from the baseline look like it were missing two
migrations it already has.

## Capturing the live schema without pg_dump

`pg_dump` needs a direct database connection. `capture/A..G` need only
the SQL editor, are read-only, and between them cover everything a dump
would — see `capture/README.md`. That is also the verification
mechanism: the same queries run against a scratch database rebuilt from
these files should give the same answers, which replaces the
`git diff` step below for anyone without a connection.

---

## The procedure, every time

1. **Write the migration first**, as `sql/NNN_what_it_does.sql`. Next
   number in sequence. Checks before changes, as
   `public_recap_sharing.sql` does — a file that begins by telling you
   what is true now is one you can run without holding your breath.

2. **Run it** in the Supabase SQL editor.

3. **Re-dump immediately**, while you still remember what you changed:

       pg_dump "postgres://postgres:[PASSWORD]@db.pboushzlcyfkssojpuut.supabase.co:5432/postgres" \
         --schema-only --schema=public --no-owner --no-privileges \
         -f sql/schema_dump.sql

   If you do not have a direct connection — Supabase has been moving
   5432 behind the pooler — run `capture/A..G` in the SQL editor
   instead. That is how the baseline was made.

4. **Diff the dump.** `git diff` on the dump should show exactly what
   the migration said it would and nothing else. This is the step that
   earns the whole procedure: it catches the column you added by hand in
   the table editor three weeks ago and forgot, and it catches a
   migration that did more than it claimed.

5. **Commit the migration and the dump together.** One without the other
   is worse than neither, because it looks done.

---

## A migration is never edited after it has run

If it was wrong, write another one. An edited migration is a file that
says one thing and did another, and every instance that already ran the
old version is now silently different.

This matters more with each instance. With one deployment you can fix it
by hand and remember. With three you cannot.

---

## schema_migrations — BUILT 23 August 2026

`002_schema_migrations.sql`. An instance can now be ASKED what it is
missing rather than somebody having to remember.

**The last statement of every migration from here on is its own insert
into that table.** Not the first — a migration that records itself before
doing the work leaves a lie behind when it fails halfway.

The table is deliberately locked down, unlike every other table here: no
grants to `anon` or `authenticated`, RLS on with no policies at all. The
Supabase default of granting everything and letting RLS decide is the
wrong default for a table whose only job is to be trustworthy, and
nothing in the application reads it.

---

## Changes that do not touch the schema

RLS policy edits, grants, role changes and index changes ALL count as
schema changes. They are in the dump, they differ between instances, and
they are exactly the kind of thing that gets clicked in a dashboard and
forgotten.

The 15 Aug 2026 sharing work is the worked example: a column, an index,
five policies and a column grant, all of which had to be reproducible.
