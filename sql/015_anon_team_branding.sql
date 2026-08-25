-- =====================================================================
-- 015 — the anon branding policy stops guessing
--
-- `anon reads our branding` on `teams` reads:
--
--     using (is_our_team = true)
--
-- Written when one team existed, where it meant "the only team". Every
-- tenant's team now carries that flag, so it means "every team on the
-- platform" — and recap.html, which anonymous viewers open, then does
-- `.limit(1)` and takes whichever row Postgres feels like.
--
-- **A public recap can already be wearing the wrong school's colours.**
-- Not hypothetical: a second tenant exists in production as of 25 Aug.
--
-- The tenants table got this right in 009 — it scopes anon reads to
-- tenants that have at least one published game. `teams` was left on the
-- old flag, because at the time the flag still described reality.
--
-- SCOPED THE SAME WAY. A team is readable anonymously when its tenant has
-- a published game. Colours and a crest are not secrets — they are on the
-- school's website — but serving the WRONG one is a visible error on a
-- page a coach shares with local media.
-- =====================================================================

drop policy if exists "anon reads our branding" on public.teams;
create policy "anon reads team branding" on public.teams for select to anon
  using (exists (select 1 from public.games g
                  where g.tenant_id = teams.tenant_id
                    and g.status = 'final'
                    and g.is_public = true
                    and g.deleted_at is null));

comment on policy "anon reads team branding" on public.teams is
  'Scoped to tenants with a published game. Replaced "anon reads our branding", which used is_our_team = true - true for EVERY tenant once there was more than one, so a public recap could pick another school''s colours.';

insert into public.schema_migrations (version, name)
values (15, '015_anon_team_branding') on conflict (version) do nothing;
