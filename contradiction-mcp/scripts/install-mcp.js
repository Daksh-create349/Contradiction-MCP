#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const serverDist = path.join(projectRoot, 'dist', 'index.js');
const dbPath = path.join(projectRoot, 'data', 'contradiction.db');

if (!fs.existsSync(serverDist)) {
  console.error('❌ dist/index.js not found! Please build the project first: npm run build');
  process.exit(1);
}

const serverConfig = {
  command: process.execPath,
  args: [serverDist],
  env: {
    NODE_ENV: 'production',
    DATABASE_PATH: dbPath,
    MCP_TRANSPORT: 'stdio',
    LOG_LEVEL: 'info',
  },
};

const home = os.homedir();
const targets = [
  {
    name: 'Antigravity (Global)',
    path: path.join(home, '.gemini', 'config', 'mcp_config.json'),
    mustExistDir: path.join(home, '.gemini', 'config'),
  },
  {
    name: 'Antigravity (Workspace .agents)',
    path: path.join(projectRoot, '..', '.agents', 'mcp_config.json'),
    mustExistDir: path.join(projectRoot, '..'),
  },
  {
    name: 'Claude Desktop',
    path:
      process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
        : process.platform === 'win32'
          ? path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
          : path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
    mustExistDir:
      process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'Claude')
        : null,
  },
  {
    name: 'Cursor IDE (Workspace)',
    path: path.join(projectRoot, '..', '.cursor', 'mcp.json'),
    mustExistDir: path.join(projectRoot, '..'),
  },
];

console.log('=== Contradiction MCP Automated Configurator ===\n');
console.log(`Server Executable: ${serverDist}`);
console.log(`Database Location: ${dbPath}\n`);

let configuredCount = 0;

for (const target of targets) {
  try {
    const dir = path.dirname(target.path);
    // If target specifies mustExistDir and it doesn't exist, skip unless Antigravity or workspace
    if (target.mustExistDir && !fs.existsSync(target.mustExistDir)) {
      continue;
    }

    fs.mkdirSync(dir, { recursive: true });

    let existing = {};
    if (fs.existsSync(target.path)) {
      try {
        existing = JSON.parse(fs.readFileSync(target.path, 'utf-8'));
      } catch {
        existing = {};
      }
    }

    if (!existing.mcpServers || typeof existing.mcpServers !== 'object') {
      existing.mcpServers = {};
    }

    existing.mcpServers['contradiction'] = serverConfig;

    fs.writeFileSync(target.path, JSON.stringify(existing, null, 2), 'utf-8');
    console.log(`✔ Configured ${target.name}: ${target.path}`);
    configuredCount++;
  } catch (err) {
    console.warn(`⚠ Could not configure ${target.name}: ${err.message}`);
  }
}

console.log(`\n🎉 Done! Configured ${configuredCount} MCP client environment(s).`);
console.log(
  'Restart Antigravity / Claude / Cursor to load Contradiction MCP tools automatically.\n',
);
