param(
  [ValidateSet('release', 'debug')]
  [string]$Variant = 'release'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$jdkDirectory = Get-ChildItem (Join-Path $repoRoot '.build-tools/jdk') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
$javaHome = if ($env:JAVA_HOME) { $env:JAVA_HOME } elseif ($jdkDirectory) { $jdkDirectory.FullName } else { '' }
$sdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $repoRoot '.build-tools/android-sdk' }
if (-not (Test-Path (Join-Path $javaHome 'bin/java.exe'))) { throw 'Java 21 was not found.' }
if (-not (Test-Path (Join-Path $sdkRoot 'platforms/android-36'))) { throw 'Android SDK platform 36 was not found.' }

if ($Variant -eq 'release') {
  & (Join-Path $PSScriptRoot 'initialize-android-signing.ps1') -JavaHome $javaHome
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Push-Location $repoRoot
try {
  & npm.cmd run build:android:web
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & node scripts/run-capacitor-safe.cjs sync android
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-android-assets.ps1
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  $env:JAVA_HOME = $javaHome
  $env:ANDROID_SDK_ROOT = $sdkRoot
  $env:ANDROID_HOME = $sdkRoot
  $env:ANDROID_USER_HOME = Join-Path $repoRoot '.build-tools/android-home'
  New-Item -ItemType Directory -Force $env:ANDROID_USER_HOME | Out-Null
  $env:GRADLE_USER_HOME = Join-Path $repoRoot '.build-tools/gradle-home'
  Push-Location (Join-Path $repoRoot 'android')
  try {
    $task = if ($Variant -eq 'release') { 'assembleRelease' } else { 'assembleDebug' }
    & .\gradlew.bat --no-daemon "-Duser.home=$repoRoot" $task
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally { Pop-Location }

  $version = (Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
  $sourceApk = Join-Path $repoRoot "android/app/build/outputs/apk/$Variant/app-$Variant.apk"
  $releaseDirectory = Join-Path $repoRoot 'mobile/releases'
  New-Item -ItemType Directory -Force $releaseDirectory | Out-Null
  $targetApk = Join-Path $releaseDirectory "tahosapp-android-$version.apk"
  Copy-Item -LiteralPath $sourceApk -Destination $targetApk -Force
  $stream = [System.IO.File]::OpenRead($targetApk)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try { $hash = ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $sha256.Dispose(); $stream.Dispose() }
  Write-Host "APK: $targetApk"
  Write-Host "SHA-256: $hash"
} finally { Pop-Location }
