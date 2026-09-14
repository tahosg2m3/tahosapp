param(
  [string]$JavaHome = ""
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$signingDirectory = Join-Path $repoRoot 'mobile/signing'
$keystorePath = Join-Path $signingDirectory 'tahosapp-release.jks'
$propertiesPath = Join-Path $signingDirectory 'keystore.properties'

if ((Test-Path $keystorePath) -and (Test-Path $propertiesPath)) {
  Write-Host 'Android signing identity already exists.'
  exit 0
}
if ((Test-Path $keystorePath) -or (Test-Path $propertiesPath)) {
  throw 'Android signing files are incomplete. Restore the missing file before continuing.'
}

if (-not $JavaHome) {
  if ($env:JAVA_HOME) { $JavaHome = $env:JAVA_HOME }
  else {
    $bundledJdk = Get-ChildItem (Join-Path $repoRoot '.build-tools/jdk') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($bundledJdk) { $JavaHome = $bundledJdk.FullName }
  }
}
$keytool = Join-Path $JavaHome 'bin/keytool.exe'
if (-not (Test-Path $keytool)) { throw 'Java 21 keytool was not found.' }

New-Item -ItemType Directory -Force $signingDirectory | Out-Null
$bytes = New-Object byte[] 36
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($bytes) } finally { $random.Dispose() }
$password = [Convert]::ToBase64String($bytes).Replace('+', 'A').Replace('/', 'B').TrimEnd('=')

& $keytool -genkeypair -v -keystore $keystorePath -storetype PKCS12 -storepass $password `
  -alias tahosapp -keyalg RSA -keysize 4096 -validity 10000 -keypass $password `
  -dname 'CN=tahosapp, OU=Mobile, O=tahosapp, L=Istanbul, C=TR'
if ($LASTEXITCODE -ne 0) { throw 'Android signing key could not be generated.' }

$properties = @(
  'storeName=tahosapp-release.jks'
  "storePassword=$password"
  'keyAlias=tahosapp'
  "keyPassword=$password"
) -join [Environment]::NewLine
[System.IO.File]::WriteAllText($propertiesPath, $properties, [System.Text.UTF8Encoding]::new($false))
Write-Host 'Android signing identity created in mobile/signing. Keep this directory private and backed up.'
