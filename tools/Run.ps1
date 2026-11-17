param([switch]$NoBuild)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not $NoBuild) { & "$PSScriptRoot/Build-Explorer.ps1" }
Write-Host 'Open http://127.0.0.1:5198. Ctrl+C stops this local server.'
& node tools/serve.mjs
if ($LASTEXITCODE -ne 0) { throw 'Local server failed; another instance may already own port 5198.' }
