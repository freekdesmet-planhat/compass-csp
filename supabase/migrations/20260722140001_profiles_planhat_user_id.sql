-- ============================================================================
-- Compass — add a stable Planhat linkage to profiles.
-- ----------------------------------------------------------------------------
-- profiles are 1:1 with auth.users and cannot be inserted from Planhat, so the
-- sync-planhat users pass MATCHES an existing profile by email, then stamps its
-- Planhat user _id here. On later runs the link survives an email change (match
-- by planhat_user_id first, email second).
--
-- Nullable (existing profiles have no Planhat link); partial unique index allows
-- many NULLs while keeping the stamped ids unique — mirrors the (source,source_id)
-- convention elsewhere.
-- ============================================================================
alter table public.profiles add column if not exists planhat_user_id text;

create unique index if not exists profiles_planhat_user_id_uidx
  on public.profiles (planhat_user_id)
  where planhat_user_id is not null;
