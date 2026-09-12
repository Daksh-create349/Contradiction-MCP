-- Migration 002: Enforce unique contradiction per claim pair regardless of order (A-B == B-A)

CREATE UNIQUE INDEX IF NOT EXISTS idx_contradictions_pair_unique ON contradictions (
    CASE WHEN claim_a_id < claim_b_id THEN claim_a_id ELSE claim_b_id END,
    CASE WHEN claim_a_id < claim_b_id THEN claim_b_id ELSE claim_a_id END
);

CREATE INDEX IF NOT EXISTS idx_contradictions_confidence ON contradictions(confidence);
