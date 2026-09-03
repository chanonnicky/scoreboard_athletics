<#
  CG Live - Character Generator server for the athletics (track) scoreboard.
  Pure Windows PowerShell 5.1 - nothing to install.

    powershell -ExecutionPolicy Bypass -File server.ps1 [-Port 8080] [-Token SECRET]

  Control : http://<ip>:<port>/control
  Overlay : http://<ip>:<port>/overlay   (OBS Browser Source / vMix Web Browser)

  overlay/control auto-fall back to polling (SSE is server.py only).
  Requests are handled concurrently on a runspace pool (mirrors server.py's
  ThreadingHTTPServer) so one slow client cannot block the others.
  NOTE: keep this file ASCII-only - PowerShell 5.1 reads BOM-less scripts as ANSI.
#>
param(
  [int]$Port = 8080,
  [string]$Token = $env:CG_TOKEN,
  # binding host: "+" = all interfaces (needs Administrator once / setup.bat).
  # use "localhost" for a quick same-machine test with no elevation.
  [string]$ListenHost = "+"
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# Also accept start.sh-style flags so start.bat and start.sh take the same
# arguments:  --port N | --port=N | --host H | --token T   (start.bat forwards %*)
for ($i = 0; $i -lt $args.Count; $i++) {
  $a = [string]$args[$i]
  if ($a -match '^--port=(.+)$')       { $Port = [int]$Matches[1] }
  elseif ($a -match '^--host=(.+)$')   { $ListenHost = $Matches[1] }
  elseif ($a -match '^--token=(.+)$')  { $Token = $Matches[1] }
  elseif ($a -eq '--port'  -and $i + 1 -lt $args.Count) { $i++; $Port = [int]$args[$i] }
  elseif ($a -eq '--host'  -and $i + 1 -lt $args.Count) { $i++; $ListenHost = [string]$args[$i] }
  elseif ($a -eq '--token' -and $i + 1 -lt $args.Count) { $i++; $Token = [string]$args[$i] }
}
if (-not $Port) { $Port = 8080 }

$Root        = Split-Path -Parent $MyInvocation.MyCommand.Path
$Public      = Join-Path $Root "public"
$DataDir     = Join-Path $Root "data"
$StatePath   = Join-Path $DataDir "state.json"
$DefaultPath = Join-Path $DataDir "state.default.json"

# --------------------------------------------------------------------------- #
#  shared, thread-safe state container
#  Every worker runspace gets a reference to this same object. All mutable
#  state lives here (not in per-runspace $script: vars, which are isolated).
# --------------------------------------------------------------------------- #
$G = [hashtable]::Synchronized(@{})
$G.Lock        = New-Object object
$G.State       = $null
$G.Version     = 0
$G.IdLast      = [long]0
$G.IdSeq       = 0
$G.Root        = $Root
$G.Public      = $Public
$G.DataDir     = $DataDir
$G.StatePath   = $StatePath
$G.DefaultPath = $DefaultPath
$G.Token       = $Token
$G.CTypes      = @{
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
#  $Lib - every request-handling function. Dot-sourced once in this (main)
#  runspace for startup, and again inside each worker runspace per request.
#  Functions read/write shared state through $script:G (set by the caller).
# --------------------------------------------------------------------------- #
$Lib = {
  Add-Type -AssemblyName System.Web.Extensions
  $script:JS = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $script:JS.MaxJsonLength = 20971520

  # ----------------------------------------------------------------------- #
  #  state
  # ----------------------------------------------------------------------- #
  function Read-JsonFile($path) {
    $raw = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    return $script:JS.DeserializeObject($raw)
  }

  function Load-State {
    $path = if (Test-Path $script:G.StatePath) { $script:G.StatePath } else { $script:G.DefaultPath }
    return Read-JsonFile $path
  }

  function Save-State {
    $json = $script:JS.Serialize($script:G.State)
    $tmp = "$($script:G.StatePath).tmp"
    [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -Force -LiteralPath $tmp -Destination $script:G.StatePath
  }

  function State-Json {
    [System.Threading.Monitor]::Enter($script:G.Lock)
    try { return $script:JS.Serialize($script:G.State) }
    finally { [System.Threading.Monitor]::Exit($script:G.Lock) }
  }

  # NOTE: build new nodes as plain @{} hashtables. A New-Object Dictionary that is
  # then filled via PowerShell's indexer gets an ETS wrapper that JavaScriptSerializer
  # chokes on ("circular reference ... PSParameterizedProperty").
  function New-Dict { return @{} }

  # unique id: timestamp(ms) + counter, so a burst of calls in the same ms
  # (e.g. importing many CSV rows) never collides. Monitor is re-entrant, so
  # calling this from inside a locked mutation is fine.
  function New-Id([string]$prefix = "e") {
    [System.Threading.Monitor]::Enter($script:G.Lock)
    try {
      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      if ($now -eq $script:G.IdLast) { $script:G.IdSeq = [int]$script:G.IdSeq + 1 }
      else { $script:G.IdLast = $now; $script:G.IdSeq = 0 }
      return "${prefix}_${now}_$($script:G.IdSeq)"
    } finally { [System.Threading.Monitor]::Exit($script:G.Lock) }
  }

  # self-heal duplicate/empty event ids on load (keeps the first, renames the rest)
  function Dedupe-EventIds {
    $seen = @{}
    $changed = 0
    foreach ($ev in @($script:G.State["events"])) {
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
    if ($script:G.State["events"]) { $changed += (Dedupe-EventIds) }
    if ($script:G.State.ContainsKey("football") -and -not $script:G.State.ContainsKey("sports")) {
      $fb = $script:G.State["football"]
      $sp = New-Dict
      $sp["key"] = "football"; $sp["name"] = "Football"; $sp["icon"] = ""
      $sp["points"]  = if ($fb -and $fb["points"])  { $fb["points"] }  else { @{ win = 3; draw = 1; loss = 0 } }
      $sp["matches"] = if ($fb -and $fb["matches"]) { $fb["matches"] } else { @() }
      $script:G.State["sports"] = @($sp)
      [void]$script:G.State.Remove("football")
      Write-Host "  [migrate] football -> sports"
      $changed++
    }
    if ($changed -gt 0) { Save-State }
  }

  # ----------------------------------------------------------------------- #
  #  commands
  # ----------------------------------------------------------------------- #
  function Apply-Command($cmd) {
    [System.Threading.Monitor]::Enter($script:G.Lock)
    try {
      $action = [string]$cmd["action"]
      $onair  = $script:G.State["onair"]

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
          $script:G.State["results"][[string]$cmd["eventId"]] = $cmd["results"]
        }
        "upsertEvent" {
          $ev = $cmd["event"]
          if (-not $ev["id"]) { $ev["id"] = New-Id "e" }
          $events = [System.Collections.ArrayList]@($script:G.State["events"])
          $idx = -1
          for ($i = 0; $i -lt $events.Count; $i++) {
            if ([string]$events[$i]["id"] -eq [string]$ev["id"]) { $idx = $i; break }
          }
          if ($idx -ge 0) { $events[$idx] = $ev } else { [void]$events.Add($ev) }
          $script:G.State["events"] = $events.ToArray()
        }
        "deleteEvent" {
          $eid = [string]$cmd["eventId"]
          $script:G.State["events"] = @($script:G.State["events"] | Where-Object { [string]$_["id"] -ne $eid })
          if ($script:G.State["results"].ContainsKey($eid)) { [void]$script:G.State["results"].Remove($eid) }
          foreach ($k in @($onair.Keys)) {
            if ([string]$onair[$k]["eventId"] -eq $eid) { $onair[$k]["eventId"] = $null; $onair[$k]["visible"] = $false }
          }
        }
        "setTally" { $script:G.State["tally"] = $cmd["tally"] }
        "addEventPointsToTally" {
          $eid = [string]$cmd["eventId"]
          $pts = $script:G.State["settings"]["points"]
          $tally = $script:G.State["tally"]
          if ($script:G.State["results"].ContainsKey($eid)) {
            foreach ($r in $script:G.State["results"][$eid]) {
              $rk = [string]$r["rank"]; $hs = [string]$r["house"]
              if ($tally.ContainsKey($hs) -and $pts.ContainsKey($rk)) {
                $tally[$hs] = [int]$tally[$hs] + [int]$pts[$rk]
              }
            }
          }
        }
        "setSettings" {
          $s = $script:G.State["settings"]
          foreach ($p in $cmd["settings"].Keys) { $s[$p] = $cmd["settings"][$p] }
        }
        "setSport" {
          $sp = $cmd["sport"]
          $sports = [System.Collections.ArrayList]@($script:G.State["sports"])
          $idx = -1
          for ($i = 0; $i -lt $sports.Count; $i++) {
            if ([string]$sports[$i]["key"] -eq [string]$sp["key"]) { $idx = $i; break }
          }
          if ($idx -ge 0) { $sports[$idx] = $sp } else { [void]$sports.Add($sp) }
          $script:G.State["sports"] = $sports.ToArray()
        }
        "deleteSport" {
          $key = [string]$cmd["key"]
          $script:G.State["sports"] = @($script:G.State["sports"] | Where-Object { [string]$_["key"] -ne $key })
        }
        "resetState" { $script:G.State = Read-JsonFile $script:G.DefaultPath }
        "replaceState" { $script:G.State = $cmd["state"] }
        default { throw "unknown action: $action" }
      }

      $script:G.Version = [int]$script:G.Version + 1
      Save-State
    } finally {
      [System.Threading.Monitor]::Exit($script:G.Lock)
    }
  }

  function Import-CsvText($kind, $text) {
    if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
    $rows = @($text | ConvertFrom-Csv)

    if ($kind -ne "events") { throw "unknown import kind: $kind" }

    [System.Threading.Monitor]::Enter($script:G.Lock)
    try {
      $events = [System.Collections.ArrayList]@($script:G.State["events"])
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
      $script:G.State["events"] = $events.ToArray()
      $script:G.Version = [int]$script:G.Version + 1
      Save-State
      return @{ events = $seen }
    } finally {
      [System.Threading.Monitor]::Exit($script:G.Lock)
    }
  }

  # ----------------------------------------------------------------------- #
  #  HTTP helpers
  # ----------------------------------------------------------------------- #
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
    $ctype = $script:G.CTypes[$ext]; if (-not $ctype) { $ctype = "application/octet-stream" }
    Send-Bytes $ctx 200 ([System.IO.File]::ReadAllBytes($file)) $ctype
  }

  function Serve-Static($ctx, $path) {
    $rel = $path.TrimStart('/') -replace '/', '\'
    $full = [System.IO.Path]::GetFullPath((Join-Path $script:G.Public $rel))
    if (-not $full.StartsWith($script:G.Public, [StringComparison]::OrdinalIgnoreCase)) { Send-Text $ctx 403 "forbidden"; return }
    Serve-File $ctx $full
  }

  function Test-Token($req) {
    if (-not $script:G.Token) { return $true }
    $t = $req.Headers["X-Token"]
    if (-not $t) { $t = $req.QueryString["token"] }
    return ($t -eq $script:G.Token)
  }

  function Read-Body($req) {
    $sr = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
    try { return $sr.ReadToEnd() } finally { $sr.Dispose() }
  }

  function Handle-Request($ctx) {
    $req = $ctx.Request
    $path = $req.Url.AbsolutePath
    $method = $req.HttpMethod

    if ($path -eq "/" -or $path -eq "/home") { Serve-File $ctx (Join-Path $script:G.Public "home.html"); return }
    if ($path -eq "/healthz") { Send-Text $ctx 200 "ok"; return }
    # control + score (incl. per-sport score /score/<sport>)
    if ($path -eq "/control" -or $path -eq "/score" -or $path.StartsWith("/score/")) { Serve-File $ctx (Join-Path $script:G.Public "control.html"); return }
    # Live overlay (/live is the new name for /overlay)
    if ($path -eq "/overlay" -or $path -eq "/live") { Serve-File $ctx (Join-Path $script:G.Public "overlay.html"); return }
    # Scoreboard (/scoreboard rotate, /scoreboard/<sport> live)
    if ($path -eq "/board" -or $path -eq "/scoreboard" -or $path.StartsWith("/scoreboard/")) { Serve-File $ctx (Join-Path $script:G.Public "board.html"); return }

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
        Send-Text $ctx 200 ($script:JS.Serialize(@{ ok = $true; imported = $info })) "application/json; charset=utf-8"
      } catch {
        Send-Text $ctx 400 ($script:JS.Serialize(@{ error = ("" + $_.Exception.Message) })) "application/json; charset=utf-8"
      }
      return
    }

    Serve-Static $ctx $path
  }
}

# --------------------------------------------------------------------------- #
#  $Worker - runs on a pool runspace, one invocation per request.
#  A scriptblock passed across runspaces stays bound to its origin session
#  state, so $Lib is handed over as text and rebuilt here with
#  [scriptblock]::Create before dot-sourcing.
# --------------------------------------------------------------------------- #
$Worker = @'
param($ctx, $G, $LibText)
$script:G = $G
. ([scriptblock]::Create($LibText))
try { Handle-Request $ctx }
catch { try { Send-Text $ctx 500 "internal error" } catch {} }
finally { try { $ctx.Response.OutputStream.Close() } catch {} }
'@

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

function Show-PortBusy([int]$port) {
  # http.sys owns the socket, so Get-NetTCPConnection usually reports PID 4 (System);
  # only show a pid when it points at a real user process worth killing.
  $who = $null
  try {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($conn -and $conn.OwningProcess -gt 4) {
      $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
      $who = if ($proc) { "PID $($conn.OwningProcess) - $($proc.ProcessName)" } else { "PID $($conn.OwningProcess)" }
    }
  } catch {}
  Write-Host ""
  if ($who) { Write-Host "  Port $port is already in use ($who)" -ForegroundColor Yellow }
  else      { Write-Host "  Port $port is already in use" -ForegroundColor Yellow }
  Write-Host ""
  Write-Host "  Two ways to fix:"
  Write-Host "    1) use another port:  start.bat --port 9000"
  Write-Host "    2) close the other CG Live window (whatever is holding port $port), then start again"
  Write-Host ""
}

function New-StartedListener([string]$bindHost, [int]$port) {
  $prefix = "http://${bindHost}:$port/"
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add($prefix)
  try {
    $l.Start()
    return $l
  } catch [System.Net.HttpListenerException] {
    # ErrorCode 5 = access denied (first run: no urlacl yet). Anything else here
    # means the port is taken -- show the same friendly message start.sh does.
    if ($_.Exception.ErrorCode -ne 5) { Show-PortBusy $port; exit 1 }
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
    try {
      $l2.Start()
    } catch [System.Net.HttpListenerException] {
      if ($_.Exception.ErrorCode -ne 5) { Show-PortBusy $port; exit 1 }
      throw
    }
    return $l2
  }
}

# --------------------------------------------------------------------------- #
#  main
# --------------------------------------------------------------------------- #
if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }

# load + migrate state in this runspace
$script:G = $G
. $Lib
$LibText = $Lib.ToString()   # handed to each worker runspace (see $Worker)
$G.State = Load-State
Migrate-State
if (-not (Test-Path $StatePath)) { Save-State }

$listener = New-StartedListener $ListenHost $Port

# pool of worker runspaces - requests are handled concurrently
$pool = [runspacefactory]::CreateRunspacePool(1, 16)
$pool.Open()
$pending = New-Object System.Collections.ArrayList

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

    $ps = [powershell]::Create()
    $ps.RunspacePool = $pool
    [void]$ps.AddScript($Worker).AddArgument($ctx).AddArgument($G).AddArgument($LibText)
    $handle = $ps.BeginInvoke()
    [void]$pending.Add([pscustomobject]@{ ps = $ps; handle = $handle })

    # reap finished workers so [powershell] handles don't leak
    for ($i = $pending.Count - 1; $i -ge 0; $i--) {
      if ($pending[$i].handle.IsCompleted) {
        try { $pending[$i].ps.EndInvoke($pending[$i].handle) } catch {}
        $pending[$i].ps.Dispose()
        $pending.RemoveAt($i)
      }
    }
  }
} finally {
  try { $listener.Stop(); $listener.Close() } catch {}
  foreach ($p in $pending) { try { $p.ps.Dispose() } catch {} }
  try { $pool.Close(); $pool.Dispose() } catch {}
  try { Save-State } catch {}
  Write-Host "`nstate saved - server stopped"
}
