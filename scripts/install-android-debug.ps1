param(
  [switch]$Launch
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $repoRoot
$adbCandidates = @(
  "C:\Users\46743\platform-tools\adb.exe",
  (Join-Path $workspaceRoot ".tools\android-sdk\platform-tools\adb.exe"),
  "C:\Users\46743\OneDrive - Monarch\Documents\google ai studio apps\.tools\android-sdk\platform-tools\adb.exe"
)
$adb = $adbCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$apk = Join-Path $repoRoot "android-lifeops\app\build\outputs\apk\debug\app-debug.apk"

if (-not $adb) {
  throw "Missing adb under $workspaceRoot\.tools"
}
if (-not (Test-Path -LiteralPath $apk)) {
  throw "Missing APK at $apk. Run npm run android:build-debug first."
}

& $adb install -r $apk
if ($Launch) {
  & $adb shell monkey -p com.jackson.sentinellifeops -c android.intent.category.LAUNCHER 1
}
