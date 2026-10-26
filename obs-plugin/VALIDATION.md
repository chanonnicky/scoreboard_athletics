# Native plugin validation — 2026-10-26

## Version 0.4.0 — one-page operation and Thai text spacing

- Primary workflow: select a library item, edit its text inline, explicitly Air.
  A separate Save Text action updates the library; simply airing quick edits does
  not overwrite saved copy. Program preview/per-layer controls collapse when unused.
- Tabs are now Operation, Design and Settings. Library management lives in Settings,
  while routine operation no longer requires visiting the full design form.
- Dock input/button padding increased. Graphic side/top/bottom spacing and ticker
  height increased; shaped glyph bounds determine baseline and size fitting so Thai
  marks have breathing room inside the panel rather than touching its edges.
- Tests cover staged quick edits, explicit Air/save isolation, font-bound padding
  for Noto Sans Thai and Charmonman at 48/72 px, and narrow-Dock layout.
- Visual diagnostics: `test-output/dock.png` and `test-output/thai-padding.png`.

## Version 0.3.0 — theme-specific motion

- Native entry/exit choreography for all 15 themes: eased float, subtle spring/squash,
  paper reveal, diagonal reveal, staggered geometry, brush bands, neon/scan accents
  and alpha-masked gloss. Explicit manual animation selections remain supported.
- New items default to themed entry 650 ms / exit 420 ms. Existing persisted
  selections remain unchanged. The editor has a one-click themed-motion button
  and a Preview-only entry/hold/exit rehearsal that does not touch Program state.
- Additional tests sample entry, settled state, exit and interrupted entrance for
  all 90 theme/type combinations, verify exact settled pixels and full transparency
  at completion, and check that rehearsal cannot air or mutate the program item.
- Generated visual diagnostics: `test-output/theme-motion.png` (timelines) and
  `test-output/motion-frames/` (five-theme animated-preview frames).

## Version 0.2.0 — simpler Dock and outgoing animations

- Dock now opens on **ขึ้น–ลงจอ**, with a Program preview, searchable library,
  a large selected-item Air button, and independent layer controls. Editing and
  source/library settings are separate tabs. Selecting a runtime row does not
  change the draft or air anything until the operator requests it.
- Exit effects: slide down, fade out (default 300 ms), wipe out, with separate
  exit timing. Manual hide, Hide All, hotkeys and scheduled expiry share the exit
  lifecycle. Repeated hide does not restart it; re-air cancels it. Scene collection
  changes, imports and the explicit emergency cut still hide immediately.
- Regression tests cover every type with all three exit effects at start/middle/end,
  progressive fade alpha, stopping during entrance, legacy library defaults,
  repeat hide/re-air, independent layers and publishing the final transparent frame.
- Build and package version is 0.2.0. Installation locations and the library format
  remain compatible; existing items acquire fade-out defaults without migration.

## Verified in this workspace

- Windows 11 x64, Ryzen 5 5600, RTX 3050, Visual Studio Build Tools 2026.
- Production `cg-live-native.dll` compiled successfully against the pinned official
  OBS 31.1.1 SDK / Qt 6.8.3. No server, browser or network library dependency.
- `native-core` and `native-dock` passed. Coverage includes 6 types × 15 themes,
  draft/program isolation, independent layers, expiry, grapheme boundaries,
  premultiplied alpha, asset normalization/deduplication, corrupt-file recovery,
  package round trip and invalid package rejection, library CRUD/reordering and Dock actions.
- CPU compositor measured about **2.2 ms/frame** at 1920×1080 with three layers on
  this machine. This excludes Qt preview, GPU upload and the rest of OBS; it is
  not a sustained broadcast/recording benchmark or a guarantee of 1080p60.
- The GPU harness loaded the test build of the **same plugin source** into actual
  installed **OBS 33.0.0 / Qt 6.11.1** and official portable **OBS 32.1.2 / Qt 6.8.3** runtimes.
  Both passed module registration, 1920×1080 Source dimensions, Direct3D render/readback,
  50% alpha and color comparison against the CPU surface, transparent background,
  sharing one source in two private test scenes and clean source/module shutdown.
- No OBS user profile, scene collection, installed plugin directory or running
  server was modified. GPU tests use a temporary config directory and no obs-browser.
- OBS 32.1.2 official Windows x64 ZIP was verified against the GitHub release asset
  SHA-256: `8d97e4563bd8d22d03e63042aa7dccede1d555c9bd35ce8a9e5019b0d0201bf6`.

## Reproduce

```powershell
./obs-plugin/build.ps1
./obs-plugin/test-obs.ps1 -ObsRoot 'C:\Program Files\obs-studio'
# Or point ObsRoot at an extracted official OBS Portable runtime.
```

The optional GPU harness requires a working graphics device. It deliberately does
not run in the standard CI test suite because hosted runners may have no GPU.
It exercises the source independently of the OBS application UI, so frontend
interaction is covered by the Dock harness and the remaining manual checks below.
`cg-native-smoke.dll` exposes test-only engine hooks; it is **never** installed or
included in the distributable ZIPs. The production DLL has no test hooks.

Generated diagnostics (ignored by Git):

- `test-output/themes.png`: all 90 type/theme combinations.
- `test-output/dock.png`: actual Qt Dock screenshot.
- `test-output/obs-gpu.png`: transparent GPU readback.
- `test-output/obs-32.1.2.log`, `obs-33.0.0.log`: native runtime test logs.
- `.build/windows/Testing/Temporary/LastTest.log`: CPU/Dock tests and timing.

OBS 33's isolated harness logs an optional `libobs-winrt` lookup and GPU-priority
messages; neither affects the native source rendering assertions. It does not load
capture/browser plugins. The GPU test is an SDR RGBA test, not an HDR certification.

## Still requires target-device validation

- Run the macOS arm64 and x86_64 CI jobs, install on actual Macs, and inspect fonts,
  transparency, packaging, code signing and graphics performance there.
- In the OBS application UI on each target version, verify Dock placement/restoration,
  hotkey bindings and their persistence, repeated Add Source/Add Existing, Studio Mode,
  collection switching, restart and plugin removal.
- Record/stream a sustained 1080p60 scene with long Thai text, ticker and animation
  over bright/dark footage; inspect frame timing and alpha edges.
- GitHub Actions workflow has been added but was not dispatched from this workspace.
- Developer ID signing/notarization is not configured; no credentials are bundled.

These remaining checks are not represented as passed by the automated results.
