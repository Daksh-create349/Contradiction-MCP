-- Migration 005: Add claim history and lifecycle tracking
PRAGMA foreign_keys = ON;

ALTER TABLE claims ADD COLUMN first_seen_at TEXT;
ALTER TABLE claims ADD COLUMN last_seen_at TEXT;
ALTER TABLE claims ADD COLUMN superseded_by TEXT;

CREATE TABLE IF NOT EXISTS claim_history (
    id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    value TEXT NOT NULL,
    normalized_value TEXT,
    observed_at TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    superseded_at TEXT,
    superseded_by TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_claim_history_claim_id ON claim_history(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_history_source_id ON claim_history(source_id);
CREATE INDEX IF NOT EXISTS idx_claim_history_superseded_at ON claim_history(superseded_at);
