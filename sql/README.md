# Database changes — the rule

**Every change to the Supabase schema is committed here before the session
ends. No exceptions, including "it was only one column".**

This is not bookkeeping. `sql/schema.sql` is the only copy of the schema
that exists outside a hosted dashboard. It is what a second instance is
built from, what a restore is checked against, and the only version of
the database anybody can actually read.

A schema that lives in one place, and that place is somebody else's web
app, is a backup with extra steps.

---

## What goes in this folder

    schema.sql        the whole schema, dumped. The current truth.
    seed.sql          the minimum that makes an empty instance usable
    NNN_name.sql      one migration per change, numbered, never edited

`schema.sql` is REGENERATED, not hand-edited. The migrations are the
history; the dump is the state. Neither is derivable from the other in
practice — a dump cannot tell you why a column exists, and a stack of
migrations takes an hour to read.

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
         -f sql/schema.sql

4. **Diff the dump.** `git diff sql/schema.sql` should show exactly what
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

## When there is more than one instance

Add a `schema_migrations` table recording which files have been applied,
and have each migration insert its own number. Then an instance can be
ASKED what it is missing rather than somebody having to remember.

Not needed for one deployment. Needed by the third — see the clonable
deployment item in TODO.md. Written down here now because the cost of
adopting it later is proportional to how many unnumbered changes came
first.

---

## Changes that do not touch the schema

RLS policy edits, grants, role changes and index changes ALL count as
schema changes. They are in the dump, they differ between instances, and
they are exactly the kind of thing that gets clicked in a dashboard and
forgotten.

The 15 Aug 2026 sharing work is the worked example: a column, an index,
five policies and a column grant, all of which had to be reproducible.
