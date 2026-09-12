-- Migration 006: Add contradiction resolution lifecycle and audit history
PRAGMA foreign_keys = ON;

ALTER TABLE contradictions ADD COLUMN resolution_reason TEXT;
ALTER TABLE contradictions ADD COLUMN resolved_by TEXT;
ALTER TABLE contradictions ADD COLUMN resolution_source TEXT;
ALTER TABLE contradictions ADD COLUMN chosen_claim_id TEXT;
ALTER TABLE contradictions ADD COLUMN audit_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_contradictions_chosen_claim ON contradictions(chosen_claim_id);

CREATE TABLE IF NOT EXISTS contradiction_history (
    id TEXT PRIMARY KEY,
    contradiction_id TEXT NOT NULL,
    action TEXT NOT NULL,
    previous_status TEXT NOT NULL,
    new_status TEXT NOT NULL,
    performed_by TEXT NOT NULL,
    performed_at TEXT NOT NULL,
    reason TEXT,
    chosen_claim_id TEXT,
    notes TEXT,
    FOREIGN KEY (contradiction_id) REFERENCES contradictions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contradiction_history_contradiction_id ON contradiction_history(contradiction_id);
CREATE INDEX IF NOT EXISTS idx_contradiction_history_performed_at ON contradiction_history(performed_at);
