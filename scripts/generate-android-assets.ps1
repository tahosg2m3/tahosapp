param(
  [string]$Source = "deployment/site/assets/tahosapp-icon.png"
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repoRoot $Source
$resRoot = Join-Path $repoRoot 'android/app/src/main/res'
$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)

function Write-CanvasImage {
  param(
    [string]$Target,
    [int]$Width,
    [int]$Height,
    [double]$Scale,
    [bool]$Transparent = $false
  )

  $bitmap = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.Clear($(if ($Transparent) { [System.Drawing.Color]::Transparent } else { [System.Drawing.Color]::FromArgb(255, 15, 23, 42) }))
    $size = [int]([Math]::Min($Width, $Height) * $Scale)
    $x = [int](($Width - $size) / 2)
    $y = [int](($Height - $size) / 2)
    $graphics.DrawImage($sourceImage, $x, $y, $size, $size)
    $bitmap.Save($Target, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

try {
  $legacySizes = @{ mdpi = 48; hdpi = 72; xhdpi = 96; xxhdpi = 144; xxxhdpi = 192 }
  $foregroundSizes = @{ mdpi = 108; hdpi = 162; xhdpi = 216; xxhdpi = 324; xxxhdpi = 432 }
  foreach ($density in $legacySizes.Keys) {
    $directory = Join-Path $resRoot "mipmap-$density"
    Write-CanvasImage (Join-Path $directory 'ic_launcher.png') $legacySizes[$density] $legacySizes[$density] 0.88
    Write-CanvasImage (Join-Path $directory 'ic_launcher_round.png') $legacySizes[$density] $legacySizes[$density] 0.88
    Write-CanvasImage (Join-Path $directory 'ic_launcher_foreground.png') $foregroundSizes[$density] $foregroundSizes[$density] 0.68 $true
  }

  Get-ChildItem $resRoot -Directory | Where-Object Name -Like 'drawable*' | ForEach-Object {
    $target = Join-Path $_.FullName 'splash.png'
    if (Test-Path $target) {
      $current = [System.Drawing.Image]::FromFile($target)
      try { $width = $current.Width; $height = $current.Height } finally { $current.Dispose() }
      Write-CanvasImage $target $width $height 0.34
    }
  }
} finally {
  $sourceImage.Dispose()
}
