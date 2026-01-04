
Add-Type -AssemblyName System.Drawing

$src = 'C:/Users/Admin/.gemini/antigravity/brain/abce3888-18b8-4960-8f62-9b74d243c2db/podcast_supersymmetry_16_9_extended_1767503009344.png'
$dest = 'C:\Cursor AI\podcast_supersymmetry_1280x720.png'

if (-not (Test-Path $src)) {
    Write-Error "Source file not found: $src"
    exit 1
}

$img = [System.Drawing.Image]::FromFile($src)
Write-Host "Loaded image. Type: $($img.GetType().FullName), Size: $($img.Width)x$($img.Height)"

$cw = 1024
$ch = 576
$tw = 1280
$th = 720

# Create destination bitmap
$res = New-Object System.Drawing.Bitmap($tw, $th)
$g = [System.Drawing.Graphics]::FromImage($res)

# High quality interpolation
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

try {
    # Calculations with explicit int casting
    $yOffset = [int](($img.Height - $ch) / 2)
    Write-Host "Y Offset: $yOffset"

    # Draw the cropped and resized image
    $srcRect = New-Object System.Drawing.Rectangle(0, $yOffset, $cw, $ch)
    $destRect = New-Object System.Drawing.Rectangle(0, 0, $tw, $th)
    
    # Using explicit overload parameters if needed, but Rect, Rect, Unit is standard
    $g.DrawImage($img, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    
    $res.Save($dest)
    Write-Host "Success: Image saved to $dest"
}
catch {
    Write-Error "Error during processing: $_"
}
finally {
    if ($g) { $g.Dispose() }
    if ($res) { $res.Dispose() }
    if ($img) { $img.Dispose() }
}
