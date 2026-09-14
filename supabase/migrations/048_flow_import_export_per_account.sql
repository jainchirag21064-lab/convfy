-- ============================================================
-- 048_flow_import_export_per_account.sql
--
-- Per-account toggle for the Flows import/export feature.
--
-- Default: DISABLED for every account. A platform admin enables it
-- per customer/owner account from /platform/accounts (mirrors the
-- per-account member-limit override added in 046). The Import/Export
-- buttons in the flow editor are shown to that account's users only
-- when accounts.flow_import_export_enabled is true.
--
-- The customer-facing read is scoped automatically: the flows editor
-- calls GET /api/flows/import-export, which resolves the caller's own
-- account via the RLS-scoped SSR client and reads this column. No
-- SECURITY DEFINER helper is needed — accounts_select already limits
-- a user to rows they belong to, so a user can only ever see their own
-- account's flag.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS flow_import_export_enabled boolean NOT NULL DEFAULT false;

-- Self-backfill for any accounts table that somehow predates the
-- column default (defensive; DEFAULT false on a fresh ALTER already
-- covers inserted rows, but existing rows with a NULL that slipped in
-- before the NOT NULL DEFAULT took effect get normalised here).
UPDATE accounts
   SET flow_import_export_enabled = false
 WHERE flow_import_export_enabled IS NULL;