$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null

Add-Type -AssemblyName System.Drawing

$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

$bg = [System.Drawing.Color]::FromArgb(11, 18, 32) # #0b1220
$g.Clear($bg)

# subtle gradient circle
$rect = New-Object System.Drawing.Rectangle 16, 16, ($size - 32), ($size - 32)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddEllipse($rect)
$brush = New-Object System.Drawing.Drawing2D.PathGradientBrush $path
$brush.CenterColor = [System.Drawing.Color]::FromArgb(90, 59, 130, 246)   # blue
$brush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 34, 197, 94)) # green transparent
$g.FillPath($brush, $path)

# title text
$font = New-Object System.Drawing.Font 'Segoe UI', 56, ([System.Drawing.FontStyle]::Bold)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(234, 240, 255))
$g.DrawString('RAM', $font, $textBrush, ($size / 2), ($size / 2 - 8), $format)
$font.Dispose()

# small subtitle
$font2 = New-Object System.Drawing.Font 'Segoe UI', 22, ([System.Drawing.FontStyle]::Regular)
$textBrush2 = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(190, 234, 240, 255))
$g.DrawString('CLEAN', $font2, $textBrush2, ($size / 2), ($size / 2 + 56), $format)
$font2.Dispose()

$g.Dispose()

$pngPath = Join-Path $assets 'icon.png'
$icoPath = Join-Path $assets 'icon.ico'

$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$hIcon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$fs = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()

$bmp.Dispose()
$icon.Dispose()

Write-Host "Wrote $pngPath"
Write-Host "Wrote $icoPath"

