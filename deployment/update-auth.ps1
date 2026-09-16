[CmdletBinding()]
param(
  [string]$EnvironmentFile = 'backend\.env'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourcePath = [IO.Path]::GetFullPath((Join-Path $repoRoot $EnvironmentFile))
$deployBase = [IO.Path]::GetFullPath((Join-Path $repoRoot '.deploy'))
$releaseId = Get-Date -Format 'yyyyMMdd-HHmmss'
$stageRoot = [IO.Path]::GetFullPath((Join-Path $deployBase "auth-$releaseId"))
$filteredPath = Join-Path $stageRoot 'auth.env'
$remotePath = "/tmp/tahosapp-auth-$releaseId.env"
$remoteScriptPath = "/tmp/tahosapp-update-auth-$releaseId.sh"
$remoteHost = '188.191.107.157'
$remoteUser = 'tahosdeploy'
$sshKey = 'C:\Users\User\.ssh\tahosapp_deploy_ed25519'
$knownHosts = 'C:\Users\User\.ssh\tahosapp_known_hosts'
$allowedKeys = @(
  'SOCIAL_AUTH_BASE_URL',
  'SOCIAL_AUTH_WEB_URL',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'WEBAUTHN_ORIGIN',
  'WEBAUTHN_RP_ID',
  'WEBAUTHN_RP_NAME'
)
$requiredKeys = @(
  'SOCIAL_AUTH_BASE_URL',
  'SOCIAL_AUTH_WEB_URL',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET'
)

if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Kimlik dogrulama kaynak dosyasi bulunamadi: $sourcePath"
}
if (-not (Test-Path -LiteralPath $sshKey -PathType Leaf)) {
  throw "SSH anahtari bulunamadi: $sshKey"
}
if (-not $stageRoot.StartsWith($deployBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Gecici kimlik dogrulama klasoru proje sinirlari disinda.'
}

$sourceLines = Get-Content -LiteralPath $sourcePath -Encoding UTF8
$selectedLines = foreach ($key in $allowedKeys) {
  $matches = @($sourceLines | Where-Object { $_ -match "^$([regex]::Escape($key))=" })
  if ($matches.Count -gt 1) { throw "$key birden fazla kez tanimlanmis." }
  if ($matches.Count -eq 1) { $matches[0] }
}
foreach ($key in $requiredKeys) {
  $line = $selectedLines | Where-Object { $_ -match "^$([regex]::Escape($key))=(.+)$" } | Select-Object -First 1
  if (-not $line) { throw "$key bos veya eksik." }
  $value = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
  if (-not $value -or $value -match '^(your-|replace-|\.\.\.)') { throw "$key gercek bir deger icermiyor." }
}

New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
[IO.File]::WriteAllLines($filteredPath, $selectedLines, [Text.UTF8Encoding]::new($false))

$sshOptions = @(
  '-i', $sshKey,
  '-o', "UserKnownHostsFile=$knownHosts",
  '-o', 'StrictHostKeyChecking=yes',
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=20'
)
$remote = "${remoteUser}@${remoteHost}"

try {
  & scp @sshOptions $filteredPath "${remote}:$remotePath"
  if ($LASTEXITCODE -ne 0) { throw 'Kimlik dogrulama ayarlari sunucuya aktarilamadi.' }
  & scp @sshOptions (Join-Path $PSScriptRoot 'update-auth-server.sh') "${remote}:$remoteScriptPath"
  if ($LASTEXITCODE -ne 0) { throw 'Sunucu kimlik dogrulama yardimcisi aktarilamadi.' }

  & ssh @sshOptions $remote "sudo bash $remoteScriptPath $remotePath"
  if ($LASTEXITCODE -ne 0) { throw 'Canli kimlik dogrulama ayarlari etkinlestirilemedi.' }
}
finally {
  if (Test-Path -LiteralPath $stageRoot) {
    $resolvedStage = [IO.Path]::GetFullPath($stageRoot)
    if ($resolvedStage.StartsWith($deployBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
  }
}

Write-Host 'Google girisi canli sunucuda etkinlestirildi ve dogrulandi.' -ForegroundColor Green
