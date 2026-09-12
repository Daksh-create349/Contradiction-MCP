-- Migration 004: Add contextual and temporal dimensions to claims table for false-positive reduction

ALTER TABLE claims ADD COLUMN environment TEXT DEFAULT 'unknown';
ALTER TABLE claims ADD COLUMN scope TEXT DEFAULT 'unknown';
ALTER TABLE claims ADD COLUMN source_role TEXT DEFAULT 'unknown';
ALTER TABLE claims ADD COLUMN is_historical INTEGER NOT NULL DEFAULT 0;
ALTER TABLE claims ADD COLUMN valid_from TEXT;
ALTER TABLE claims ADD COLUMN valid_until TEXT;
ALTER TABLE claims ADD COLUMN value_constraint TEXT;
ALTER TABLE claims ADD COLUMN multi_value_context TEXT;

CREATE INDEX IF NOT EXISTS idx_claims_environment ON claims(environment);
CREATE INDEX IF NOT EXISTS idx_claims_scope ON claims(scope);
CREATE INDEX IF NOT EXISTS idx_claims_source_role ON claims(source_role);
CREATE INDEX IF NOT EXISTS idx_claims_is_historical ON claims(is_historical);
