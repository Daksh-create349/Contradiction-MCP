-- Enable foreign keys enforcement
PRAGMA foreign_keys = ON;

-- 1. Sources table
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    uri TEXT,
    last_fetched_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    trust_score REAL NOT NULL DEFAULT 1.0 CHECK (trust_score >= 0.0 AND trust_score <= 1.0),
    metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sources_type ON sources(type);
CREATE INDEX IF NOT EXISTS idx_sources_created_at ON sources(created_at);

-- 2. Claims table
CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    value TEXT NOT NULL,
    value_type TEXT NOT NULL,
    normalized_value TEXT,
    confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    observed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_claims_source_id ON claims(source_id);
CREATE INDEX IF NOT EXISTS idx_claims_subject_predicate ON claims(subject, predicate);
CREATE INDEX IF NOT EXISTS idx_claims_value_type ON claims(value_type);
CREATE INDEX IF NOT EXISTS idx_claims_created_at ON claims(created_at);

-- 3. Contradictions table
CREATE TABLE IF NOT EXISTS contradictions (
    id TEXT PRIMARY KEY,
    claim_a_id TEXT NOT NULL,
    claim_b_id TEXT NOT NULL,
    contradiction_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    explanation TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    detected_at TEXT NOT NULL,
    resolved_at TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    CHECK (claim_a_id != claim_b_id),
    FOREIGN KEY (claim_a_id) REFERENCES claims(id) ON DELETE CASCADE,
    FOREIGN KEY (claim_b_id) REFERENCES claims(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contradictions_claims ON contradictions(claim_a_id, claim_b_id);
CREATE INDEX IF NOT EXISTS idx_contradictions_type ON contradictions(contradiction_type);
CREATE INDEX IF NOT EXISTS idx_contradictions_severity ON contradictions(severity);
CREATE INDEX IF NOT EXISTS idx_contradictions_status ON contradictions(status);
CREATE INDEX IF NOT EXISTS idx_contradictions_detected_at ON contradictions(detected_at);
