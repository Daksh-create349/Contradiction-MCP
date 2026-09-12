#!/usr/bin/env bash
set -e

echo "=== Installing Contradiction MCP ==="

TARGET_DIR="$HOME/.contradiction-mcp"

if [ -d "$TARGET_DIR" ]; then
  echo "Updating existing installation in $TARGET_DIR..."
  cd "$TARGET_DIR"
  git pull origin main --quiet
else
  echo "Cloning Contradiction MCP to $TARGET_DIR..."
  git clone --depth 1 https://github.com/Daksh-create349/Contradiction-MCP.git "$TARGET_DIR"
  cd "$TARGET_DIR"
fi

cd contradiction-mcp

echo "Installing dependencies..."
npm install --silent

echo "Building TypeScript engine..."
npm run build --silent

echo "Configuring IDE clients..."
node scripts/install-mcp.js

echo "=== Installation Complete! Restart your IDE to use Contradiction MCP. ==="
