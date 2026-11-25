$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" } }

if (-not (Test-Path '.venv/Scripts/python.exe')) { python -m venv .venv; Check-Exit }
& .venv/Scripts/python.exe -m pip install -r requirements-build.txt; Check-Exit
npm ci --omit=dev --ignore-scripts --no-audit --no-fund; Check-Exit
$ffmpeg = (Get-Command ffmpeg.exe -ErrorAction Stop).Source
$ffprobe = Join-Path (Split-Path $ffmpeg) 'ffprobe.exe'
if (-not (Test-Path $ffprobe)) { throw 'ffprobe.exe must be beside ffmpeg.exe.' }
New-Item -ItemType Directory -Force bin | Out-Null
foreach ($entry in @(@((Get-Command node.exe).Source, 'bin/node.exe'), @($ffmpeg, 'bin/ffmpeg.exe'), @($ffprobe, 'bin/ffprobe.exe'))) {
    if ([IO.Path]::GetFullPath($entry[0]) -ne [IO.Path]::GetFullPath($entry[1])) { Copy-Item $entry[0] $entry[1] -Force }
}
& .venv/Scripts/python.exe -m unittest discover -s tests -v; Check-Exit
& .venv/Scripts/python.exe -m PyInstaller --noconfirm --onefile --windowed --name 'Sound Sticker Studio' --distpath . app.py; Check-Exit
Write-Host 'Build complete. Keep the EXE, backend.cjs, src, node_modules, and bin together.'
