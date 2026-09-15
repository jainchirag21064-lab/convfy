-- ============================================================
-- 049_catalogs.sql
--
-- WhatsApp product catalog sync. Stores the catalog connected to
-- the account's WABA and every product within it, synced from
-- Meta's Commerce Manager via the Graph API.
--
-- READ:  all account members (view the product grid)
-- WRITE: admin+ only (trigger sync from the Catalogs page)
-- ============================================================

-- One catalog row per account (a WABA has exactly one connected catalog).
CREATE TABLE IF NOT EXISTS catalogs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  meta_catalog_id TEXT NOT NULL,
  name TEXT,
  last_synced_at TIMESTAMPTZ,
  synced_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, meta_catalog_id)
);

CREATE INDEX IF NOT EXISTS idx_catalogs_account ON catalogs(account_id);

-- Products within a catalog.
CREATE TABLE IF NOT EXISTS catalog_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  catalog_id UUID NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
  meta_product_id TEXT NOT NULL,
  retailer_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  price TEXT,
  currency TEXT,
  url TEXT,
  availability TEXT,
  status TEXT,
  image_url TEXT,
  images JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, meta_product_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_items_account ON catalog_items(account_id);
CREATE INDEX IF NOT EXISTS idx_catalog_items_catalog ON catalog_items(catalog_id);

-- RLS: same shape as message_templates (migration 017).
ALTER TABLE catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalogs_select ON catalogs
  FOR SELECT USING (is_account_member(account_id));

CREATE POLICY catalogs_insert ON catalogs
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY catalogs_update ON catalogs
  FOR UPDATE USING (is_account_member(account_id, 'admin'));

CREATE POLICY catalogs_delete ON catalogs
  FOR DELETE USING (is_account_member(account_id, 'admin'));

CREATE POLICY catalog_items_select ON catalog_items
  FOR SELECT USING (is_account_member(account_id));

CREATE POLICY catalog_items_insert ON catalog_items
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY catalog_items_update ON catalog_items
  FOR UPDATE USING (is_account_member(account_id, 'admin'));

CREATE POLICY catalog_items_delete ON catalog_items
  FOR DELETE USING (is_account_member(account_id, 'admin'));
