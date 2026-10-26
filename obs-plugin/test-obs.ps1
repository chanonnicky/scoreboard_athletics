param([Parameter(Mandatory=$true)][string]$ObsRoot)
$ErrorActionPreference = 'Stop'
$ObsRoot = (Resolve-Path -LiteralPath $ObsRoot).Path
$bin = Join-Path $ObsRoot 'bin/64bit'
$build = Join-Path $PSScriptRoot '.build/windows/RelWithDebInfo'
if (!(Test-Path -LiteralPath "$bin/obs.dll")) { throw 'Expected OBS root with bin/64bit/obs.dll' }
$env:PATH = "$bin;$env:PATH"
$env:QT_PLUGIN_PATH = $bin
$env:CG_FONT_DIR = Join-Path $PSScriptRoot 'data/fonts'
$env:CG_TEST_OUTPUT = Join-Path $PSScriptRoot 'test-output'
New-Item -ItemType Directory -Force $env:CG_TEST_OUTPUT | Out-Null
$version = (Get-Item -LiteralPath "$bin/obs64.exe").VersionInfo.ProductVersion
& "$build/cg-obs-tests.exe" "$build/cg-native-smoke.dll" "$ObsRoot/data/libobs" "$bin/libobs-d3d11.dll" 2>&1 | Tee-Object "$env:CG_TEST_OUTPUT/obs-$version.log"
if ($LASTEXITCODE -ne 0) { throw "OBS $version integration test failed" }
