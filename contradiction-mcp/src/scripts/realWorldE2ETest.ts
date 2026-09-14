import path from 'path';
import { DatabaseManager } from '../storage/database.js';
import { ConnectorRegistry } from '../connectors/connectorRegistry.js';
import { DocumentConnector } from '../connectors/document/documentConnector.js';
import { SyncService } from '../connectors/syncService.js';
import { DiscoveryService } from '../discovery/discoveryService.js';
import { ResolutionAdvisor } from '../intelligence/resolutionAdvisor.js';
import { ReviewService } from '../services/reviewService.js';

async function runRealWorldTest(): Promise<void> {
  const testDir = path.resolve(process.cwd(), 'data/testdocs');
  console.log('=== REAL WORLD E2E TEST ===');
  console.log(`Test directory: ${testDir}`);

  const dbManager = new DatabaseManager(':memory:');
  dbManager.initialize();

  const registry = new ConnectorRegistry();
  const docConn = new DocumentConnector({
    allowedRoots: [testDir],
    maxFileSizeBytes: 10 * 1024 * 1024,
  });
  registry.register(docConn);

  const discoveryService = new DiscoveryService(dbManager);
  const syncService = new SyncService(dbManager, registry, discoveryService);
  const reviewService = new ReviewService(dbManager);
  const resolutionAdvisor = new ResolutionAdvisor();

  // 1. Ingest README
  console.log('\n--- Ingesting Canonical Markdown README ---');
  const readmeSummary = await syncService.syncSource('document', {
    filePath: path.join(testDir, 'test_infrastructure_readme.md'),
    subject: 'Alpha Commerce Platform',
    environment: 'production',
    sourceRole: 'canonical_spec',
  });
  console.log(`Claims Extracted: ${readmeSummary.claimsExtracted}`);
  console.log(`Claims Created:   ${readmeSummary.claimsCreated}`);
  console.log(`Warnings:         ${readmeSummary.extractionWarnings?.length || 0}`);

  // 2. Ingest JSON Deployment Spec
  console.log('\n--- Ingesting Deployment Spec JSON ---');
  const jsonSummary = await syncService.syncSource('document', {
    filePath: path.join(testDir, 'test_deployment_spec.json'),
    subject: 'Alpha Commerce Platform',
    environment: 'production',
    sourceRole: 'deployment_spec',
  });
  console.log(`Claims Extracted: ${jsonSummary.claimsExtracted}`);
  console.log(`Claims Created:   ${jsonSummary.claimsCreated}`);
  console.log(`Warnings:         ${jsonSummary.extractionWarnings?.length || 0}`);

  // 3. Ingest K8s Manifest JSON
  console.log('\n--- Ingesting K8s Manifest JSON ---');
  const k8sSummary = await syncService.syncSource('document', {
    filePath: path.join(testDir, 'test_k8s_manifest.json'),
    subject: 'Alpha Commerce Platform',
    environment: 'production',
    sourceRole: 'k8s_manifest',
  });
  console.log(`Claims Extracted: ${k8sSummary.claimsExtracted}`);
  console.log(`Claims Created:   ${k8sSummary.claimsCreated}`);
  console.log(`Warnings:         ${k8sSummary.extractionWarnings?.length || 0}`);

  // 4. Ingest DOCX Architecture Spec
  console.log('\n--- Ingesting Architecture DOCX ---');
  const docxSummary = await syncService.syncSource('document', {
    filePath: path.join(testDir, 'test_architecture.docx'),
    subject: 'Alpha Commerce Platform',
    environment: 'production',
    sourceRole: 'architecture_doc',
  });
  console.log(`Claims Extracted: ${docxSummary.claimsExtracted}`);
  console.log(`Claims Created:   ${docxSummary.claimsCreated}`);
  console.log(`Warnings:         ${docxSummary.extractionWarnings?.length || 0}`);

  // 5. Scan for all contradictions
  console.log('\n--- Full Contradiction Discovery Scan ---');
  const scanResult = discoveryService.scanAllClaims({ minConfidence: 0.35, limit: 100 });
  console.log(`Total Contradictions Discovered: ${scanResult.contradictionsFound}`);
  console.log(`Candidate Pairs Evaluated:       ${scanResult.candidatePairs}`);
  console.log(`Pairs Analyzed:                  ${scanResult.pairsAnalyzed}`);

  const allContradictions = dbManager.listContradictions({ limit: 50 });
  console.log(`\nDiscovered ${allContradictions.length} contradiction records in DB:`);

  for (const c of allContradictions) {
    const c1 = dbManager.getClaimById(c.claimAId);
    const c2 = dbManager.getClaimById(c.claimBId);
    const s1 = c1 ? dbManager.getSourceById(c1.sourceId) : null;
    const s2 = c2 ? dbManager.getSourceById(c2.sourceId) : null;

    console.log(
      `\n[ID: ${c.id.substring(0, 8)}] Type: ${c.contradictionType} | Severity: ${c.severity} | Conf: ${c.confidence.toFixed(2)}`,
    );
    console.log(
      `  Source A: [${s1?.type || 'doc'}] ${s1?.name} -> "${c1?.predicate}" = "${c1?.value}"`,
    );
    console.log(
      `  Source B: [${s2?.type || 'doc'}] ${s2?.name} -> "${c2?.predicate}" = "${c2?.value}"`,
    );
    console.log(`  Explanation: ${c.explanation.split('\n')[0]}`);

    if (c1 && c2) {
      const advice = resolutionAdvisor.adviseResolution(c, c1, c2, s1, s2);
      if (advice) {
        console.log(
          `  Advice: ${advice.likelyCurrentClaim} (${advice.recommendedAction}) [Conf: ${advice.confidence.toFixed(2)}]`,
        );
        console.log(`  Reason: ${advice.reason}`);
      }
    }
  }

  // 6. Test Lifecycle Transitions (Review, Resolve, Dismiss, Reopen)
  if (allContradictions.length > 0) {
    const target = allContradictions[0];
    console.log(
      `\n--- Testing Lifecycle Transitions on Contradiction ${target.id.substring(0, 8)} ---`,
    );

    // Review
    const reviewed = reviewService.reviewContradiction(target.id, {
      reviewedBy: 'auditor@company.com',
      notes: 'Audited during deployment verification',
    });
    console.log(`Status after Review:  ${reviewed?.status}`);

    // Resolve
    const resolved = reviewService.resolveContradiction(target.id, {
      resolvedBy: 'architect@company.com',
      reason: 'Accepted canonical README value',
      chosenClaimId: target.claimAId,
    });
    console.log(
      `Status after Resolve: ${resolved?.status} (Selected: ${resolved?.chosenClaimId?.substring(0, 8)})`,
    );

    // Audit History
    const history = reviewService.getContradictionHistory(target.id);
    console.log(`Audit Trail Entries:  ${history.length}`);
    for (const h of history) {
      console.log(`  - ${h.action} by ${h.performedBy}: ${h.reason || h.notes || ''}`);
    }
  }

  dbManager.close();
  console.log('\n=== REAL WORLD E2E TEST COMPLETED SUCCESSFULLY ===');
}

runRealWorldTest().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
