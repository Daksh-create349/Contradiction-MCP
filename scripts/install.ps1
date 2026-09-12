Write-Host "=== Installing Contradiction MCP for Windows ===" -ForegroundColor Cyan

$TargetDir = Join-Path $HOME ".contradiction-mcp"

if (Test-Path $TargetDir) {
    Write-Host "Updating existing installation in $TargetDir..." -ForegroundColor Yellow
    Set-Location $TargetDir
    git pull origin main
} else {
    Write-Host "Cloning Contradiction MCP to $TargetDir..." -ForegroundColor Yellow
    git clone --depth 1 https://github.com/Daksh-create349/Contradiction-MCP.git $TargetDir
    Set-Location $TargetDir
}

Set-Location (Join-Path $TargetDir "contradiction-mcp")

Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install

Write-Host "Building TypeScript..." -ForegroundColor Yellow
npm run build

Write-Host "Configuring IDE clients (Claude, Cursor, Antigravity)..." -ForegroundColor Yellow
node scripts/install-mcp.js

Write-Host "`n=== Installation Complete! Restart your IDE to use Contradiction MCP. ===" -ForegroundColor Green
