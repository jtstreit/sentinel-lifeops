param(
  [string]$Device = "",
  [string]$BaseUrl = "",
  [string]$Token = "",
  [int]$WaitSeconds = 8,
  [switch]$NoForceRefresh,
  [switch]$NoAdbReverse
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $repoRoot
$envPath = Join-Path $repoRoot ".env"

function Get-DotEnvValue([string]$Name) {
  if (-not (Test-Path -LiteralPath $envPath)) {
    return ""
  }
  $line = Get-Content -LiteralPath $envPath |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
    Select-Object -First 1
  if (-not $line) {
    return ""
  }
  return ($line -replace "^\s*$([regex]::Escape($Name))\s*=\s*", "").Trim().Trim('"').Trim("'")
}

function Find-Adb {
  $candidates = @()
  if ($env:ANDROID_HOME) {
    $candidates += Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
  }
  if ($env:ANDROID_SDK_ROOT) {
    $candidates += Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe"
  }
  $candidates += Join-Path $workspaceRoot ".tools\android-sdk\platform-tools\adb.exe"
  $candidates += Join-Path $workspaceRoot ".tools\platform-tools\adb.exe"

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  $fromPath = Get-Command adb.exe -ErrorAction SilentlyContinue
  if ($fromPath) {
    return $fromPath.Source
  }

  throw "Missing adb.exe. Expected Android platform-tools under $workspaceRoot\.tools."
}

if (-not $BaseUrl) {
  $BaseUrl = $env:VITE_PUBLIC_INGEST_BASE_URL
}
if (-not $BaseUrl) {
  $BaseUrl = Get-DotEnvValue "VITE_PUBLIC_INGEST_BASE_URL"
}
if (-not $BaseUrl) {
  throw "Missing BaseUrl. Set VITE_PUBLIC_INGEST_BASE_URL in .env or pass -BaseUrl."
}

if (-not $Token) {
  $Token = $env:VITE_SENTINEL_INGEST_TOKEN
}
if (-not $Token) {
  $Token = Get-DotEnvValue "VITE_SENTINEL_INGEST_TOKEN"
}
if (-not $Token) {
  $Token = Get-DotEnvValue "SENTINEL_INGEST_TOKEN"
}

$adb = Find-Adb
$adbArgs = @()
if ($Device) {
  $adbArgs += @("-s", $Device)
}

$serverBaseUrl = $BaseUrl.TrimEnd("/")
$deviceBaseUrl = $serverBaseUrl
if (-not $NoAdbReverse) {
  try {
    $uri = [Uri]$serverBaseUrl
    $port = if ($uri.IsDefaultPort) {
      if ($uri.Scheme -eq "https") { 443 } else { 80 }
    } else {
      $uri.Port
    }
    & $adb @adbArgs reverse "tcp:$port" "tcp:$port" | Out-Null
    $deviceBaseUrl = "$($uri.Scheme)://127.0.0.1:$port"
    Write-Host "ADB reverse active for port $port; device will post to $deviceBaseUrl"
  } catch {
    Write-Warning "Could not enable ADB reverse; falling back to $serverBaseUrl. $($_.Exception.Message)"
  }
}

$forceRefresh = if ($NoForceRefresh) { "false" } else { "true" }
& $adb @adbArgs shell am broadcast `
  -n com.jackson.sentinellifeops/.TelemetryExportReceiver `
  -a com.jackson.sentinellifeops.EXPORT_TELEMETRY `
  --es baseUrl $deviceBaseUrl `
  --es token $Token `
  --ez forceRefresh $forceRefresh | Out-Host

if ($WaitSeconds -gt 0) {
  Start-Sleep -Seconds $WaitSeconds
}

$headers = @{}
if ($Token) {
  $headers["X-Sentinel-Ingest-Token"] = $Token
}

try {
  $telemetry = Invoke-RestMethod -Uri ($serverBaseUrl + "/api/telemetry") -Headers $headers
  $count = if ($telemetry.logs) { $telemetry.logs.Count } else { 0 }
  Write-Host "LifeOps telemetry store count: $count"
} catch {
  Write-Warning "Broadcast sent, but server count check failed: $($_.Exception.Message)"
}
