[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$installerRoot = Join-Path $repoRoot 'installer'
$iconPath = Join-Path $repoRoot 'electron\assets\tahosapp-icon.png'

function New-TahosappBitmap {
  param(
    [Parameter(Mandatory = $true)][int]$Width,
    [Parameter(Mandatory = $true)][int]$Height,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [switch]$Sidebar
  )

  $bitmap = New-Object Drawing.Bitmap($Width, $Height, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  try {
    $bounds = New-Object Drawing.Rectangle(0, 0, $Width, $Height)
    $gradient = New-Object Drawing.Drawing2D.LinearGradientBrush(
      $bounds,
      [Drawing.Color]::FromArgb(18, 24, 47),
      [Drawing.Color]::FromArgb(7, 10, 20),
      52
    )
    $graphics.FillRectangle($gradient, $bounds)
    $gradient.Dispose()

    $violet = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(75, 99, 80, 255))
    $cyan = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(46, 24, 215, 220))
    $graphics.FillEllipse($violet, -38, -35, [Math]::Max(95, $Width), [Math]::Max(95, $Width))
    $graphics.FillEllipse($cyan, [Math]::Max(20, $Width - 68), [Math]::Max(15, $Height - 95), 105, 105)
    $violet.Dispose()
    $cyan.Dispose()

    $icon = [Drawing.Image]::FromFile($iconPath)
    try {
      if ($Sidebar) {
        $graphics.DrawImage($icon, 38, 52, 88, 88)
        $white = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(247, 248, 255))
        $muted = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(169, 175, 201))
        $brandFont = New-Object Drawing.Font('Segoe UI', 17, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
        $tagFont = New-Object Drawing.Font('Segoe UI', 8, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
        $graphics.DrawString('tahosapp', $brandFont, $white, 35, 156)
        $graphics.DrawString('BAĞLAN  •  KONUŞ', $tagFont, $muted, 30, 190)
        $graphics.DrawString('PAYLAŞ', $tagFont, $muted, 61, 204)
        $white.Dispose(); $muted.Dispose(); $brandFont.Dispose(); $tagFont.Dispose()
      } else {
        $graphics.DrawImage($icon, $Width - 55, 7, 44, 44)
      }
    } finally {
      $icon.Dispose()
    }

    $bitmap.Save($OutputPath, [Drawing.Imaging.ImageFormat]::Bmp)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

New-TahosappBitmap -Width 164 -Height 314 -OutputPath (Join-Path $installerRoot 'installer-sidebar.bmp') -Sidebar
New-TahosappBitmap -Width 150 -Height 57 -OutputPath (Join-Path $installerRoot 'installer-header.bmp')
Write-Host "Installer artwork generated in $installerRoot" -ForegroundColor Green
