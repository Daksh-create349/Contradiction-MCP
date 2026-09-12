#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const serverDist = path.join(projectRoot, 'dist', 'index.js');

const args = process.argv.slice(2);
const command = args[0] || 'start';

if (
  command === 'start' ||
  command === 'run' ||
  (command && !['install', 'setup', '--help', '-h', 'help'].includes(command))
) {
  // If invoked as standard MCP server (e.g. npx -y contradiction-mcp)
  await import('../dist/index.js');
} else if (command === '--help' || command === '-h' || command === 'help') {
  console.log(`
Contradiction MCP - Cross-Source Inconsistency & Contradiction Engine

Usage:
  npx contradiction-mcp                     Start MCP server (stdio default)
  npx contradiction-mcp install [ide]       Auto-configure MCP server in specified IDE/client

Supported IDEs:
  antigravity    Configure Google Antigravity (~/.gemini/config/mcp_config.json)
  cursor         Configure Cursor IDE (~/.cursor/mcp.json or workspace)
  claude         Configure Claude Desktop App
  claude-code    Configure Claude Code CLI (~/.claude.json or via claude mcp add)
  windsurf       Configure Windsurf IDE (~/.codeium/windsurf/mcp_config.json)
  all            Configure all detected environments (default)

Examples:
  npx contradiction-mcp install antigravity
  npx contradiction-mcp install cursor
  npx contradiction-mcp install claude
  npx contradiction-mcp install claude-code
  npx contradiction-mcp install all
`);
  process.exit(0);
} else if (command === 'install' || command === 'setup') {
  const requestedIde = (args[1] || 'all').toLowerCase();
  const home = os.homedir();
  const cwd = process.cwd();

  const nodeExecutable = process.execPath;
  const isGlobalNpx = !fs.existsSync(serverDist);

  // If installed via npm global or npx, use npx contradiction-mcp as command, else point to local dist/index.js
  const serverConfig = isGlobalNpx
    ? {
        command: 'npx',
        args: ['-y', 'contradiction-mcp'],
        env: {
          NODE_ENV: 'production',
          MCP_TRANSPORT: 'stdio',
        },
      }
    : {
        command: nodeExecutable,
        args: [serverDist],
        env: {
          NODE_ENV: 'production',
          DATABASE_PATH: path.join(projectRoot, 'data', 'contradiction.db'),
          MCP_TRANSPORT: 'stdio',
          LOG_LEVEL: 'error',
        },
      };

  console.log(
    `\n=== Installing Contradiction MCP for target: [${requestedIde.toUpperCase()}] ===\n`,
  );

  function updateJsonConfig(filePath, serverKey = 'contradiction', format = 'mcpServers') {
    try {
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });

      let data = {};
      if (fs.existsSync(filePath)) {
        try {
          data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch {
          data = {};
        }
      }

      if (format === 'mcpServers') {
        if (!data.mcpServers || typeof data.mcpServers !== 'object') {
          data.mcpServers = {};
        }
        data.mcpServers[serverKey] = serverConfig;
      } else if (format === 'claudeCode') {
        // Claude Code CLI format in ~/.claude.json
        if (!data.mcpServers || typeof data.mcpServers !== 'object') {
          data.mcpServers = {};
        }
        data.mcpServers[serverKey] = serverConfig;
      }

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`✔ Configured: ${filePath}`);
      return true;
    } catch (err) {
      console.warn(`⚠ Failed configuring ${filePath}: ${err.message}`);
      return false;
    }
  }

  let count = 0;

  // 1. Antigravity
  if (['antigravity', 'all'].includes(requestedIde)) {
    const globalGemini = path.join(home, '.gemini', 'config', 'mcp_config.json');
    if (updateJsonConfig(globalGemini)) count++;

    const workspaceAgents = path.join(cwd, '.agents', 'mcp_config.json');
    if (updateJsonConfig(workspaceAgents)) count++;
  }

  // 2. Cursor
  if (['cursor', 'all'].includes(requestedIde)) {
    const globalCursor = path.join(home, '.cursor', 'mcp.json');
    if (updateJsonConfig(globalCursor)) count++;

    const workspaceCursor = path.join(cwd, '.cursor', 'mcp.json');
    if (updateJsonConfig(workspaceCursor)) count++;
  }

  // 3. Claude Desktop
  if (['claude', 'claude-desktop', 'all'].includes(requestedIde)) {
    const claudePath =
      process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
        : process.platform === 'win32'
          ? path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
          : path.join(home, '.config', 'Claude', 'claude_desktop_config.json');

    if (updateJsonConfig(claudePath)) count++;
  }

  // 4. Claude Code CLI
  if (['claude-code', 'claudecode', 'all'].includes(requestedIde)) {
    const claudeCodeJson = path.join(home, '.claude.json');
    if (updateJsonConfig(claudeCodeJson, 'contradiction', 'claudeCode')) count++;

    // Also attempt native `claude mcp add` if claude cli is in PATH
    try {
      const checkClaude = execSync('which claude 2>/dev/null || true', {
        encoding: 'utf-8',
      }).trim();
      if (checkClaude) {
        try {
          execSync(
            `claude mcp add contradiction -- ${serverConfig.command} ${serverConfig.args.join(' ')}`,
            { stdio: 'ignore' },
          );
          console.log(`✔ Registered via Claude CLI: claude mcp add contradiction`);
        } catch {
          // ignore if already added
        }
      }
    } catch {
      // ignore
    }
  }

  // 5. Windsurf
  if (['windsurf', 'all'].includes(requestedIde)) {
    const windsurfPath = path.join(home, '.codeium', 'windsurf', 'mcp_config.json');
    if (updateJsonConfig(windsurfPath)) count++;
  }

  console.log(`\n🎉 Installation finished! Successfully configured in ${count} location(s).`);
  console.log(`Restart your IDE / Agent (${requestedIde}) to begin using Contradiction MCP.\n`);
}
