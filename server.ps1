<#
  CG Live - Character Generator server for the athletics (track) scoreboard.
  Pure Windows PowerShell 5.1 - nothing to install.

    powershell -ExecutionPolicy Bypass -File server.ps1 [-Port 8080] [-Token SECRET]

  Control : http://<ip>:<port>/control
  Overlay : http://<ip>:<port>/overlay   (OBS Browser Source / vMix Web Browser)

  overlay/control auto-fall back to polling (SSE is server.py only).
  NOTE: keep this file ASCII-only - PowerShell 5.1 reads BOM-less scripts as ANSI.
#>
[CmdletBinding()]
param(
  [int]$Port = 8080,
  [string]$Token = $env:CG_TOKEN,
  # binding host: "+" = all interfaces (needs Administrator once / setup.bat).
  # use "localhost" for a quick same-machine test with no elevation.
  [string]$ListenHost = "+"
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$Root        = Split-Path -Parent $MyInvocation.MyCommand.Path
$Public      = Join-Path $Root "public"
$DataDir     = Join-Path $Root "data"
$StatePath   = Join-Path $DataDir "state.json"
$DefaultPath = Join-Path $DataDir "state.default.json"

Add-Type -AssemblyName System.Web.Extensions
$script:JS = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$script:JS.MaxJsonLength = 20971520

$CTypes = @{
  ".html"  = "text/html; charset=utf-8"
  ".css"   = "text/css; charset=utf-8"
  ".js"    = "application/javascript; charset=utf-8"
  ".json"  = "application/json; charset=utf-8"
  ".woff2" = "font/woff2"; ".woff" = "font/woff"; ".ttf" = "font/ttf"
  ".png"   = "image/png"; ".jpg" = "image/jpeg"; ".jpeg" = "image/jpeg"
  ".svg"   = "image/svg+xml"; ".webp" = "image/webp"
  ".ico"   = "image/x-icon"; ".txt" = "text/plain; charset=utf-8"
}

# --------------------------------------------------------------------------- #
#  state
# --------------------------------------------------------------------------- #
function Read-JsonFile($path) {
  $raw = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
  return $script:JS.DeserializeObject($raw)
}

function Load-State {
  $path = if (Test-Path $StatePath) { $StatePath } else { $DefaultPath }
  return Read-JsonFile $path
}

function Save-State {
  $json = $script:JS.Serialize($script:State)
  $tmp = "$StatePath.tmp"
  [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -Force -LiteralPath $tmp -Destination $StatePath
}

function State-Json { return $script:JS.Serialize($script:State) }

# NOTE: build new nodes as plain @{} hashtables. A New-Object Dictionary that is
# then filled via PowerShell's indexer gets an ETS wrapper that JavaScriptSerializer
# chokes on ("circular reference ... PSParameterizedProperty").
function New-Dict { return @{} }

# unique id: timestamp(ms) + counter, so a burst of calls in the same ms
# (e.g. importing many CSV rows) never collides.
$script:IdLast = [long]0
$script:IdSeq  = 0
function New-Id([string]$prefix = "e") {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  if ($now -eq $script:IdLast) { $script:IdSeq++ } else { $script:IdLast = $now; $script:IdSeq = 0 }
  return "${prefix}_${now}_$($script:IdSeq)"
}

# self-heal duplicate/empty event ids on load (keeps the first, renames the rest)
function Dedupe-EventIds {
  $seen = @{}
  $changed = 0
  foreach ($ev in @($script:State["events"])) {
    $id = [string]$ev["id"]
    if ($id -and -not $seen.ContainsKey($id)) { $seen[$id] = $true; continue }
    $new = New-Id "e"
    while ($seen.ContainsKey($new)) { $new = New-Id "e" }
    $ev["id"] = $new
    $seen[$new] = $true
    $changed++
  }
  return $changed
}

# migrate on load: dedupe ids + move legacy single "football" -> "sports" list
function Migrate-State {
  $changed = 0
  if ($script:State["events"]) { $changed += (Dedupe-EventIds) }
  if ($script:State.ContainsKey("football") -and -not $script:State.ContainsKey("sports")) {
    $fb = $script:State["football"]
    $sp = New-Dict
    $sp["key"] = "football"; $sp["name"] = "Football"; $sp["icon"] = ""
    $sp["points"]  = if ($fb -and $fb["points"])  { $fb["points"] }  else { @{ win = 3; draw = 1; loss = 0 } }
    $sp["matches"] = if ($fb -and $fb["matches"]) { $fb["matches"] } else { @() }
    $script:State["sports"] = @($sp)
    [void]$script:State.Remove("football")
    Write-Host "  [migrate] football -> sports"
    $changed++
  }
  if ($changed -gt 0) { Save-State }
}

# --------------------------------------------------------------------------- #
#  commands
# --------------------------------------------------------------------------- #
function Apply-Command($cmd) {
  $action = [string]$cmd["action"]
  $onair  = $script:State["onair"]

  switch ($action) {
    "show" {
      $slot = [string]$cmd["slot"]
      $d = New-Dict
      $d["template"] = $cmd["template"]; $d["eventId"] = $cmd["eventId"]; $d["sport"] = $cmd["sport"]; $d["visible"] = $true
      $onair[$slot] = $d
      # only one slot visible at a time -- hide the others
      foreach ($k in @($onair.Keys)) {
        if ($k -ne $slot -and $onair[$k]) { $onair[$k]["visible"] = $false }
      }
    }
    "hide" {
      $slot = [string]$cmd["slot"]
      if ($onair.ContainsKey($slot)) { $onair[$slot]["visible"] = $false }
    }
    "hideAll" {
      foreach ($k in @($onair.Keys)) { $onair[$k]["visible"] = $false }
    }
    "setResults" {
      $script:State["results"][[string]$cmd["eventId"]] = $cmd["results"]
    }
    "upsertEvent" {
      $ev = $cmd["event"]
      if (-not $ev["id"]) { $ev["id"] = New-Id "e" }
      $events = [System.Collections.ArrayList]@($script:State["events"])
      $idx = -1
      for ($i = 0; $i -lt $events.Count; $i++) {
        if ([string]$events[$i]["id"] -eq [string]$ev["id"]) { $idx = $i; break }
      }
      if ($idx -ge 0) { $events[$idx] = $ev } else { [void]$events.Add($ev) }
      $script:State["events"] = $events.ToArray()
    }
    "deleteEvent" {
      $eid = [string]$cmd["eventId"]
      $script:State["events"] = @($script:State["events"] | Where-Object { [string]$_["id"] -ne $eid })
      if ($script:State["results"].ContainsKey($eid)) { [void]$script:State["results"].Remove($eid) }
      foreach ($k in @($onair.Keys)) {
        if ([string]$onair[$k]["eventId"] -eq $eid) { $onair[$k]["eventId"] = $null; $onair[$k]["visible"] = $false }
      }
    }
    "setTally" { $script:State["tally"] = $cmd["tally"] }
    "addEventPointsToTally" {
      $eid = [string]$cmd["eventId"]
      $pts = $script:State["settings"]["points"]
      $tally = $script:State["tally"]
      if ($script:State["results"].ContainsKey($eid)) {
        foreach ($r in $script:State["results"][$eid]) {
          $rk = [string]$r["rank"]; $hs = [string]$r["house"]
          if ($tally.ContainsKey($hs) -and $pts.ContainsKey($rk)) {
            $tally[$hs] = [int]$tally[$hs] + [int]$pts[$rk]
          }
        }
      }
    }
    "setSettings" {
      $s = $script:State["settings"]
      foreach ($p in $cmd["settings"].Keys) { $s[$p] = $cmd["settings"][$p] }
    }
    "setSport" {
      $sp = $cmd["sport"]
      $sports = [System.Collections.ArrayList]@($script:State["sports"])
      $idx = -1
      for ($i = 0; $i -lt $sports.Count; $i++) {
        if ([string]$sports[$i]["key"] -eq [string]$sp["key"]) { $idx = $i; break }
      }
      if ($idx -ge 0) { $sports[$idx] = $sp } else { [void]$sports.Add($sp) }
      $script:State["sports"] = $sports.ToArray()
    }
    "deleteSport" {
      $key = [string]$cmd["key"]
      $script:State["sports"] = @($script:State["sports"] | Where-Object { [string]$_["key"] -ne $key })
    }
    "resetState" { $script:State = Read-JsonFile $DefaultPath }
    "replaceState" { $script:State = $cmd["state"] }
    default { throw "unknown action: $action" }
  }

  $script:Version++
  Save-State
}

function Import-CsvText($kind, $text) {
  if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
  $rows = @($text | ConvertFrom-Csv)

  if ($kind -eq "events") {
    $events = [System.Collections.ArrayList]@($script:State["events"])
    $seen = 0
    foreach ($row in $rows) {
      $title = ("" + $row.title).Trim()
      if (-not $title) { $title = ("" + $row.event).Trim() }
      if (-not $title) { continue }
      $seen++
      $lvl = ("" + $row.level).Trim()
      if (-not $lvl) { $lvl = ("" + $row.ageGroup).Trim() }
      if (-not $lvl) { $lvl = ("" + $row.age).Trim() }
      $found = $null
      foreach ($e in $events) { if ([string]$e["title"] -eq $title) { $found = $e; break } }
      if ($found) {
        $found["level"] = $lvl
      } else {
        $d = New-Dict
        $d["id"] = New-Id "e"
        $d["title"] = $title; $d["level"] = $lvl
        [void]$events.Add($d)
      }
    }
    $script:State["events"] = $events.ToArray()
    return @{ events = $seen }
  }

  throw "unknown import kind: $kind"
}

# --------------------------------------------------------------------------- #
#  HTTP helpers
# --------------------------------------------------------------------------- #
function Send-Bytes($ctx, [int]$code, [byte[]]$body, [string]$ctype) {
  $res = $ctx.Response
  $res.StatusCode = $code
  $res.ContentType = $ctype
  $res.ContentLength64 = $body.Length
  try { $res.Headers["Cache-Control"] = "no-store" } catch {}
  try { $res.Headers["Access-Control-Allow-Origin"] = "*" } catch {}
  $res.OutputStream.Write($body, 0, $body.Length)
  $res.OutputStream.Close()
}

function Send-Text($ctx, [int]$code, [string]$text, [string]$ctype = "text/plain; charset=utf-8") {
  Send-Bytes $ctx $code ([System.Text.Encoding]::UTF8.GetBytes($text)) $ctype
}

function Serve-File($ctx, $file) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Send-Text $ctx 404 "not found"; return }
  $ext = [System.IO.Path]::GetExtension($file).ToLower()
  $ctype = $CTypes[$ext]; if (-not $ctype) { $ctype = "application/octet-stream" }
  Send-Bytes $ctx 200 ([System.IO.File]::ReadAllBytes($file)) $ctype
}

function Serve-Static($ctx, $path) {
  $rel = $path.TrimStart('/') -replace '/', '\'
  $full = [System.IO.Path]::GetFullPath((Join-Path $Public $rel))
  if (-not $full.StartsWith($Public, [StringComparison]::OrdinalIgnoreCase)) { Send-Text $ctx 403 "forbidden"; return }
  Serve-File $ctx $full
}

function Test-Token($req) {
  if (-not $Token) { return $true }
  $t = $req.Headers["X-Token"]
  if (-not $t) { $t = $req.QueryString["token"] }
  return ($t -eq $Token)
}

function Read-Body($req) {
  $sr = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
  try { return $sr.ReadToEnd() } finally { $sr.Dispose() }
}

function Handle-Request($ctx) {
  $req = $ctx.Request
  $path = $req.Url.AbsolutePath
  $method = $req.HttpMethod

  if ($path -eq "/" -or $path -eq "/home") { Serve-File $ctx (Join-Path $Public "home.html"); return }
  if ($path -eq "/healthz") { Send-Text $ctx 200 "ok"; return }
  # control + score (incl. per-sport score /score/<sport>)
  if ($path -eq "/control" -or $path -eq "/score" -or $path.StartsWith("/score/")) { Serve-File $ctx (Join-Path $Public "control.html"); return }
  # Live overlay (/live is the new name for /overlay)
  if ($path -eq "/overlay" -or $path -eq "/live") { Serve-File $ctx (Join-Path $Public "overlay.html"); return }
  # Scoreboard (/scoreboard rotate, /scoreboard/<sport> live)
  if ($path -eq "/board" -or $path -eq "/scoreboard" -or $path.StartsWith("/scoreboard/")) { Serve-File $ctx (Join-Path $Public "board.html"); return }

  if ($path -eq "/api/state" -and $method -eq "GET") {
    Send-Text $ctx 200 (State-Json) "application/json; charset=utf-8"; return
  }
  if ($path -eq "/api/events") {
    Send-Text $ctx 404 "SSE not supported by server.ps1 - client falls back to polling"; return
  }
  if ($path -eq "/api/command" -and $method -eq "POST") {
    if (-not (Test-Token $req)) { Send-Text $ctx 401 '{"error":"unauthorized"}' "application/json; charset=utf-8"; return }
    try {
      $cmd = $script:JS.DeserializeObject((Read-Body $req))
      Apply-Command $cmd
      Send-Text $ctx 200 '{"ok":true}' "application/json; charset=utf-8"
    } catch {
      Send-Text $ctx 400 ($script:JS.Serialize(@{ error = ("" + $_.Exception.Message) })) "application/json; charset=utf-8"
    }
    return
  }
  if ($path -eq "/api/import" -and $method -eq "POST") {
    if (-not (Test-Token $req)) { Send-Text $ctx 401 '{"error":"unauthorized"}' "application/json; charset=utf-8"; return }
    try {
      $payload = $script:JS.DeserializeObject((Read-Body $req))
      $info = Import-CsvText ([string]$payload["kind"]) ([string]$payload["csv"])
      $script:Version++
      Save-State
      Send-Text $ctx 200 ($script:JS.Serialize(@{ ok = $true; imported = $info })) "application/json; charset=utf-8"
    } catch {
      Send-Text $ctx 400 ($script:JS.Serialize(@{ error = ("" + $_.Exception.Message) })) "application/json; charset=utf-8"
    }
    return
  }

  Serve-Static $ctx $path
}

# --------------------------------------------------------------------------- #
function Get-LanIP {
  try {
    $s = New-Object System.Net.Sockets.Socket('InterNetwork', 'Dgram', 'Udp')
    $s.Connect("8.8.8.8", 80)
    $ip = ([System.Net.IPEndPoint]$s.LocalEndPoint).Address.ToString()
    $s.Close()
    return $ip
  } catch { return "127.0.0.1" }
}

function New-StartedListener([string]$bindHost, [int]$port) {
  $prefix = "http://${bindHost}:$port/"
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add($prefix)
  try {
    $l.Start()
    return $l
  } catch [System.Net.HttpListenerException] {
    if ($bindHost -eq "localhost") { throw }
    Write-Host ""
    Write-Host "  First run needs Administrator once to open port $port ..." -ForegroundColor Yellow
    $acl = "netsh http add urlacl url=http://+:$port/ user=Everyone"
    $fw  = "netsh advfirewall firewall add rule name=" + [char]34 + "CG Live $port" + [char]34 + " dir=in action=allow protocol=TCP localport=$port"
    try {
      Start-Process -Verb RunAs -Wait -FilePath "cmd.exe" -ArgumentList ("/c " + $acl + " & " + $fw)
    } catch {
      throw "Administrator approval is required on first run. Or run setup.bat once, then start again."
    }
    Start-Sleep -Milliseconds 800
    $l2 = New-Object System.Net.HttpListener
    $l2.Prefixes.Add($prefix)
    $l2.Start()
    return $l2
  }
}

# --------------------------------------------------------------------------- #
#  main
# --------------------------------------------------------------------------- #
if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }
$script:State = Load-State
$script:Version = 0
Migrate-State
if (-not (Test-Path $StatePath)) { Save-State }

$listener = New-StartedListener $ListenHost $Port
$ip = Get-LanIP
$bar = "=" * 60
Write-Host $bar
Write-Host " CG Live  -  scoreboard_athletics  (PowerShell)"
Write-Host $bar
Write-Host "  Control   : http://${ip}:$Port/control              (Live control)"
Write-Host "  Score     : http://${ip}:$Port/score                (score: athletics)"
Write-Host "  Score/foot: http://${ip}:$Port/score/football       (score: football)"
Write-Host "  Score/bask: http://${ip}:$Port/score/basketball     (score: basketball)"
Write-Host "  Live      : http://${ip}:$Port/live                 <<  put this in OBS / vMix"
Write-Host "  Scoreboard: http://${ip}:$Port/scoreboard           (rotating display)"
Write-Host "  SB/live   : http://${ip}:$Port/scoreboard/football  (live match score)"
Write-Host "  Local     : http://127.0.0.1:$Port/control"
if ($Token) { Write-Host "  Token   :  $Token" }
Write-Host $bar
Write-Host "  Ctrl+C to stop"
Write-Host $bar

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try { Handle-Request $ctx }
    catch { try { Send-Text $ctx 500 "internal error" } catch {} }
  }
} finally {
  try { $listener.Stop(); $listener.Close() } catch {}
  try { Save-State } catch {}
  Write-Host "`nstate saved - server stopped"
}
