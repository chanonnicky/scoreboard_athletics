param([string]$Generator = '', [switch]$SkipConfigure, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (!(Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio Build Tools with Desktop development with C++.' }
$vs = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json | ConvertFrom-Json)[0]
if (!$vs) { throw 'No C++ toolchain found.' }
$cmake = Join-Path $vs.installationPath 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
if (!(Test-Path -LiteralPath $cmake)) { $cmake = (Get-Command cmake -ErrorAction Stop).Source }
$ctest = Join-Path (Split-Path $cmake) 'ctest.exe'
if (!$Generator) { if ([version]$vs.installationVersion -ge [version]'18.0') { $Generator = 'Visual Studio 18 2026' } else { $Generator = 'Visual Studio 17 2022' } }
function Run-CMake { & $cmake @args; if ($LASTEXITCODE -ne 0) { throw "CMake failed ($LASTEXITCODE)" } }
if (!$SkipConfigure) { Run-CMake @('-S','.', '-B','.build/windows','-G',$Generator,'-A','x64','-DBUILD_TESTING=ON') }
if (!$SkipBuild) { Run-CMake @('--build','.build/windows','--config','RelWithDebInfo','--parallel') }
$spec = Get-Content buildspec.json -Raw | ConvertFrom-Json
$qt = Join-Path $PSScriptRoot ".deps/obs-deps-qt6-$($spec.dependencies.qt6.version)-x64"
$deps = Join-Path $PSScriptRoot ".deps/obs-deps-$($spec.dependencies.prebuilt.version)-x64"
$env:PATH = "$qt/bin;$deps/bin;$env:PATH"
$env:QT_PLUGIN_PATH = "$qt/plugins"
$env:CG_TEST_OUTPUT = Join-Path $PSScriptRoot 'test-output'
& $ctest --test-dir .build/windows -C RelWithDebInfo --output-on-failure
if ($LASTEXITCODE -ne 0) { throw 'Native tests failed; packages were not generated.' }
Run-CMake @('--install','.build/windows','--config','RelWithDebInfo','--prefix',"$PSScriptRoot/dist/windows")
$normal = Join-Path $PSScriptRoot 'dist/windows/cg-live-native'
Copy-Item README.md,LICENSE,THIRD-PARTY.md,VALIDATION.md -Destination $normal
$portable = Join-Path $PSScriptRoot 'dist/portable'
New-Item -ItemType Directory -Force "$portable/obs-plugins/64bit","$portable/data/obs-plugins/cg-live-native" | Out-Null
Copy-Item "$normal/bin/64bit/cg-live-native.dll" "$portable/obs-plugins/64bit/"
Copy-Item "$normal/data/*" "$portable/data/obs-plugins/cg-live-native/" -Recurse -Force
Copy-Item README.md,LICENSE,THIRD-PARTY.md,VALIDATION.md -Destination $portable
Compress-Archive -Path $normal -DestinationPath "dist/cg-live-native-$($spec.version)-windows-x64.zip" -Force
Compress-Archive -Path "$portable/*" -DestinationPath "dist/cg-live-native-$($spec.version)-windows-portable-x64.zip" -Force
Write-Host 'Build + tests complete. Packages: obs-plugin/dist/'
