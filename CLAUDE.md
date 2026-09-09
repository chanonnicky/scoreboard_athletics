# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CG Live — a live Character Generator (broadcast graphics) system for school track-and-field
"sports day" (กีฬาสี). It renders 1st–3rd place **by competitor only — there are no athlete
names** (scoring is per-competitor). Output is a transparent web overlay fed into OBS Browser
Source and/or vMix Web Browser at 1920×1080. Operators drive it from `/control` and `/score`.

**Two modes** (`settings.mode`, toggled on the `/control` settings page): `"house"` — the
internal sports day, exactly 4 fixed houses (`red/green/yellow/blue`, colour + name + optional
logo); `"school"` — an external competition, an editable list of schools
(`settings.schools = [{key,name,logo}]`, name + uploaded logo only, colour auto-assigned from a
palette by roster order). Both athletics results and the sports module use whichever competitor
set the mode selects. The two modes are **separate datasets** — switching parks the inactive
one in `state.parked` (see below).

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
  catches syntax errors. For `setMode`/upload: `POST /api/command {"action":"setMode","mode":"school"}`
  then check `/api/state` has `settings.mode:"school"` + `parked.house`; `POST /api/upload` a tiny
  base64 PNG and GET the returned `/uploads/…` URL.
- **House-mode regression** — the competitor abstraction must not change house-mode HTML. Render
  `results`/`top3`/`sportMatches`/`sportLive`/`sportLower` from the current `templates.js` and from
  `git show HEAD:public/templates.js` against the same house state; assert byte-equal. Then render
  a school-mode state shim (`settings.mode:"school"`, `settings.schools:[…]`, results/matches
  keyed by school keys) and assert the output has inline `--house:` and **no** `h-sc` class or
  `/pictures/house-` URL. On this Windows box `node` = VS Code's Electron:
  `ELECTRON_RUN_AS_NODE=1 "…/Microsoft VS Code/Code.exe" script.js`.

## Architecture

### Two parallel server implementations — keep them in sync

`server.py` (Python, real-time **SSE**) and `server.ps1` (PowerShell, **polling only**, the
Windows default) are independent reimplementations of the *same* HTTP API and behavior. Any
change to routes, command handling, or the state model must be made in **both** files, or Windows
and macOS deployments diverge. They are currently in parity (routes incl. `/board`, `/uploads/*`;
commands incl. `setSport`/`deleteSport`/`setMode`; `POST /api/upload`; the id-dedupe +
`football`→`sports` + `football`→`futsal` rename migration on load, incl. forcing the sport's
display name to `ฟุตซอล`, plus defaulting `settings.mode` to `"house"`). The one intentional
difference: `server.ps1` has no SSE (`/api/events` 404s → clients poll). It must also stay
**ASCII-only** (PS 5.1 reads BOM-less scripts as ANSI), so where it needs the Thai name it
builds the string from Unicode code points (`-join [char[]](0x0E1F,…)`) — both servers still
converge on `name: "ฟุตซอล"`.

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
house seed, `data/state.default.school.json` the school seed — used on first run and on reset).
Mutations go through one endpoint:

- `POST /api/command` → `apply_command()` mutates in-memory `STATE`, then `save_soon()` (debounced
  disk write) + `broadcast()` (push to SSE subscribers). `GET /api/state` returns the whole blob;
  `GET /api/events` is the SSE stream.

**Modes / `state.parked`.** The *active* mode's data always lives at the normal top-level keys
(`PROFILE_KEYS` = `settings`, `events`, `results`, `onair`, `sports`, `tally`) — so every consumer
is mode-agnostic. `state.parked` = `{house?, school?}` holds *only the inactive* mode's profile
(same 6 keys, `settings` minus `mode`). The `setMode` command snapshots the active profile into
`state.parked[oldMode]`, then loads `state.parked[newMode]` (or seeds it from that mode's default
file), swaps it in, forces every `onair` slot hidden, and persists immediately. `resetState`
reseeds only the active mode and preserves `settings.mode` + `state.parked`. Both servers default
`settings.mode` to `"house"` on load if absent (existing `state.json` = house mode).

**Logo upload.** `POST /api/upload` (token-guarded) takes JSON `{name?, dataUrl}` — a base64
image data URL (png/jpg/webp/gif/svg, ≤2MB; base64, *not* multipart, so `server.ps1` can parse
it) — writes `data/uploads/<id>.<ext>` and returns `{url:"/uploads/<file>"}`. `GET /uploads/*`
serves that dir (traversal-guarded, before the `public/` static fallback). `data/uploads/` is
gitignored. The `/control` school editor uploads a school logo through this and stores the
returned URL in `settings.schools[].logo`.

`onair` has two independent slots, `lower` and `full`; the `show` command sets one slot and does
**not** touch the other — a lower-third and a full-screen graphic can be on air together. Pushing
a new template into a slot replaces whatever that slot held; `hideAll` clears both.

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
| `/score` | control.html | score-entry: athletics events (rank competitors — houses or schools) |
| `/score/<sport>` | control.html | score-entry per sport (futsal/basketball): edit matches, set the **current match**, live +/- and number entry |
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
(single current-match scoreboard); `sportLower` (the current match as a compact lower-third bar —
Live overlay only, `null` when no current match). Consumers: `overlay.js` (Live, `state.onair`
slots), `control.js` (control + score pages, with live preview via the same `T.*`), `board.js`
(Scoreboard).

`overlay.css` holds the shared card/house/animation styles (loaded by both overlay and board);
`board.css` only overrides background and sizing. On top of those, **theme skins** — one CSS file
each, every rule scoped under `.<slug>` (and `:root.<slug>` for var-only blocks), all loaded after
`overlay.css`/`board.css` in `overlay.html` + `board.html` (never in `control.html`, so the
control/score pages are inherently un-themed): `glass.css` (liquid glass), `clay.css`
(Claymorphism — light) + `claydark.css` (Claymorphism — dark), `neu.css` (Neumorphism — dark),
`retro.css` (Retro-Futurism), `editorial.css` (Editorial/Magazine), `broken.css` (Asymmetrical),
`bauhaus.css`, `techno.css` (Dark Techno/Techwear), `popart.css` (Pop Art), `illustrative.css`,
`y2k.css` (Y2K / Frutiger Aero), `swiss.css` (International Typographic), `pastel.css`.
`applyTheme(state)`
in `overlay.js` / `board.js` picks **one** class for `<html>` from the `THEMES[]` list by
`settings.theme` (`"default"` / absent = none); URL `?theme=<slug>` forces one screen, `?theme=default`
(or `classic`) forces none, legacy `?glass=1` still means glass. Skins override surfaces /
typography / decoration only — not the main layout, animations, HTML, or `templates.js` — so
`sigOf` doesn't track the theme and `applyTheme` runs before the sig early-return
(`board.js` ~160, `overlay.js` ~310). `glass` is the only skin that uses `backdrop-filter`; none
use `color-mix()` (old OBS/vMix CEF). **Font is locked to LINE Seed Sans TH** across all CG —
`overlay.css` has a `body.overlay *, body.board * { font-family: … !important }` guard, so skins
must not set `font-family` (they lean on weight / letter-spacing / text-transform instead).
Default (no setting) = the original opaque look,
byte-identical. The theme is chosen from a `<select>` in `/control` → settings
(`data-act="theme-set"` → `setSettings {theme}`).

In **house mode**, colors are CSS variables
(`--red`/`--green`/`--yellow`/`--blue`) pushed from `settings.houses` at runtime; `.h-red`/`.h-green`/…
map them to `--house`/`--ink`. In **school mode** the templates emit an inline
`style="--house:…;--ink:…"` per competitor element (`.h-*` classes unused; the `:root`
color-injection loop no-ops on empty `settings.houses`).

**Competitor abstraction** (`templates.js`): `comp(state, key)` → `{name, logo, color, ink,
lightInk}` resolving from `settings.houses`/`houseNames`/`houseLogos` (house) or
`settings.schools` (school; color = `SCHOOL_PALETTE[rosterIndex % len]`, never stored).
`compCls(state,key)` = `hClass(key)` in house mode, `"comp"[+" comp-lightbg"]` in school;
`compStyle(state,key)` = `""` in house, the inline var string in school. Every template team/chip
element uses this pair. `houseName`/`houseLogoUrl` delegate to `comp()`. Exported for reuse:
`T.comp`, `T.compMode`, `T.compKeys`. **House-mode output is byte-identical to before this
abstraction** — keep it that way (there is a diff test; see below).

### Logos

- Meet/school logo (corner of every CG): `settings.logo` → `logoImg()`.
- Per-competitor logo: `houseLogoUrl()`. House mode: `settings.houseLogos[key]` if set (empty
  string = off), else the convention `/pictures/house-<key>.png`; source art in `logo/*.ai`
  (actually PDFs), served PNGs at `public/pictures/house-*.png` (force-added past the
  `public/pictures/*` gitignore rule via `!public/pictures/house-*.png`). School mode:
  `settings.schools[i].logo` verbatim (a `/uploads/…` URL from `POST /api/upload`, or `""` = none
  — **no `/pictures/house-*` fallback**).

House key → color/name mapping: red = Red Falcon, green = Green Dragon, yellow = Gold Lion,
blue = Blue Shark (editable in the settings tab). Schools have no fixed keys — the settings
editor mints `sc_<base36ts><rand>` and stores `{key,name,logo}`.

### Sports module (generic, multi-sport)

Separate from athletics results. `state.sports` is an ordered list; each sport is
`{ key, name, icon, currentId, clockMin, matches:[{id, level, title, home, away, hs, as, done, clock}] }`.
Matches divide by `level` (grade — the picker offers ป.1–ม.6, free text). `currentId` points to the
match "playing now". `clockMin` (minutes, default 10; seeds: futsal 20 / basketball 10) is the
per-sport default period length — editable on `/score/<sport>`, applied to a new match's `clock.dur`
and to "รีเซ็ต". There is **no standings/bracket** (removed by request) — only the match list and
the live scoreboard. Add a sport by adding a list entry, not new code.

`match.clock = { running, elapsed, since, dur }` is a **count-down clock** (missing = stopped, full
`dur` remaining; `dur` missing → `sport.clockMin·60`, else 600s = 10:00). Internally it's still a count-up: `elapsed`/`since`
track time run (`since` stamped by the control client via `Date.now()`, tolerates small skew, no
server change); displayed value = `max(0, dur − (elapsed + (running ? (now − since)/1000 : 0)))`.
At 0 it holds `00:00` and gets a `.ended` class (red). Helpers `T.remainSec` (tick from `data-*`
attrs) / `T.clockRemain` / `T.clockDur` / `T.fmtClock` (templates.js); the clock div carries
`data-el`/`data-since`/`data-dur`. Consumers tick every 0.5s (`board.js`/`overlay.js`
`startClockTick`, `control.js` `restartSpClockTick`) since state doesn't change while it runs.
`sportCollectFromDom` freezes the clock when a match is marked `done`. Controls live on the
`/score/<sport>` live-match card: `clk-toggle` (start/stop), `clk-add` ±1:00/±0:10 (adjusts `dur`
→ remaining), `clk-reset` (elapsed→0, keeps `dur`).

Templates: `sportMatches(state, key)` (match list grouped by grade level, sorted ป.1→ม.6 via
`gradeRank`) and `sportLive(state, key)` (big scoreboard of `currentId` — two teams + score + live
status). Editing happens on the **per-sport score page** `/score/<sport>` (`renderSportScore` in
control.js): match CRUD, "ตั้งสด" to set `currentId`, and +/- / number score entry. Everything saves
via the `setSport` command (whole-sport upsert; debounced or immediate for +/-). Live/Scoreboard read
it: `onair[slot].sport` carries the key on Live's `show`; both `sportMatches` and `sportLive` are
pushable to `/live`'s full slot (`renderLive()`'s per-sport button pair, `show-full-sport` /
`show-full-sportlive`), `sportLower` is pushable to Live's **lower** slot (`renderLive()`'s
per-sport `show-lower-sportbar` buttons, and can be on air *with* a full-slot graphic), and
`/scoreboard/<sport>` always renders `sportLive`. `load_state` migrates a legacy `state.football`
object into `state.sports[0]`, and renames the old `football` sport (key + name + `onair` refs) to
`futsal` / ฟุตซอล (name forced even when the key is already `futsal`).

`overlay.js` mirrors `board.js`'s `sportLive` handling since it's a third consumer of the same
template: `isSport()` covers `sportMatches`/`sportLive`/`sportLower` (for `sportSig` + the
`sameShell` same-sport check — needed because unlike `top3`/`schedule`, `conf.eventId` is always
`null` for sport templates, so without comparing `conf.sport` too, switching from one sport's card
to another's would wrongly read as "unchanged"), and a narrower `isLiveSport()`
(`sportLive`/`sportLower`) gates the per-slot clock ticker (`startClockTick`/`tickClock`).
Score-bump + `.just-final` (`bumpLiveScore`, `.tpl-live-card` only) stay `sportLive`-only,
independently of `board.js`'s copies — both must stay in sync if that logic changes.
`sportLower` is Live-only (no `board.js` path) and deliberately **calm** — no score-bump, no
finish-flash. On a same-match update `renderSlot` calls `patchSportbar()` (a shell signature =
homes + names + logos + sport name/icon decides patch-vs-rebuild), editing only score text,
`.live-clock` (class + `data-*` + text), team win/trail classes, and `.sportbar[data-done]` — so
the pulsing `.live-dot` and the `<img>` logos are never re-created and nothing flickers. The
status line renders `.live-dot` + `LIVE` + `จบแล้ว` always; CSS `[data-done]` toggles which show.
