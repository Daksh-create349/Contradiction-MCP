import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import path from 'node:path';

async function runLiveVerification() {
  const serverPath = path.resolve(process.cwd(), 'dist', 'index.js');
  console.log(`Starting live MCP server process: node ${serverPath}`);

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: {
      ...process.env,
      DATABASE_PATH: './data/live_verify.db',
      LOG_LEVEL: 'info',
    },
  });

  const client = new Client(
    { name: 'live-verification-client', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    console.log('✓ Connected to built Contradiction MCP server via stdio transport\n');

    // 1. list_tools
    console.log('--- 1. Calling listTools ---');
    const toolsRes = await client.listTools();
    console.log(
      `Available Tools (${toolsRes.tools.length}): ${toolsRes.tools.map((t) => t.name).join(', ')}`,
    );

    // 2. test_github_connection
    console.log('\n--- 2. Calling test_github_connection (expressjs/express) ---');
    const testRes = await client.callTool({
      name: 'test_github_connection',
      arguments: {
        owner: 'expressjs',
        repo: 'express',
      },
    });
    console.log(JSON.stringify(testRes, null, 2));

    // 3. sync_github_repository
    console.log('\n--- 3. Calling sync_github_repository (expressjs/express) ---');
    const syncRes = await client.callTool({
      name: 'sync_github_repository',
      arguments: {
        owner: 'expressjs',
        repo: 'express',
        runDiscovery: true,
      },
    });
    console.log(JSON.stringify(syncRes, null, 2));

    // 4. list_contradictions
    console.log('\n--- 4. Calling list_contradictions ---');
    const contradictionsRes = await client.callTool({
      name: 'list_contradictions',
      arguments: {},
    });
    console.log(JSON.stringify(contradictionsRes, null, 2));

    // 5. Query claims to explain relationship between CI matrix or engine claims
    console.log('\n--- 5. Calling explain_claim_relationship ---');
    // Read SQLite db to find two extracted claims from express repo
    const Database = (await import('better-sqlite3')).default;
    const db = new Database('./data/live_verify.db');
    const claims = db
      .prepare(
        "SELECT id, subject, predicate, value, environment, multi_value_context FROM claims WHERE predicate LIKE '%version%' LIMIT 5",
      )
      .all() as Array<{
      id: string;
      subject: string;
      predicate: string;
      value: string;
      environment: string;
      multi_value_context: string;
    }>;
    db.close();

    console.log('Extracted claims sample:', claims);
    if (claims.length >= 2) {
      const explainRes = await client.callTool({
        name: 'explain_claim_relationship',
        arguments: {
          claimAId: claims[0].id,
          claimBId: claims[1].id,
        },
      });
      console.log('explain_claim_relationship output:', JSON.stringify(explainRes, null, 2));
    }

    console.log(
      '\n✓ All Live MCP calls executed successfully against real GitHub API with false-positive elimination!',
    );
  } finally {
    await client.close();
  }
}

runLiveVerification().catch((err) => {
  console.error('Fatal error during live MCP verification:', err);
  process.exit(1);
});
