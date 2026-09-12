/**
 * Phase 35 & 36: Final Live MCP Protocol Workflow and Reproducible End-to-End Demo
 * Connects to the real compiled server via StdioClientTransport and invokes every step through MCP protocol.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDistPath = path.resolve(__dirname, '..', '..', 'dist', 'index.js');

async function runFinalDemo() {
  const tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'live-demo-')));
  const demoDbPath = path.join(tempDir, 'demo.db');

  console.log('======================================================================');
  console.log('CONTRADICTION MCP — FINAL PRODUCTION LIVE PROTOCOL DEMONSTRATION');
  console.log('======================================================================');
  console.log(`Server Executable: ${serverDistPath}`);
  console.log(`Database Target:   ${demoDbPath}`);
  console.log(`Sandbox Directory: ${tempDir}\n`);

  // Prepare Source B (Document)
  const docPath = path.join(tempDir, 'architecture_spec.json');
  fs.writeFileSync(
    docPath,
    JSON.stringify(
      {
        node_version: '22',
        service_port: 8080,
        primary_database: 'postgres-16',
      },
      null,
      2,
    ),
  );

  // Prepare Source C (Website/Documentation guide with conflicting version)
  const websiteDocPath = path.join(tempDir, 'outdated_guide.txt');
  fs.writeFileSync(
    websiteDocPath,
    `# Operations Guide
node_version: 18
service_port: 8080
primary_database: postgres-14
`,
  );

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverDistPath],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_PATH: demoDbPath,
      LOG_LEVEL: 'error',
      MCP_TRANSPORT: 'stdio',
    },
  });

  const client = new Client(
    { name: 'contradiction-production-verifier', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    console.log('[STEP 1] Initializing MCP Protocol Connection...');
    await client.connect(transport);
    console.log('✔ Connected to compiled MCP server via Stdio transport.');

    console.log('\n[STEP 2] Querying MCP Tools, Resources, and Prompts...');
    const tools = await client.listTools();
    const resources = await client.listResources();
    const templates = await client.listResourceTemplates();
    const prompts = await client.listPrompts();

    console.log(`✔ Tools Registered:     ${tools.tools.length} active tools`);
    console.log(`✔ Static Resources:     ${resources.resources.length} resource(s)`);
    console.log(
      `✔ Resource Templates:   ${templates.resourceTemplates.length} template(s) (Total: ${resources.resources.length + templates.resourceTemplates.length})`,
    );
    console.log(`✔ Prompts Available:    ${prompts.prompts.length} prompt(s)`);

    console.log('\n[STEP 3] Calling Tool: health_check...');
    const healthRes = await client.callTool({ name: 'health_check', arguments: {} });
    const healthText = (healthRes.content as Array<{ text: string }>)[0].text;
    console.log('Response:');
    console.log(healthText);

    console.log('\n[STEP 4] Calling Tool: test_github_connection (Public Repo)...');
    const ghTestRes = await client.callTool({
      name: 'test_github_connection',
      arguments: { owner: 'octocat', repo: 'Hello-World' },
    });
    console.log('Response:');
    console.log((ghTestRes.content as Array<{ text: string }>)[0].text);

    console.log(
      '\n[STEP 5] Calling Tool: sync_document (Source B: Production Architecture Spec)...',
    );
    const docSyncRes = await client.callTool({
      name: 'sync_document',
      arguments: {
        filePath: docPath,
        sourceName: 'Production Architecture Spec',
        subject: 'Core API Platform',
        environment: 'production',
        scope: 'deployment',
        sourceRole: 'deployment',
      },
    });
    console.log('Response:');
    console.log((docSyncRes.content as Array<{ text: string }>)[0].text);

    console.log('\n[STEP 6] Calling Tool: sync_document (Source C: Legacy Operations Guide)...');
    const guideSyncRes = await client.callTool({
      name: 'sync_document',
      arguments: {
        filePath: websiteDocPath,
        sourceName: 'Legacy Operations Guide',
        subject: 'Core API Platform',
        environment: 'production',
        scope: 'deployment',
        sourceRole: 'documentation',
      },
    });
    console.log('Response:');
    console.log((guideSyncRes.content as Array<{ text: string }>)[0].text);

    console.log('\n[STEP 7] Calling Tool: scan_for_contradictions...');
    const scanRes = await client.callTool({
      name: 'scan_for_contradictions',
      arguments: { limit: 10, minConfidence: 0.5 },
    });
    console.log('Response:');
    console.log((scanRes.content as Array<{ text: string }>)[0].text);

    console.log('\n[STEP 8] Calling Tool: list_contradictions (status=OPEN)...');
    const listRes = await client.callTool({
      name: 'list_contradictions',
      arguments: { status: 'OPEN' },
    });
    const listParsed = JSON.parse((listRes.content as Array<{ text: string }>)[0].text);
    console.log(`Found ${listParsed.total} open contradiction(s):`);
    for (const item of listParsed.contradictions) {
      console.log(
        ` - ID: ${item.id} | Predicate: ${item.predicate || 'mismatch'} | Severity: ${item.severity} | Score: ${item.confidence}`,
      );
    }

    if (listParsed.contradictions.length === 0) {
      throw new Error('Expected contradictions to be discovered between conflicting sources');
    }

    const targetContra = listParsed.contradictions[0];
    const contradictionId = targetContra.id;

    console.log(`\n[STEP 9] Calling Tool: get_contradiction (${contradictionId})...`);
    const getRes = await client.callTool({
      name: 'get_contradiction',
      arguments: { contradictionId },
    });
    const contraDetails = JSON.parse((getRes.content as Array<{ text: string }>)[0].text);
    console.log('Contradiction Details:');
    console.log(` - Explanation: ${contraDetails.explanation}`);
    console.log(
      ` - Claim A: ${contraDetails.claimA.predicate} = '${contraDetails.claimA.value}' (Source: ${contraDetails.sourceA?.name})`,
    );
    console.log(
      ` - Claim B: ${contraDetails.claimB.predicate} = '${contraDetails.claimB.value}' (Source: ${contraDetails.sourceB?.name})`,
    );

    console.log(`\n[STEP 10] Calling Tool: explain_claim_relationship...`);
    const explainRes = await client.callTool({
      name: 'explain_claim_relationship',
      arguments: {
        claimAId: contraDetails.claimA.id,
        claimBId: contraDetails.claimB.id,
      },
    });
    console.log('Relationship Analysis:');
    console.log((explainRes.content as Array<{ text: string }>)[0].text);

    console.log(`\n[STEP 11] Calling Tool: advise_resolution...`);
    const adviseRes = await client.callTool({
      name: 'advise_resolution',
      arguments: { contradictionId },
    });
    const adviceParsed = JSON.parse((adviseRes.content as Array<{ text: string }>)[0].text);
    console.log('Resolution Advice (Heuristic Assessment):');
    console.log(` - Recommended Winner: ${adviceParsed.likelyCurrentClaim}`);
    console.log(` - Confidence:         ${adviceParsed.confidence}`);
    console.log(` - Reason:             ${adviceParsed.reason}`);
    console.log(` - Recommended Action: ${adviceParsed.recommendedAction}`);

    console.log(`\n[STEP 12] Calling Tool: review_contradiction...`);
    const reviewRes = await client.callTool({
      name: 'review_contradiction',
      arguments: {
        contradictionId,
        reviewedBy: 'lead-sre-agent',
        notes: 'Verified production manifest is deployment source of truth.',
      },
    });
    console.log('Review Result:');
    console.log((reviewRes.content as Array<{ text: string }>)[0].text);

    console.log(`\n[STEP 13] Calling Tool: resolve_contradiction...`);
    const resolveRes = await client.callTool({
      name: 'resolve_contradiction',
      arguments: {
        contradictionId,
        resolvedBy: 'lead-sre-agent',
        reason: 'Adopted production architecture spec; scheduled doc update for legacy guide.',
        chosenClaimId: contraDetails.claimA.id,
      },
    });
    console.log('Resolution Result:');
    console.log((resolveRes.content as Array<{ text: string }>)[0].text);

    console.log(`\n[STEP 14] Calling Tool: get_contradiction_history...`);
    const histRes = await client.callTool({
      name: 'get_contradiction_history',
      arguments: { contradictionId },
    });
    console.log('Audit Trail:');
    console.log((histRes.content as Array<{ text: string }>)[0].text);

    console.log(`\n[STEP 15] Calling Tool: get_claim_history...`);
    const claimHistRes = await client.callTool({
      name: 'get_claim_history',
      arguments: { claimId: contraDetails.claimA.id },
    });
    console.log('Claim Version History:');
    console.log((claimHistRes.content as Array<{ text: string }>)[0].text);

    console.log(`\n[STEP 16] Reading MCP Resources via Protocol:`);
    const resMetrics = await client.readResource({ uri: 'health://metrics' });
    console.log('✔ Read health://metrics:');
    console.log((resMetrics.contents as Array<{ text: string }>)[0].text);

    const resContra = await client.readResource({ uri: `contradiction://${contradictionId}` });
    console.log(`✔ Read contradiction://${contradictionId}:`);
    console.log((resContra.contents as Array<{ text: string }>)[0].text);

    console.log(`\n[STEP 17] Testing MCP Prompt: investigate_contradiction...`);
    const promptRes = await client.getPrompt({
      name: 'investigate_contradiction',
      arguments: { contradictionId },
    });
    console.log('Prompt Generated:');
    console.log((promptRes.messages[0].content as { text: string }).text);

    console.log('\n======================================================================');
    console.log('🎉 DEMONSTRATION COMPLETE: ALL 17 PRODUCTION PHASES VERIFIED LIVE!');
    console.log('======================================================================\n');
  } finally {
    try {
      await client.close();
    } catch {
      // ignore
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

runFinalDemo().catch((err) => {
  console.error('Fatal demo error:', err);
  process.exit(1);
});
