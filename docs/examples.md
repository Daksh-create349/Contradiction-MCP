# Contradiction MCP: Practical Usage Examples

## 1. Syncing Documents & Discovering Drift

### Scenario: Outdated Documentation

A developer updates `deploy.json` to Node 22, but `README.md` still instructs developers to install Node 18.

### Step 1: Ingest Deploy Manifest

```json
// Call tool: sync_document
{
  "filePath": "/path/to/project/deploy.json",
  "subject": "Core Service",
  "environment": "production",
  "sourceRole": "deployment"
}
```

### Step 2: Ingest Readme

```json
// Call tool: sync_document
{
  "filePath": "/path/to/project/README.md",
  "subject": "Core Service",
  "environment": "production",
  "sourceRole": "documentation"
}
```

### Step 3: List Discovered Contradictions

```json
// Call tool: list_contradictions
{}
```

Response:

```json
{
  "count": 1,
  "contradictions": [
    {
      "id": "e2147f29-a546-4a7c-97f1-cc00b81a7a81",
      "contradictionType": "VERSION_MISMATCH",
      "severity": "HIGH",
      "explanation": "Both claims describe node_version for 'Core Service' ... README reports '18' ... deploy.json reports '22'. The versions are mutually exclusive.",
      "status": "OPEN"
    }
  ]
}
```

---

## 2. Requesting Resolution Advisory

AI agents or operators can request automated recommendations before making changes:

```json
// Call tool: advise_resolution
{
  "contradictionId": "e2147f29-a546-4a7c-97f1-cc00b81a7a81"
}
```

Response:

```json
{
  "likelyCurrentClaim": "claimA",
  "confidence": 0.95,
  "recommendedAction": "Accept Claim A ('22') over Claim B ('18'). Deployment specifications override informal documentation.",
  "reason": "Claim A has higher authority (deployment manifest, role weight: 1.0) compared to Claim B (documentation guide, role weight: 0.6).",
  "authorityComparison": {
    "winner": "claimA",
    "claimAScore": 0.95,
    "claimBScore": 0.58
  }
}
```

---

## 3. Resolving the Contradiction with Full Audit Trail

```json
// Call tool: resolve_contradiction
{
  "contradictionId": "e2147f29-a546-4a7c-97f1-cc00b81a7a81",
  "resolvedBy": "lead-engineer",
  "reason": "Production deploy manifest is canonical. Created Issue #402 to update README.md.",
  "chosenClaimId": "claim-uuid-for-node-22"
}
```

### Inspect Audit History

```json
// Call tool: get_contradiction_history
{
  "contradictionId": "e2147f29-a546-4a7c-97f1-cc00b81a7a81"
}
```

Returns chronological, immutable audit log of status transitions and operator decisions.
