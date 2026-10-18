---
description: "The Tweakpane inspector: stats, pause and step, system timings, entity and resource views."
---

# Debug panel

`DebugPlugin` (in `CorePlugins`) is a [Tweakpane](https://tweakpane.github.io/docs/) inspector for dev
builds. It does nothing headless, in production builds, or in `kiln shot`.

| Section | |
|---|---|
| Stats | FPS (with a 12-second graph), frame time, frame, tick, entity count, renderer backend |
| Control | Pause, step one frame, snapshot to the console, vsync and an FPS cap |
| Systems (ms) | Per-system timings, smoothed |
| Entity | Pick an entity by id and edit its trait fields live |
| Resources | Every resource as JSON |

Toggle it with the `` ` `` key; `?debug=0` in the URL hides it.

`debugPlugin({ open: false })` starts it collapsed, and `force: true` shows it outside dev builds.

Turning the plugin on sets `app.profile`, which records per-system timings. Headless runs leave it off.
