# pack.ps1 - Build a clean Chrome Web Store ZIP (runtime files only).
#
# Usage:  powershell -ExecutionPolicy Bypass -File tools\pack.ps1
# Output: dist\GestureSeek-v<version>.zip
#
# Notes:
# - Excludes dev-only files (tests, tools, docs, node_modules, git metadata,
#   package.json) - the store package must contain only what the extension
#   actually loads at runtime.
# - Ships only the SIMD wasm runtime (vision_wasm_internal.*). Every Chrome
#   build that can install MV3 extensions supports wasm SIMD, so the nosimd
#   and module variants (~22 MB combined) are dead weight in the package.
# - Ships only gesture_recognizer.task (the active ENGINE). The HandLandmarker
#   fallback model stays in the repo for development; re-add it here if the
#   ENGINE constant in camera.js is ever flipped to "landmarker".

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$version = $manifest.version

$staging = Join-Path ([System.IO.Path]::GetTempPath()) "gestureseek-pack"
$dist = Join-Path $root "dist"

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null
New-Item -ItemType Directory -Force -Path $dist | Out-Null

# Top-level runtime files
$files = @(
  "manifest.json", "content.js", "gesture-core.js", "i18n.js",
  "camera.html", "camera.js", "popup.html", "popup.js", "LICENSE"
)
foreach ($f in $files) { Copy-Item (Join-Path $root $f) $staging }

# Icons
Copy-Item (Join-Path $root "icons") (Join-Path $staging "icons") -Recurse

# Model: only the engine actually in use (see note above)
New-Item -ItemType Directory -Path (Join-Path $staging "models") | Out-Null
Copy-Item (Join-Path $root "models\gesture_recognizer.task") (Join-Path $staging "models")

# MediaPipe runtime: the ES bundle + SIMD wasm only
New-Item -ItemType Directory -Path (Join-Path $staging "lib\wasm") -Force | Out-Null
Copy-Item (Join-Path $root "lib\vision_bundle.mjs") (Join-Path $staging "lib")
Copy-Item (Join-Path $root "lib\wasm\vision_wasm_internal.js") (Join-Path $staging "lib\wasm")
Copy-Item (Join-Path $root "lib\wasm\vision_wasm_internal.wasm") (Join-Path $staging "lib\wasm")

$zip = Join-Path $dist ("GestureSeek-v" + $version + ".zip")
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zip

$sizeMb = "{0:N1}" -f ((Get-Item $zip).Length / 1MB)
Write-Host "Packed $zip ($sizeMb MB)"
Remove-Item $staging -Recurse -Force
