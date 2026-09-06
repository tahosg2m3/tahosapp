[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$AllowDirty,
  [string]$InstallerPath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Split-UploadFile {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$DestinationDirectory,
    [int64]$ChunkSize = 20MB
  )

  $parts = @()
  $source = [IO.File]::OpenRead($SourcePath)
  try {
    $buffer = New-Object byte[] (1MB)
    $partIndex = 0
    while ($source.Position -lt $source.Length) {
      $partPath = Join-Path $DestinationDirectory ((Split-Path -Leaf $SourcePath) + ('.part{0:D3}' -f $partIndex))
      $part = [IO.File]::Create($partPath)
      try {
        $written = 0L
        while ($written -lt $ChunkSize -and $source.Position -lt $source.Length) {
          $wanted = [Math]::Min($buffer.Length, $ChunkSize - $written)
          $read = $source.Read($buffer, 0, [int]$wanted)
          if ($read -le 0) { break }
          $part.Write($buffer, 0, $read)
          $written += $read
        }
      } finally {
        $part.Dispose()
      }
      $parts += $partPath
      $partIndex++
    }
  } finally {
    $source.Dispose()
  }
  return $parts
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$deployBase = [IO.Path]::GetFullPath((Join-Path $repoRoot '.deploy'))
$releaseId = Get-Date -Format 'yyyyMMdd-HHmmss'
$stageRoot = [IO.Path]::GetFullPath((Join-Path $deployBase $releaseId))
$webStage = Join-Path $stageRoot 'web'
$backendArchive = Join-Path $stageRoot "tahosapp-backend-$releaseId.tar.gz"
$webArchive = Join-Path $stageRoot "tahosapp-web-$releaseId.tar.gz"
$updateArchive = Join-Path $stageRoot "tahosapp-updates-$releaseId.tar.gz"
$remoteHost = '188.191.107.157'
$remoteUser = 'tahosdeploy'
$sshKey = 'C:\Users\User\.ssh\tahosapp_deploy_ed25519'
$knownHosts = 'C:\Users\User\.ssh\tahosapp_known_hosts'

if (-not $stageRoot.StartsWith($deployBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Gecici dagitim klasoru proje sinirlari disinda.'
}

if (-not (Test-Path -LiteralPath $sshKey -PathType Leaf)) {
  throw "SSH anahtari bulunamadi: $sshKey"
}

$resolvedInstaller = ''
$resolvedUpdateManifest = ''
$resolvedInstallerBlockmap = ''
if ($InstallerPath) {
  $resolvedInstaller = [IO.Path]::GetFullPath($InstallerPath)
  if (-not (Test-Path -LiteralPath $resolvedInstaller -PathType Leaf) -or [IO.Path]::GetExtension($resolvedInstaller) -ne '.exe') {
    throw 'Gecerli bir Windows .exe kurulum dosyasi secmelisin.'
  }
  $resolvedUpdateManifest = Join-Path (Split-Path -Parent $resolvedInstaller) 'latest.yml'
  $resolvedInstallerBlockmap = "$resolvedInstaller.blockmap"
  if (-not (Test-Path -LiteralPath $resolvedUpdateManifest -PathType Leaf)) {
    throw 'Otomatik guncelleme manifesti bulunamadi: release/latest.yml'
  }
  if (-not (Test-Path -LiteralPath $resolvedInstallerBlockmap -PathType Leaf)) {
    throw 'Otomatik guncelleme blockmap dosyasi bulunamadi.'
  }
}

if (-not $AllowDirty) {
  $changes = & git -C $repoRoot status --porcelain
  if ($LASTEXITCODE -ne 0) { throw 'Git durumu okunamadi.' }
  if ($changes) {
    throw "Kaydedilmemis degisiklikler var. Once git add/commit yap veya bilincli olarak -AllowDirty kullan."
  }
}

if (-not $SkipBuild) {
  & npm.cmd --prefix $repoRoot run build:frontend
  if ($LASTEXITCODE -ne 0) { throw 'Web uygulamasi derlenemedi.' }
}

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'frontend\dist\index.html'))) {
  throw 'frontend/dist bulunamadi. Dagitimdan once web derlemesi gerekli.'
}

New-Item -ItemType Directory -Path $webStage -Force | Out-Null
$siteSource = Join-Path $repoRoot 'deployment\site'
if (-not (Test-Path -LiteralPath (Join-Path $siteSource 'index.html') -PathType Leaf)) {
  throw 'Tanitim sitesi kaynagi bulunamadi: deployment/site'
}
Get-ChildItem -LiteralPath $siteSource -Force | Copy-Item -Destination $webStage -Recurse -Force
$packageVersion = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($resolvedInstaller) {
  $expectedInstallerName = "tahosapp-Setup-$packageVersion.exe"
  if ((Split-Path -Leaf $resolvedInstaller) -cne $expectedInstallerName) {
    throw "Kurulum dosyasi proje surumuyle eslesmiyor. Beklenen: $expectedInstallerName"
  }
  $manifestText = Get-Content -LiteralPath $resolvedUpdateManifest -Raw -Encoding UTF8
  if ($manifestText -notmatch "(?m)^version:\s*['`"]?$([regex]::Escape($packageVersion))['`"]?\s*$") {
    throw 'latest.yml proje surumuyle eslesmiyor.'
  }
  if ($manifestText -notmatch [regex]::Escape($expectedInstallerName)) {
    throw 'latest.yml secilen kurulum dosyasini gostermiyor.'
  }
}
$stagedLandingPage = Join-Path $webStage 'index.html'
$landingHtml = Get-Content -LiteralPath $stagedLandingPage -Raw -Encoding UTF8
$middleDot = [char]0x00B7
# Keep this expression ASCII-only. Windows PowerShell 5.1 may decode a UTF-8
# script without a BOM using the active ANSI code page, which previously made
# the literal middle-dot fail to match and left the old version on the site.
$landingHtml = [regex]::Replace(
  $landingHtml,
  'v\d+\.\d+\.\d+\s+[^A-Za-z0-9<]+\s+Windows',
  "v$packageVersion $middleDot Windows"
)
$landingHtml = [regex]::Replace(
  $landingHtml,
  '"softwareVersion"\s*:\s*"\d+\.\d+\.\d+"',
  ('"softwareVersion": "' + $packageVersion + '"')
)
[IO.File]::WriteAllText($stagedLandingPage, $landingHtml, [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $repoRoot 'installer\tahosapp.ico') -Destination (Join-Path $webStage 'tahosapp.ico')
Copy-Item -LiteralPath (Join-Path $repoRoot 'frontend\dist') -Destination (Join-Path $webStage 'app') -Recurse

& tar.exe -czf $backendArchive -C (Join-Path $repoRoot 'backend') package.json package-lock.json src
if ($LASTEXITCODE -ne 0) { throw 'Backend arsivi olusturulamadi.' }
& tar.exe -czf $webArchive -C $webStage .
if ($LASTEXITCODE -ne 0) { throw 'Web arsivi olusturulamadi.' }
if ($resolvedInstaller) {
  $updateStage = Join-Path $stageRoot 'updates'
  New-Item -ItemType Directory -Path $updateStage -Force | Out-Null
  Copy-Item -LiteralPath $resolvedInstaller -Destination (Join-Path $updateStage (Split-Path -Leaf $resolvedInstaller))
  Copy-Item -LiteralPath $resolvedInstallerBlockmap -Destination (Join-Path $updateStage (Split-Path -Leaf $resolvedInstallerBlockmap))
  Copy-Item -LiteralPath $resolvedUpdateManifest -Destination (Join-Path $updateStage 'latest.yml')
  & tar.exe -czf $updateArchive -C $updateStage .
  if ($LASTEXITCODE -ne 0) { throw 'Otomatik guncelleme arsivi olusturulamadi.' }
}

$sshOptions = @(
  '-i', $sshKey,
  '-o', "UserKnownHostsFile=$knownHosts",
  '-o', 'StrictHostKeyChecking=yes',
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=20',
  '-o', 'ServerAliveInterval=15',
  '-o', 'ServerAliveCountMax=6'
)
$remote = "${remoteUser}@${remoteHost}"
$remoteBackend = "/tmp/$(Split-Path -Leaf $backendArchive)"
$remoteWeb = "/tmp/$(Split-Path -Leaf $webArchive)"
$remoteScript = "/tmp/tahosapp-server-deploy-$releaseId.sh"
$remoteCaddyFile = "/tmp/tahosapp-Caddyfile-$releaseId"
$remoteUpdateArchive = '-'
$remoteInstallerName = '-'
$stagedRemoteScript = Join-Path $stageRoot "tahosapp-server-deploy-$releaseId.sh"
$stagedCaddyFile = Join-Path $stageRoot "tahosapp-Caddyfile-$releaseId"
Copy-Item -LiteralPath (Join-Path $repoRoot 'deployment\tahosapp-server-deploy.sh') -Destination $stagedRemoteScript
Copy-Item -LiteralPath (Join-Path $repoRoot 'deployment\Caddyfile') -Destination $stagedCaddyFile
$uploadFiles = @($backendArchive, $webArchive, $stagedRemoteScript, $stagedCaddyFile)
$updateParts = @()

if ($resolvedInstaller) {
  $remoteUpdateArchive = "/tmp/$(Split-Path -Leaf $updateArchive)"
  $remoteInstallerName = Split-Path -Leaf $resolvedInstaller
  $updateParts = Split-UploadFile -SourcePath $updateArchive -DestinationDirectory $stageRoot
}

# Upload all artifacts over one SSH connection. Some VPS network protections
# throttle several rapid SCP/SSH handshakes and used to block the final
# activation connection even though every archive had already arrived.
& scp @sshOptions @uploadFiles "${remote}:/tmp/"
if ($LASTEXITCODE -ne 0) { throw 'Dagitim dosyalari sunucuya yuklenemedi.' }

foreach ($updatePart in $updateParts) {
  $uploaded = $false
  for ($attempt = 1; $attempt -le 3 -and -not $uploaded; $attempt++) {
    & scp @sshOptions -l 24000 $updatePart "${remote}:/tmp/"
    if ($LASTEXITCODE -eq 0) {
      $uploaded = $true
    } elseif ($attempt -lt 3) {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $uploaded) {
    throw "Otomatik guncelleme parcasi yuklenemedi: $(Split-Path -Leaf $updatePart)"
  }
}

$remotePrepare = ''
if ($updateParts.Count -gt 0) {
  $remotePrepare = "cat $remoteUpdateArchive.part* > $remoteUpdateArchive && "
}
& ssh @sshOptions $remote "${remotePrepare}sudo bash $remoteScript $releaseId $remoteBackend $remoteWeb $remoteUpdateArchive $remoteInstallerName $remoteCaddyFile"
if ($LASTEXITCODE -ne 0) { throw 'Sunucu saglik kontrolu basarisiz oldu; onceki surum korunuyor.' }

Write-Host ''
Write-Host "Yayin tamamlandi: $releaseId" -ForegroundColor Green
Write-Host 'Web: https://tahosapp.com.tr'
Write-Host 'Uygulama: https://tahosapp.com.tr/app/'
