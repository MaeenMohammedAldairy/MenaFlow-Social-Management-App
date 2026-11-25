-- `social_accounts_completed` was only ever written as true and never reset, so
-- it kept answering "done" after the merchant disconnected their last account.
-- The onboarding status derives the flag from the live connection rows now
-- (artifacts/api-server/src/lib/onboarding-status.ts); nothing reads the column.
ALTER TABLE public.mena_workspace_onboarding
  DROP COLUMN social_accounts_completed;
