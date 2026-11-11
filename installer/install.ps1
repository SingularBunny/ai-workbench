# ai-workbench installer for Windows.
#   1. OpenClaw at the pinned version via the official install.ps1 (installs Node if needed;
#      docs/install/installer.md). Skipped if the right version is already installed.
#   2. installer/setup.mjs: config, plugins with dependencies, checks. Shows the install plan
#      and asks for consent.
#
#   powershell -ExecutionPolicy Bypass -File installer\install.ps1 [--dry-run] [--yes] [--plugins-root <dir>]
#   powershell -ExecutionPolicy Bypass -File installer\install.ps1 --uninstall [--dry-run] [--yes]
#
# NOT TESTED on real Windows: the Docker validation runs on Linux only.
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg = Get-Content (Join-Path $here '..\openclaw\workbench.config.mjs') -Raw
if ($cfg -notmatch 'export const OPENCLAW_VERSION = "([^"]+)";') { throw 'OPENCLAW_VERSION not found in workbench.config.mjs' }
$version = $Matches[1]
$dry = $args -contains '--dry-run'
$uninstall = $args -contains '--uninstall'

function Get-OpenClawVersion {
    $cmd = Get-Command openclaw -ErrorAction SilentlyContinue
    if (-not $cmd) { return '' }
    try { return (& openclaw --version 2>$null | Out-String) } catch { return '' }
}

if ($uninstall) {
    # uninstall does not install OpenClaw: it removes only our own changes (setup.mjs --uninstall)
} elseif ((Get-OpenClawVersion) -like "*$version*") {
    Write-Host "OpenClaw $version is already installed."
} elseif ($dry) {
    Write-Host "[dry-run] would install OpenClaw $version with the official install.ps1"
} else {
    Write-Host "Installing OpenClaw $version (official install.ps1)…"
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("openclaw-install-" + [guid]::NewGuid() + '.ps1')
    try {
        # Download to a file, not `iwr | iex`: an interrupted download will not run half a script.
        Invoke-WebRequest -UseBasicParsing -Uri 'https://openclaw.ai/install.ps1' -OutFile $tmp
        Write-Host ("install.ps1 sha256: " + (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower())
        & $tmp -Tag $version -NoOnboard
    } finally {
        Remove-Item $tmp -ErrorAction SilentlyContinue
    }
    # The installer updates the user PATH; pick it up without restarting the shell.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    if ($dry) { Write-Host '[dry-run] Node will be available after OpenClaw is installed'; exit 0 }
    throw 'Node not found after installing OpenClaw. Open a new PowerShell window and try again.'
}
& $node.Source (Join-Path $here 'setup.mjs') @args
exit $LASTEXITCODE
