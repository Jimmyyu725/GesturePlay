# resize-icons.ps1 - Resize the master icon art into the extension icon set.
#
# Usage:  powershell -ExecutionPolicy Bypass -File tools\resize-icons.ps1
# Input:  assets\store\icon-candidate-a.png (1024x1024, transparent)
# Output: icons\icon{16,32,48,128}.png (32-bit PNG, alpha preserved)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "assets\store\icon-candidate-a.png"
$outDir = Join-Path $root "icons"

$src = [System.Drawing.Bitmap]::new($source)
foreach ($size in 128, 48, 32, 16) {
  $dst = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, 0, 0, $size, $size)
  $g.Dispose()
  $out = Join-Path $outDir ("icon" + $size + ".png")
  $dst.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $dst.Dispose()
  Write-Host ("wrote icons/icon" + $size + ".png")
}
$src.Dispose()
