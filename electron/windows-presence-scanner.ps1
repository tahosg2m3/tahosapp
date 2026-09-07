param(
  [ValidateRange(2, 120)]
  [int]$IntervalSeconds = 3
)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Limit-Text([object]$Value, [int]$MaximumLength) {
  $text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($text)) { return '' }
  $text = ($text -replace '[\x00-\x1F\x7F]', ' ' -replace '\s+', ' ').Trim()
  if ($text.Length -gt $MaximumLength) { return $text.Substring(0, $MaximumLength) }
  return $text
}

$mediaManager = $null
$asTaskMethod = $null
$mediaPropertiesType = $null
$mediaManagerType = $null
$mediaError = ''

function Initialize-MediaManager {
  try {
    if ($null -eq $asTaskMethod) {
      Add-Type -AssemblyName System.Runtime.WindowsRuntime
      $script:asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
          $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
        } |
        Select-Object -First 1
      $script:mediaManagerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
      $script:mediaPropertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
    }
    $managerOperation = $mediaManagerType::RequestAsync()
    $managerTask = $asTaskMethod.MakeGenericMethod($mediaManagerType).Invoke($null, @($managerOperation))
    $managerTask.Wait()
    $script:mediaManager = $managerTask.Result
    $script:mediaError = ''
  } catch {
    $script:mediaManager = $null
    $script:mediaError = Limit-Text $_.Exception.GetBaseException().Message 240
  }
}

Initialize-MediaManager
$cachedProcesses = @()
$processScanCountdown = 0

while ($true) {
  $mediaSessions = @()
  if ($null -eq $mediaManager) { Initialize-MediaManager }
  if ($null -ne $mediaManager -and $null -ne $asTaskMethod -and $null -ne $mediaPropertiesType) {
    try {
      $currentSession = $mediaManager.GetCurrentSession()
      $currentSourceId = if ($null -ne $currentSession) { [string]$currentSession.SourceAppUserModelId } else { '' }

      foreach ($session in $mediaManager.GetSessions()) {
        try {
          $propertiesOperation = $session.TryGetMediaPropertiesAsync()
          $propertiesTask = $asTaskMethod.MakeGenericMethod($mediaPropertiesType).Invoke($null, @($propertiesOperation))
          $propertiesTask.Wait()
          $properties = $propertiesTask.Result
          $playback = $session.GetPlaybackInfo()
          $timeline = $session.GetTimelineProperties()
          $title = Limit-Text $properties.Title 160
          if ([string]::IsNullOrWhiteSpace($title)) { continue }

          $durationMs = [Math]::Max(0, [int64]$timeline.EndTime.TotalMilliseconds)
          $positionMs = [Math]::Max(0, [int64]$timeline.Position.TotalMilliseconds)
          # Bazı tarayıcılar Position değerini seyrek günceller. Windows'un
          # LastUpdatedTime alanından geçen süreyi ekleyerek saniye sayacının
          # geriye sıçramasını ve birkaç saniye geriden gelmesini önle.
          if ([string]$playback.PlaybackStatus -eq 'Playing') {
            try {
              $updatedAt = [DateTimeOffset]$timeline.LastUpdatedTime
              $ageMs = [Math]::Max(0, [Math]::Min(60000, ([DateTimeOffset]::UtcNow - $updatedAt).TotalMilliseconds))
              $positionMs = [int64]($positionMs + $ageMs)
            } catch {}
          }
          if ($durationMs -gt 0) { $positionMs = [Math]::Min($positionMs, $durationMs) }

          $mediaSessions += [PSCustomObject]@{
            sourceId = Limit-Text $session.SourceAppUserModelId 200
            title = $title
            artist = Limit-Text $properties.Artist 160
            album = Limit-Text $properties.AlbumTitle 160
            playbackType = Limit-Text $properties.PlaybackType 32
            playbackStatus = Limit-Text $playback.PlaybackStatus 32
            positionMs = [int64]$positionMs
            durationMs = [int64]$durationMs
            isCurrent = ([string]$session.SourceAppUserModelId -eq $currentSourceId)
          }
        } catch {
          continue
        }
      }
    } catch {
      $mediaSessions = @()
      $mediaManager = $null
      $mediaError = Limit-Text $_.Exception.GetBaseException().Message 240
    }
  }

  if ($processScanCountdown -le 0) {
    $cachedProcesses = @()
    foreach ($process in (Get-Process | Select-Object -First 500)) {
      try {
        $title = Limit-Text $process.MainWindowTitle 240
        $executablePath = Limit-Text $process.Path 520
        if ([string]::IsNullOrWhiteSpace($title) -and [string]::IsNullOrWhiteSpace($executablePath)) { continue }

        $startedAt = 0
        try { $startedAt = [DateTimeOffset]$process.StartTime; $startedAt = $startedAt.ToUnixTimeMilliseconds() } catch { $startedAt = 0 }
        $cachedProcesses += [PSCustomObject]@{
          id = [int]$process.Id
          name = Limit-Text $process.ProcessName 120
          title = $title
          path = $executablePath
          hasWindow = ([int64]$process.MainWindowHandle -ne 0)
          startedAt = [int64]$startedAt
        }
      } catch {
        continue
      }
    }
    $processScanCountdown = 2
  } else {
    $processScanCountdown--
  }

  [PSCustomObject]@{
    generatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    mediaAvailable = ($null -ne $mediaManager)
    mediaError = $mediaError
    media = @($mediaSessions)
    processes = @($cachedProcesses)
  } | ConvertTo-Json -Compress -Depth 5

  Start-Sleep -Seconds $IntervalSeconds
}
