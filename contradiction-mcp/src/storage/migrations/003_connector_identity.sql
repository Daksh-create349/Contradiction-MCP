-- Migration 003: Add external_id to sources and claims for stable connector identity and deduplication

ALTER TABLE sources ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_external_id ON sources(external_id);

ALTER TABLE claims ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_external_id ON claims(external_id);
