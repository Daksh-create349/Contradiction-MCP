# Contradiction MCP: Database & Schema Documentation

## 1. Engine & Configuration

The persistence layer uses `better-sqlite3` embedded SQLite with:

- `PRAGMA journal_mode = WAL;` for concurrent read performance.
- `PRAGMA foreign_keys = ON;` for strict referential integrity.
- `PRAGMA synchronous = NORMAL;` for high throughput write operations.
- Online non-blocking live backups via `db.backup()`.

---

## 2. Relational Schema & Migrations

The database manages schema state through incremental SQL migration scripts located in `src/storage/migrations/`:

### Migration 001: Initial Schema (`001_initial.sql`)

- `sources`:
  - `id TEXT PRIMARY KEY`: UUID v4.
  - `type TEXT NOT NULL`: Connector type.
  - `name TEXT NOT NULL`: Display name.
  - `uri TEXT`: Source locator.
  - `trust_score REAL`: Base trust weight (0.0 - 1.0).
  - `metadata TEXT`: JSON blob.
- `claims`:
  - `id TEXT PRIMARY KEY`: UUID v4.
  - `source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE`.
  - `subject TEXT NOT NULL`: Normalized entity identifier.
  - `predicate TEXT NOT NULL`: Property name.
  - `value TEXT NOT NULL`: Raw extracted string.
  - `normalized_value TEXT`: Normalized canonical representation.
  - `confidence REAL`: Extraction confidence.
  - `observed_at TEXT`: Extracted timestamp.
  - `valid_from TEXT`, `valid_until TEXT`: Temporal window.
  - `external_id TEXT`: External system ID.
  - `metadata TEXT`: JSON blob.
- `contradictions`:
  - `id TEXT PRIMARY KEY`: UUID v4.
  - `claim_a_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE`.
  - `claim_b_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE`.
  - `contradiction_type TEXT NOT NULL`.
  - `severity TEXT NOT NULL`: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`.
  - `status TEXT NOT NULL`: `OPEN`, `REVIEWED`, `RESOLVED`, `DISMISSED`.
  - `confidence REAL NOT NULL`.
  - `explanation TEXT NOT NULL`.
  - `detected_at TEXT NOT NULL`.
  - `resolved_at TEXT`.

### Migration 005: Claim History (`005_claim_history.sql`)

- `claim_history`:
  - Append-only audit table recording prior claim states whenever an external sync modifies a claim value.
  - Tracks `first_seen_at`, `last_seen_at`, `superseded_at`, and `superseded_by`.

### Migration 006: Contradiction Resolution (`006_contradiction_resolution.sql`)

- `contradiction_history`:
  - Immutable audit trail recording state transitions: `REVIEWED`, `RESOLVED`, `DISMISSED`, `REOPENED`.
  - Captures `performed_by`, `performed_at`, `reason`, `chosen_claim_id`, and `notes`.
- Adds `resolution_reason`, `resolved_by`, `chosen_claim_id`, and `audit_notes` to `contradictions`.
