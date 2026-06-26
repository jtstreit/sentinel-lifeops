$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $repoRoot
# Android build toolchain lives in the OneDrive ".tools" folder (shared with CBT Sentinel),
# not under the user home. Allow override via SENTINEL_TOOLROOT.
$toolRoot = if ($env:SENTINEL_TOOLROOT) { $env:SENTINEL_TOOLROOT } else { "C:\Users\46743\OneDrive - Monarch\Documents\google ai studio apps\.tools" }
$javaHome = Join-Path $toolRoot "jdk"
$androidHome = Join-Path $toolRoot "android-sdk"
$gradleBat = Join-Path $toolRoot "gradle-8.10.2\bin\gradle.bat"
$androidProject = Join-Path $repoRoot "android-lifeops"

if (-not (Test-Path -LiteralPath $javaHome)) {
  throw "Missing local JDK at $javaHome"
}
if (-not (Test-Path -LiteralPath $androidHome)) {
  throw "Missing local Android SDK at $androidHome"
}
if (-not (Test-Path -LiteralPath $gradleBat)) {
  throw "Missing local Gradle at $gradleBat"
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $androidHome
$env:ANDROID_SDK_ROOT = $androidHome
$env:PATH = (Join-Path $javaHome "bin") + ";" + (Join-Path $androidHome "platform-tools") + ";" + $env:PATH

& $gradleBat -p $androidProject assembleDebug
