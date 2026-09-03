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
and macOS deployments diverge. Known gaps that live in `server.py` only (mirror into `server.ps1`
before relying on Windows): the `/board` route, the duplicate-event-id fixes
(`dedupe_event_ids` + `_new_id` counter), the `football`→`sports` migration in `load_state`, and
the `setSport`/`deleteSport` commands.

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

### Frontend: one template module, three consumers

`public/templates.js` (`window.T`) renders every CG as an HTML string and is shared by:
- `overlay.html`/`overlay.js` — the OBS/vMix transparent overlay, driven by `state.onair`
  (`lower` slot = top3 lower-third, `full` slot = results or schedule). Showing one slot hides
  the other. `overlay.js` owns the show/hide animations and the auto-pager that cycles `.apage`
  pages of the results template.
- `control.html`/`control.js` — operator UI (`/control`) and score-entry UI (`/score`) are the
  **same HTML page**; the tab set differs. It renders a live preview using the same `T.*`
  functions, so template changes show up in the preview automatically.
- `board.html`/`board.js` — `/board`, a standalone opaque full-screen signage page for a school
  hallway TV that continuously cycles the results pages and scales the 1920×1080 stage to fit any
  screen. Not driven by `onair` — it always shows results.

`overlay.css` holds the shared card/house/animation styles; `board.css` only overrides background
and sizing. House colors are CSS variables (`--red`/`--green`/`--yellow`/`--blue`) pushed from
`settings.houses` at runtime; `.h-red`/`.h-green`/… map them to `--house`/`--ink`.

### Logos

- School logo: `settings.logo` → `logoImg()`, corner of every CG.
- Per-house logos: `houseLogoUrl()` uses `settings.houseLogos[key]` if set (empty string = off),
  else the convention `/pictures/house-<key>.png`. Source art is in `logo/*.ai` (actually PDFs);
  the served PNGs are trimmed exports at `public/pictures/house-*.png`. Those PNGs are force-added
  past the `public/pictures/*` gitignore rule via a `!public/pictures/house-*.png` exception.

House key → color/name mapping: red = Red Falcon, green = Green Dragon, yellow = Yellow/Gold Lion,
blue = Blue Shark (editable in the settings tab).

### Sports tournament module (generic, multi-sport)

Separate from the athletics results. `state.sports` is an ordered list; each sport is
`{ key, name, icon, points:{win,draw,loss}, matches:[{id, level, title, stage, home, away, hs, as, done}] }`.
`stage` is only `group` | `final` | `third` (no semifinals). Everything divides by `level` (grade,
free text) — each level has its own standings and its own final/third/champion. Any number of sports
(football/basketball/วิ่งเปรี้ยว/ชักเย่อ/…); all share this one structure, so add a sport by adding a
list entry, not new code.

The control "กีฬา" tab (`renderSports`, tab key `sports`) has a sport picker, per-sport settings
(name/icon/points), and a match editor (level/title/stage/home/score/away/done). It upserts one sport
at a time via the `setSport` command (debounced; `deleteSport` also exists). Three generic templates
take a sport key: `sportMatches` (fixtures by level→stage), `sportTable` (per-level group standings via
`standings(state, sport, level)` — pts, GD, GF), `sportBracket` (per-level final + third + champion).
They render from `state.sports` with no `eventId`; the sport key travels in `onair[slot].sport` (added
to the `show` command) and in `sportSig`. Signage: `/board?view=all` rotates athletics results plus
every sport's three cards; `?view=<sportkey>` rotates just that sport. `load_state` migrates a legacy
`state.football` object into `state.sports[0]`.
