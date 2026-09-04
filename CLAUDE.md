# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CG Live — a live Character Generator (broadcast graphics) system for school track-and-field
"sports day" (กีฬาสี). It renders 1st–3rd place **by house color only — there are no athlete
names** (scoring is per-house). Output is a transparent web overlay fed into OBS Browser Source
and/or vMix Web Browser at 1920×1080. Operators drive it from `/control` and `/score`.

README.md is the authoritative user/deployment doc (in Thai) — read it for network setup
(LAN / Tailscale), OBS/vMix config, and CSV import format.

## Running

```bash
./start.sh                 # macOS/Linux — auto-picks Python 3, port 8080
./start.sh --port 9000     # forwards --port/--host/--token to server.py
python3 server.py --port 8080 --host 127.0.0.1     # direct
```

On macOS `start.sh` deliberately uses **system Python** (`/usr/bin/python3`); conda/homebrew
Python is unsigned and macOS firewall blocks LAN connections to it (localhost works, LAN IP
doesn't). Windows deployment runs `server.ps1` (via `start.bat`) instead — no Python needed.

**Rule: `start.bat` and `start.sh` must give the operator the same experience.** They launch
different servers (`server.ps1` vs `server.py`) but the observable behaviour must match: same
routes and CG output, concurrent handling of many polling screens, the same args
(`--port N` / `--port=N` / `--host` / `--token` — `start.bat` forwards `%*` and `server.ps1`
parses the `--` forms itself, on top of native `-Port` etc.), and equivalent messages on
startup and on a busy port (wording is platform-idiomatic — `./start.sh` vs `start.bat`,
`kill` vs close-the-window — but the same information). The one sanctioned gap is transport:
`server.ps1` has no SSE, so Windows clients poll (see below). Any other divergence is a bug to
fix in both, not to document.

There is **no test suite and no build step**. The frontend is plain ES5 served statically.

### Verifying changes without a browser

The Chrome automation extension in this environment often cannot reach the local server, and
there are no automated tests. Two reliable checks:

- **Template output** — `public/templates.js` is a self-contained UMD-ish module. Run it in Node
  with a `window` shim to assert the produced HTML:
  ```bash
  node -e 'global.window={};require("./public/templates.js");
    var st=JSON.parse(require("fs").readFileSync("data/state.json","utf8"));
    console.log(global.window.T.results(st).match(/apage/g).length,"pages");'
  ```
- **Routes/state** — start the server and `curl` (`/healthz`, `/board`, `/api/state`,
  `/pictures/house-red.png`). `python3 -c "import py_compile;py_compile.compile('server.py',doraise=True)"`
  catches syntax errors.

## Architecture

### Two parallel server implementations — keep them in sync

`server.py` (Python, real-time **SSE**) and `server.ps1` (PowerShell, **polling only**, the
Windows default) are independent reimplementations of the *same* HTTP API and behavior. Any
change to routes, command handling, or the state model must be made in **both** files, or Windows
and macOS deployments diverge. They are currently in parity (routes incl. `/board`; commands incl.
`setSport`/`deleteSport`; the id-dedupe + `football`→`sports` migration on load). Two intentional
differences: `server.ps1` has no SSE (`/api/events` 404s → clients poll), and it must stay
**ASCII-only** (PS 5.1 reads BOM-less scripts as ANSI), so its migration names the legacy sport
`"Football"` rather than the Thai name `server.py` uses.

Both serve requests **concurrently** (`server.py` via `ThreadingHTTPServer`; `server.ps1` accepts
on the main thread and dispatches each request to a 16-slot **runspace pool**). In `server.ps1`
all mutable state lives in one `[hashtable]::Synchronized` container `$G` (shared by reference
into every worker), and every read/mutation of `$G.State` is guarded by `[Monitor]` on `$G.Lock`
(re-entrant, so `New-Id` nested inside `Apply-Command` is fine). The request-handling functions
live in the `$Lib` scriptblock; a scriptblock passed across runspaces stays bound to its origin
session state, so workers get `$Lib.ToString()` and rebuild it with `[scriptblock]::Create`
before dot-sourcing. `$script:JS` (JavaScriptSerializer, not thread-safe) is created per runspace
inside `$Lib`.

Clients auto-detect transport: overlay/board try SSE first and fall back to polling `/api/state`
every ~0.25–1s (`?transport=poll` forces it). So the Python SSE path is an optimization, not a
requirement — everything works over polling.

### Single shared state blob

The entire app state (`settings`, `events`, `results`, `onair`, optionally `tally`) is one JSON
object persisted to `data/state.json` (gitignored runtime data; `data/state.default.json` is the
seed used on first run and on reset). Mutations go through one endpoint:

- `POST /api/command` → `apply_command()` mutates in-memory `STATE`, then `save_soon()` (debounced
  disk write) + `broadcast()` (push to SSE subscribers). `GET /api/state` returns the whole blob;
  `GET /api/events` is the SSE stream.

Because the whole blob round-trips, a running server holds authoritative state in memory and will
**overwrite `data/state.json` on the next command**. Editing `state.json` by hand while a server
is running gets clobbered — restart the server to pick up file edits.

### Event IDs must be unique

Highlighting/lookup in the schedule and results templates matches events by `id`. Duplicate ids
cause every matching row to light up together. IDs are generated in `_new_id()` (timestamp-ms +
a per-ms counter so a burst of CSV imports doesn't collide). `load_state()` runs
`dedupe_event_ids()` as a self-healing migration on startup and rewrites the file if it changed.

### Two output channels (Live / Scoreboard) + per-role URLs

The system is organized into independent channels, separated by URL, all driven from one shared
state and one operator control:

| URL | file | role |
|---|---|---|
| `/control` | control.html | **Live control** — operator shows/hides overlay graphics anytime |
| `/score` | control.html | score-entry: athletics events (rank houses) |
| `/score/<sport>` | control.html | score-entry per sport (football/basketball): edit matches, set the **current match**, live +/- and number entry |
| `/live` (alias `/overlay`) | overlay.html | **Live** — transparent OBS/vMix overlay, driven by `state.onair` |
| `/scoreboard` (alias `/board`) | board.html | **Scoreboard type 1** — opaque venue screen, auto-rotates all results (`?view=all\|results\|<sport>`) |
| `/scoreboard/<sport>` | board.html | **Scoreboard type 2** — live single-match scoreboard of that sport's `currentId` |

The rotate-all screen only re-renders the visible card when it must (card count changes, or a
single-card view); on a plain data change it updates `cards[]` silently and lets the rotator pick
up the new content on its next tick — so it never flashes/resets mid-cycle. `sigOf()` must include
every field any card reads (it covers `settings.selEventId`, see below) — a plain equality/JSON
check, not a deep diff, so a field left out silently stops updating.

`T.results()` and `T.sportMatches()` highlight the row of whatever is currently in progress
*in place*, inside the normal list — not a separate summary line: `results` marks the `.rrow2`
whose event id matches `settings.selEventId` (`▶` rank marker, gold `.cur` background, "กำลัง
แข่ง" in place of the rank chips); `sportMatches`' `matchRow(state, m, idx, isLive)` marks the
`.fbm` whose id is that sport's `currentId` (only while `!done`, "สด" + pulsing dot in place of
"VS"). Shows everywhere those two templates render — `/live`, the control-page preview, and both
Scoreboard screens.

`control.js` picks its mode from `location.pathname`: `/control` → Live control, `/score` →
athletics scoring, `/score/<sport>` → per-sport scoring (`SCORE_SPORT`). All three share one
**app shell** (`control.html`): a left `.sidebar` (nav to control / per-sport score / manage /
open-display links; collapses to a `body.sb-open` drawer < 900px) + `.app-main`. On `/control`
the four "manage" views (`live` | `events` | `import` | `settings`) are switched via
`location.hash` (`activeView` / `viewFromHash()` / `hashchange`), not tabs. `board.js` picks its
mode from the path: `/scoreboard/<sport>` → live mode (renders `T.sportLive`, no rotation,
in-place score updates); otherwise the rotate-all mode.

The **selected event** is meet-wide shared state at `settings.selEventId` (written via
`setSettings`, which shallow-merges — no new command). `control.js` reads it through
`selectedEventId()` (optimistic `selOverride` until the server echoes) and writes via
`setSelectedEvent()` (debounced 250ms); every operator page follows it. `followSelection()` (move
the on-air `schedule` window when the pointer moves) is gated to `/control`.

### Frontend: one template module, shared by every consumer

`public/templates.js` (`window.T`) renders every CG as an HTML string. Templates: `top3`, `results`,
`schedule` (athletics); `sportMatches` (per-sport match list grouped by grade level); `sportLive`
(single current-match scoreboard). Consumers: `overlay.js` (Live, `state.onair` slots),
`control.js` (control + score pages, with live preview via the same `T.*`), `board.js` (Scoreboard).

`overlay.css` holds the shared card/house/animation styles (loaded by both overlay and board);
`board.css` only overrides background and sizing. House colors are CSS variables
(`--red`/`--green`/`--yellow`/`--blue`) pushed from `settings.houses` at runtime; `.h-red`/`.h-green`/…
map them to `--house`/`--ink`.

### Logos

- School logo: `settings.logo` → `logoImg()`, corner of every CG.
- Per-house logos: `houseLogoUrl()` uses `settings.houseLogos[key]` if set (empty string = off),
  else the convention `/pictures/house-<key>.png`. Source art is in `logo/*.ai` (actually PDFs);
  the served PNGs are trimmed exports at `public/pictures/house-*.png`. Those PNGs are force-added
  past the `public/pictures/*` gitignore rule via a `!public/pictures/house-*.png` exception.

House key → color/name mapping: red = Red Falcon, green = Green Dragon, yellow = Yellow/Gold Lion,
blue = Blue Shark (editable in the settings tab).

### Sports module (generic, multi-sport)

Separate from athletics results. `state.sports` is an ordered list; each sport is
`{ key, name, icon, currentId, matches:[{id, level, title, home, away, hs, as, done, clock}] }`.
Matches divide by `level` (grade — the picker offers ป.1–ม.6, free text). `currentId` points to the
match "playing now". There is **no standings/bracket** (removed by request) — only the match list and
the live scoreboard. Add a sport by adding a list entry, not new code.

`match.clock = { running, elapsed, since }` is a **count-up stopwatch** (missing = stopped at 0):
displayed value = `elapsed + (running ? (Date.now() - since)/1000 : 0)`. `since` is stamped by the
control client (`Date.now()`) — accepts small control-vs-display clock skew, no server change.
Helpers `T.clockValue` / `T.fmtClock` (templates.js). Consumers tick it themselves every 0.5s
(`board.js` `startClockTick`, `control.js` `restartSpClockTick`) since state doesn't change while it
runs. `sportCollectFromDom` freezes the clock when a match is marked `done`. Controls live on the
`/score/<sport>` live-match card (`clk-toggle` / `clk-add` ±1:00/±0:10 / `clk-reset`).

Templates: `sportMatches(state, key)` (match list grouped by grade level, sorted ป.1→ม.6 via
`gradeRank`) and `sportLive(state, key)` (big scoreboard of `currentId` — two teams + score + live
status). Editing happens on the **per-sport score page** `/score/<sport>` (`renderSportScore` in
control.js): match CRUD, "ตั้งสด" to set `currentId`, and +/- / number score entry. Everything saves
via the `setSport` command (whole-sport upsert; debounced or immediate for +/-). Live/Scoreboard read
it: `onair[slot].sport` carries the key on Live's `show`; `/scoreboard/<sport>` renders `sportLive`.
`load_state` migrates a legacy `state.football` object into `state.sports[0]`.
