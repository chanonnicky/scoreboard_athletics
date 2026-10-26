# Third-party notices

- The `cmake/` build infrastructure and OBS dependency pins come from
  [obsproject/obs-plugintemplate](https://github.com/obsproject/obs-plugintemplate),
  commit `3e7d7ac3b5342cd7d9b88890b9c70b472d1520fc` (GPL-2.0-or-later).
  The plugin source is distributed under the same license; see LICENSE.
- OBS Studio/libobs/obs-frontend-api: GPL-2.0-or-later. Build dependencies are
  downloaded from official OBS releases with SHA-256 verification (`buildspec.json`).
  The SDK baseline is OBS 31.1.1 / Qt 6.8.3; target runtime verification is 32.1.2 and 33.0.0.
- Qt: dynamically linked to the Qt libraries supplied by OBS. No Qt binaries are
  included in the plugin archives. See https://www.qt.io/licensing/.
- Noto Sans Thai: SIL Open Font License 1.1, bundled with its license in `data/fonts/`.
  Source: https://github.com/google/fonts/tree/main/ofl/notosansthai
  Font SHA-256: `5a1c559bb539583c8a1fd99d1c5b9491e5e14478c9cd2bd0970d5c3096cc9ef8`.
- Charmonman Regular/Bold: SIL Open Font License 1.1, copied from this repository's
  existing offline font assets, with the original license in `data/fonts/`.

Only build-time dependency downloads require internet access. The installed plugin
uses local files, Qt and libobs exclusively; it does not open a listener or fetch fonts.
