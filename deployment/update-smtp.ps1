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
$stageRoot = [IO.Path]::GetFullPath((Join-Path $deployBase "smtp-$releaseId"))
$filteredPath = Join-Path $stageRoot 'smtp.env'
$remotePath = "/tmp/tahosapp-smtp-$releaseId.env"
$remoteVerifyPath = "/tmp/tahosapp-verify-smtp-$releaseId.js"
$remoteHost = '188.191.107.157'
$remoteUser = 'tahosdeploy'
$sshKey = 'C:\Users\User\.ssh\tahosapp_deploy_ed25519'
$knownHosts = 'C:\Users\User\.ssh\tahosapp_known_hosts'
$allowedKeys = @('SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM')
$requiredKeys = @('SMTP_USER', 'SMTP_PASS', 'MAIL_FROM')

if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "SMTP kaynak dosyasi bulunamadi: $sourcePath"
}
if (-not $stageRoot.StartsWith($deployBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Gecici SMTP klasoru proje sinirlari disinda.'
}

$sourceLines = Get-Content -LiteralPath $sourcePath -Encoding UTF8
$selectedLines = foreach ($key in $allowedKeys) {
  $matches = @($sourceLines | Where-Object { $_ -match "^$([regex]::Escape($key))=" })
  if ($matches.Count -gt 1) { throw "$key birden fazla kez tanimlanmis." }
  if ($matches.Count -eq 1) { $matches[0] }
}
foreach ($key in $requiredKeys) {
  if (-not ($selectedLines | Where-Object { $_ -match "^$([regex]::Escape($key))=.+" })) {
    throw "$key bos veya eksik."
  }
}

New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
[IO.File]::WriteAllLines($filteredPath, $selectedLines, [Text.UTF8Encoding]::new($false))

$sshOptions = @(
  '-i', $sshKey,
  '-o', "UserKnownHostsFile=$knownHosts",
  '-o', 'StrictHostKeyChecking=yes',
  '-o', 'BatchMode=yes'
)
$remote = "${remoteUser}@${remoteHost}"

try {
  & scp @sshOptions $filteredPath "${remote}:$remotePath"
  if ($LASTEXITCODE -ne 0) { throw 'SMTP ayarlari sunucuya aktarilamadi.' }
  & scp @sshOptions (Join-Path $PSScriptRoot 'verify-smtp.js') "${remote}:$remoteVerifyPath"
  if ($LASTEXITCODE -ne 0) { throw 'SMTP dogrulama yardimcisi sunucuya aktarilamadi.' }

  $remoteCommand = "set -e; chmod 600 $remotePath; printf '[Service]\nEnvironmentFile=\nEnvironmentFile=/etc/tahosapp/tahosapp.env\nEnvironmentFile=/etc/tahosapp/smtp.env\n' > /tmp/tahosapp-smtp-override.conf; sudo install -o root -g tahosapp -m 0640 $remotePath /etc/tahosapp/smtp.env; sudo install -o root -g root -m 0644 -D /tmp/tahosapp-smtp-override.conf /etc/systemd/system/tahosapp.service.d/20-smtp.conf; sudo systemctl daemon-reload; sudo systemctl restart tahosapp; sleep 2; sudo -u tahosapp /opt/node22/bin/node $remoteVerifyPath; sudo systemctl is-active tahosapp"
  & ssh @sshOptions $remote $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw 'SMTP dogrulamasi basarisiz oldu.' }
}
finally {
  if (Test-Path -LiteralPath $stageRoot) {
    $resolvedStage = [IO.Path]::GetFullPath($stageRoot)
    if ($resolvedStage.StartsWith($deployBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
  }
}

Write-Host 'Canli SMTP ayarlari guncellendi ve Brevo baglantisi dogrulandi.' -ForegroundColor Green
