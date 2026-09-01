-- 034_backfill_tenant_suspensions_DOWN.sql
-- ============================================================================
-- Lifts ONLY the bans 034 placed, identified by suspended_with_tenant_at.
--
-- An account banned for cause never received the stamp, so it is not matched
-- here and stays banned. That is the whole point of the stamp.
--
-- NOTE: this cannot distinguish a stamp written by 034 from one written by
-- set_tenant_deleted() in normal operation -- they are deliberately the same
-- mark, because they mean the same thing. Running this DOWN therefore also
-- restores access for tenants deleted through the console after 018. That is
-- correct if you are reverting the whole idea, and wrong if you only meant to
-- undo the backfill, so: restore the affected tenants instead if that is what
-- you want.
-- ============================================================================

begin;

update auth.users u
   set banned_until = null
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id
 where p.id = u.id
   and t.deleted_at is not null
   and p.suspended_with_tenant_at is not null;

update public.profiles p
   set suspended_with_tenant_at = null
  from public.tenants t
 where t.id = p.tenant_id
   and t.deleted_at is not null;

commit;
