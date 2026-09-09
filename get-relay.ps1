# get-relay.ps1 - one-time download of the RTMP relay binaries into bin\
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File get-relay.ps1
#
# Downloads MediaMTX (RTMP ingest + recording) and ffmpeg (passthrough egress
# push) as single portable .exe files. Nothing is installed. Needs internet
# once. Re-run with -Force to re-download.
#
# Result:
#   bin\mediamtx\mediamtx.exe
#   bin\ffmpeg\ffmpeg.exe
#
# ASCII-only on purpose (PowerShell 5.1 reads a BOM-less script as ANSI).

param([switch]$Force)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# --- pinned versions ---------------------------------------------------------
$MtxVersion = 'v1.21.0'
$MtxZip     = "mediamtx_${MtxVersion}_windows_amd64.zip"
$MtxBase    = "https://github.com/bluenviron/mediamtx/releases/download/$MtxVersion"

$FfTag  = 'latest'
$FfZip  = 'ffmpeg-n9.0-latest-win64-gpl-9.0.zip'
$FfBase = "https://github.com/BtbN/FFmpeg-Builds/releases/download/$FfTag"
# ---------------------------------------------------------------------------

$tmp = Join-Path $env:TEMP ("cglive-relay-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

function Get-File($url, $dest) {
  Write-Host "  downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
}

# Verify $file against a line in a `sha256  *name` checksums file.
function Assert-Checksum($file, $sumsFile, $name) {
  $want = (Get-Content -LiteralPath $sumsFile |
           Where-Object { $_ -match [regex]::Escape($name) } |
           Select-Object -First 1) -replace '\s.*$', ''
  if (-not $want) { throw "no checksum for $name in $sumsFile" }
  $got = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
  if ($got -ne $want.ToUpper()) {
    throw "checksum mismatch for $name`n  expected $want`n  got      $got"
  }
  Write-Host "  checksum OK  $name"
}

function Install-Tool($name, $zipName, $baseUrl, $exeInZip, $outDir) {
  $exe = Join-Path $outDir "$exeInZip"
  if ((Test-Path $exe) -and -not $Force) {
    Write-Host "  $name already present ($exe) - skip (use -Force to redo)"
    return
  }
  $zip  = Join-Path $tmp $zipName
  $sums = Join-Path $tmp "$name.sha256"
  Get-File "$baseUrl/$zipName" $zip
  Get-File "$baseUrl/checksums.sha256" $sums
  Assert-Checksum $zip $sums $zipName

  $ext = Join-Path $tmp "$name-x"
  Expand-Archive -LiteralPath $zip -DestinationPath $ext -Force
  $src = Get-ChildItem -LiteralPath $ext -Recurse -Filter $exeInZip | Select-Object -First 1
  if (-not $src) { throw "$exeInZip not found inside $zipName" }

  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  Copy-Item -LiteralPath $src.FullName -Destination $exe -Force
  Write-Host "  installed -> $exe"
}

try {
  Write-Host "MediaMTX $MtxVersion"
  Install-Tool 'mediamtx' $MtxZip $MtxBase 'mediamtx.exe' (Join-Path $PSScriptRoot 'bin\mediamtx')

  Write-Host "ffmpeg ($FfZip)"
  Install-Tool 'ffmpeg' $FfZip $FfBase 'ffmpeg.exe' (Join-Path $PSScriptRoot 'bin\ffmpeg')

  if (-not (Test-Path (Join-Path $PSScriptRoot 'mediamtx.yml'))) {
    Copy-Item (Join-Path $PSScriptRoot 'mediamtx.example.yml') (Join-Path $PSScriptRoot 'mediamtx.yml')
    Write-Host "created mediamtx.yml from template"
  }

  Write-Host ""
  Write-Host "Done. Next:"
  Write-Host "  1) edit mediamtx.yml  (the two passwords in authInternalUsers)"
  Write-Host "  2) setup.bat          (opens firewall for RTMP port 1935)"
  Write-Host "  3) start.bat          (launches the relay + the CG server)"
  Write-Host "  4) /control -> settings -> 'RTMP relay' card: copy the URLs into OBS"
}
finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
