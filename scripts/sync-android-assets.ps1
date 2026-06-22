$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $repoRoot "dist"
$assetDir = Join-Path $repoRoot "android-lifeops\app\src\main\assets\web"

if (-not (Test-Path -LiteralPath $distDir)) {
  throw "dist does not exist. Run npm run build before syncing Android assets."
}

if (Test-Path -LiteralPath $assetDir) {
  Remove-Item -LiteralPath $assetDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $assetDir | Out-Null
Copy-Item -Path (Join-Path $distDir "*") -Destination $assetDir -Recurse -Force
Write-Host "Synced web assets to $assetDir"
