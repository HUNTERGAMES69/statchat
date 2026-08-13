# Two-factor authentication — setup and recovery

**Decided 12 August 2026: MFA at SIGN-IN, not step-up.**

Andy's call, and the right one for this app: *"once I'm in, I'm in."*
He is never without his phone at a game, and a step-up prompt appearing
at unpredictable moments is harder to live with than one predictable
challenge at the start.

## There is no SQL to run

This is worth stating plainly, because an earlier draft of this feature
had a whole migration.

MFA at sign-in is entirely Supabase's own mechanism. Enrol a factor, and
Supabase challenges for it at login. The session that comes back is
already fully authenticated, so nothing in the database needs to check an
auth level — **being signed in means the code was entered.**

The step-up design needed all of that machinery: a `has_mfa()` helper, a
policy on `games` DELETE, and a `reset_game()` function invented purely
because Reset and Undo are the same database operation and RLS could not
tell them apart. **None of it is needed now.** Simpler feature, less
code, fewer things to go wrong.

## Enrolling

1. Account page → **Two-factor authentication** → *Set up*
2. Scan the QR with any authenticator app
3. Enter the six-digit code, confirm
4. **Sign out and sign back in.** Do this immediately, at a desk. If
   something is wrong you want to find out on a Tuesday, not at a stadium.
5. **Repeat for the second admin account.** That account is the recovery
   path; if it is not enrolled it is not usable as one.

## What changes

| | |
|---|---|
| Signing in | password **and** a six-digit code |
| Entering plays | unchanged |
| Undo, correction mode | unchanged |
| Starting / ending a game | unchanged |
| Setting a game ON AIR | unchanged |
| Deleting or resetting a game | unchanged |

Only the front door.

## What it does NOT protect against

**Your own mistakes.** MFA stops someone using a stolen password. It does
nothing about deleting the wrong game yourself — that is what the
confirmation dialogs are for, and they are unchanged.

## If the phone is lost

The escape hatch. The Supabase SQL editor never asks for a code, so you
cannot be locked out permanently.

```sql
-- Find the account
select p.display_name, p.role, f.id as factor_id, f.status
  from profiles p
  join auth.mfa_factors f on f.user_id = p.id;

-- Clear the factor, then re-enrol from the account page
delete from auth.mfa_factors where user_id = '<the-uuid>';
```

Keep this file where you can reach it without the app.

## Checking who is enrolled

```sql
select p.display_name, p.role,
       case when f.id is null then 'no'
            when f.status = 'verified' then 'yes'
            else 'part-way (' || f.status || ')' end as two_factor
  from profiles p
  left join auth.mfa_factors f on f.user_id = p.id
 order by p.role, p.display_name;
```

Run this after enrolling both admins, to confirm.
