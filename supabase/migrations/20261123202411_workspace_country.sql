-- Existing workspaces can leave the business country unset.
ALTER TABLE mena_workspaces ADD COLUMN country text;
ALTER TABLE mena_workspaces ADD CONSTRAINT mena_workspaces_country_format
  CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');
