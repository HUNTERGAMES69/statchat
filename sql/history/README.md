# Pre-baseline scripts — history, not migrations

These ran against the live database BEFORE `sql/000_baseline.sql` was
captured on 23 August 2026. Everything they did is already inside the
baseline.

    rls_hardening.sql          applied 12 Aug 2026
    broadcast_flag.sql         applied Aug 2026
    001_public_recap_sharing.sql  applied 15 Aug 2026

**They carry no version number in `schema_migrations`** (except 001,
which had one before the baseline existed and keeps it — numbers are
never reused or reordered). An instance built from `000_baseline.sql`
has their effects without having run them, so recording them as pending
would be false.

They are kept because a dump cannot tell you WHY a column exists.
`broadcast_flag.sql` explains why the flag is set by a database function
rather than by an UPDATE from the page — two laptops doing "clear all,
then set mine" can interleave and leave two games flagged or none.
`rls_hardening.sql` records a draft that would have silently done
nothing because its DROP statements named policies that did not exist,
leaving strict policies sitting alongside permissive ones which Postgres
ORs together. That lesson is worth more than the SQL.

## One correction, 23 Aug 2026

The commented-out `*_open` policies at the foot of `rls_hardening.sql`
(lines 214-218) are a ROLLBACK block, not a second generation of live
policy. They were briefly misread as evidence that two overlapping sets
of policy existed on the same tables. The capture settled it: only the
granular per-command policies exist. Nothing needed reconciling.

Do not run anything in this folder. It is here to be read.
