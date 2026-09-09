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
$DefaultSchoolPath = Join-Path $DataDir "state.default.school.json"
$DefaultGeneralPath = Join-Path $DataDir "state.default.general.json"
$UploadsDir  = Join-Path $DataDir "uploads"

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
$G.DefaultSchoolPath = $DefaultSchoolPath
$G.DefaultGeneralPath = $DefaultGeneralPath
$G.UploadsDir  = $UploadsDir
$G.Token       = $Token
$G.ProfileKeys = @("settings", "events", "results", "onair", "sports", "tally")
# product axis (settings.app): "sports" | "general" -- higher than the mode axis.
# The inactive product parks at State.parkedApp[<app>] (distinct from State.parked
# which is the mode axis and belongs to the sports product's own profile).
$G.Apps = @("sports", "general")
$G.AllProfileKeys = @("settings", "events", "results", "onair", "sports", "tally", "parked", "lowers")
$G.SportsProfileKeys  = @("settings", "events", "results", "onair", "sports", "tally", "parked")
$G.GeneralProfileKeys = @("settings", "onair", "lowers")
$G.CTypes      = @{
  ".html"  = "text/html; charset=utf-8"
  ".css"   = "text/css; charset=utf-8"
  ".js"    = "application/javascript; charset=utf-8"
  ".json"  = "application/json; charset=utf-8"
  ".woff2" = "font/woff2"; ".woff" = "font/woff"; ".ttf" = "font/ttf"
  ".png"   = "image/png"; ".jpg" = "image/jpeg"; ".jpeg" = "image/jpeg"
  ".svg"   = "image/svg+xml"; ".webp" = "image/webp"; ".gif" = "image/gif"
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

  # profile key set / seed path for a product (settings.app)
  function Get-AppProfileKeys([string]$app) {
    if ($app -eq "general") { return $script:G.GeneralProfileKeys }
    return $script:G.SportsProfileKeys
  }
  function Get-AppDefaultPath([string]$app) {
    if ($app -eq "general") { return $script:G.DefaultGeneralPath }
    return $script:G.DefaultPath
  }

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
  #                  + rename the old "football" sport -> "futsal"
  function Migrate-State {
    $changed = 0
    if ($script:G.State["events"]) { $changed += (Dedupe-EventIds) }
    # default mode (every pre-existing state = house/colour mode)
    $st = $script:G.State["settings"]
    if ($st -and -not $st.ContainsKey("mode")) { $st["mode"] = "house"; $changed++ }
    # default product (every pre-existing state = the sports product)
    if ($st -and -not $st.ContainsKey("app")) { $st["app"] = "sports"; $changed++ }
    # This file must stay ASCII-only (see CLAUDE.md), so the Thai sport names are
    # built from Unicode code points:  0E1F 0E38 0E15 0E0B 0E2D 0E25 = "futsal" in Thai,
    #                                  0E1F 0E38 0E15 0E1A 0E2D 0E25 = "football" in Thai.
    $futsalTh   = -join [char[]](0x0E1F,0x0E38,0x0E15,0x0E0B,0x0E2D,0x0E25)
    $footballTh = -join [char[]](0x0E1F,0x0E38,0x0E15,0x0E1A,0x0E2D,0x0E25)
    if ($script:G.State.ContainsKey("football") -and -not $script:G.State.ContainsKey("sports")) {
      $fb = $script:G.State["football"]
      $sp = New-Dict
      $sp["key"] = "futsal"; $sp["name"] = $futsalTh; $sp["icon"] = ""
      $sp["points"]  = if ($fb -and $fb["points"])  { $fb["points"] }  else { @{ win = 3; draw = 1; loss = 0 } }
      $sp["matches"] = if ($fb -and $fb["matches"]) { $fb["matches"] } else { @() }
      $script:G.State["sports"] = @($sp)
      [void]$script:G.State.Remove("football")
      Write-Host "  [migrate] football -> sports"
      $changed++
    }
    # rename legacy sport football -> futsal + force the Thai display name
    # (name fixed independently of key: a state already moved by an older server.ps1
    #  build has key=futsal/name=Futsal and would otherwise never be repaired)
    if ($script:G.State["sports"]) {
      foreach ($sp in @($script:G.State["sports"])) {
        if (-not $sp) { continue }
        if ([string]$sp["key"] -eq "football") {
          $sp["key"] = "futsal"
          Write-Host "  [migrate] football -> futsal"
          $changed++
        }
        if ([string]$sp["key"] -eq "futsal" -and
            @("Futsal", "Football", "futsal", "", $footballTh) -contains [string]$sp["name"]) {
          $sp["name"] = $futsalTh
          $changed++
        }
      }
    }
    if ($script:G.State["onair"]) {
      foreach ($k in @($script:G.State["onair"].Keys)) {
        $conf = $script:G.State["onair"][$k]
        if ($conf -and [string]$conf["sport"] -eq "football") { $conf["sport"] = "futsal"; $changed++ }
      }
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
          # general product: Lower Third text rides here (sports templates ignore it)
          $d["line1"] = $cmd["line1"]; $d["line2"] = $cmd["line2"]
          $onair[$slot] = $d
          # main graphics (lower/full) show one at a time; 'bug' (score bug) is an independent
          # persistent slot (hideAll still clears everything)
          if ($slot -eq "lower" -or $slot -eq "full") {
            foreach ($k in @($onair.Keys)) {
              if (($k -eq "lower" -or $k -eq "full") -and $k -ne $slot) { $onair[$k]["visible"] = $false }
            }
          }
        }
        "hide" {
          $slot = [string]$cmd["slot"]
          if ($onair.ContainsKey($slot)) { $onair[$slot]["visible"] = $false }
        }
        "hideMain" {
          # hide only the main graphics (lower/full) - the score bug stays up
          foreach ($k in @("lower", "full")) { if ($onair.ContainsKey($k)) { $onair[$k]["visible"] = $false } }
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
          # NOTE: filter with foreach, not "| Where-Object" - the pipeline re-wraps each
          # dict in a PSObject and JavaScriptSerializer then chokes on it
          # ("circular reference ... PSParameterizedProperty"). Same reason upsertEvent
          # rebuilds via ArrayList.ToArray().
          $kept = [System.Collections.ArrayList]@()
          foreach ($e in @($script:G.State["events"])) {
            if ([string]$e["id"] -ne $eid) { [void]$kept.Add($e) }
          }
          $script:G.State["events"] = $kept.ToArray()
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
          $ns = $cmd["settings"]
          # snapshot logos the active settings reference BEFORE the update, so removing a
          # school / swapping a logo lets the now-orphaned upload file be deleted
          $gcCand = $null
          if ($ns.ContainsKey("schools") -or $ns.ContainsKey("logo") -or $ns.ContainsKey("houseLogos")) {
            $gcCand = Get-SettingsUploadNames $script:G.State["settings"]
          }
          $s = $script:G.State["settings"]
          foreach ($p in $ns.Keys) { $s[$p] = $ns[$p] }
          if ($gcCand) { Invoke-GcUploads $gcCand }
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
          # foreach, not "| Where-Object" - see the note in deleteEvent
          $kept = [System.Collections.ArrayList]@()
          foreach ($s in @($script:G.State["sports"])) {
            if ([string]$s["key"] -ne $key) { [void]$kept.Add($s) }
          }
          $script:G.State["sports"] = $kept.ToArray()
        }
        "resetState" {
          # reset only the active product + mode - keep settings.app always, and (sports
          # only) settings.mode + parked. parkedApp is never touched.
          $app  = [string]$script:G.State["settings"]["app"];  if (-not $app)  { $app  = "sports" }
          $mode = [string]$script:G.State["settings"]["mode"]; if (-not $mode) { $mode = "house" }
          $keys = Get-AppProfileKeys $app
          $parked    = $script:G.State["parked"]
          $parkedApp = $script:G.State["parkedApp"]
          $gcCand = Get-SettingsUploadNames $script:G.State["settings"]
          $seedPath = if ($app -eq "general") { $script:G.DefaultGeneralPath }
                      elseif ($mode -eq "school") { $script:G.DefaultSchoolPath }
                      else { $script:G.DefaultPath }
          $seed = Read-JsonFile $seedPath
          foreach ($k in $script:G.AllProfileKeys) {
            if ($script:G.State.ContainsKey($k)) { [void]$script:G.State.Remove($k) }
          }
          foreach ($k in $keys) {
            if ($seed.ContainsKey($k)) { $script:G.State[$k] = $seed[$k] }
          }
          $script:G.State["settings"]["app"] = $app
          if ($app -eq "sports") {
            $script:G.State["settings"]["mode"] = $mode
            if ($parked) { $script:G.State["parked"] = $parked }
          }
          if ($parkedApp) { $script:G.State["parkedApp"] = $parkedApp }
          Invoke-GcUploads $gcCand
        }
        "setApp" {
          $newApp = [string]$cmd["app"]
          if ($newApp -ne "sports" -and $newApp -ne "general") { throw "bad app: $newApp" }
          $oldApp = [string]$script:G.State["settings"]["app"]; if (-not $oldApp) { $oldApp = "sports" }
          if ($newApp -ne $oldApp) {
            if (-not $script:G.State.ContainsKey("parkedApp")) { $script:G.State["parkedApp"] = New-Dict }
            $parkedApp = $script:G.State["parkedApp"]
            # snapshot current product (deep copy via serialize round-trip; drop settings.app)
            $snapKeys = @{}
            foreach ($k in (Get-AppProfileKeys $oldApp)) {
              if ($script:G.State.ContainsKey($k)) { $snapKeys[$k] = $script:G.State[$k] }
            }
            $snap = $script:JS.DeserializeObject($script:JS.Serialize($snapKeys))
            if ($snap["settings"] -and $snap["settings"].ContainsKey("app")) { [void]$snap["settings"].Remove("app") }
            $parkedApp[$oldApp] = $snap
            # incoming product: from parkedApp if present, else seed from that product's default
            if ($parkedApp.ContainsKey($newApp)) {
              $incoming = $parkedApp[$newApp]
              [void]$parkedApp.Remove($newApp)
            } else {
              $seed = Read-JsonFile (Get-AppDefaultPath $newApp)
              $incoming = @{}
              foreach ($k in (Get-AppProfileKeys $newApp)) { if ($seed.ContainsKey($k)) { $incoming[$k] = $seed[$k] } }
            }
            foreach ($k in $script:G.AllProfileKeys) {
              if ($script:G.State.ContainsKey($k)) { [void]$script:G.State.Remove($k) }
            }
            foreach ($k in $incoming.Keys) { $script:G.State[$k] = $incoming[$k] }
            $script:G.State["settings"]["app"] = $newApp
            # hide every on-air slot so a stale graphic can't linger after a product switch
            $oa = $script:G.State["onair"]
            if ($oa) { foreach ($sk in @($oa.Keys)) { if ($oa[$sk]) { $oa[$sk]["visible"] = $false } } }
          }
        }
        "setLowers" { $script:G.State["lowers"] = $cmd["lowers"] }
        "setMode" {
          $newMode = [string]$cmd["mode"]
          if ($newMode -ne "house" -and $newMode -ne "school") { throw "bad mode: $newMode" }
          $oldMode = [string]$script:G.State["settings"]["mode"]; if (-not $oldMode) { $oldMode = "house" }
          $keepApp = [string]$script:G.State["settings"]["app"]; if (-not $keepApp) { $keepApp = "sports" }
          if ($newMode -ne $oldMode) {
            if (-not $script:G.State.ContainsKey("parked")) { $script:G.State["parked"] = New-Dict }
            $parked = $script:G.State["parked"]
            # snapshot current profile (deep copy via serialize round-trip; drop settings.mode)
            $snapKeys = @{}
            foreach ($k in $script:G.ProfileKeys) {
              if ($script:G.State.ContainsKey($k)) { $snapKeys[$k] = $script:G.State[$k] }
            }
            $snap = $script:JS.DeserializeObject($script:JS.Serialize($snapKeys))
            if ($snap["settings"] -and $snap["settings"].ContainsKey("mode")) { [void]$snap["settings"].Remove("mode") }
            $parked[$oldMode] = $snap
            # incoming profile: from parked if present, else seed from the mode default
            if ($parked.ContainsKey($newMode)) {
              $incoming = $parked[$newMode]
              [void]$parked.Remove($newMode)
            } else {
              $seedPath = if ($newMode -eq "school") { $script:G.DefaultSchoolPath } else { $script:G.DefaultPath }
              $seed = Read-JsonFile $seedPath
              $incoming = @{}
              foreach ($k in $script:G.ProfileKeys) { if ($seed.ContainsKey($k)) { $incoming[$k] = $seed[$k] } }
            }
            foreach ($k in $script:G.ProfileKeys) {
              if ($incoming.ContainsKey($k)) { $script:G.State[$k] = $incoming[$k] }
              elseif ($script:G.State.ContainsKey($k)) { [void]$script:G.State.Remove($k) }
            }
            $script:G.State["settings"]["mode"] = $newMode
            $script:G.State["settings"]["app"] = $keepApp
            # hide every on-air slot so a stale graphic can't linger after a mode switch
            $oa = $script:G.State["onair"]
            if ($oa) { foreach ($sk in @($oa.Keys)) { if ($oa[$sk]) { $oa[$sk]["visible"] = $false } } }
          }
        }
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

  # accept a base64 image data URL -> write data/uploads/<id>.<ext> -> return /uploads/<file>
  # (file write only - no state lock; ASCII-only, no Thai on this path)
  function Save-Upload($dataUrl) {
    $s = ("" + $dataUrl).Trim()
    if ($s -notmatch '^data:(image/(png|jpe?g|webp|gif|svg\+xml));base64,(.+)$') { throw "unsupported image type" }
    $mime = $Matches[1].ToLower()
    try { $bytes = [Convert]::FromBase64String(($Matches[3] -replace '\s', '')) }
    catch { throw "bad base64 data" }
    if ($bytes.Length -gt 2097152) { throw "file too large (max 2MB)" }
    $ext = switch -regex ($mime) {
      'png$'    { '.png'; break }
      'jpe?g$'  { '.jpg'; break }
      'webp$'   { '.webp'; break }
      'gif$'    { '.gif'; break }
      'svg'     { '.svg'; break }
      default   { '.bin' }
    }
    $name = (New-Id "up") + $ext
    if (-not (Test-Path $script:G.UploadsDir)) { New-Item -ItemType Directory -Path $script:G.UploadsDir -Force | Out-Null }
    $tmp = Join-Path $script:G.UploadsDir ($name + ".tmp")
    [System.IO.File]::WriteAllBytes($tmp, $bytes)
    Move-Item -Force -LiteralPath $tmp -Destination (Join-Path $script:G.UploadsDir $name)
    return "/uploads/$name"
  }

  # --- uploads garbage-collect: delete logo files nothing references any more --- #
  function Get-UploadName($url) {
    $u = "" + $url
    if ($u.StartsWith("/uploads/")) {
      $n = ($u -split '[?#]', 2)[0]
      $n = $n.Substring($n.LastIndexOf('/') + 1).Trim()
      if ($n -and $n -notmatch '[\\/]' -and $n -ne '.' -and $n -ne '..') { return $n }
    }
    return $null
  }
  function Get-SettingsUploadNames($settings) {
    # NB: return ,$set  -> unary comma stops PowerShell unrolling the HashSet on return
    $set = New-Object 'System.Collections.Generic.HashSet[string]'
    if ($settings -isnot [System.Collections.IDictionary]) { return ,$set }
    $vals = New-Object System.Collections.ArrayList
    [void]$vals.Add($settings["logo"])
    $hl = $settings["houseLogos"]
    if ($hl -is [System.Collections.IDictionary]) { foreach ($v in $hl.Values) { [void]$vals.Add($v) } }
    if ($settings["schools"]) {
      foreach ($sc in @($settings["schools"])) {
        if ($sc -is [System.Collections.IDictionary]) { [void]$vals.Add($sc["logo"]) }
      }
    }
    foreach ($v in $vals) { $n = Get-UploadName $v; if ($n) { [void]$set.Add($n) } }
    return ,$set
  }
  function Add-ParkedUploadNames($set, $parked) {
    if ($parked -isnot [System.Collections.IDictionary]) { return }
    foreach ($prof in $parked.Values) {
      if ($prof -is [System.Collections.IDictionary]) {
        foreach ($n in (Get-SettingsUploadNames $prof["settings"])) { [void]$set.Add($n) }
      }
    }
  }
  function Get-ReferencedUploadNames {
    # active + parked modes (house/school) + parked products (parkedApp), incl. each
    # parked product's own nested parked modes
    $set = Get-SettingsUploadNames $script:G.State["settings"]
    Add-ParkedUploadNames $set $script:G.State["parked"]
    $parkedApp = $script:G.State["parkedApp"]
    if ($parkedApp -is [System.Collections.IDictionary]) {
      foreach ($appProf in $parkedApp.Values) {
        if ($appProf -is [System.Collections.IDictionary]) {
          foreach ($n in (Get-SettingsUploadNames $appProf["settings"])) { [void]$set.Add($n) }
          Add-ParkedUploadNames $set $appProf["parked"]
        }
      }
    }
    return ,$set
  }
  function Invoke-GcUploads($candidates) {
    if ($null -eq $candidates -or $candidates.Count -eq 0) { return }
    $still = Get-ReferencedUploadNames
    $baseDir = [System.IO.Path]::GetFullPath($script:G.UploadsDir)
    foreach ($n in @($candidates)) {
      if ($still.Contains($n)) { continue }
      $p = Join-Path $script:G.UploadsDir $n
      try {
        if ((Test-Path -LiteralPath $p -PathType Leaf) -and ([System.IO.Path]::GetFullPath($p)).StartsWith($baseDir)) {
          Remove-Item -LiteralPath $p -Force
          Write-Host ("  [uploads] removed unused logo: " + $n)
        }
      } catch {}
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

  # RTMP relay (MediaMTX sidecar) - read-only status for the /control UI.
  # Video never touches this server; parse a few values from mediamtx.yml and
  # poll MediaMTX's localhost API for live status.
  function Relay-Info {
    $yml = Join-Path $script:G.Root "mediamtx.yml"
    if (-not (Test-Path $yml)) { return @{ configured = $false } }
    $txt = [System.IO.File]::ReadAllText($yml, [System.Text.Encoding]::UTF8)
    $port = 1935
    if ($txt -match '(?m)^\s*rtmpAddress:\s*\S*?:(\d+)') { $port = [int]$Matches[1] }
    $publicPort = $port
    if ($txt -match '(?m)^\s*#\s*cglive-public-rtmp-port:\s*(\d+)') { $publicPort = [int]$Matches[1] }
    # parse authInternalUsers: publish account + external (non-localhost) read account
    $pubUser = 'publish'; $pubPass = ''; $rdUser = ''; $rdPass = ''
    $sect = ''
    if ($txt -match '(?ms)^authInternalUsers:[ \t]*\r?\n(.*?)(?=^\S|\Z)') { $sect = $Matches[1] }
    $chunks = [regex]::Split($sect, '(?m)^[ \t]*-[ \t]*user:[ \t]*')
    foreach ($chunk in $chunks) {
      if ($chunk.Trim() -eq '') { continue }
      $name = ($chunk -split '\s', 2)[0].Trim()
      $cp = ''
      if ($chunk -match '(?m)^[ \t]*pass:[ \t]*([^\s#]*)') { $cp = $Matches[1] }
      $localhostOnly = $chunk.Contains('127.0.0.1')
      if ($chunk -match 'action:[ \t]*publish') { $pubUser = $name; $pubPass = $cp }
      elseif (($chunk -match 'action:[ \t]*read') -and -not $localhostOnly) { $rdUser = $name; $rdPass = $cp }
    }
    $dest = ''
    if ($txt -match '(?m)^\s*runOnAvailable:\s*.*\s(\S+)\s*$') { $dest = $Matches[1] }
    $pullKey = if ($rdUser) { "live?user={0}&pass={1}" -f $rdUser, $rdPass } else { 'live' }
    $info = @{
      configured     = $true
      running        = $false
      live           = $null
      ingestPort     = $port
      publicPort     = $publicPort
      publishUser    = $pubUser
      publishPass    = $pubPass
      publishKey     = ("live?user={0}&pass={1}" -f $pubUser, $pubPass)
      passIsDefault  = ($pubPass -eq '' -or $pubPass -eq 'CHANGE_ME_PUBLISH_PASSWORD')
      readConfigured = [bool]$rdUser
      readUser       = $rdUser
      readPass       = $rdPass
      pullKey        = $pullKey
      readIsDefault  = ($rdPass -eq '' -or $rdPass -eq 'CHANGE_ME_READ_PASSWORD')
      pushConfigured = [bool]$dest
      dest           = $dest
      destIsDefault  = ($dest -like '*EDIT_ROOM_HOST*' -or $dest -like '*EDIT_STREAM_KEY*')
      recording      = [bool]($txt -match '(?m)^\s*record:\s*true\b')
    }
    try {
      $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:9997/v3/paths/get/live' -UseBasicParsing -TimeoutSec 2
      $d = $script:JS.DeserializeObject($resp.Content)
      $info.running = $true
      $rc = 0; if ($d['readers']) { $rc = @($d['readers']).Count }
      $src = $d['source']
      $info.live = @{
        publishing    = [bool]$d['ready']
        sourceType    = $(if ($src) { [string]$src['type'] } else { $null })
        bytesReceived = $(if ($d.ContainsKey('bytesReceived')) { $d['bytesReceived'] } else { 0 })
        readers       = $rc
      }
    } catch { }
    return $info
  }

  function Handle-Request($ctx) {
    $req = $ctx.Request
    $path = $req.Url.AbsolutePath
    $method = $req.HttpMethod

    if ($path -eq "/" -or $path -eq "/home") { Serve-File $ctx (Join-Path $script:G.Public "home.html"); return }
    if ($path -eq "/healthz") { Send-Text $ctx 200 "ok"; return }
    if ($path -eq "/favicon.ico") { Serve-File $ctx (Join-Path $script:G.Public "pictures\favicon.png"); return }
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
    if ($path -eq "/api/relay" -and $method -eq "GET") {
      if (-not (Test-Token $req)) { Send-Text $ctx 401 '{"error":"unauthorized"}' "application/json; charset=utf-8"; return }
      Send-Text $ctx 200 ($script:JS.Serialize((Relay-Info))) "application/json; charset=utf-8"; return
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
    if ($path -eq "/api/upload" -and $method -eq "POST") {
      if (-not (Test-Token $req)) { Send-Text $ctx 401 '{"error":"unauthorized"}' "application/json; charset=utf-8"; return }
      try {
        $payload = $script:JS.DeserializeObject((Read-Body $req))
        $url = Save-Upload ($payload["dataUrl"])
        Send-Text $ctx 200 ($script:JS.Serialize(@{ ok = $true; url = $url })) "application/json; charset=utf-8"
      } catch {
        Send-Text $ctx 400 ($script:JS.Serialize(@{ error = ("" + $_.Exception.Message) })) "application/json; charset=utf-8"
      }
      return
    }
    # uploaded logos (stored under data/uploads/, outside public/)
    if ($path.StartsWith("/uploads/")) {
      $rel  = ($path.Substring(9)).TrimStart('/') -replace '/', '\'
      $full = [System.IO.Path]::GetFullPath((Join-Path $script:G.UploadsDir $rel))
      $base = [System.IO.Path]::GetFullPath($script:G.UploadsDir)
      if (-not $full.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { Send-Text $ctx 403 "forbidden"; return }
      Serve-File $ctx $full; return
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
Write-Host "  Score/futs: http://${ip}:$Port/score/futsal         (score: futsal)"
Write-Host "  Score/bask: http://${ip}:$Port/score/basketball     (score: basketball)"
Write-Host "  Live      : http://${ip}:$Port/live                 <<  put this in OBS / vMix"
Write-Host "  Scoreboard: http://${ip}:$Port/scoreboard           (rotating display)"
Write-Host "  SB/live   : http://${ip}:$Port/scoreboard/futsal    (live match score)"
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
