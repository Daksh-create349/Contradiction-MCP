import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Client } from '@modelcontextprotocol/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDistPath = path.resolve(__dirname, '..', '..', 'dist', 'index.js');

async function runLiveSmokeTest(): Promise<void> {
  console.log('=== Contradiction MCP Live Production Smoke Test ===');
  console.log(`Target executable: ${serverDistPath}`);

  // Create real Stdio client transport connecting to built server
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverDistPath],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_PATH: ':memory:',
      LOG_LEVEL: 'error',
      MCP_TRANSPORT: 'stdio',
    },
  });

  const client = new Client(
    {
      name: 'live-smoke-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    },
  );

  try {
    console.log('[1/6] Connecting via StdioClientTransport...');
    await client.connect(transport);
    console.log('✔ Connected to live MCP server process.');

    console.log('[2/6] Querying tools/list...');
    const tools = await client.listTools();
    console.log(`✔ Received ${tools.tools.length} active MCP tools:`);
    for (const t of tools.tools) {
      console.log(`   - ${t.name}`);
    }

    console.log('[3/6] Querying resources/list and resources/templates/list...');
    const resources = await client.listResources();
    console.log(`✔ Received ${resources.resources.length} static MCP resources:`);
    for (const r of resources.resources) {
      console.log(`   - ${r.uri}`);
    }

    const templates = await client.listResourceTemplates();
    console.log(
      `✔ Received ${templates.resourceTemplates.length} parameterized MCP resource templates:`,
    );
    for (const t of templates.resourceTemplates) {
      console.log(`   - ${t.uriTemplate} (${t.name})`);
    }

    console.log('[4/6] Querying prompts/list...');
    const prompts = await client.listPrompts();
    console.log(`✔ Received ${prompts.prompts.length} MCP prompts:`);
    for (const p of prompts.prompts) {
      console.log(`   - ${p.name}`);
    }

    console.log('[5/6] Executing tool: health_check...');
    const healthResult = await client.callTool({
      name: 'health_check',
      arguments: {},
    });
    console.log('✔ health_check output:');
    console.log((healthResult.content as Array<{ text: string }>)[0].text);

    console.log('[6/6] Executing tool: list_connectors...');
    const connectorsResult = await client.callTool({
      name: 'list_connectors',
      arguments: {},
    });
    console.log('✔ list_connectors output:');
    console.log((connectorsResult.content as Array<{ text: string }>)[0].text);

    console.log('\n🎉 ALL LIVE MCP SMOKE VERIFICATION GATES PASSED SUCCESSFULLY!');
  } catch (error) {
    console.error('❌ Live smoke test failed:', error);
    process.exit(1);
  } finally {
    try {
      await client.close();
    } catch {
      // ignore
    }
  }
}

runLiveSmokeTest().catch((err) => {
  console.error('Fatal error during smoke test:', err);
  process.exit(1);
});
