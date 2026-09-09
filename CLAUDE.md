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

### RTMP relay sidecar (optional, Windows) — video never touches the CG server

For "OBS at the venue, this box remote, the editing OBS (#2) elsewhere": `start.bat`/`start.sh`
also launch **MediaMTX** (`bin/mediamtx/mediamtx.exe`) if present — an RTMP server on :1935 that
the venue OBS **publishes** to (`user: publish`) and OBS #2 **pulls** from as a Media Source
(`user: read`). Pure relay, no re-encode; optional `runOnAvailable` ffmpeg `-c copy` push to a
further destination (commented out by default); optional recording to `data/rec/`.
`get-relay.ps1` downloads MediaMTX (pinned `v1.21.0`, checksum-verified) + ffmpeg (BtbN
win64-gpl) into `bin/` (gitignored) and seeds `mediamtx.yml` from `mediamtx.example.yml`.
`mediamtx.yml` is **gitignored** (holds passwords) — `mediamtx.example.yml` is the tracked
template, copied on first run by `start.bat`/`start.sh`/`get-relay.ps1`. `setup.bat` opens
firewall 1935. MediaMTX v1.21 gotchas: `recordPath` must contain `%path`; `moq: false` (new
default-on server).

**Invariants:** `server.py`/`server.ps1` carry **no RTMP/video code**. The one exception is a
read-only `GET /api/relay` (token-gated) — `relay_info()` / `Relay-Info`, kept in parity — which
parses `mediamtx.yml` (`_relay_users` generically classifies `authInternalUsers` blocks: the
`publish`-action user, and the non-localhost `read`-action user) plus the `# cglive-public-rtmp-port`
comment and `runOnAvailable`, and polls MediaMTX's localhost API (`:9997/v3/paths/get/live`,
1–2s timeout). The `/control` settings view renders a copy-only "RTMP relay" card
(`relayCardHtml`/`renderRelayBody`/`startRelayPoll` in `control.js`, polled every 5s, in both
sports and general settings) showing the publish URL, the pull URL for OBS #2, live status, and
an editable **public RTMP port** stored as `settings.relayPublicPort` (plain `setSettings`
shallow-merge, overrides the yml comment). Video bypasses PowerShell/Python entirely, so relay
load never affects the HTTP server. When `bin/mediamtx/mediamtx.exe` is absent,
`start.bat`/`start.sh` behave **exactly** as before (one hint line, then the CG server unchanged)
— part of the start.bat/start.sh parity rule.

Loopback test (Windows, verified): run `mediamtx.exe mediamtx.yml`; publish with
`bin\ffmpeg\ffmpeg.exe -re -f lavfi -i testsrc2=size=640x360:rate=25 -f lavfi -i sine -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -t 8 -f flv "rtmp://127.0.0.1:1935/live?user=<pubuser>&pass=<pubpass>"`;
confirm a reader with the `read` creds works and wrong publish creds get `authentication failed`
in the MediaMTX log; `/healthz` on the CG server stays green throughout.

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
  base64 PNG and GET the returned `/uploads/…` URL. For `setApp`: `POST {"action":"setApp","app":"general"}`
  then `/api/state` has only `settings`/`onair`/`lowers` + `parkedApp.sports` (holding the old
  `parked`, minus `settings.app`); switch back and `events`/`sports`/`parked` return, `parkedApp.general`
  holds the general profile. PS test client: POST bytes as `[Text.Encoding]::UTF8.GetBytes($json)`
  with `charset=utf-8` (a plain `-Body` string mangles Thai — client bug, not server).
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
commands incl. `setSport`/`deleteSport`/`setMode`/`setApp`/`setLowers`/`hideMain` + `show`'s
lower⇄full mutual exclusion (and `show` carrying `line1`/`line2` for general-product CG);
`POST /api/upload`; the id-dedupe +
`football`→`sports` + `football`→`futsal` rename migration on load, incl. forcing the sport's
display name to `ฟุตซอล`, plus defaulting `settings.mode` to `"house"` and `settings.app` to
`"sports"`; and the **uploads GC** —
`setSettings` (when it touches `schools`/`logo`/`houseLogos`) and `resetState` snapshot the
active settings' `/uploads/` filenames, then after applying delete any that nothing references
any more, active **or** parked — where "parked" means every profile in `state.parked` (modes)
**and** every profile in `state.parkedApp` (products, incl. each one's nested `parked`) (so
removing a school / swapping a logo cleans up its file; PS side must `return ,$set` to stop
HashSet unrolling)). The one intentional
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

**Products / `settings.app` / `state.parkedApp`.** `settings.app` ∈ `("sports","general")` is an
axis *above* `mode` — `"sports"` is this whole athletics/sports system; `"general"` is a live
Lower Third generator (`/control` compose UI + `/live` only; no `/score`, no `/scoreboard`).
`state.parkedApp` = `{sports?, general?}` parks the *inactive product's whole profile*, keyed by
app name — **distinct from `state.parked`** (the mode axis), which is itself part of the sports
profile and travels inside `parkedApp.sports` when sports is parked. The general profile keys are
just `settings`, `onair`, `lowers` (`lowers` = saved Lower Third presets `[{id,kind,line1,line2}]`,
`kind` ∈ `name|topic|title` — mapped to a slot+template by `GEN_KINDS` in `control.js`:
`name`→`lower`/`genLowerName`, `topic`→`lower`/`genLowerTopic`, `title`→`full`/`genTitle`).
The `setApp` command mirrors `setMode` one level up: snapshot the active
product's `_app_profile_keys(old)` into `parkedApp[old]` (minus `settings.app`), load
`parkedApp[new]` or seed from `state.default.general.json` / `state.default.json`, clear
**every** key in `ALL_PROFILE_KEYS`, install, force `onair` hidden, persist now. `setLowers`
whole-list-replaces `state.lowers`. Both servers default `settings.app` to `"sports"` on load if
absent, and `setMode` re-injects `settings.app` after its settings swap (else the product axis is
lost). `resetState` is app-aware: reseeds the active product's keys, always re-injects
`settings.app`, re-injects `settings.mode` + `state.parked` only when `app == "sports"`, always
preserves `state.parkedApp`.

**Modes / `state.parked`.** The *active* mode's data always lives at the normal top-level keys
(`PROFILE_KEYS` = `settings`, `events`, `results`, `onair`, `sports`, `tally`) — so every consumer
is mode-agnostic. `state.parked` = `{house?, school?}` holds *only the inactive* mode's profile
(same 6 keys, `settings` minus `mode`). The `setMode` command snapshots the active profile into
`state.parked[oldMode]`, then loads `state.parked[newMode]` (or seeds it from that mode's default
file), swaps it in, forces every `onair` slot hidden, and persists immediately. `resetState`
reseeds only the active mode and preserves `settings.mode` + `state.parked`. Both servers default
`settings.mode` to `"house"` on load if absent (existing `state.json` = house mode). `setMode`
only runs inside the sports product.

**Logo upload.** `POST /api/upload` (token-guarded) takes JSON `{name?, dataUrl}` — a base64
image data URL (png/jpg/webp/gif/svg, ≤2MB; base64, *not* multipart, so `server.ps1` can parse
it) — writes `data/uploads/<id>.<ext>` and returns `{url:"/uploads/<file>"}`. `GET /uploads/*`
serves that dir (traversal-guarded, before the `public/` static fallback). `data/uploads/` is
gitignored. The `/control` school editor uploads a school logo through this and stores the
returned URL in `settings.schools[].logo`. `uploadImage()` in `control.js` **auto-shrinks raster
logos client-side before upload** — anything over 640px or ~1.6MB is redrawn on a canvas at a
smaller size, PNG first then WebP (both keep alpha), stepping down until it fits; SVG and
already-small files pass through untouched, and the server's 2MB cap stays as the backstop.

`onair` has three slots: `lower`, `full`, and `bug` (score bug). **`lower` and `full` are the
"main graphics" and only one shows at a time** — the `show` command, when `slot` is `lower`/`full`,
forces the *other* of the two hidden (both `server.py` and `server.ps1`); pushing a new template
into a slot still replaces whatever that slot held. **`bug` is independent and persistent** — it
stays up alongside a main graphic, and `show`/`hide` on `bug` (or a main slot) never disturbs the
other. `bug` always carries `template:"scoreBug"` + a `sport` key — `T.scoreBug` renders a small
top-left corner graphic (two teams, live score, countdown clock, LIVE dot) that stays on the whole
game; it lives in its own `#slot-bug` (`overlay.js` `SLOTS`, `.slot-bug` anchored top-left).
`hideMain` clears just `lower`+`full`; `hideAll` clears all three. On `/control`:
`hide-lower`/`hide-full` → `hideMain`, `hide-all` (■ ลงจอทั้งหมด) → `hideAll`, the per-sport
score-bug buttons toggle the `bug` slot (click the active sport again to hide it), `hide-bug` →
`hide {slot:"bug"}`. The full-width `sportLower` bar is a separate thing — an option in the
**`lower`** slot (`show-lower-sportbar`, mutually exclusive with `full`), alongside `top3`.

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
| `/scoreboard` (alias `/board`) | board.html | **Scoreboard type 1** — opaque venue screen, auto-rotates all results (`?view=all\|results\|chart\|<sport>`) |
| `/scoreboard/<sport>` | board.html | **Scoreboard type 2** — live single-match scoreboard of that sport's `currentId` |
| `/` (alias `/home`) | home.html | landing / help page + the **product picker** (`setApp`) |

Every route is served in **both** products; when `settings.app == "general"` only `/control`
(compose UI) and `/live` are meaningful — `/score*` shows a "no scoring" card and `/scoreboard*`
renders an empty rotation (guarded by `|| []`).

The rotate-all screen only re-renders the visible card when it must (card count changes, or a
single-card view); on a plain data change with 2+ cards it updates `cards[]` silently and lets the
rotator pick up the new content on its next tick — so it never flashes/resets mid-cycle. With a
**single card** it patches the visible card in place (`refreshCurrentCard()`): swap `cg.innerHTML`
with **no** `boardIn` and, when the card is one `.apage` (or none), add `.show` synchronously so
the row slide-in does **not** replay — the values/status just update. `sigOf()` must include
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

`control.js` also branches on `settings.app` (`isGeneralApp()`): in the **general** product
`render()` routes to `renderGeneralLive` / `renderGeneralSettings` (score views and the
events/import hash-views are unreachable — the sidebar hides those groups via ids
`sbGroupScore`/`sbNavEvents`/`sbNavImport`/`sbNavBoard`, `body.app-general` + `applyAppBrand()`
relabel the brand). `renderGeneralLive` is one **compose** card (a `.seg` segmented control picks
`GEN_KINDS` kind → text fields → `gen-air` shows it, Enter in a field = air, `gen-save-preset`
saves/updates a `lowers` preset) + a **rundown** card (each `state.lowers` row: click = air, the
row for whatever's currently on-air is `.is-live`, a card-header `preset-hide` button lowers it) +
a "กำลังออกอากาศ" strip showing the live text with per-slot `✕ ลงจอ` + the shared live preview
iframe. Client draft state is `genUI = {kind,l1,l2,editId}` (a module var, seeded from `onair`
once, cleared on `switchApp`); handlers call `genCollectUI()` to read the DOM back into it before
acting. The product toggle (`app-sports`/`app-general` → `switchApp()` → `setApp`) is in **both**
settings views. `home.html` has the same picker (POSTs `setApp` with the `cg_token` from
localStorage; 401 → tells the user to set the token in `/control`).

The **selected event** is meet-wide shared state at `settings.selEventId` (written via
`setSettings`, which shallow-merges — no new command). `control.js` reads it through
`selectedEventId()` (optimistic `selOverride` until the server echoes) and writes via
`setSelectedEvent()` (debounced 250ms); every operator page follows it. `followSelection()` (move
the on-air `schedule` window when the pointer moves) is gated to `/control`.

### Frontend: one template module, shared by every consumer

`public/templates.js` (`window.T`) renders every CG as an HTML string. Templates: `top3`, `results`,
`schedule` (athletics); `chart` (medal-count data graphic, see below); `sportMatches` (per-sport
match list grouped by grade level); `sportLive` (single current-match scoreboard); `sportLower`
(the current match as a compact full-width lower-third bar); `scoreBug` (the current match as a
small top-left corner bug — score + countdown clock + LIVE dot, meant to stay on the whole game).
`sportLower`/`scoreBug` are Live overlay only and return `null` when there's no current match.
The **general product** adds `genLowerName` (name + role/subtitle, `lower` slot), `genLowerTopic`
(single-line topic bar, `lower` slot), `genTitle` (full-screen title card, `full` slot) — each
takes `(state, conf)` where `conf` is the `onair[slot]` object and reads `conf.line1`/`conf.line2`;
each returns `null` when empty. Live overlay only; `overlay.js` `isGen()`/`genSig()` gate them and
`sameShell` is forced false so every push re-animates.
Consumers: `overlay.js` (Live, `state.onair` slots), `control.js` (control + score pages, with
live preview via the same `T.*`), `board.js` (Scoreboard).

**`chart` — medal data graphic.** `T.chart(state)` counts 🥇🥈🥉 per competitor from
`state.results` across all events (fresh each render — `T.medalTally(state)`, Olympic sort
gold→silver→bronze→roster order; nothing persisted, `state.tally` is unrelated dead code). Gated
by `settings.chartEnabled` (returns `null` when off, so it drops out of the board rotation and
`onair` slot); `settings.chartType` = `"bars"` (horizontal ranked, default) | `"columns"`
(vertical); `settings.chartTitle` overrides the "ตารางเหรียญรางวัล" kicker. All three live under
`settings` (plain `setSettings` shallow-merge — no new command) so they park per-mode. Pushable to
Live's `full` slot (`show` template `chart`, `renderLive`'s "กราฟเหรียญ" button, shown only when
`chartEnabled`); on the board via `/scoreboard?view=chart` (dedicated) and appended to
`?view=all`'s rotation. `overlay.js` `chartSig()` / `board.js` `sigOf()` include the three chart
settings. Styles: `.tpl-chart-card` + `.chart-*` in `overlay.css`, bars/columns coloured by the
competitor `--house`/`--ink` vars like `.rchip`.

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
`overlay.css` has a `body.overlay *, body.board * { font-family: … !important }` guard (specificity
`0,0,1,1`), so skins normally must not set `font-family`. The **one exception** is `editorial.css`,
which self-declares `@font-face` for **Charmonman** (bundled at `public/fonts/Charmonman-*.ttf`,
SIL OFL) and applies it to headings/names only, overriding the guard with a more specific
selector + `!important`; numbers, clocks and dense list text stay LINE Seed.
Default (no setting) = the original opaque look,
byte-identical. The theme is chosen from a `<select>` in `/control` → settings
(`data-act="theme-set"` → `setSettings {theme}`) — present in **both** the sports and general
settings views (each product parks its own `settings.theme`).

The general-product CG classes (`.gen-l3` / `.gen-l3-name-txt` / `.gen-l3-role-txt` /
`.gen-topic` / `.gen-topic-txt` in `overlay.css`) render with the base `overlay.css` look under
every theme — no skin file targets them yet (add `.<slug> .gen-l3 {…}` blocks the same way the
other template classes are covered). `genTitle` deliberately reuses the `.card` / `.card-head` /
`.card-title.big` / `.card-sub` shell (+ `.tpl-gentitle-card` for layout) so it inherits each
skin's surface/typography automatically.

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
`show-full-sportlive`); `sportLower` (full-width lower bar) goes in the `lower` slot
(`show-lower-sportbar`); `scoreBug` (top-left corner bug, live score + countdown, always on) goes
in the independent persistent `bug` slot via `renderLive()`'s per-sport `show-bug` buttons — one
sport at a time, stays up with a main graphic (see the `onair` note above). `/scoreboard/<sport>`
always renders `sportLive`. `overlay.js` in-place patching: `patchLiveBar(bar,html,root,home,away)`
backs both `patchSportbar` (`.sportbar`) and `patchScoreBug` (`.scorebug`) — score/clock/status
update without re-creating the LIVE dot or logos. `load_state` migrates a legacy `state.football`
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
