-- DOWN for 015_anon_team_branding.sql
-- Restores the original policy VERBATIM. Note what that means with more
-- than one tenant: anonymous readers can see every tenant's team row, and
-- a public recap may show the wrong school's colours. Only useful if 015
-- itself breaks public recaps.
drop policy if exists "anon reads team branding" on public.teams;
create policy "anon reads our branding" on public.teams for select to anon
  using (is_our_team = true);
delete from public.schema_migrations where version = 15;
