# Capturing the live schema from the Supabase SQL editor

`pg_dump` needs a direct database connection. These six queries need only
the SQL editor, and between them they capture everything `sql/schema.sql`
would have held.

## How to run them

Run each file as its own query in the Supabase SQL editor. Each returns a
SINGLE cell of pretty-printed JSON. Click the cell, copy the whole value,
and paste it back labelled with the file letter.

    A_tables_columns.sql          tables, views, columns, types, defaults,
                                  identity/generated, RLS flags, comments
    B_constraints_indexes.sql     primary/foreign/unique/check constraints,
                                  every index including partial ones
    C_policies_grants.sql         RLS policies with USING and WITH CHECK,
                                  table grants, and COLUMN grants
    D_functions_triggers_types.sql  full function bodies, security definer
                                  and search_path, triggers, enums, sequences
    E_extensions_schemas.sql      extensions, schemas, roles
    F_storage.sql                 the team-logos bucket and storage policies
    G_event_and_auth_triggers.sql event triggers, and triggers on auth.users

Order does not matter and none of them writes anything.

### G was added after D came back

D captured `rls_auto_enable()` and `create_profile_for_new_user()` but
neither of the things that FIRE them, because both live outside the public
schema: an event trigger is a database-wide object in `pg_event_trigger`,
and the signup trigger hangs off `auth.users`. A baseline built from A-F
alone would have created both functions and called neither -- new tables
would not get RLS turned on, and a new user would get no profile row and
therefore no role.

The gap was found by reading D's output rather than by any check, which is
the argument for reading a capture rather than pasting it straight into a
generator.

## Why six queries and not one

One query returning everything is easy to truncate on paste and gives no
way to tell a short answer from a complete one. Six named results are
checkable: if D is missing, that is visible.

## What this is FOR

Two things, and the second is the one that matters.

1. **A baseline.** `000_baseline.sql` is written from these captures, and
   it is the first time the shape of StatChat's data exists outside the
   Supabase dashboard. There is currently not one `CREATE TABLE` statement
   anywhere in the repo.

2. **A diff instrument.** The output is deterministic JSON, so the same
   six queries run against a scratch database rebuilt from the migrations
   should produce a byte-identical document. That is what proves the
   baseline is right, and it replaces the `git diff sql/schema.sql` step in
   `sql/README.md` for anyone without a direct connection.

Verified 23 Aug against a scratch Postgres 16 built to mirror StatChat's
shape. Six mutations were applied one at a time and the capture caught
every one: a dropped policy, a revoked COLUMN grant, a changed column
default, a dropped PARTIAL index, RLS switched off, and a column added by
hand. Each was reverted and the capture returned to baseline. A diff that
has not been shown to catch anything is not a check.

The partial index case is worth naming: `one_broadcast_game` is the unique
index behind hazard 1 in `MULTI_TENANT_PLAN.md`. It is exactly the sort of
object a hand-written baseline forgets, and it is caught here.
