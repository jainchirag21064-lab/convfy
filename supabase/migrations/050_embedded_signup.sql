-- ============================================================
-- whatsapp_config: Meta Embedded Signup v4 state
--
-- Why this exists:
--   Customers no longer have to hand-enter credentials. With Meta
--   Embedded Signup they authenticate in a Meta popup, pick an
--   existing WhatsApp Business phone number, and CONVfy completes the
--   connection server-side via a Business Integration System User
--   (BISU) token.
--
--   Three new nullable columns, all backward compatible:
--
--     1. business_portfolio_id  — the Meta Business / partner
--        portfolio id the end customer granted access to
--        (postMessage `business_id`). Identifies WHICH business's
--        WhatsApp assets the BISU token may touch — useful for
--        diagnostics and for reconciling the webhook callback_uri.
--
--     2. onboarded_via          — 'manual' (default; POST
--        /api/whatsapp/config with hand-entered credentials) or
--        'embedded_signup' (the Embedded Signup flow). The UI uses
--        this to render the right connected state / remediation
--        copy. NOT NULL with a default so legacy rows simply read
--        'manual'.
--
--     3. token_expires_at       — the BISU token from Embedded Signup
--        is a "60 Expiration Token" (permanent unless/until
--        regenerated or deleted), but we still record the issued
--        timestamp for contexts where Meta rotates it: the diagnostic
--        probe can compare this against the token's data_expires_at
--        and warn when Meta reports the stored token is near expiry.
--
--   Existing manual rows are untouched (all columns nullable /
--   defaulted).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS business_portfolio_id TEXT,
  ADD COLUMN IF NOT EXISTS onboarded_via TEXT NOT NULL DEFAULT 'manual'
    CHECK (onboarded_via IN ('manual', 'embedded_signup')),
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN whatsapp_config.business_portfolio_id IS
  'Meta Business/portfolio id granted during Embedded Signup (postMessage business_id). NULL for manual setups.';
COMMENT ON COLUMN whatsapp_config.onboarded_via IS
  'How the config was connected: manual (hand-entered credentials) or embedded_signup (Meta Embedded Signup v4).';
COMMENT ON COLUMN whatsapp_config.token_expires_at IS
  'Issued expiry of the stored access token. BISU tokens are ~permanent but Meta may rotate them; diagnostics compare against debug_token data_expires_at.';